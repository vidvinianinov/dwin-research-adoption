import Database from "better-sqlite3";
import Ajv from "ajv";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { extname, isAbsolute, join, relative } from "node:path";
import { z } from "zod";
import { FACTORY_DATA } from "../../../src/paths.mjs";

export const DATA = join(FACTORY_DATA, "capsules", "document-intelligence");
export const RUNTIME = join(FACTORY_DATA, "runtimes", "document-intelligence");
export const POLICY = JSON.parse(readFileSync(new URL("../contracts/policy.json", import.meta.url), "utf8"));
export const sha = value => createHash("sha256").update(value).digest("hex");
export const CONFIG_HASH = sha(JSON.stringify(POLICY));
const snapshotSchema = JSON.parse(readFileSync(new URL("../contracts/document-snapshot.schema.json", import.meta.url), "utf8"));
const validateSnapshot = new Ajv({ allErrors: true, strict: true }).compile(snapshotSchema);

const SOURCE = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  path: z.string().min(1),
  privacy: z.literal("local-private-no-export"),
  registered_at: z.string().datetime(),
}).strict();
const REGISTRY = z.object({ schema_version: z.literal("dwin.document-sources/v1"), sources: z.array(SOURCE).max(POLICY.max_sources) }).strict();
export const SEARCH = z.object({
  query: z.string().trim().min(2).max(300),
  source_id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/).optional(),
  limit: z.number().int().min(1).max(POLICY.max_search_results).default(5),
  preview_chars: z.number().int().min(0).max(POLICY.max_preview_characters).default(500),
}).strict();
export const LIST = z.object({ limit: z.number().int().min(1).max(50).default(20) }).strict();
export const BLOCKS = z.object({
  source_id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  page_no: z.number().int().min(1).max(POLICY.max_pages).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  after_ordinal: z.number().int().min(-1).default(-1),
  preview_chars: z.number().int().min(0).max(POLICY.max_preview_characters).default(500),
}).strict();
export const REOPEN = z.object({ block_id: z.string().regex(/^[a-f0-9]{64}$/), verify_live: z.boolean().default(true) }).strict();

function privateDir(path) { mkdirSync(path, { recursive: true, mode: 0o700 }); }
function atomicJson(path, value) {
  const next = `${path}.next`;
  writeFileSync(next, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(next, path);
}
function inspectSource(path) {
  if (!isAbsolute(path)) throw new Error("Source path must be absolute");
  if (!existsSync(path)) throw new Error("Source file does not exist");
  if (lstatSync(path).isSymbolicLink()) throw new Error("Source symlink is forbidden");
  const canonical = realpathSync(path), stats = statSync(canonical);
  if (!stats.isFile()) throw new Error("Source must be one regular file");
  if (!POLICY.supported_extensions.includes(extname(canonical).toLowerCase())) throw new Error("Unsupported source extension");
  if (stats.size < 1 || stats.size > POLICY.max_file_bytes) throw new Error("Source size limit exceeded");
  return { path: canonical, bytes: stats.size };
}

export function readRegistry(data = DATA) {
  const path = join(data, "sources.json");
  if (!existsSync(path)) return REGISTRY.parse({ schema_version: "dwin.document-sources/v1", sources: [] });
  const registry = REGISTRY.parse(JSON.parse(readFileSync(path, "utf8")));
  if (new Set(registry.sources.map(source => source.id)).size !== registry.sources.length) throw new Error("Duplicate source id");
  return registry;
}

export function registerSource(id, path, data = DATA) {
  const inspected = inspectSource(path), registry = readRegistry(data);
  const prior = registry.sources.find(source => source.id === id);
  if (prior && prior.path !== inspected.path) throw new Error("Source id is already bound to another file");
  if (!prior) registry.sources.push(SOURCE.parse({ id, path: inspected.path, privacy: POLICY.privacy, registered_at: new Date().toISOString() }));
  registry.sources.sort((a, b) => a.id.localeCompare(b.id, "en"));
  REGISTRY.parse(registry); privateDir(data); atomicJson(join(data, "sources.json"), registry);
  return { schema_version: "dwin.document-registration/v1", registered: true, source_id: id, source_bytes: inspected.bytes, privacy: POLICY.privacy };
}

export function liveSource(source) {
  const inspected = inspectSource(source.path);
  if (inspected.path !== source.path) throw new Error("Source identity changed");
  const bytes = readFileSync(source.path);
  return { ...source, source_bytes: bytes.length, source_sha256: sha(bytes) };
}

function artifactTreeHash(dir) {
  const hash = createHash("sha256"), visit = current => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Symlink in model artifacts is forbidden");
      if (entry.isDirectory()) visit(path); else if (entry.isFile()) { hash.update(relative(dir, path)); hash.update("\0"); hash.update(readFileSync(path)); hash.update("\0"); }
    }
  };
  visit(dir); return hash.digest("hex");
}

