import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import { FACTORY_DATA } from "../../../src/paths.mjs";
import { EvidenceStore, registerSource as registerEvidenceSource } from "../../evidence-graph/lib/store.mjs";

export const DATA = join(FACTORY_DATA, "capsules", "setup-intelligence");
export const POLICY = JSON.parse(readFileSync(new URL("../contracts/policy.json", import.meta.url), "utf8"));
export const sha = value => createHash("sha256").update(value).digest("hex");
export const POLICY_HASH = sha(JSON.stringify(POLICY) + readFileSync(new URL(import.meta.url)) + readFileSync(new URL("../../../package.json", import.meta.url)) + process.version + process.arch);

const TYPES = ["instruction", "skill", "mcp", "capsule", "plugin", "contract", "policy", "hook", "steering", "sop", "script", "eval", "fixture", "evidence", "package", "documentation", "config"];
const ROOT = z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/), path: z.string().min(1), kind: z.enum(["directory", "file"]), privacy: z.literal("local-private-no-export"), registered_at: z.string().datetime() }).strict();
const REGISTRY = z.object({ schema_version: z.literal("dwin.setup-sources/v1"), roots: z.array(ROOT).max(POLICY.max_roots) }).strict();
export const SEARCH = z.object({ query: z.string().trim().min(2).max(300), context_id: z.string().min(1).max(100), source_id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/).optional(), component_type: z.enum(TYPES).optional(), limit: z.number().int().min(1).max(POLICY.max_search_results).default(5), preview_chars: z.number().int().min(0).max(POLICY.max_preview_characters).default(500) }).strict();
export const REOPEN = z.object({ chunk_id: z.string().regex(/^[a-f0-9]{64}$/), verify_live: z.boolean().default(true) }).strict();
export const GRAPH = z.object({ node_id: z.string().min(1).max(100), depth: z.number().int().min(1).max(2).default(1), max_nodes: z.number().int().min(1).max(100).default(40) }).strict();
export const RECONCILE = z.object({ claim: z.string().trim().min(10).max(1000), capabilities: z.array(z.enum(["source_retention", "provenance", "embedding_identity", "migration_evaluation", "fixed_schema_memory", "approval_gate", "expiry", "hybrid_retrieval", "setup_inventory", "daily_schedule", "token_measurement"])).min(1).max(11), limit_per_capability: z.number().int().min(1).max(5).default(3) }).strict();

export const CAPABILITIES = {
  source_retention: ["raw source", "source retention", "retain source", "original evidence", "source history"],
  provenance: ["provenance", "source hash", "source_sha256", "exact citation", "page", "bounding box"],
  embedding_identity: ["embedding model", "model revision", "preprocessing configuration", "embedding space", "vector generation"],
  migration_evaluation: ["model upgrade", "embedding migration", "migration test", "baseline", "intervention"],
  fixed_schema_memory: ["fixed schema", "memory schema", "claim schema", "subject predicate object"],
  approval_gate: ["human approval", "approval gate", "explicit approval", "approve every promotion"],
  expiry: ["expires_at", "expiry", "expiration", "supersede"],
  hybrid_retrieval: ["bm25", "fts5", "hybrid retrieval", "semantic candidate", "sqlite-vec"],
  setup_inventory: ["setup index", "component inventory", "skill", "mcp", "contract", "policy"],
  daily_schedule: ["daily schedule", "scheduler", "launchd", "cron", "daily sync"],
  token_measurement: ["token usage", "tokens", "cost per task", "tool calls", "cache hit rate"]
};

