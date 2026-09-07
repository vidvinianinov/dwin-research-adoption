import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractDocument } from "../lib/extractor.mjs";
import { CONFIG_HASH, DocumentStore, POLICY, sha } from "../lib/store.mjs";

if (!process.env.DWIN_RUN_OUTPUT || !process.env.DWIN_RUN_ID || !process.env.DWIN_CAPSULE_ROOT) throw new Error("Factory runtime environment is incomplete");
const path = join(process.env.DWIN_CAPSULE_ROOT, "fixtures", "research-note.pdf"), bytes = readFileSync(path);
const source = { id: "fixture-research-note", path, source_sha256: sha(bytes), source_bytes: bytes.length, privacy: POLICY.privacy, registered_at: "2026-09-05T00:00:00.000Z" };
const store = new DocumentStore(join(process.env.DWIN_RUN_OUTPUT, "fixture-store"));
try {
  const snapshot = await extractDocument(source, join(process.env.DWIN_RUN_OUTPUT, "staging"));
  const saved = store.save(snapshot, source), search = store.search({ query: "grounded evidence", source_id: source.id, limit: 5 }), integrity = store.integrity([source.id]);
  const report = { schema_version: "dwin.document-fixture-evaluation/v1", run_id: process.env.DWIN_RUN_ID, expected: { parser: "docling", parser_version: POLICY.parser_version, parser_config_hash: CONFIG_HASH, title_phrase: "DWIN Grounded Document Fixture", table_terms: ["Baseline", "Intervention"], formula_token: "Recall" }, observed: { source_sha256: saved.source_sha256, source_bytes: saved.source_bytes, page_count: saved.page_count, block_count: saved.block_count, parser: saved.parser, parser_version: saved.parser_version, parser_config_hash: saved.parser_config_hash, model_artifacts_hash: saved.model_artifacts_hash, labels: [...new Set(snapshot.blocks.map(block => block.label))].sort(), markdown_contains_title: snapshot.markdown.includes("DWIN Grounded Document Fixture"), markdown_contains_table_terms: ["Baseline", "Intervention"].every(term => snapshot.markdown.includes(term)), markdown_contains_formula_token: snapshot.markdown.includes("Recall"), search_hits: search.results.length }, integrity, network_requests: 0, privacy: POLICY.privacy, instruction_authority: POLICY.instruction_authority, authority: POLICY.authority };
  writeFileSync(join(process.env.DWIN_RUN_OUTPUT, "document-fixture-evaluation.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ page_count: saved.page_count, block_count: saved.block_count, search_hits: search.results.length, integrity: integrity.passed })}\n`);
} finally { store.close(); }
