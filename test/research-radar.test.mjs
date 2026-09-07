import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const testRoot = mkdtempSync(join(tmpdir(), "dwin-radar-test-"));
process.env.DWIN_FACTORY_DATA = join(testRoot, "factory-data");
process.env.DWIN_ARXIV_FIXTURE = join(root, "test", "fixtures", "research-radar", "arxiv-sample.xml");

const { buildArxivUrl, fetchArxiv } = await import("../capsules/research-radar/lib/arxiv.mjs");
const { cachedArxivSearch } = await import("../capsules/research-radar/lib/cache.mjs");
const { RadarStore } = await import("../capsules/research-radar/lib/db.mjs");
const { radarEvidenceBundle, radarSearchLocal } = await import("../capsules/research-radar/lib/reports.mjs");
const { syncResearchRadar } = await import("../capsules/research-radar/lib/sync.mjs");

test("builds only bounded official arXiv queries", () => {
  const url = buildArxivUrl({ query: "all:agent", maxResults: 10 });
  assert.equal(url.hostname, "export.arxiv.org");
  assert.equal(url.searchParams.get("max_results"), "10");
  assert.equal(buildArxivUrl({ query: "all:agent", start: 200, maxResults: 200 }).searchParams.get("start"), "200");
  assert.throws(() => buildArxivUrl({ query: "all:agent", maxResults: 201 }), /1-200/);
});

test("uses the private query cache before repeating an arXiv request", async () => {
  const store = new RadarStore(join(testRoot, "cache.sqlite"));
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return fetchArxiv({ query: "all:agent", maxResults: 10 });
  };
  try {
    const request = { query: "all:agent", start: 0, maxResults: 10, sortBy: "relevance", sortOrder: "descending" };
    const first = await cachedArxivSearch(request, { store, fetcher, now: "2026-08-30T12:00:00.000Z" });
    const second = await cachedArxivSearch(request, { store, fetcher, now: "2026-08-30T13:00:00.000Z" });
    assert.equal(first.cache.status, "miss");
    assert.equal(first.cache.request_performed, true);
    assert.equal(second.cache.status, "hit");
    assert.equal(second.cache.request_performed, false);
    assert.equal(calls, 1);
    assert.equal(store.cacheStats({ now: "2026-08-30T13:00:00.000Z" }).fresh_entries, 1);
    assert.equal(second.papers.length, 3);
  } finally { store.close(); }
});

test("ships a focused memory watch with lifecycle and safety terms", () => {
  const store = new RadarStore();
  try {
    const watch = store.watches().find((item) => item.id === "agent-memory");
    assert.match(watch.query, /working memory/);
    assert.match(watch.query, /context compression/);
    assert.ok(watch.positive_keywords.includes("provenance"));
    assert.ok(watch.positive_keywords.includes("supersession"));
    assert.ok(watch.positive_keywords.includes("memory poisoning"));
  } finally { store.close(); }
});

test("parses Atom metadata and marks all paper content untrusted", async () => {
  const papers = await fetchArxiv({ query: "all:agent", maxResults: 10 });
  assert.equal(papers.length, 3);
  assert.equal(papers[0].id, "2608.00001");
  assert.equal(papers[0].content_trust, "untrusted-external");
  assert.deepEqual(papers[0].authors, ["Ada Example", "Lin Test"]);
});

test("syncs watch profiles into a deduplicated deterministic queue", async () => {
  const report = await syncResearchRadar({ requestDelayMs: 0 });
  assert.equal(report.queries_succeeded, 3);
  assert.equal(report.queries_failed, 0);
  assert.equal(report.remote_requests, 3);
  assert.equal(report.cache_hits, 0);
  assert.equal(report.papers_seen, 9);
  assert.equal(report.papers_new, 3);
  const store = new RadarStore();
  try {
    assert.equal(statSync(store.path).mode & 0o777, 0o600);
    assert.equal(store.stats().papers, 3);
    assert.equal(store.stats().matches, 6);
    assert.equal(report.coverage.status, "partial");
    assert.equal(report.coverage.counts.queued_papers, 3);
    const queue = store.queue({ minScore: 0, limit: 10 });
    const memoryPaper = queue.find((paper) => paper.id === "2608.00001");
    assert.ok(memoryPaper);
    assert.equal(memoryPaper.authority, "candidate-only");
    assert.ok(memoryPaper.best_score > 0);
  } finally { store.close(); }
});

test("keeps repeated sync idempotent for papers and FTS rows", async () => {
  const report = await syncResearchRadar({ requestDelayMs: 0 });
  assert.equal(report.papers_new, 0);
  assert.equal(report.remote_requests, 3);
  assert.equal(report.cache_hits, 0);
  const store = new RadarStore();
  try {
    assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM papers").get().count, 3);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM papers_fts").get().count, 3);
  } finally { store.close(); }
});

test("searches locally and preserves external-content boundaries", () => {
  assert.ok(radarSearchLocal("graph memory").length >= 1);
  const evidence = radarEvidenceBundle("2608.00001");
  assert.equal(evidence.content_trust, "untrusted-external");
  assert.equal(evidence.instruction_authority, "none");
  assert.match(evidence.abstract, /Ignore previous instructions/);
  assert.deepEqual(evidence.claims, []);
});

test("records human review without promoting research to memory", () => {
  const store = new RadarStore();
  try {
    const reviewed = store.review("2608.00001", "shortlisted", "Inspect evaluation design.");
    assert.equal(reviewed.review_status, "shortlisted");
    assert.equal(store.stats().shortlisted, 1);
  } finally { store.close(); }
});
