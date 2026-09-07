import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractDocument } from "../lib/extractor.mjs";
import { DATA, DocumentStore, POLICY, liveSource, readRegistry, runtimeStatus } from "../lib/store.mjs";

if (!process.env.DWIN_RUN_OUTPUT || !process.env.DWIN_RUN_ID) throw new Error("Factory runtime environment is incomplete");
const runtime = runtimeStatus(undefined, { verify_artifacts: true }); if (!runtime.ready) throw new Error(`DOCLING_RUNTIME_NOT_READY: ${runtime.reason}`);
const registry = readRegistry(); if (!registry.sources.length) throw new Error("NO_REGISTERED_DOCUMENTS");
const store = new DocumentStore(), processed = [], skipped = [], staging = join(DATA, "staging", process.env.DWIN_RUN_ID);
mkdirSync(staging, { recursive: true, mode: 0o700 });
try {
  for (const entry of registry.sources) {
    const source = liveSource(entry);
    if (!store.needsExtraction(source)) { skipped.push({ source_id: source.id, reason: "CURRENT" }); continue; }
    if (processed.length >= POLICY.max_documents_per_run) { skipped.push({ source_id: source.id, reason: "RUN_LIMIT" }); continue; }
    const started = performance.now(), snapshot = await extractDocument(source, staging), saved = store.save(snapshot, source);
    processed.push({ source_id: source.id, source_sha256: source.source_sha256, source_bytes: source.source_bytes, page_count: saved.page_count, block_count: saved.block_count, extraction_duration_ms: Math.round(performance.now() - started), parser: saved.parser, parser_version: saved.parser_version, parser_config_hash: saved.parser_config_hash, model_artifacts_hash: saved.model_artifacts_hash });
  }
  const integrity = store.integrity(processed.map(item => item.source_id));
  const report = { schema_version: "dwin.document-extraction-report/v1", run_id: process.env.DWIN_RUN_ID, processed, skipped, integrity, network_requests: 0, privacy: POLICY.privacy, instruction_authority: POLICY.instruction_authority, authority: POLICY.authority };
  writeFileSync(join(process.env.DWIN_RUN_OUTPUT, "document-extraction-report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ processed: processed.length, skipped: skipped.length, integrity: integrity.passed })}\n`);
  if (!processed.length && !skipped.some(item => item.reason === "CURRENT")) process.exitCode = 1;
} finally { store.close(); }