export function runtimeStatus(runtime = RUNTIME, { verify_artifacts = false } = {}) {
  const manifestPath = join(runtime, "runtime-manifest.json");
  if (!existsSync(manifestPath)) return { ready: false, reason: "RUNTIME_MANIFEST_MISSING", expected_parser_version: POLICY.parser_version, parser_config_hash: CONFIG_HASH };
  let manifest;
  try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); } catch { return { ready: false, reason: "RUNTIME_MANIFEST_INVALID", expected_parser_version: POLICY.parser_version, parser_config_hash: CONFIG_HASH }; }
  const python = join(runtime, "venv", "bin", "python"), models = join(runtime, "models");
  let ready = manifest.schema_version === "dwin.document-runtime/v1" && manifest.docling_version === POLICY.parser_version && manifest.ocrmac_version === "1.0.1" && /^[a-f0-9]{64}$/.test(manifest.model_tree_sha256 || "") && existsSync(python) && existsSync(models), reason = ready ? null : "RUNTIME_IDENTITY_MISMATCH", artifacts_verified = false;
  if (ready && verify_artifacts) {
    artifacts_verified = artifactTreeHash(models) === manifest.model_tree_sha256;
    if (!artifacts_verified) { ready = false; reason = "MODEL_ARTIFACT_HASH_MISMATCH"; }
  }
  return { ready, reason, expected_parser_version: POLICY.parser_version, parser_config_hash: CONFIG_HASH, artifacts_verified, manifest };
}

function redactPath(path) { return path ? `registered://${sha(path).slice(0, 16)}` : null; }

