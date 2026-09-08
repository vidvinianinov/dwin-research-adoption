import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCapsule } from "./executor.mjs";
import { validateAll } from "./manifests.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const childIds = ["research-radar", "document-intelligence", "evidence-graph", "setup-intelligence", "research-adoption", "memory-graph"];
const children = new Map();
const toolOwners = new Map();
const basicToolNames = new Set([
  "radar_route_problem", "radar_search_templates", "radar_compile_template", "radar_search_template",
  "radar_search_local", "radar_queue", "radar_get_paper", "radar_lookup_ids",
  "document_status", "document_sync", "document_search", "document_reopen",
  "evidence_status", "evidence_sync", "evidence_search", "evidence_reopen", "evidence_embedding_status", "evidence_embed", "evidence_search_hybrid",
  "evidence_record_adoption", "evidence_adoption_graph", "research_adoption_status",
  "setup_status", "setup_sync", "setup_search", "setup_reopen", "setup_graph", "setup_reconcile", "setup_bridge_evidence", "setup_evaluate_reconciliation",
  "memory_status", "memory_search", "memory_graph", "memory_propose", "memory_promote", "memory_validate"
]);
const toolProfile = process.env.DWIN_TOOL_PROFILE === "full" ? "full" : "basic";

function scrub(value) {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrub(item)]));
  if (typeof value !== "string") return value;
  return value
    .replace(/\/Users\/[A-Za-z0-9._-]+(?:\/[^\s"']*)?/g, "[local-path-redacted]")
    .replace(/[A-Za-z]:\\Users\\[^\s"']+/g, "[local-path-redacted]");
}

function asResult(value) {
  const clean = scrub(value);
  return { content: [{ type: "text", text: JSON.stringify(clean, null, 2) }], structuredContent: clean };
}

const localTools = [
  {
    name: "factory_validate",
    title: "Validate research adoption factory",
    description: "Validate every bundled capsule manifest and policy admission without network access or state changes.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: { type: "object", properties: { valid: { type: "boolean" }, capsule_count: { type: "integer" }, capsules: { type: "array" } }, required: ["valid", "capsule_count", "capsules"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  {
    name: "factory_run_health",
    title: "Run bounded factory health evaluation",
    description: "Run the declared local health job and return its hashed evaluator-gated receipt summary.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: { type: "object", properties: { run_id: { type: "string" }, status: { type: "string", enum: ["ACCEPTED", "REJECTED", "ERROR"] }, source_hash: { type: "string" } }, required: ["run_id", "status", "source_hash"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }
];

async function connectChildren() {
  await Promise.all(childIds.map(async id => {
    const client = new Client({ name: `dwin-unified-${id}`, version: "0.2.0" }, { capabilities: {} });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(root, "capsules", id, "mcp-server.mjs")],
      env: { ...process.env, DWIN_FACTORY_ROOT: root },
      stderr: "pipe"
    });
    await client.connect(transport);
    const listed = await client.listTools();
    for (const tool of listed.tools) {
      if (toolOwners.has(tool.name)) throw new Error(`Duplicate MCP tool name: ${tool.name}`);
      toolOwners.set(tool.name, id);
    }
    children.set(id, { client, tools: listed.tools });
  }));
}

await connectChildren();

const server = new Server({ name: "dwin-research-adoption", version: "0.2.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [...localTools, ...childIds.flatMap(id => children.get(id).tools).filter(tool => toolProfile === "full" || basicToolNames.has(tool.name))]
}));

server.setRequestHandler(CallToolRequestSchema, async request => {
  const { name, arguments: args = {} } = request.params;
  if (name === "factory_validate") return asResult(validateAll());
  if (name === "factory_run_health") {
    const receipt = await runCapsule("factory-health", "daily-health", { trigger: "mcp" });
    return asResult({ run_id: receipt.run_id, status: receipt.status, source_hash: receipt.source_hash });
  }
  const owner = toolOwners.get(name);
  if (!owner || (toolProfile !== "full" && !basicToolNames.has(name))) throw new Error(`Tool is not available in the ${toolProfile} profile: ${name}`);
  return scrub(await children.get(owner).client.callTool({ name, arguments: args }));
});

async function closeChildren() {
  await Promise.allSettled([...children.values()].map(item => item.client.close()));
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await closeChildren();
    process.exit(0);
  });
}

await server.connect(new StdioServerTransport());
