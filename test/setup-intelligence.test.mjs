import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SetupStore, registerRoot } from "../capsules/setup-intelligence/lib/store.mjs";
import { EvidenceStore } from "../capsules/evidence-graph/lib/store.mjs";
import { evaluateReconciliation } from "../capsules/setup-intelligence/lib/evaluation.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "dwin-setup-test-"));
  const source = join(root, "setup"), data = join(root, "data"), evidenceData = join(root, "evidence");
  cpSync(new URL("../capsules/setup-intelligence/fixtures/sample-setup/", import.meta.url), source, { recursive: true });
  registerRoot("sample", source, data);
  const store = new SetupStore(data); store.index();
  return { root, source, data, evidenceData, store };
}

test("indexes typed setup components with exact lexical and graph provenance", () => {
  const x = fixture();
  try {
    const status = x.store.status();
    assert.ok(status.counts.components >= 7);
    for (const type of ["instruction", "skill", "mcp", "contract", "policy", "hook", "eval"]) assert.ok(status.component_types[type] >= 1, type);
    const search = x.store.search({ query: "embedding model revision", context_id: "unit" });
    assert.equal(search.status, "OK");
    const reopened = x.store.reopen({ chunk_id: search.results[0].id, verify_live: true });
    assert.equal(reopened.status, "LIVE_VERIFIED");
    assert.match(reopened.chunk.text, /embedding/i);
    const graph = x.store.neighbors({ node_id: search.results[0].id, depth: 2, max_nodes: 20 });
    assert.ok(graph.nodes.length > 1);
    assert.ok(graph.edges.every(edge => ["HAS_CHUNK", "CLASSIFIED_AS", "MENTIONS", "REFERENCES_COMPONENT"].includes(edge.type)));
  } finally { x.store.close(); }
});

test("reconciliation distinguishes observed lexical candidates from explicit gaps", () => {
  const x = fixture();
  try {
    const result = x.store.reconcile({ claim: "Memory must survive embedding migrations and retain raw evidence.", capabilities: ["source_retention", "embedding_identity", "token_measurement"], limit_per_capability: 3 });
    assert.equal(result.capabilities.find(item => item.id === "source_retention").status, "OBSERVED_CANDIDATE");
    assert.equal(result.capabilities.find(item => item.id === "embedding_identity").status, "OBSERVED_CANDIDATE");
    assert.equal(result.capabilities.find(item => item.id === "token_measurement").status, "GAP_CANDIDATE");
    assert.equal(result.approval, "required");
  } finally { x.store.close(); }
});

test("bridges sanitized typed snapshots into Evidence Graph for optional hybrid retrieval", () => {
  const x = fixture();
  try {
    const bridged = x.store.bridgeEvidence(x.evidenceData);
    assert.equal(bridged.source_id, "setup-index");
    assert.equal(bridged.evidence.changed, true);
    const evidence = new EvidenceStore(x.evidenceData);
    try {
      const hit = evidence.search({ query: "embedding spaces", context_id: "bridge", source_id: "setup-index" });
      assert.equal(hit.status, "OK");
      assert.doesNotMatch(hit.packet.results[0].preview, /dwin-setup-test-/);
      assert.equal(evidence.integrity().passed, true);
    } finally { evidence.close(); }
  } finally { x.store.close(); }
});

test("fails closed on broad roots, symlinks, secrets and stale live sources", () => {
  assert.throws(() => registerRoot("broad", "/", join(tmpdir(), "dwin-broad-data")), /Broad/);
  const x = fixture();
  try {
    const secret = join(x.source, "policies", "secret.md");
    writeFileSync(secret, "credential=" + "sk-" + "A".repeat(40));
    assert.throws(() => x.store.index(), /SECRET_PATTERN/);
    unlinkSync(secret);
    const link = join(x.source, "skills", "escape.md");
    symlinkSync(join(x.source, "AGENTS.md"), link);
    assert.throws(() => x.store.index(), /Symlink/);
    unlinkSync(link);
    const hit = x.store.search({ query: "human approves", context_id: "fresh" }).results[0];
    writeFileSync(join(x.source, "AGENTS.md"), "# Changed\n");
    assert.equal(x.store.reopen({ chunk_id: hit.id, verify_live: true }).status, "SOURCE_CHANGED");
    assert.equal(readFileSync(join(x.data, "sources.json"), "utf8").includes(x.source), true);
  } finally { x.store.close(); }
});

test("evaluates naive versus typed reconciliation without inventing model-token savings", () => {
  const x = fixture();
  try {
    const report = evaluateReconciliation(x.store, { case_id: "fixture", paper: { id: "2609.05339", version: 1, url: "https://arxiv.org/abs/2609.05339", content_trust: "untrusted-external" }, claim: "Retain raw evidence and isolate embedding model revisions.", expected: { source_retention: "OBSERVED_CANDIDATE", embedding_identity: "OBSERVED_CANDIDATE", token_measurement: "GAP_CANDIDATE" } });
    assert.equal(report.metrics.capability_status_accuracy, 1);
    assert.equal(report.metrics.model_tokens, null);
    assert.equal(report.boundaries.memory_changed, false);
    assert.equal(report.boundaries.decision, "deferred");
  } finally { x.store.close(); }
});