const RECONCILIATION_RULES = {
  source_retention: { types: ["skill", "contract", "policy", "mcp"], groups: [["raw source", "original evidence", "source copy", "source history"], ["retain", "retention", "protected"]] },
  provenance: { types: ["contract", "policy", "mcp", "script"], groups: [["source_sha256", "source hash", "provenance"], ["page", "bbox", "bounding box", "offset", "span"]] },
  embedding_identity: { types: ["skill", "contract", "policy", "script"], groups: [["embedding"], ["revision", "fingerprint", "model identity"], ["configuration", "config", "generation", "space"]] },
  migration_evaluation: { types: ["eval"], groups: [["model upgrade", "embedding migration", "writer swap"], ["baseline"], ["intervention"]] },
  fixed_schema_memory: { types: ["contract"], groups: [["memory"], ["schema_version", "schema"], ["claim", "subject", "predicate"]] },
  approval_gate: { types: ["contract", "policy", "mcp", "script"], groups: [["human approval", "explicit-human-approval", "explicit approval"], ["promotion", "promote"]] },
  expiry: { types: ["contract", "policy", "script"], groups: [["expires_at", "expiry", "expiration", "valid_until"], ["required", "supersede", "status"]] },
  hybrid_retrieval: { types: ["contract", "policy", "script"], groups: [["bm25", "fts5"], ["embedding", "semantic", "vector"], ["hybrid", "rrf", "candidate"]] },
  setup_inventory: { types: ["mcp", "capsule", "contract", "script"], groups: [["setup"], ["component"], ["index", "inventory"]] },
  daily_schedule: { types: ["capsule", "script", "config"], groups: [["daily"], ["schedule", "launchd", "cron", "startcalendarinterval"]] },
  token_measurement: { types: ["eval"], groups: [["token usage", "tokens"], ["baseline", "intervention", "comparison"], ["metric", "measured", "usage"]] }
};

const SECRET = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{20,}|npm_[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|gh[oprsu]_[A-Za-z0-9]{20,})\b/;
const privateDir = path => mkdirSync(path, { recursive: true, mode: 0o700 });
function assertPath(path) {
  if (!isAbsolute(path) || !existsSync(path) || lstatSync(path).isSymbolicLink()) throw new Error("Setup root must be an existing absolute non-symlink path");
  const canonical = realpathSync(path);
  if (["/", "/Users", homedir(), "/Volumes", "/tmp", "/private/tmp"].includes(canonical)) throw new Error("Broad setup root is forbidden");
  const stats = statSync(canonical);
  if (!stats.isDirectory() && !stats.isFile()) throw new Error("Setup root must be a regular file or directory");
  if (stats.isFile() && !POLICY.extensions.includes(extname(canonical).toLowerCase())) throw new Error("Unsupported setup file");
  return { path: canonical, kind: stats.isDirectory() ? "directory" : "file" };
}

export function readRegistry(data = DATA) {
  const path = join(data, "sources.json");
  if (!existsSync(path)) return REGISTRY.parse({ schema_version: "dwin.setup-sources/v1", roots: [] });
  const registry = REGISTRY.parse(JSON.parse(readFileSync(path, "utf8")));
  if (new Set(registry.roots.map(root => root.id)).size !== registry.roots.length) throw new Error("Duplicate setup root id");
  return registry;
}

