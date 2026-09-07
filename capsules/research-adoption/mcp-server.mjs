import { readdirSync, readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runCapsule } from "../../src/executor.mjs";
import { buildPilotAudit } from "./lib/adoption.mjs";
import { DATA, verifyCorpus } from "./lib/corpus.mjs";
import { PROMPT_VERSION } from "./lib/local-extraction.mjs";

const server = new McpServer({ name: "dwin-research-adoption", version: "0.1.0" });
const read = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }, write = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const receipt = z.object({ run_id: z.string(), status: z.enum(["ACCEPTED", "REJECTED", "ERROR"]), source_hash: z.string() }).strict();
const result = value => ({ content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value });
const execute = async job => { const value = await runCapsule("research-adoption", job, { trigger: "mcp" }); return result({ run_id: value.run_id, status: value.status, source_hash: value.source_hash }); };

server.registerTool("research_adoption_status", { description: "Inspect the local pinned-corpus, Docling audit, and current-versus-historical local candidate-cache state without network access or Memory promotion.", inputSchema: z.object({}).strict(), outputSchema: z.object({ corpus_ready: z.boolean(), corpus_reason: z.string().nullable(), expected_papers: z.number().int(), indexed_papers: z.number().int(), parser_gate_passed: z.boolean(), current_cached_extractions: z.number().int(), historical_cached_extractions: z.number().int(), current_prompt_version: z.string(), authority: z.literal("candidate-only"), memory_promotion: z.literal("forbidden") }).strict(), annotations: read }, async () => {
  const corpus = verifyCorpus(); let audit; try { audit = buildPilotAudit(); } catch { audit = { aggregate: { indexed: 0 }, gate_passed: false }; }
  let current = 0, historical = 0; try { for (const name of readdirSync(`${DATA}/local-candidate-cache`).filter(item => item.endsWith(".json"))) { try { const item = JSON.parse(readFileSync(`${DATA}/local-candidate-cache/${name}`, "utf8")); item.prompt_version === PROMPT_VERSION ? current++ : historical++; } catch { historical++; } } } catch {}
  return result({ corpus_ready: corpus.ready, corpus_reason: corpus.reason, expected_papers: 5, indexed_papers: audit.aggregate.indexed, parser_gate_passed: audit.gate_passed, current_cached_extractions: current, historical_cached_extractions: historical, current_prompt_version: PROMPT_VERSION, authority: "candidate-only", memory_promotion: "forbidden" });
});
server.registerTool("research_adoption_sync_pilot", { description: "Download only the five version-pinned official arXiv PDFs, hash them, bind an immutable corpus lock, and register the files for local Docling parsing.", inputSchema: z.object({}).strict(), outputSchema: receipt, annotations: write }, async () => execute("sync-pilot-corpus"));
server.registerTool("research_adoption_audit_pilot", { description: "Audit all five locally parsed papers for source identity, title recovery, page provenance, duplicate blocks, encoding health, and export integrity. This is not a semantic-accuracy score.", inputSchema: z.object({}).strict(), outputSchema: receipt, annotations: write }, async () => execute("audit-pilot-corpus"));
server.registerTool("research_adoption_build_graph", { description: "After an accepted corpus audit, build deterministic paper/PDF/document/block/dimension candidates and bridge Docling Markdown into the private Evidence Graph. No claim or Memory promotion.", inputSchema: z.object({}).strict(), outputSchema: receipt, annotations: write }, async () => execute("build-candidate-graph"));
server.registerTool("research_adoption_extract_local", { description: "Opt-in experiment: use the pinned local qwen3.5:4b model on a bounded block subset to create exact-block-cited, human-unverified candidate extractions. No external inference or automatic adoption.", inputSchema: z.object({}).strict(), outputSchema: receipt, annotations: write }, async () => execute("extract-local-candidates"));
await server.connect(new StdioServerTransport());
