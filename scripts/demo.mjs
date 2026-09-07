import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
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
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [join(root, "bin", "dwin-research-adoption.mjs")],
    env: { ...process.env, DWIN_FACTORY_ROOT: root, DWIN_FACTORY_DATA: data, DWIN_ARXIV_FIXTURE: fixture },
    stderr: "pipe"
  }));
  const listed = await client.listTools();
  const names = listed.tools.map(tool => tool.name);
  for (const required of ["factory_validate", "radar_route_problem", "radar_compile_template", "radar_search_template", "document_search", "evidence_search", "research_adoption_status", "memory_status"]) {
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
  const summary = {
    schema_version: "dwin.reproducible-demo/v1",
    tool_count: names.length,
    capsules_valid: validationData.capsule_count,
    routed_dimension: routeData.route.routes[0].dimension_id,
    query_hash: createHash("sha256").update(planData.plan.query).digest("hex"),
    retrieved_papers: searchData.search.papers.length,
    cache_status: searchData.search.cache.status,
    network_fixture: true,
    durable_change: false
  };
  assert.doesNotMatch(JSON.stringify(summary), /\/Users\//);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} finally {
  await client.close();
  rmSync(data, { recursive: true, force: true });
}