export class DocumentStore {
  constructor(data = DATA) {
    this.data = data; privateDir(data); privateDir(join(data, "exports"));
    const dbPath = join(data, "documents.sqlite");
    this.db = new Database(dbPath); chmodSync(dbPath, 0o600);
    this.db.pragma("journal_mode = WAL"); this.db.pragma("busy_timeout = 5000");
    const version = this.db.pragma("user_version", { simple: true });
    if (version > 2) { this.db.close(); throw new Error("Unsupported document index version"); }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        source_id TEXT PRIMARY KEY, source_path TEXT NOT NULL, source_sha256 TEXT NOT NULL,
        source_bytes INTEGER NOT NULL, parser TEXT NOT NULL, parser_version TEXT NOT NULL,
        parser_config_hash TEXT NOT NULL, model_artifacts_hash TEXT NOT NULL, page_count INTEGER NOT NULL, block_count INTEGER NOT NULL,
        docling_json_path TEXT NOT NULL, docling_json_sha256 TEXT NOT NULL,
        markdown_path TEXT NOT NULL, markdown_sha256 TEXT NOT NULL, indexed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS blocks (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, ordinal INTEGER NOT NULL, page_no INTEGER, label TEXT NOT NULL, text TEXT NOT NULL, text_sha256 TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS blocks_source_ordinal ON blocks(source_id, ordinal);
      CREATE INDEX IF NOT EXISTS blocks_source_page ON blocks(source_id, page_no);
      CREATE VIRTUAL TABLE IF NOT EXISTS blocks_fts USING fts5(id UNINDEXED, source_id UNINDEXED, label, text, tokenize='unicode61');
    `);
    if (version === 1) this.db.exec("ALTER TABLE documents ADD COLUMN model_artifacts_hash TEXT NOT NULL DEFAULT 'unknown';");
    this.db.pragma("user_version = 2");
  }
  close() { this.db.close(); }
  get(sourceId) { return this.db.prepare("SELECT * FROM documents WHERE source_id=?").get(sourceId) || null; }
  needsExtraction(source) {
    const current = this.get(source.id);
    const runtime = runtimeStatus();
    return !current || current.source_sha256 !== source.source_sha256 || current.parser_version !== POLICY.parser_version || current.parser_config_hash !== CONFIG_HASH || (runtime.ready && current.model_artifacts_hash !== runtime.manifest.model_tree_sha256);
  }
  save(snapshot, source) {
    if (!validateSnapshot(snapshot)) throw new Error(`Snapshot contract failed: ${new Ajv().errorsText(validateSnapshot.errors)}`);
    if (snapshot.source_id !== source.id || snapshot.source_sha256 !== source.source_sha256 || snapshot.source_bytes !== source.source_bytes) throw new Error("Extraction/source identity mismatch");
    if (snapshot.parser !== POLICY.parser || snapshot.parser_version !== POLICY.parser_version || snapshot.parser_config_hash !== CONFIG_HASH || !/^[a-f0-9]{64}$/.test(snapshot.model_artifacts_hash)) throw new Error("Parser identity mismatch");
    if (!Array.isArray(snapshot.blocks) || snapshot.blocks.length < 1 || snapshot.blocks.length > POLICY.max_blocks) throw new Error("Block count outside policy");
    if (snapshot.page_count < 1 || snapshot.page_count > POLICY.max_pages) throw new Error("Page count outside policy");
    for (const block of snapshot.blocks) {
      if (!block.text || block.text.length > POLICY.max_block_characters || sha(block.text) !== block.text_sha256) throw new Error("Block integrity failed");
    }
    const exportRoot = join(this.data, "exports", source.id); privateDir(exportRoot);
    const jsonPath = join(exportRoot, `${snapshot.source_sha256}.docling.json`), markdownPath = join(exportRoot, `${snapshot.source_sha256}.md`);
    const jsonText = `${JSON.stringify(snapshot.docling_document, null, 2)}\n`, markdownText = snapshot.markdown.endsWith("\n") ? snapshot.markdown : `${snapshot.markdown}\n`;
    writeFileSync(jsonPath, jsonText, { mode: 0o600 }); writeFileSync(markdownPath, markdownText, { mode: 0o600 });
    const indexedAt = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM blocks_fts WHERE source_id=?").run(source.id);
      this.db.prepare("DELETE FROM blocks WHERE source_id=?").run(source.id);
      for (const block of snapshot.blocks) {
        const pageNo = block.provenance[0]?.page_no || null;
        this.db.prepare("INSERT INTO blocks VALUES (?,?,?,?,?,?,?,?)").run(block.id, source.id, block.ordinal, pageNo, block.label, block.text, block.text_sha256, JSON.stringify(block));
        this.db.prepare("INSERT INTO blocks_fts VALUES (?,?,?,?)").run(block.id, source.id, block.label, block.text);
      }
      this.db.prepare(`INSERT OR REPLACE INTO documents (source_id,source_path,source_sha256,source_bytes,parser,parser_version,parser_config_hash,model_artifacts_hash,page_count,block_count,docling_json_path,docling_json_sha256,markdown_path,markdown_sha256,indexed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
        source.id, source.path, source.source_sha256, source.source_bytes, snapshot.parser, snapshot.parser_version,
        snapshot.parser_config_hash, snapshot.model_artifacts_hash, snapshot.page_count, snapshot.blocks.length, jsonPath, sha(jsonText), markdownPath, sha(markdownText), indexedAt
      );
    })();
    return this.get(source.id);
  }
  status() {
    const registry = readRegistry(this.data), documents = this.db.prepare("SELECT count(*) AS n FROM documents").get().n, blocks = this.db.prepare("SELECT count(*) AS n FROM blocks").get().n;
    let fresh = 0, stale = 0, unavailable = 0;
    for (const source of registry.sources) {
      try { const live = liveSource(source); this.needsExtraction(live) ? stale++ : fresh++; } catch { unavailable++; }
    }
    return { schema_version: "dwin.document-status/v1", runtime: runtimeStatus(), registered_sources: registry.sources.length, indexed_documents: documents, indexed_blocks: blocks, fresh_sources: fresh, stale_sources: stale, unavailable_sources: unavailable, privacy: POLICY.privacy, instruction_authority: POLICY.instruction_authority, authority: POLICY.authority };
  }
  list(raw = {}) {
    const input = LIST.parse(raw), registry = new Map(readRegistry(this.data).sources.map(source => [source.id, source]));
    const rows = this.db.prepare("SELECT * FROM documents ORDER BY indexed_at DESC,source_id LIMIT ?").all(input.limit);
    return { schema_version: "dwin.document-list/v1", documents: rows.map(row => ({ source_id: row.source_id, source_locator: redactPath(registry.get(row.source_id)?.path), source_sha256: row.source_sha256, source_bytes: row.source_bytes, parser: row.parser, parser_version: row.parser_version, parser_config_hash: row.parser_config_hash, model_artifacts_hash: row.model_artifacts_hash, page_count: row.page_count, block_count: row.block_count, indexed_at: row.indexed_at, exports: { docling_json_sha256: row.docling_json_sha256, markdown_sha256: row.markdown_sha256 } })), privacy: POLICY.privacy, authority: POLICY.authority };
  }
  blocks(raw) {
    const input = BLOCKS.parse(raw), params = [input.source_id, input.after_ordinal];
    let page = ""; if (input.page_no) { page = " AND page_no=?"; params.push(input.page_no); }
    params.push(input.limit + 1);
    const rows = this.db.prepare(`SELECT data FROM blocks WHERE source_id=? AND ordinal>?${page} ORDER BY ordinal LIMIT ?`).all(...params).map(row => JSON.parse(row.data));
    return { schema_version: "dwin.document-blocks/v1", source_id: input.source_id, truncated: rows.length > input.limit, blocks: rows.slice(0, input.limit).map(({ text, ...block }) => ({ ...block, preview: text.slice(0, input.preview_chars), preview_truncated: text.length > input.preview_chars })), privacy: POLICY.privacy, authority: POLICY.authority };
  }
  search(raw) {
    const input = SEARCH.parse(raw), terms = [...new Set(input.query.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) || [])].slice(0, 30);
    if (!terms.length) throw new Error("QUERY_HAS_NO_TERMS");
    const match = terms.map(term => `"${term.replaceAll('"', '""')}"`).join(" OR "), params = [match];
    let scoped = ""; if (input.source_id) { scoped = " AND b.source_id=?"; params.push(input.source_id); }
    params.push(input.limit + 1);
    const rows = this.db.prepare(`SELECT b.data,bm25(blocks_fts,0,0,2,1) AS rank FROM blocks_fts JOIN blocks b ON b.id=blocks_fts.id WHERE blocks_fts MATCH ?${scoped} ORDER BY rank,b.id LIMIT ?`).all(...params);
    return { schema_version: "dwin.document-search/v1", query: input.query, retrieval_method: "fts5-bm25-literal-or/v1", truncated: rows.length > input.limit, results: rows.slice(0, input.limit).map(row => { const { text, ...block } = JSON.parse(row.data); return { ...block, preview: text.slice(0, input.preview_chars), preview_truncated: text.length > input.preview_chars, lexical_rank: row.rank }; }), privacy: POLICY.privacy, instruction_authority: POLICY.instruction_authority, authority: POLICY.authority };
  }
  reopen(raw) {
    const input = REOPEN.parse(raw), row = this.db.prepare("SELECT data,source_id FROM blocks WHERE id=?").get(input.block_id);
    if (!row) throw new Error("BLOCK_NOT_FOUND");
    const block = JSON.parse(row.data), document = this.get(row.source_id);
    let live = { status: "NOT_CHECKED", source_sha256: null };
    if (input.verify_live) {
      try { const source = readRegistry(this.data).sources.find(item => item.id === row.source_id); if (!source) throw new Error("UNREGISTERED"); const current = liveSource(source); live = { status: current.source_sha256 === document.source_sha256 ? "LIVE_VERIFIED" : "SOURCE_CHANGED", source_sha256: current.source_sha256 }; }
      catch { live = { status: "SOURCE_UNAVAILABLE", source_sha256: null }; }
    }
    return { schema_version: "dwin.document-block/v1", block, indexed_source_sha256: document.source_sha256, live, privacy: POLICY.privacy, instruction_authority: POLICY.instruction_authority, authority: POLICY.authority };
  }
  integrity(sourceIds = null) {
    const documents = sourceIds ? this.db.prepare(`SELECT * FROM documents WHERE source_id IN (${sourceIds.map(() => "?").join(",")})`).all(...sourceIds) : this.db.prepare("SELECT * FROM documents").all();
    let invalidBlocks = 0, missingExports = 0;
    for (const document of documents) {
      for (const row of this.db.prepare("SELECT text,text_sha256,data FROM blocks WHERE source_id=?").all(document.source_id)) {
        const block = JSON.parse(row.data); if (sha(row.text) !== row.text_sha256 || block.id !== sha(`${document.source_sha256}:${block.ordinal}:${block.label}:${block.text_sha256}`)) invalidBlocks++;
      }
      for (const [path, expected] of [[document.docling_json_path, document.docling_json_sha256], [document.markdown_path, document.markdown_sha256]]) if (!existsSync(path) || sha(readFileSync(path)) !== expected) missingExports++;
    }
    return { passed: invalidBlocks === 0 && missingExports === 0, document_count: documents.length, invalid_blocks: invalidBlocks, missing_or_changed_exports: missingExports };
  }
}
