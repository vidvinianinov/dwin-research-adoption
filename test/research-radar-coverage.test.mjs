import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const testRoot = mkdtempSync(join(tmpdir(), "dwin-radar-coverage-"));
process.env.DWIN_FACTORY_DATA = join(testRoot, "factory-data");
delete process.env.DWIN_ARXIV_FIXTURE;
const { RadarStore } = await import("../capsules/research-radar/lib/db.mjs");
const { cachedArxivSearch } = await import("../capsules/research-radar/lib/cache.mjs");
const { parseArxivPage, buildArxivUrl, fetchArxivPage } = await import("../capsules/research-radar/lib/arxiv.mjs");
const { syncResearchRadar, researchCoverage } = await import("../capsules/research-radar/lib/sync.mjs");
const { activateResearchTemplate, researchWatchDrift, routeResearchProblem, researchTemplates } = await import("../capsules/research-radar/lib/templates.mjs");

function paper(index, version = 1, updated = "2026-08-30T12:00:00.000Z") {
  const id = `2608.${String(index).padStart(5, "0")}`;
  return { id, version_id: `${id}v${version}`, title: `Retrieval paper ${index}`, summary: `SQLite dense retrieval evidence ${index}`,
    authors: ["Fixture Author"], categories: ["cs.IR"], primary_category: "cs.IR", published_at: "2026-08-01T00:00:00.000Z", updated_at: updated,
    abs_url: `https://arxiv.org/abs/${id}v${version}`, pdf_url: `https://arxiv.org/pdf/${id}v${version}`, content_trust: "untrusted-external", source: "arxiv-api" };
}
function page(total, start, count, mapper = (i) => paper(i + 1)) {
  return { papers: Array.from({ length: count }, (_, i) => mapper(start + i)), metadata: { total_results: total, start_index: start, items_per_page: count, verified: true } };
}
function onlyWatch(store, id = "coverage-watch") {
  store.db.prepare("UPDATE watchlists SET enabled=0").run();
  store.upsertWatch({ id, name: "Coverage watch", query: "all:retrieval", category: "cs.IR", positive_keywords: ["retrieval"], negative_keywords: [], enabled: true });
}

test("resumes a paper beyond position 25 after restart and never reports first page as complete", async () => {
  const path = join(testRoot, "resume.sqlite");
  let store = new RadarStore(path); onlyWatch(store);
  const calls = [];
  const fetcher = async (request) => { calls.push(request.start); return page(30, request.start, Math.min(request.maxResults, 30 - request.start)); };
  let report = await syncResearchRadar({ store, mode: "backfill", maxResults: 10, maxPages: 2, requestDelayMs: 0, fetcher, now: "2026-08-31T10:00:00.000Z" });
  assert.equal(report.coverage.status, "partial");
  assert.deepEqual(calls, [0, 10]);
  assert.equal(report.coverage.states.find((state) => state.id === "coverage-watch:submissions").next_start, 20);
  store.close();
  store = new RadarStore(path);
  report = await syncResearchRadar({ store, mode: "backfill", maxResults: 10, maxPages: 1, requestDelayMs: 0, fetcher, now: "2026-08-31T10:01:00.000Z" });
  assert.equal(calls.at(-1), 20);
  assert.ok(store.paper("2608.00030"));
  assert.equal(report.coverage.states.find((state) => state.id === "coverage-watch:submissions").status, "observed-exhausted");
  store.close();
});

test("duplicate equal-date page boundary stays partial instead of claiming stable traversal", async () => {
  const store = new RadarStore(join(testRoot, "duplicates.sqlite")); onlyWatch(store, "equal-date-watch");
  const fetcher = async ({ start }) => start === 0 ? page(19, 0, 10) : page(19, 10, 9, (i) => paper(i)); // repeats paper 10
  const report = await syncResearchRadar({ store, mode: "backfill", maxResults: 10, maxPages: 2, requestDelayMs: 0, fetcher, now: "2026-08-31T11:00:00.000Z" });
  const state = report.coverage.states.find((item) => item.id === "equal-date-watch:submissions");
  assert.equal(state.status, "partial");
  assert.equal(state.reason, "unstable-offset-traversal-requires-recheck");
  assert.equal(state.duplicate_entries, 1);
  store.close();
});

