import { randomUUID, createHash } from "node:crypto";
import { fetchArxivPage } from "./arxiv.mjs";
import { cachedArxivSearch } from "./cache.mjs";
import { RadarStore } from "./db.mjs";
import { scorePaper } from "./ranking.mjs";

const DAY = 86_400_000, OVERLAP = 3 * DAY;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const dateField = (date) => date.slice(0, 16).replace(/\D/g, "");
const iso = (time) => new Date(time).toISOString();
const MODES = new Set(["auto", "submissions", "backfill", "revisions"]);
const LIMITATIONS = [
  "Offset pagination is not a stable server snapshot; changed totals, duplicates and equal-date movement can hide entries.",
  "Observed exhaustion is a bounded API traversal, not scientific relevance recall or guaranteed exhaustive coverage.",
  "Revision scans use update ordering, not a first-submission filter; tracked id lookups are an additional bounded lane.",
];

function save(store, state) {
  store.db.prepare("INSERT INTO scan_states(id,watch_id,lane,query_hash,state_json,last_attempt_at,not_before) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET query_hash=excluded.query_hash,state_json=excluded.state_json,last_attempt_at=excluded.last_attempt_at,not_before=excluded.not_before")
    .run(state.id, state.watch_id, state.lane, state.query_hash, JSON.stringify(state), state.last_attempt_at, state.not_before);
}
function load(store) { return store.db.prepare("SELECT state_json FROM scan_states ORDER BY id").all().map((row) => JSON.parse(row.state_json)); }
function archive(store, state, now) {
  store.db.prepare("INSERT OR IGNORE INTO scan_history(id,state_id,state_json,recorded_at) VALUES (?,?,?,?)")
    .run(hash(JSON.stringify(state)), state.id, JSON.stringify(state), now);
}
function initialize(store, watch, lane, now, previous = null) {
  const lower = previous?.status === "observed-exhausted" ? Date.parse(previous.window.until) - OVERLAP : Date.parse(now) - 90 * DAY;
  const state = {
    id: watch.id + ":" + lane, watch_id: watch.id, lane, query_hash: hash(watch.query),
    window: { since: iso(lower), until: now, kind: previous?.status === "observed-exhausted" ? "incremental-overlap" : "initial-90-day-backfill" },
    query: watch.query, next_start: 0, total_results: null, observed_ids: [], duplicate_entries: 0,
    status: "partial", reason: "not-started", last_attempt_at: previous?.last_attempt_at || null,
    not_before: null, stale_fallbacks: 0, total_changed: false, pages: 0, last_snapshot_id: null,
  };
  if (lane === "submissions") state.query = "(" + watch.query + ") AND submittedDate:[" + dateField(state.window.since) + " TO " + dateField(now) + "]";
  save(store, state);
  return state;
}
function prepareStates(store, watches, now) {
  const states = new Map(load(store).map((state) => [state.id, state]));
  for (const watch of watches) for (const lane of ["submissions", "revisions"]) {
    const previous = states.get(watch.id + ":" + lane);
    if (!previous || previous.query_hash !== hash(watch.query)) {
      if (previous) archive(store, previous, now);
      initialize(store, watch, lane, now);
    } else if (previous.status === "observed-exhausted" && (!previous.not_before || previous.not_before <= now)) {
      archive(store, previous, now); initialize(store, watch, lane, now, previous);
    }
  }
  const existing = states.get("tracked-revisions");
  if ((!existing || existing.status === "observed-exhausted" && existing.not_before <= now)) {
    const ids = store.db.prepare("SELECT p.id FROM papers p LEFT JOIN revision_checks c ON c.paper_id=p.id WHERE c.checked_at IS NULL OR c.checked_at<? ORDER BY COALESCE(c.checked_at,''),p.id LIMIT 50").all(iso(Date.parse(now) - DAY)).map((row) => row.id);
    if (ids.length) {
      if (existing) archive(store, existing, now);
      save(store, { id: "tracked-revisions", watch_id: null, lane: "tracked-revisions", query_hash: hash(JSON.stringify(ids)), ids,
        window: { since: now, until: now, kind: "tracked-id-batch" }, query: null, next_start: 0, total_results: null,
        observed_ids: [], duplicate_entries: 0, status: "partial", reason: "not-started", last_attempt_at: existing?.last_attempt_at || null,
        not_before: null, stale_fallbacks: 0, total_changed: false, pages: 0, last_snapshot_id: null });
    }
  }
}

