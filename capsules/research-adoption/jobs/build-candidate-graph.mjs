import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildCandidateGraph } from "../lib/adoption.mjs";
if (!process.env.DWIN_RUN_OUTPUT) throw new Error("DWIN_RUN_OUTPUT required");
const graph = buildCandidateGraph();
writeFileSync(join(process.env.DWIN_RUN_OUTPUT, "research-candidate-graph.json"), `${JSON.stringify(graph, null, 2)}\n`, { mode: 0o600 });
writeFileSync(join(process.env.DWIN_RUN_OUTPUT, "document-evidence-lineage.json"), `${JSON.stringify({ schema_version: "dwin.document-evidence-lineage/v1", corpus_id: graph.corpus_id, corpus_state_hash: graph.corpus_state_hash, evidence_generation: graph.evidence_graph.generation, lineage: graph.lineage, authority: graph.authority, instruction_authority: graph.instruction_authority }, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ nodes: graph.nodes.length, edges: graph.edges.length, evidence_generation: graph.evidence_graph.generation })}\n`);
