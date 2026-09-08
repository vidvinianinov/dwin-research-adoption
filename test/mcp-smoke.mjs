import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const data = mkdtempSync(join(tmpdir(), "dwin-mcp-smoke-"));
const client = new Client({ name: "dwin-smoke", version: "0.1.0" }, { capabilities: {} });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(root, "bin", "dwin-research-adoption.mjs")], env: { ...process.env, DWIN_FACTORY_ROOT: root, DWIN_FACTORY_DATA: data }, stderr: "pipe" }));
  const listed = await client.listTools();
  assert.equal(listed.tools.length, 38);
  const names = new Set(listed.tools.map(tool => tool.name));
  for (const name of ["factory_validate", "radar_search_template", "document_reopen", "evidence_search_hybrid", "setup_reconcile", "setup_bridge_evidence", "setup_evaluate_reconciliation", "evidence_adoption_graph", "research_adoption_status", "memory_promote"]) assert.ok(names.has(name), name);
  for (const tool of listed.tools) {
    assert.ok(tool.description?.length > 20, `${tool.name} description`);
    assert.equal(typeof tool.annotations?.readOnlyHint, "boolean", `${tool.name} readOnlyHint`);
    assert.equal(typeof tool.annotations?.destructiveHint, "boolean", `${tool.name} destructiveHint`);
    assert.equal(typeof tool.annotations?.openWorldHint, "boolean", `${tool.name} openWorldHint`);
  }
  const status = await client.callTool({ name: "memory_status", arguments: {} });
  assert.equal(status.structuredContent.promotion_gate, "explicit-human-approval");
  assert.doesNotMatch(JSON.stringify(status), /\/Users\//);
  process.stdout.write(`${JSON.stringify({ passed: true, tools: listed.tools.length })}\n`);
} finally {
  await client.close();
  rmSync(data, { recursive: true, force: true });
}