test("stale fallback performs no cursor progress", async () => {
  const store = new RadarStore(join(testRoot, "stale.sqlite")); onlyWatch(store, "stale-watch");
  const first = await syncResearchRadar({ store, mode: "backfill", maxResults: 10, maxPages: 1, requestDelayMs: 0,
    fetcher: async ({ start }) => page(30, start, 10), now: "2026-08-01T00:00:00.000Z" });
  const state = first.coverage.states.find((item) => item.id === "stale-watch:submissions");
  const request = { query: store.db.prepare("SELECT json_extract(state_json,'$.query') AS query FROM scan_states WHERE id=?").get("stale-watch:submissions").query,
    start: 10, maxResults: 10, sortBy: "submittedDate", sortOrder: "descending" };
  const requestUrl = buildArxivUrl(request).toString();
  store.putCachedSearch({ requestUrl, request, ...page(30, 10, 10), fetchedAt: "2026-08-01T00:00:00.000Z", ttlSeconds: 60 });
  const second = await syncResearchRadar({ store, mode: "backfill", maxResults: 10, maxPages: 1, requestDelayMs: 0,
    fetcher: async () => { throw new Error("offline"); }, now: "2026-08-03T00:00:00.000Z" });
  const after = second.coverage.states.find((item) => item.id === "stale-watch:submissions");
  assert.equal(state.next_start, 10);
  assert.equal(after.next_start, 10);
  assert.equal(after.reason, "stale-fallback-no-progress");
  store.close();
});

test("one-off discovery reaches queue and immutable cache retains v1 after canonical v2", async () => {
  const store = new RadarStore(join(testRoot, "versions.sqlite"));
  const request = { query: "all:sqlite", start: 0, maxResults: 10, sortBy: "relevance", sortOrder: "descending" };
  const first = await cachedArxivSearch(request, { store, requestDelayMs: 0, now: "2026-08-01T00:00:00.000Z", fetcher: async () => page(1, 0, 1, () => paper(53, 1)) });
  const v1key = first.papers[0].version_key;
  assert.equal(store.queue({ limit: 10 }).some((item) => item.id === "2608.00053"), true);
  store.review("2608.00053", "read", "v1 reviewed", v1key);
  store.upsertPaper(paper(53, 2, "2026-08-30T12:00:00.000Z"), "2026-08-30T12:01:00.000Z");
  const cached = store.cachedSearch(first.request_url, { now: "2026-08-01T00:00:10.000Z" });
  assert.equal(cached.papers[0].version_id, "2608.00053v1");
  assert.equal(store.paperVersion(v1key).version_id, "2608.00053v1");
  assert.equal(store.paper("2608.00053").version_id, "2608.00053v2");
  assert.equal(store.paper("2608.00053").review_status, "needs-review");
  store.upsertPaper(paper(53, 1), "2026-08-31T00:00:00.000Z");
  assert.equal(store.paper("2608.00053").version_id, "2608.00053v2");
  store.close();
});

test("preserves custom watches on reopen and refuses silent catalog replacement", () => {
  const path = join(testRoot, "migration.sqlite");
  let store = new RadarStore(path);
  store.upsertWatch({ id: "agent-memory", name: "My custom memory", query: "all:custom", category: null, positive_keywords: ["custom"], negative_keywords: [], enabled: true });
  store.close();
  store = new RadarStore(path);
  const activation = activateResearchTemplate("ai-memory-systems", {}, store);
  assert.equal(activation.conflict, true);
  assert.equal(store.watches().find((item) => item.id === "agent-memory").query, "all:custom");
  const drift = researchWatchDrift(store).find((item) => item.watch_id === "agent-memory");
  assert.equal(drift.state, "drift");
  assert.equal(drift.automatic_replacement, false);
  store.close();
});