export function registerRoot(id, path, data = DATA) {
  const inspected = assertPath(path), registry = readRegistry(data);
  const prior = registry.roots.find(root => root.id === id);
  if (prior && prior.path !== inspected.path) throw new Error("Setup root id is already bound to another path");
  if (!prior) registry.roots.push(ROOT.parse({ id, ...inspected, privacy: POLICY.privacy, registered_at: new Date().toISOString() }));
  registry.roots.sort((a, b) => a.id.localeCompare(b.id, "en")); REGISTRY.parse(registry); privateDir(data);
  writeFileSync(join(data, "sources.json"), `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
  return { schema_version: "dwin.setup-registration/v1", registered: true, source_id: id, kind: inspected.kind, privacy: POLICY.privacy };
}

function componentType(locator) {
  const lower = locator.toLowerCase(), name = basename(lower), parts = lower.split("/");
  if (["agents.md", "claude.md"].includes(name)) return "instruction";
  if (name === "skill.md") return "skill";
  if (name === "server.json" || name === ".mcp.json" || /^mcp-server\./.test(name)) return "mcp";
  if (name === "capsule.json") return "capsule";
  if (name === "plugin.json") return "plugin";
  if (parts.includes("contracts")) return "contract";
  if (parts.includes("policies") || parts.includes("policy")) return "policy";
  if (parts.includes("hooks")) return "hook";
  if (parts.includes("steering") || parts.includes("steerings")) return "steering";
  if (parts.includes("sop") || parts.includes("sops")) return "sop";
  if (parts.includes("eval") || parts.includes("evals") || parts.includes("test") || parts.includes("tests")) return "eval";
  if (parts.includes("fixture") || parts.includes("fixtures")) return "fixture";
  if (parts.includes("evidence")) return "evidence";
  if (parts.includes("script") || parts.includes("scripts") || parts.includes("jobs") || parts.includes("lib") || parts.includes("src") || parts.includes("bin")) return "script";
  if (name === "package.json") return "package";
  if (["readme.md", "security.md", "license.md"].includes(name) || parts.includes("docs")) return "documentation";
  return "config";
}

function collect(registry) {
  const components = []; let total = 0;
  const readComponent = (root, base, path) => {
    if (lstatSync(path).isSymbolicLink()) throw new Error("Symlink in registered setup is forbidden");
    const canonical = realpathSync(path);
    if (root.kind === "directory" && canonical !== base && !canonical.startsWith(`${base}/`)) throw new Error("Setup path escape");
    const stats = statSync(canonical), extension = extname(canonical).toLowerCase();
    if (!stats.isFile() || !POLICY.extensions.includes(extension)) return;
    if (stats.size > POLICY.max_file_bytes || components.length >= POLICY.max_files) throw new Error("Setup file/count limit exceeded");
    const bytes = readFileSync(canonical); total += bytes.length;
    if (total > POLICY.max_total_bytes) throw new Error("Setup total byte limit exceeded");
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    if (SECRET.test(text)) throw new Error("SECRET_PATTERN_DETECTED: exclude or sanitize this setup source before indexing");
    if (!text.trim()) return;
    const rel = root.kind === "file" ? basename(canonical) : relative(base, canonical), locator = `${root.id}/${rel}`;
    components.push({ id: sha(locator), source_id: root.id, locator, path: canonical, type: componentType(locator), source_hash: sha(bytes), text });
  };
  const walk = (root, base, dir, depth) => {
    if (depth > POLICY.max_depth) throw new Error("Setup depth limit exceeded");
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      if (POLICY.excluded_directories.includes(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Symlink in registered setup is forbidden");
      if (entry.isDirectory()) walk(root, base, path, depth + 1); else if (entry.isFile()) readComponent(root, base, path);
    }
  };
  for (const root of registry.roots) {
    const inspected = assertPath(root.path);
    if (inspected.path !== root.path || inspected.kind !== root.kind) throw new Error("Setup root identity changed");
    if (root.kind === "file") readComponent(root, dirname(root.path), root.path); else walk(root, root.path, root.path, 0);
  }
  return { components, total };
}

function headings(text, type, locator) {
  const found = []; let offset = 0, fence = null;
  if (extname(locator).toLowerCase() === ".md") for (const line of text.split(/(?<=\n)/)) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) fence = fence ? null : marker[1][0];
    if (!marker && !fence) { const heading = line.match(/^#{1,6}\s+(.+?)\s*$/); if (heading) found.push({ offset, title: heading[1] }); }
    offset += line.length;
  }
  return found.length ? found : [{ offset: 0, title: `${type}: ${basename(locator)}` }];
}

function chunksOf(component) {
  const result = [], sections = headings(component.text, component.type, component.locator); let start = 0, heading = sections[0].title;
  while (start < component.text.length) {
    const previous = sections.filter(item => item.offset <= start).at(-1); if (previous) heading = previous.title;
    let end = Math.min(start + POLICY.chunk_characters, component.text.length);
    const next = sections.find(item => item.offset > start && item.offset < end); if (next) end = next.offset;
    const newline = component.text.lastIndexOf("\n", end - 1); if (end < component.text.length && newline > start + POLICY.chunk_characters / 2) end = newline + 1;
    if (end < component.text.length && /[\uDC00-\uDFFF]/.test(component.text[end])) end--;
    const text = component.text.slice(start, end), content_hash = sha(text);
    result.push({ id: sha(`${component.id}:${component.source_hash}:${start}:${content_hash}`), component_id: component.id, source_id: component.source_id, locator: component.locator, component_type: component.type, heading, text, content_hash, source_hash: component.source_hash, char_start: start, char_length: end - start, line_start: component.text.slice(0, start).split("\n").length, line_end: component.text.slice(0, Math.max(start, end - 1)).split("\n").length });
    start = end;
  }
  return result;
}

function matchExpression(terms) {
  const tokens = [...new Set(terms.flatMap(term => term.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) || []).filter(term => term.length > 1))].slice(0, 40);
  if (!tokens.length) throw new Error("QUERY_HAS_NO_TERMS");
  return tokens.map(term => `"${term.replaceAll('"', '""')}"`).join(" OR ");
}

export class SetupStore {
  constructor(data = DATA) {
    this.data = data; privateDir(data); const path = join(data, "setup.sqlite");
    this.db = new Database(path); chmodSync(path, 0o600); this.db.pragma("journal_mode = WAL"); this.db.pragma("busy_timeout = 5000");
    const version = this.db.pragma("user_version", { simple: true }); if (version > 1) { this.db.close(); throw new Error("Unsupported setup index version"); }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS components (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, locator TEXT NOT NULL, path TEXT NOT NULL, type TEXT NOT NULL, source_hash TEXT NOT NULL, text TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chunks (id TEXT PRIMARY KEY, component_id TEXT NOT NULL, source_id TEXT NOT NULL, component_type TEXT NOT NULL, data TEXT NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(id UNINDEXED, component_type UNINDEXED, heading, text, tokenize='unicode61');
      CREATE TABLE IF NOT EXISTS nodes (id TEXT PRIMARY KEY, type TEXT NOT NULL, label TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS edges (id TEXT PRIMARY KEY, src TEXT NOT NULL, dst TEXT NOT NULL, type TEXT NOT NULL, evidence_chunk_id TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS setup_edges_src ON edges(src); CREATE INDEX IF NOT EXISTS setup_edges_dst ON edges(dst);
      PRAGMA user_version = 1;
    `);
  }
  close() { this.db.close(); }
  meta(key) { return this.db.prepare("SELECT value FROM metadata WHERE key=?").get(key)?.value || null; }
  setMeta(key, value) { this.db.prepare("INSERT OR REPLACE INTO metadata VALUES (?,?)").run(key, String(value)); }
  counts() { const value = {}; for (const table of ["components", "chunks", "nodes", "edges"]) value[table] = this.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n; return value; }
  status() {
    const component_types = {}; for (const type of TYPES) component_types[type] = 0;
    for (const row of this.db.prepare("SELECT type,count(*) AS n FROM components GROUP BY type").all()) component_types[row.type] = row.n;
    return { schema_version: "dwin.setup-index/v1", generation: this.meta("generation"), indexed_at: this.meta("indexed_at"), policy_hash: POLICY_HASH, index_policy_matches: this.meta("policy_hash") === POLICY_HASH, counts: this.counts(), component_types, evidence_bridge_generation: this.meta("bridge_generation"), retrieval: { default: "fts5-bm25", semantic: "optional-evidence-graph-candidate-only" }, privacy: POLICY.privacy, instruction_authority: POLICY.instruction_authority, authority: POLICY.authority };
  }
  index() {
    const registry = readRegistry(this.data); if (!registry.roots.length) throw new Error("NO_REGISTERED_SETUP_ROOTS");
    const { components, total } = collect(registry); if (!components.length) throw new Error("NO_SUPPORTED_SETUP_COMPONENTS");
    const generation = sha(JSON.stringify({ policy: POLICY_HASH, roots: registry.roots, components: components.map(component => [component.id, component.source_hash, component.type]) }));
    if (generation === this.meta("generation")) return { schema_version: "dwin.setup-index-report/v1", generation, changed: false, source_bytes_read: total, counts: this.counts(), privacy: POLICY.privacy, authority: POLICY.authority, instruction_authority: POLICY.instruction_authority };
    this.db.transaction(() => {
      for (const table of ["components", "chunks", "chunks_fts", "nodes", "edges"]) this.db.exec(`DELETE FROM ${table}`);
      const node = (id, type, label) => this.db.prepare("INSERT OR IGNORE INTO nodes VALUES (?,?,?)").run(id, type, label);
      const edge = (src, dst, type, chunk) => this.db.prepare("INSERT OR IGNORE INTO edges VALUES (?,?,?,?,?)").run(sha(`${src}:${dst}:${type}`), src, dst, type, chunk);
      const allChunks = [];
      for (const component of components) {
        this.db.prepare("INSERT INTO components VALUES (@id,@source_id,@locator,@path,@type,@source_hash,@text)").run(component);
        node(component.id, "component", component.locator); const chunks = chunksOf(component); allChunks.push(...chunks);
        const typeId = `type:${component.type}`; node(typeId, "component_type", component.type); edge(component.id, typeId, "CLASSIFIED_AS", chunks[0].id);
        for (const chunk of chunks) {
          this.db.prepare("INSERT INTO chunks VALUES (?,?,?,?,?)").run(chunk.id, component.id, component.source_id, component.type, JSON.stringify(chunk));
          this.db.prepare("INSERT INTO chunks_fts VALUES (?,?,?,?)").run(chunk.id, component.type, chunk.heading, chunk.text);
          node(chunk.id, "chunk", chunk.heading); edge(component.id, chunk.id, "HAS_CHUNK", chunk.id);
          const lower = chunk.text.toLowerCase();
          for (const [capability, terms] of Object.entries(CAPABILITIES)) if (terms.some(term => lower.includes(term))) { const id = `capability:${capability}`; node(id, "capability", capability); edge(chunk.id, id, "MENTIONS", chunk.id); }
        }
      }
      const byName = new Map(); for (const component of components) { const name = basename(component.locator).toLowerCase(); byName.set(name, [...(byName.get(name) || []), component]); }
      for (const chunk of allChunks) for (const [name, targets] of byName) if (name.length >= 6 && targets.length === 1 && targets[0].id !== chunk.component_id && chunk.text.toLowerCase().includes(name)) edge(chunk.component_id, targets[0].id, "REFERENCES_COMPONENT", chunk.id);
      this.setMeta("generation", generation); this.setMeta("policy_hash", POLICY_HASH); this.setMeta("registry_hash", sha(JSON.stringify(registry))); this.setMeta("indexed_at", new Date().toISOString()); this.setMeta("bridge_generation", "");
    })();
    return { schema_version: "dwin.setup-index-report/v1", generation, changed: true, source_bytes_read: total, counts: this.counts(), privacy: POLICY.privacy, authority: POLICY.authority, instruction_authority: POLICY.instruction_authority };
  }
  assertSnapshot() {
    if (!this.meta("generation")) throw new Error("SETUP_INDEX_EMPTY");
    if (this.meta("policy_hash") !== POLICY_HASH) throw new Error("SETUP_INDEX_POLICY_CHANGED");
    if (this.meta("registry_hash") !== sha(JSON.stringify(readRegistry(this.data)))) throw new Error("SETUP_SOURCE_SCOPE_CHANGED");
  }
  search(raw) {
    const input = SEARCH.parse(raw); this.assertSnapshot(); const params = [matchExpression([input.query])];
    let where = ""; if (input.source_id) { where += " AND c.source_id=?"; params.push(input.source_id); } if (input.component_type) { where += " AND c.component_type=?"; params.push(input.component_type); } params.push(input.limit + 1);
    const rows = this.db.prepare(`SELECT c.data,bm25(chunks_fts,0,0,3,1) AS rank FROM chunks_fts JOIN chunks c ON c.id=chunks_fts.id WHERE chunks_fts MATCH ?${where} ORDER BY rank,c.id LIMIT ?`).all(...params);
    return { schema_version: "dwin.setup-search/v1", status: rows.length ? "OK" : "NO_HITS", context_id: input.context_id, query: input.query, retrieval_method: "fts5-bm25-literal-or/v1", freshness: "indexed-snapshot-not-live", truncated: rows.length > input.limit, results: rows.slice(0, input.limit).map(row => { const { text, ...chunk } = JSON.parse(row.data); return { ...chunk, preview: text.slice(0, input.preview_chars), preview_truncated: text.length > input.preview_chars, lexical_rank: row.rank }; }), privacy: POLICY.privacy, instruction_authority: POLICY.instruction_authority, authority: POLICY.authority };
  }
  reopen(raw) {
    const input = REOPEN.parse(raw); this.assertSnapshot(); const row = this.db.prepare("SELECT data FROM chunks WHERE id=?").get(input.chunk_id);
    if (!row) return { schema_version: "dwin.setup-chunk/v1", status: "NOT_FOUND", chunk: null, privacy: POLICY.privacy, instruction_authority: POLICY.instruction_authority, authority: POLICY.authority };
    const chunk = JSON.parse(row.data), component = this.db.prepare("SELECT * FROM components WHERE id=?").get(chunk.component_id), bytes = Buffer.from(component.text), text = bytes.subarray(Buffer.byteLength(component.text.slice(0, chunk.char_start)), Buffer.byteLength(component.text.slice(0, chunk.char_start + chunk.char_length))).toString("utf8");
    if (text !== chunk.text || sha(text) !== chunk.content_hash || sha(bytes) !== component.source_hash) throw new Error("SETUP_SNAPSHOT_INTEGRITY_FAILED");
    let status = "SNAPSHOT_VERIFIED";
    if (input.verify_live) { try { status = !lstatSync(component.path).isSymbolicLink() && realpathSync(component.path) === component.path && sha(readFileSync(component.path)) === component.source_hash ? "LIVE_VERIFIED" : "SOURCE_CHANGED"; } catch (error) { status = error.code === "ENOENT" ? "SOURCE_MISSING" : "SOURCE_UNAVAILABLE"; } }
    return { schema_version: "dwin.setup-chunk/v1", status, chunk, privacy: POLICY.privacy, instruction_authority: POLICY.instruction_authority, authority: POLICY.authority };
  }
  neighbors(raw) {
    const input = GRAPH.parse(raw); this.assertSnapshot(); const seen = new Set([input.node_id]), frontier = [input.node_id], edges = []; let truncated = false;
    for (let level = 0; level < input.depth && frontier.length; level++) { const next = []; for (const id of frontier) for (const edge of this.db.prepare("SELECT * FROM edges WHERE src=? OR dst=? ORDER BY id LIMIT 500").all(id, id)) { const other = edge.src === id ? edge.dst : edge.src; if (!edges.some(item => item.id === edge.id)) edges.push(edge); if (!seen.has(other)) { if (seen.size >= input.max_nodes) { truncated = true; continue; } seen.add(other); next.push(other); } } frontier.splice(0, frontier.length, ...next); }
    const nodes = [...seen].map(id => this.db.prepare("SELECT * FROM nodes WHERE id=?").get(id)).filter(Boolean); const allowed = new Set(nodes.map(node => node.id));
    return { schema_version: "dwin.setup-graph/v1", root: input.node_id, depth: input.depth, truncated, nodes, edges: edges.filter(edge => allowed.has(edge.src) && allowed.has(edge.dst)).slice(0, 500), privacy: POLICY.privacy, instruction_authority: POLICY.instruction_authority, authority: POLICY.authority };
  }
  reconcile(raw) {
    const input = RECONCILE.parse(raw); this.assertSnapshot(); const capabilities = input.capabilities.map(id => {
      const rule = RECONCILIATION_RULES[id], rows = this.db.prepare(`SELECT c.data,bm25(chunks_fts,0,0,3,1) AS rank FROM chunks_fts JOIN chunks c ON c.id=chunks_fts.id WHERE chunks_fts MATCH ? ORDER BY rank,c.id LIMIT 100`).all(matchExpression(CAPABILITIES[id]));
      const matches = rows.map(row => ({ row, chunk: JSON.parse(row.data) })).filter(({ chunk }) => {
        const locator = chunk.locator.toLowerCase(), text = chunk.text.toLowerCase();
        if (locator.includes("/fixtures/") || locator.includes("/test/") || locator.includes("/tests/") || locator.includes("/docs/") || (locator.includes("/capsules/setup-intelligence/") && !["setup_inventory", "daily_schedule"].includes(id))) return false;
        return rule.types.includes(chunk.component_type) && rule.groups.every(group => group.some(term => text.includes(term)));
      }).slice(0, input.limit_per_capability).map(({ row, chunk }) => { const { text, ...rest } = chunk; return { ...rest, preview: text.slice(0, 500), preview_truncated: text.length > 500, lexical_rank: row.rank }; });
      return { id, status: matches.length ? "OBSERVED_CANDIDATE" : "GAP_CANDIDATE", matched_by: "typed-multi-indicator-lexical-evidence/v1", matches };
    });
    return { schema_version: "dwin.setup-reconciliation/v1", claim: input.claim, setup_generation: this.meta("generation"), capabilities, observed: capabilities.filter(item => item.status === "OBSERVED_CANDIDATE").length, gaps: capabilities.filter(item => item.status === "GAP_CANDIDATE").length, approval: "required", automatic_change: false, note: "Typed multi-indicator lexical evidence identifies review candidates. Documentation, fixtures, tests, and the analyzer's own taxonomy are excluded from positive implementation evidence; results still do not prove quality, applicability, or permission to edit.", privacy: POLICY.privacy, instruction_authority: POLICY.instruction_authority, authority: POLICY.authority };
  }
  bridgeEvidence(evidenceData) {
    this.assertSnapshot(); const generation = this.meta("generation"), bridgeRoot = join(this.data, "evidence-bridge"); privateDir(bridgeRoot);
    for (const entry of readdirSync(bridgeRoot, { withFileTypes: true })) { if (entry.isSymbolicLink()) throw new Error("Symlink in generated bridge is forbidden"); if (entry.isFile() && entry.name.endsWith(".md")) unlinkSync(join(bridgeRoot, entry.name)); }
    const bridgeComponents = this.db.prepare("SELECT * FROM components ORDER BY locator").all().filter(component => { const locator = component.locator.toLowerCase(); return !locator.includes("/fixtures/") && !locator.includes("/test/") && !locator.includes("/tests/") && !locator.includes("/docs/"); });
    for (const component of bridgeComponents) {
      const text = `# AI-native setup component\n\n- component_id: ${component.id}\n- component_type: ${component.type}\n- source_locator: ${component.locator}\n- source_sha256: ${component.source_hash}\n- setup_generation: ${generation}\n\n## Exact registered content\n\n${component.text.endsWith("\n") ? component.text : `${component.text}\n`}`;
      writeFileSync(join(bridgeRoot, `${component.id}.md`), text, { mode: 0o600 });
    }
    registerEvidenceSource("setup-index", bridgeRoot, evidenceData); const evidence = new EvidenceStore(evidenceData);
    try { const indexed = evidence.index(); this.setMeta("bridge_generation", generation); return { schema_version: "dwin.setup-evidence-bridge/v1", source_id: "setup-index", setup_generation: generation, bridge_files: bridgeComponents.length, excluded_nonproduction_components: this.counts().components - bridgeComponents.length, evidence: { generation: indexed.generation, changed: indexed.changed, counts: indexed.counts }, embedding_status: "REQUIRES_EXPLICIT_EVIDENCE_EMBED_JOB", semantic_authority: POLICY.semantic_role, privacy: POLICY.privacy, authority: POLICY.authority }; } finally { evidence.close(); }
  }
  integrity() {
    this.assertSnapshot(); let invalid_chunks = 0, invalid_edges = 0;
    for (const row of this.db.prepare("SELECT data FROM chunks").all()) { const chunk = JSON.parse(row.data), component = this.db.prepare("SELECT * FROM components WHERE id=?").get(chunk.component_id); if (!component || sha(chunk.text) !== chunk.content_hash || component.text.slice(chunk.char_start, chunk.char_start + chunk.char_length) !== chunk.text) invalid_chunks++; }
    for (const edge of this.db.prepare("SELECT * FROM edges").all()) if (!this.db.prepare("SELECT 1 FROM nodes WHERE id=?").get(edge.src) || !this.db.prepare("SELECT 1 FROM nodes WHERE id=?").get(edge.dst) || !this.db.prepare("SELECT 1 FROM chunks WHERE id=?").get(edge.evidence_chunk_id)) invalid_edges++;
    return { passed: invalid_chunks === 0 && invalid_edges === 0, components: this.counts().components, invalid_chunks, invalid_edges, generation: this.meta("generation") };
  }
}
