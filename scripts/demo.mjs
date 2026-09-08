import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const data = mkdtempSync(join(tmpdir(), "dwin-research-demo-"));
const fixture = join(root, "test", "fixtures", "research-radar", "arxiv-sample.xml");
const client = new Client({ name: "dwin-reproducible-demo", version: "0.1.0" }, { capabilities: {} });
const payload = response => response.structuredContent || JSON.parse(response.content[0].text);

try {
  const registered = spawnSync(process.execPath, [join(root, "bin", "dwin-research-adoption.mjs"), "setup-register", "public-product", root], { env: { ...process.env, DWIN_FACTORY_ROOT: root, DWIN_FACTORY_DATA: data }, encoding: "utf8" });
  assert.equal(registered.status, 0, registered.stderr || registered.stdout);
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [join(root, "bin", "dwin-research-adoption.mjs")],
    env: { ...process.env, DWIN_FACTORY_ROOT: root, DWIN_FACTORY_DATA: data, DWIN_ARXIV_FIXTURE: fixture },
    stderr: "pipe"
  }));
  const listed = await client.listTools();
  const names = listed.tools.map(tool => tool.name);
  for (const required of ["factory_validate", "radar_route_problem", "radar_compile_template", "radar_search_template", "document_search", "evidence_search", "setup_search", "setup_reconcile", "research_adoption_status", "memory_status"]) {
    assert.ok(names.includes(required), `missing unified tool ${required}`);
  }
  const validation = await client.callTool({ name: "factory_validate", arguments: {} });
  const validationData = payload(validation);
  assert.equal(validationData.valid, true);
  const route = await client.callTool({ name: "radar_route_problem", arguments: { problem: "How can an AI coding agent retain useful long-term memory without storing unverified claims?", dimension_id: null, limit: 3 } });
  const routeData = payload(route);
  assert.ok(routeData.route.routes.length > 0);
  const plan = await client.callTool({ name: "radar_compile_template", arguments: { template_id: "ai-memory-systems", since: "2026-08-01", until: "2026-09-06", include_phrases: [], exclude_phrases: [], phrase_field: "all", start: 0, max_results: 20, sort_by: "submittedDate", sort_order: "descending" } });
  const planData = payload(plan);
  assert.match(planData.plan.query, /memory/i);
  const search = await client.callTool({ name: "radar_search_template", arguments: { template_id: "ai-memory-systems", since: "2026-08-01", until: "2026-09-06", include_phrases: [], exclude_phrases: [], phrase_field: "all", start: 0, max_results: 20, sort_by: "submittedDate", sort_order: "descending" } });
  const searchData = payload(search);
  assert.ok(searchData.search.papers.length > 0);
  const setupSync = payload(await client.callTool({ name: "setup_sync", arguments: {} }));
  assert.equal(setupSync.status, "ACCEPTED");
  const setupSearch = payload(await client.callTool({ name: "setup_search", arguments: { query: "embedding model revision", context_id: "demo", limit: 3, preview_chars: 120 } }));
  assert.equal(setupSearch.status, "OK");
  const reopened = payload(await client.callTool({ name: "setup_reopen", arguments: { chunk_id: setupSearch.results[0].id, verify_live: true } }));
  assert.equal(reopened.status, "LIVE_VERIFIED");
  const reconciliation = payload(await client.callTool({ name: "setup_reconcile", arguments: { claim: "Agent memory should retain protected raw source evidence, isolate embedding generations, use a fixed schema, and test portability before upgrades.", capabilities: ["source_retention", "provenance", "embedding_identity", "migration_evaluation", "fixed_schema_memory", "approval_gate", "token_measurement"], limit_per_capability: 3 } }));
  assert.equal(reconciliation.gaps, 3);
  const evaluation = payload(await client.callTool({ name: "setup_evaluate_reconciliation", arguments: {} }));
  assert.equal(evaluation.status, "ACCEPTED");
  const memory = payload(await client.callTool({ name: "memory_status", arguments: {} }));
  assert.equal(memory.candidates, 0); assert.equal(memory.claims, 0);
  const summary = {
    schema_version: "dwin.reproducible-demo/v1",
    tool_count: names.length,
    capsules_valid: validationData.capsule_count,
    routed_dimension: routeData.route.routes[0].dimension_id,
    query_hash: createHash("sha256").update(planData.plan.query).digest("hex"),
    retrieved_papers: searchData.search.papers.length,
    cache_status: searchData.search.cache.status,
    setup_index_receipt: setupSync.status,
    evidence_reopen: reopened.status,
    reconciliation_observed: reconciliation.observed,
    reconciliation_gaps: reconciliation.gaps,
    negative_outcome: reconciliation.capabilities.filter(item => item.status === "GAP_CANDIDATE").map(item => item.id),
    evaluation_receipt: evaluation.status,
    memory_candidates: memory.candidates,
    memory_claims: memory.claims,
    network_fixture: true,
    durable_change: false
  };
  assert.doesNotMatch(JSON.stringify(summary), /\/Users\//);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} finally {
  await client.close();
  rmSync(data, { recursive: true, force: true });
}