test("shared SQLite limiter serializes request starts across store instances", () => {
  const path = join(testRoot, "limiter.sqlite");
  const first = new RadarStore(path), second = new RadarStore(path);
  assert.equal(first.reserveRequest({ nowMs: 1000, delayMs: 3000 }), 0);
  assert.equal(second.reserveRequest({ nowMs: 1000, delayMs: 3000 }), 3000);
  first.close(); second.close();
});

test("token-boundary routing does not treat retrieval as eval and explicit Russian stems remain inspectable", () => {
  const retrieval = routeResearchProblem("multilingual retrieval infrastructure", { limit: 5 });
  assert.ok(retrieval.routes.some((item) => item.dimension_id === "retrieval-ranking"));
  assert.ok(!retrieval.routes.some((item) => item.dimension_id === "evaluation"));
  const russian = routeResearchProblem("эмпирическая оценка мультиязычного поиска", { limit: 5 });
  assert.ok(russian.routes.some((route) => route.reasons.some((reason) => reason.type === "explicit-ru-stem")));
  for (const id of ["sqlite-retrieval", "dense-vector-indexing", "governed-memory", "hybrid-retrieval-reranking"])
    assert.ok(researchTemplates().some((template) => template.id === id));
});

test("rejects Atom errors, redirect escapes, inconsistent pages and unrequested id_list papers", async () => {
  const atomError = `<?xml version="1.0"?><feed><entry><id>http://arxiv.org/api/errors#x</id><updated>2026-08-01</updated><published>2026-08-01</published><title>Error</title><summary>bad query</summary></entry></feed>`;
  assert.throws(() => parseArxivPage(atomError), /Atom error/);
  const inconsistent = `<?xml version="1.0"?><feed xmlns:opensearch="x"><opensearch:totalResults>0</opensearch:totalResults><opensearch:startIndex>0</opensearch:startIndex><opensearch:itemsPerPage>0</opensearch:itemsPerPage><entry><id>http://arxiv.org/abs/2608.00001v1</id><updated>2026-08-01T00:00:00Z</updated><published>2026-08-01T00:00:00Z</published><title>X</title><summary>X</summary></entry></feed>`;
  assert.throws(() => parseArxivPage(inconsistent), /Inconsistent/);
  const redirect = new Response(null, { status: 302, headers: { location: "https://evil.example/api" } });
  await assert.rejects(fetchArxivPage({ query: "all:x", maxResults: 1 }, { fixturePath: null, fetchImpl: async () => redirect }), /allowlist/);
  const store = new RadarStore(join(testRoot, "ids.sqlite"));
  await assert.rejects(cachedArxivSearch({ ids: ["2608.00001"], start: 0, maxResults: 50, sortBy: "lastUpdatedDate", sortOrder: "descending" }, { store, requestDelayMs: 0, fetcher: async () => page(1, 0, 1, () => paper(2)) }), /unrequested/);
  store.close();
});

test("valid empty range remains an explicit bounded observation", async () => {
  const store = new RadarStore(join(testRoot, "empty.sqlite")); onlyWatch(store, "empty-watch");
  const report = await syncResearchRadar({ store, mode: "backfill", maxPages: 1, requestDelayMs: 0, now: "2026-08-31T12:00:00.000Z",
    fetcher: async ({ start }) => page(0, start, 0) });
  const state = report.coverage.states.find((item) => item.id === "empty-watch:submissions");
  assert.equal(state.status, "observed-exhausted");
  assert.equal(report.papers_seen, 0);
  assert.equal(researchCoverage(store).status, "partial"); // unscanned revision lane is still explicit
  store.close();
});