export function researchCoverage(store) {
  const enabled = new Set(store.watches({ enabledOnly: true }).map((watch) => watch.id));
  const states = load(store).filter((state) => !state.watch_id || enabled.has(state.watch_id));
  const counts = store.db.prepare("SELECT (SELECT COUNT(*) FROM papers) AS papers,(SELECT COUNT(DISTINCT paper_id) FROM discoveries) AS queued_papers,(SELECT COUNT(*) FROM paper_versions) AS immutable_versions,(SELECT COUNT(*) FROM discoveries) AS discovery_observations").get();
  return {
    schema_version: "dwin.research-coverage/v1", authority: "candidate-only",
    status: states.length && states.every((state) => state.status === "observed-exhausted") ? "bounded-observed-exhausted" : "partial",
    counts, states: states.map(({ observed_ids, ids, query, ...state }) => ({ ...state, unique_papers_observed: observed_ids.length, tracked_ids_count: ids?.length || 0 })),
    limitations: LIMITATIONS, default_page_size: 50, max_pages_per_run: 3, max_run_ms: 105_000,
  };
}

export async function syncResearchRadar({
  store: suppliedStore = null, maxResults = 50, maxPages = 3, maxRunMs = 105_000,
  requestDelayMs = process.env.DWIN_ARXIV_FIXTURE ? 0 : 3000, fetcher = fetchArxivPage,
  mode = "auto", now = new Date().toISOString(),
} = {}) {
  if (!MODES.has(mode)) throw new Error("Invalid scan mode");
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 200 || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 3) throw new Error("Scan budget must be 1-200 results/page and 1-3 pages");
  if (!Number.isInteger(maxRunMs) || maxRunMs < 100 || maxRunMs > 105_000) throw new Error("Invalid scan time budget");
  const store = suppliedStore || new RadarStore(), shouldClose = !suppliedStore;
  const deadlineMs = Date.now() + maxRunMs;
  const syncId = "research_" + now.replace(/[-:.TZ]/g, "") + "_" + randomUUID().slice(0, 8);
  const watches = store.watches({ enabledOnly: true }), byWatch = new Map(watches.map((watch) => [watch.id, watch]));
  const report = {
    schema_version: "dwin.research-sync-report/v2", sync_id: syncId, source: "arxiv-api", endpoint_domain: "export.arxiv.org",
    authority: "candidate-only", content_trust: "untrusted-external", started_at: now, finished_at: null, mode,
    queries_attempted: 0, queries_succeeded: 0, queries_failed: 0, papers_seen: 0, papers_new: 0,
    matches_upserted: 0, cache_hits: 0, remote_requests: 0, stale_fallbacks: 0, version_changes: 0, failures: [],
    pages_budget: maxPages, runtime_budget_ms: maxRunMs, pages: [], coverage: null,
  };
  let runInserted = false;
  try {
    store.db.transaction(() => {
      const lease = store.db.prepare("SELECT * FROM scan_lease WHERE id=1").get();
      if (lease && lease.until_ms > Date.now()) throw new Error("Another Research Radar scan holds the bounded lease");
      store.db.prepare("INSERT INTO scan_lease(id,owner,until_ms) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,until_ms=excluded.until_ms").run(syncId, deadlineMs + 5000);
    }).immediate();
    store.db.prepare("INSERT INTO sync_runs(id,started_at,status,queries_attempted) VALUES (?,?,'running',0)").run(syncId, now);
    runInserted = true;
    prepareStates(store, watches, now);
    const attempted = new Set();
    for (let pageNumber = 0; pageNumber < maxPages && Date.now() < deadlineMs - 1000; pageNumber += 1) {
      const state = load(store).filter((state) =>
        (!state.watch_id || byWatch.has(state.watch_id)) && state.status !== "observed-exhausted"
        && !["offset-cap-requires-narrower-watch", "unstable-offset-traversal-requires-recheck", "empty-page-before-total"].includes(state.reason)
        && !attempted.has(state.id)
        && (mode === "auto" || mode === "revisions" && state.lane !== "submissions"
          || mode === "submissions" && state.lane === "submissions"
          || mode === "backfill" && state.lane === "submissions" && state.window.kind === "initial-90-day-backfill"))
        .sort((a, b) => String(a.last_attempt_at || "").localeCompare(String(b.last_attempt_at || "")) || a.id.localeCompare(b.id))[0];
      if (!state) break;
      report.queries_attempted += 1;
      const start = state.next_start;
      const request = state.lane === "tracked-revisions" ? { ids: state.ids, start: 0, maxResults: 50, sortBy: "lastUpdatedDate", sortOrder: "descending" }
        : { query: state.query, start, maxResults, sortBy: state.lane === "revisions" ? "lastUpdatedDate" : "submittedDate", sortOrder: "descending" };
      state.last_attempt_at = iso(Date.now()); // durable fairness also after a rejected request
      try {
        const search = await cachedArxivSearch(request, { store, fetcher, now, requestDelayMs, deadlineMs });
        report.queries_succeeded += 1;
        report.cache_hits += Number(search.cache.status === "hit");
        report.remote_requests += Number(search.cache.request_performed);
        report.stale_fallbacks += Number(search.cache.status === "stale-fallback");
        report.papers_seen += search.papers.length; report.papers_new += search.papers_new; report.version_changes += search.version_changes;
        if (state.watch_id) {
          const watch = byWatch.get(state.watch_id);
          store.db.transaction(() => {
            for (const paper of search.papers) {
              const ranking = scorePaper(paper, watch);
              store.upsertMatch({ paperId: paper.id, watchId: watch.id, syncId, score: ranking.score, scoreVersion: ranking.score_version, reasons: ranking.reasons, seenAt: now });
              report.matches_upserted += 1;
            }
          })();
        }
        state.last_snapshot_id = search.cache.snapshot_id;
        if (search.cache.stale) {
          state.status = "partial"; state.reason = "stale-fallback-no-progress"; state.stale_fallbacks += 1; attempted.add(state.id);
        } else if (state.lane === "tracked-revisions") {
          const returned = new Set(search.papers.map((paper) => paper.id));
          const complete = state.ids.every((id) => returned.has(id));
          state.observed_ids = [...returned]; state.pages += 1;
          state.status = complete ? "observed-exhausted" : "partial";
          state.reason = complete ? "tracked-identifiers-returned" : "tracked-identifiers-missing";
          if (complete) {
            store.db.transaction(() => { for (const id of state.ids) store.db.prepare("INSERT INTO revision_checks(paper_id,checked_at) VALUES (?,?) ON CONFLICT(paper_id) DO UPDATE SET checked_at=excluded.checked_at").run(id, now); })();
            state.not_before = iso(Date.parse(now) + DAY);
          }
          attempted.add(state.id);
        } else if (!search.metadata.verified) {
          state.status = "partial"; state.reason = "pagination-metadata-missing-no-progress"; attempted.add(state.id);
        } else {
          const unique = new Set(state.observed_ids);
          for (const paper of search.papers) { if (unique.has(paper.id)) state.duplicate_entries += 1; unique.add(paper.id); }
          state.observed_ids = [...unique]; state.pages += 1;
          if (state.total_results !== null && state.total_results !== search.metadata.total_results) state.total_changed = true;
          state.total_results = search.metadata.total_results;
          const next = start + search.papers.length;
          const belowRevisionWindow = state.lane === "revisions" && search.papers.some((paper) => Date.parse(paper.updated_at) < Date.parse(state.window.since));
          const exhausted = next >= state.total_results || belowRevisionWindow;
          state.next_start = next;
          if (exhausted && !state.duplicate_entries && !state.total_changed) {
            state.status = "observed-exhausted"; state.reason = belowRevisionWindow ? "bounded-update-window-observed" : "feed-total-observed";
            state.not_before = iso(Date.parse(now) + DAY); attempted.add(state.id);
          } else {
            state.status = "partial"; state.reason = exhausted ? "unstable-offset-traversal-requires-recheck" : "page-budget-pending";
            if (!search.papers.length || next >= 2000 || exhausted) {
              state.reason = next >= 2000 ? "offset-cap-requires-narrower-watch" : exhausted ? state.reason : "empty-page-before-total";
              attempted.add(state.id);
            }
          }
        }
        report.pages.push({ state_id: state.id, start, returned: search.papers.length, total_results: search.metadata.total_results, cache_status: search.cache.status, status: state.status, reason: state.reason, snapshot_id: search.cache.snapshot_id });
      } catch (error) {
        report.queries_failed += 1;
        state.status = "partial"; state.reason = "request-failed-no-progress"; attempted.add(state.id);
        report.failures.push({ watch_id: state.watch_id, state_id: state.id, error_class: error.name || "Error", message: String(error.message || error).slice(0, 300) });
      }
      save(store, state);
    }
    report.finished_at = new Date().toISOString();
    report.coverage = researchCoverage(store);
    report.status = report.queries_failed ? "partial-errors" : report.coverage.status;
    store.db.prepare("UPDATE sync_runs SET finished_at=?,status=?,queries_attempted=?,queries_succeeded=?,queries_failed=?,papers_seen=?,papers_new=?,matches_upserted=?,report_json=? WHERE id=?")
      .run(report.finished_at, report.status, report.queries_attempted, report.queries_succeeded, report.queries_failed, report.papers_seen, report.papers_new, report.matches_upserted, JSON.stringify(report), syncId);
    return report;
  } catch (error) {
    if (runInserted) {
      report.finished_at = new Date().toISOString(); report.status = "error";
      report.failures.push({ watch_id: null, state_id: null, error_class: error.name || "Error", message: String(error.message || error).slice(0, 300) });
      store.db.prepare("UPDATE sync_runs SET finished_at=?,status='error',queries_attempted=?,queries_succeeded=?,queries_failed=?,papers_seen=?,papers_new=?,matches_upserted=?,report_json=? WHERE id=?")
        .run(report.finished_at, report.queries_attempted, report.queries_succeeded, report.queries_failed + 1, report.papers_seen, report.papers_new, report.matches_upserted, JSON.stringify(report), syncId);
    }
    throw error;
  } finally {
    store.db.prepare("DELETE FROM scan_lease WHERE owner=?").run(syncId);
    if (shouldClose) store.close();
  }
}
