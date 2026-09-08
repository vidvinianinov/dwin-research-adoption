import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, ""), data = mkdtempSync(join(tmpdir(), "dwin-adoption-test-"));
process.env.DWIN_FACTORY_ROOT = root; process.env.DWIN_FACTORY_DATA = data;
const { CORPUS, fetchPinnedPdf, syncPilotCorpus, verifyCorpus } = await import("../capsules/research-adoption/lib/corpus.mjs");
const { dailyPilotStateHonest } = await import("../capsules/research-adoption/lib/adoption.mjs");

function pdfResponse(versionId) { return new Response(Buffer.from(`%PDF-1.4\n${versionId}\n%%EOF\n`), { status: 200, headers: { "content-type": "application/pdf" } }); }
const radar = { paperVersion: key => { const paper = CORPUS.papers.find(item => item.version_key === key); return paper ? { ...paper } : null; } };

test("pins five PDFs once and then serves immutable local snapshots", async () => {
  let calls = 0; const registered = [];
  const first = await syncPilotCorpus({ data, radar, runId: "test-1", fetchImpl: async url => { calls++; return pdfResponse(String(url).split("/").at(-1)); }, register: (id, path) => registered.push([id, path]) });
  assert.equal(first.report.network_requests, 5); assert.equal(calls, 5); assert.equal(registered.length, 5); assert.equal(verifyCorpus(data).ready, true);
  const second = await syncPilotCorpus({ data, radar, runId: "test-2", fetchImpl: async () => { throw new Error("network must not run"); }, register: () => {} });
  assert.equal(second.report.network_requests, 0); assert.ok(second.report.papers.every(item => item.status === "cache-hit"));
});

test("rejects redirects outside official arXiv PDF paths", async () => {
  await assert.rejects(() => fetchPinnedPdf("2608.24188v1", { fetchImpl: async () => new Response(null, { status: 302, headers: { location: "https://example.com/paper.pdf" } }) }), /OUTSIDE_ALLOWLIST/);
});

test("rejects non-PDF response bodies", async () => {
  await assert.rejects(() => fetchPinnedPdf("2608.24188v1", { fetchImpl: async () => new Response("not a pdf", { status: 200 }) }), /PDF_MAGIC_INVALID/);
});

test("treats an unprovisioned optional pilot as honest action-required state", () => {
  const idle = { corpus: { ready: false, parser_gate_passed: false }, local_extraction: { papers_complete: 0 }, next_actions: ["repair-pilot-parser-gate", "continue-bounded-local-extraction"] };
  assert.equal(dailyPilotStateHonest(idle), true);
  assert.equal(dailyPilotStateHonest({ ...idle, corpus: { ready: false, parser_gate_passed: true } }), false);
  assert.equal(dailyPilotStateHonest({ ...idle, next_actions: [] }), false);
  assert.equal(dailyPilotStateHonest({ corpus: { ready: true, parser_gate_passed: true }, local_extraction: { papers_complete: CORPUS.papers.length }, next_actions: [] }), true);
});
