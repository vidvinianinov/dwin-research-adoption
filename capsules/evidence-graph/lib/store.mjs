import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import { FACTORY_DATA } from "../../../src/paths.mjs";

export const DATA = join(FACTORY_DATA, "capsules", "evidence-graph");
export const POLICY = JSON.parse(readFileSync(new URL("../contracts/policy.json", import.meta.url), "utf8"));
export const sha = value => createHash("sha256").update(value).digest("hex");
export const POLICY_HASH = sha(JSON.stringify(POLICY) + readFileSync(new URL(import.meta.url)) +
  readFileSync(new URL("./contracts.mjs", import.meta.url)) + readFileSync(new URL("../../../package.json", import.meta.url)) + process.version + process.arch);
const ROOT = z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/), path: z.string().min(1), kind: z.enum(["directory","file"]), privacy: z.literal("local-private-no-export") }).strict();
const REGISTRY = z.object({ schema_version: z.literal("dwin.evidence-sources/v1"), roots: z.array(ROOT).max(POLICY.max_roots) }).strict();
export const SEARCH = z.object({
  query: z.string().trim().min(2).max(300), context_id: z.string().min(1).max(100),
  source_id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/).optional(),
  limit: z.number().int().min(1).max(20).default(5), preview_chars: z.number().int().min(0).max(1200).default(350),
  known_packet_hash: z.string().regex(/^[a-f0-9]{64}$/).optional(), bypass_cache: z.boolean().default(false)
}).strict();
export const REOPEN = z.object({chunk_id:z.string().regex(/^[a-f0-9]{64}$/),verify_live:z.boolean().default(true)}).strict();
export const NEIGHBORS = z.object({node_id:z.string().min(1).max(100),depth:z.number().int().min(1).max(2).default(1),max_nodes:z.number().int().min(1).max(100).default(40)}).strict();

export const CONCEPTS = {
  provenance: ["evidence", "provenance", "source_sha256", "exact span", "locator"],
  authority: ["approval", "human decision", "authority", "promotion"],
  retrieval: ["bm25", "fts5", "retrieval", "rerank", "rrf"],
  semantic: ["embedding", "semantic", "vector", "sqlite-vec"],
  cache: ["cache", "caching", "memoization"],
  context: ["context", "prompt", "truncation"],
  execution: ["dag", "ledger", "workflow", "checkpoint"],
  evaluation: ["evaluation", "empirical", "holdout", "baseline", "regression"],
  privacy: ["privacy", "redaction", "export", "secret"],
  recovery: ["rollback", "retry", "fallback", "timeout"],
  adoption: ["adoption", "runtime", "installed", "fresh-session"],
  learning: ["learning", "skill", "sop", "resolution"],
  local_models: ["local llm", "ollama", "xenova", "model identity"]
};

function privateDir(path) { mkdirSync(path, { recursive: true, mode: 0o700 }); }
function assertDirectory(path) {
  if (!isAbsolute(path) || lstatSync(path).isSymbolicLink()) throw new Error("Directory must be absolute and not a symlink");
  const canonical = realpathSync(path);
  if (["/", "/Users", homedir(), "/Volumes", "/tmp", "/private/tmp"].includes(canonical)) throw new Error("Broad source root is forbidden");
  if (!statSync(canonical).isDirectory()) throw new Error("Source is not a directory");
  return canonical;
}
export function readRegistry(data = DATA) {
  const file = join(data, "sources.json");
  if (!existsSync(file)) return REGISTRY.parse({ schema_version: "dwin.evidence-sources/v1", roots: [] });
  const registry = REGISTRY.parse(JSON.parse(readFileSync(file, "utf8")));
  if (new Set(registry.roots.map(x => x.id)).size !== registry.roots.length) throw new Error("Duplicate source alias");
  return registry;
}
export function registerSource(id, path, data = DATA) {
  if(!isAbsolute(path)||lstatSync(path).isSymbolicLink()) throw new Error("Source must be absolute and not a symlink");
  const kind = statSync(path).isDirectory()?"directory":"file";
  if(kind==="file"&&(!statSync(path).isFile()||!POLICY.extensions.includes(extname(path).toLowerCase()))) throw new Error("Unsupported source file");
  const entry = ROOT.parse({ id, path: kind==="directory"?assertDirectory(path):realpathSync(path), kind, privacy: "local-private-no-export" });
  const registry = readRegistry(data);
  const previous = registry.roots.find(x => x.id === id);
  if (previous && previous.path !== entry.path) throw new Error("Source alias already bound to another directory");
  if (!previous) registry.roots.push(entry);
  REGISTRY.parse(registry);
  privateDir(data);
  writeFileSync(join(data, "sources.json"), JSON.stringify(registry, null, 2) + "\n", { mode: 0o600 });
  return { registered: true, source_id: id, privacy: entry.privacy };
}

function collect(registry) {
  const documents = [];
  let total = 0;
  for (const root of registry.roots) {
    if(lstatSync(root.path).isSymbolicLink()||realpathSync(root.path)!==root.path) throw new Error("Source identity changed");
    const base = root.kind==="directory"?assertDirectory(root.path):dirname(root.path);
    const readDocument = path => {
      const canonical = realpathSync(path);
      if (!canonical.startsWith(base + "/")) throw new Error("Source path escape");
      if (statSync(path).size > POLICY.max_file_bytes) throw new Error("Source file too large");
      const bytes = readFileSync(path);
      total += bytes.length;
      if (bytes.length > POLICY.max_file_bytes || total > POLICY.max_total_bytes || documents.length >= POLICY.max_files) throw new Error("Source size limit exceeded");
      const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|ghp_[A-Za-z0-9]{30,})\b/.test(text)) throw new Error("SECRET_PATTERN_DETECTED: exclude or sanitize this source before indexing");
      const locator = `${root.id}/${relative(base, path)}`;
      documents.push({ id: sha(locator), source_id: root.id, locator, path: canonical, hash: sha(bytes), text });
    };
    const walk = (dir, depth) => {
      if (depth > POLICY.max_depth) throw new Error("Source depth limit exceeded");
      for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a,b)=>a.name.localeCompare(b.name,"en"))) {
        if ([".git", "node_modules"].includes(entry.name)) continue;
        const path = join(dir, entry.name);
        if (entry.isSymbolicLink()) throw new Error("Symlink in registered source is forbidden");
        if (entry.isDirectory()) { walk(path, depth + 1); continue; }
        if (!entry.isFile() || !POLICY.extensions.includes(extname(entry.name).toLowerCase())) continue;
        readDocument(path);
      }
    };
    if(root.kind==="file") readDocument(root.path); else walk(base, 0);
  }
  return { documents, total };
}

export function chunksOf(doc) {
  const result = [];
  const headings=[];
  let offset=0,fence=null;
  if(extname(doc.locator).toLowerCase()===".md") for(const line of doc.text.split(/(?<=\n)/)) {
    const marker=line.match(/^\s*(`{3,}|~{3,})/);
    if(marker){if(!fence)fence=marker[1][0];else if(fence===marker[1][0])fence=null;}
    if(!marker&&!fence){const heading=line.match(/^#{1,6}\s+(.+?)\s*$/);if(heading)headings.push({offset,title:heading[1]});}
    offset+=line.length;
  }
  let start = 0, heading = doc.text.split("\n").find(line=>line.trim())?.slice(0,240)||doc.locator;
  while (start < doc.text.length) {
    const previous=headings.filter(item=>item.offset<=start).at(-1);if(previous)heading=previous.title;
    let end = Math.min(start + POLICY.chunk_characters, doc.text.length);
    const next=headings.find(item=>item.offset>start&&item.offset<end);if(next)end=next.offset;
    const newline = doc.text.lastIndexOf("\n", end - 1);
    if (end < doc.text.length && newline > start + POLICY.chunk_characters / 2) end = newline + 1;
    if (end < doc.text.length && /[\uDC00-\uDFFF]/.test(doc.text[end])) end--;
    const text = doc.text.slice(start, end);
    const byte_start = Buffer.byteLength(doc.text.slice(0, start));
    const byte_length = Buffer.byteLength(text);
    const content_hash = sha(text);
    result.push({ id: sha(`${doc.id}:${doc.hash}:${byte_start}:${content_hash}`), document_id: doc.id, source_id: doc.source_id,
      locator: doc.locator, heading, text, source_hash: doc.hash, content_hash, char_start: start, char_length: end-start,
      byte_start, byte_length, line_start: doc.text.slice(0,start).split("\n").length,
      line_end: doc.text.slice(0,Math.max(start,end-1)).split("\n").length });
    start = end;
  }
  return result;
}

export class EvidenceStore {
  constructor(data = DATA) {
    this.data = data;
    privateDir(data);
    this.db = new Database(join(data, "evidence.sqlite"));
    chmodSync(join(data, "evidence.sqlite"), 0o600);
    this.db.pragma("journal_mode = WAL"); this.db.pragma("busy_timeout = 5000");
    const version = this.db.pragma("user_version", { simple: true });
    if (version > 1) { this.db.close(); throw new Error("Unsupported evidence schema version"); }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, locator TEXT NOT NULL, path TEXT NOT NULL, hash TEXT NOT NULL, text TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chunks (id TEXT PRIMARY KEY, document_id TEXT NOT NULL, source_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(id UNINDEXED, heading, text, tokenize='unicode61');
      CREATE TABLE IF NOT EXISTS nodes (id TEXT PRIMARY KEY, type TEXT NOT NULL, label TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS edges (id TEXT PRIMARY KEY, src TEXT NOT NULL, dst TEXT NOT NULL, type TEXT NOT NULL, evidence_chunk_id TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS edges_src ON edges(src); CREATE INDEX IF NOT EXISTS edges_dst ON edges(dst);
      CREATE TABLE IF NOT EXISTS packets (key TEXT PRIMARY KEY, data TEXT NOT NULL, hash TEXT NOT NULL, expires INTEGER NOT NULL, touched INTEGER NOT NULL);
      PRAGMA user_version = 1;
    `);
  }
  close() { this.db.close(); }
  meta(key) { return this.db.prepare("SELECT value FROM metadata WHERE key=?").get(key)?.value || null; }
  setMeta(key, value) { this.db.prepare("INSERT OR REPLACE INTO metadata VALUES (?,?)").run(key, String(value)); }
  status() {
    const counts = {};
    for (const name of ["documents","chunks","nodes","edges","packets"]) counts[name] = this.db.prepare(`SELECT count(*) AS n FROM ${name}`).get().n;
    return { schema_version: "dwin.evidence-index/v1", generation: this.meta("generation"), indexed_at: this.meta("indexed_at"),
      policy_hash: POLICY_HASH, index_policy_matches: this.meta("policy_hash") === POLICY_HASH, counts,
      privacy: POLICY.privacy, instruction_authority: "none", authority: "candidate-only", vector_status: "NOT_USED_BY_LEXICAL_SEARCH", live_freshness: "not-checked-until-reopen" };
  }
  index() {
    const registry = readRegistry(this.data);
    if (!registry.roots.length) throw new Error("NO_REGISTERED_SOURCES");
    const { documents, total } = collect(registry);
    if (!documents.length) throw new Error("NO_SUPPORTED_DOCUMENTS");
    const generation = sha(JSON.stringify({ policy: POLICY_HASH, roots: registry.roots, documents: documents.map(x=>[x.id,x.hash]) }));
    if (generation === this.meta("generation")) return { ...this.status(), changed: false, source_bytes_read: total, parsed_documents: 0 };
    this.db.transaction(() => {
      for (const table of ["documents","chunks","chunks_fts","nodes","edges","packets"]) this.db.exec(`DELETE FROM ${table}`);
      const node = (id,type,label) => this.db.prepare("INSERT OR IGNORE INTO nodes VALUES (?,?,?)").run(id,type,label);
      const edge = (src,dst,type,chunk) => this.db.prepare("INSERT OR IGNORE INTO edges VALUES (?,?,?,?,?)").run(sha(`${src}:${dst}:${type}`),src,dst,type,chunk);
      for (const doc of documents) {
        this.db.prepare("INSERT INTO documents VALUES (@id,@source_id,@locator,@path,@hash,@text)").run(doc);
        node(doc.id,"source",doc.locator);
        for (const chunk of chunksOf(doc)) {
          this.db.prepare("INSERT INTO chunks VALUES (?,?,?,?)").run(chunk.id,doc.id,doc.source_id,JSON.stringify(chunk));
          this.db.prepare("INSERT INTO chunks_fts VALUES (?,?,?)").run(chunk.id,chunk.heading,chunk.text);
          node(chunk.id,"chunk",chunk.heading); edge(chunk.id,doc.id,"DERIVED_FROM",chunk.id);
          const lower = chunk.text.toLowerCase();
          for (const [concept, terms] of Object.entries(CONCEPTS)) {
            if (!terms.some(term => lower.includes(term))) continue;
            const id = `concept:${concept}`; node(id,"concept",concept); edge(chunk.id,id,"MENTIONS",chunk.id);
          }
          for (const match of chunk.text.matchAll(/https?:\/\/[^\s<>"`)]+/g)) {
            const url = match[0].replace(/[.,;]+$/,"");
            const id = `url:${sha(url)}`; node(id,"url",url); edge(chunk.id,id,"REFERENCES",chunk.id);
          }
        }
      }
      this.setMeta("generation",generation); this.setMeta("policy_hash",POLICY_HASH); this.setMeta("registry_hash",sha(JSON.stringify(registry))); this.setMeta("indexed_at",new Date().toISOString());
    })();
    return { ...this.status(), changed: true, source_bytes_read: total, parsed_documents: documents.length };
  }
  assertSnapshot() {
    if (!this.meta("generation")) throw new Error("INDEX_EMPTY");
    if (this.meta("policy_hash") !== POLICY_HASH) throw new Error("INDEX_POLICY_CHANGED: reindex required");
    const registry = readRegistry(this.data);
    if(this.meta("registry_hash")!==sha(JSON.stringify(registry))) throw new Error("SOURCE_SCOPE_CHANGED: reindex required");
    const roots = new Map(registry.roots.map(x=>[x.id,x]));
    for (const doc of this.db.prepare("SELECT source_id,path FROM documents").all()) {
      const root=roots.get(doc.source_id);
      if (!root || (root.kind==="file"?doc.path!==root.path:!doc.path.startsWith(resolve(root.path)+"/"))) throw new Error("SOURCE_SCOPE_CHANGED: reindex required");
    }
  }
  prune(now) {
    this.db.prepare("DELETE FROM packets WHERE expires<=?").run(now);
    this.db.exec(`DELETE FROM packets WHERE key IN (SELECT key FROM packets ORDER BY touched DESC,key DESC LIMIT -1 OFFSET ${POLICY.cache_max_entries})`);
    while (this.db.prepare("SELECT coalesce(sum(length(CAST(data AS BLOB))),0) AS n FROM packets").get().n > POLICY.cache_max_bytes)
      this.db.exec("DELETE FROM packets WHERE key=(SELECT key FROM packets ORDER BY touched,key LIMIT 1)");
  }
  search(raw, { now = Date.now() } = {}) {
    return this.db.transaction(()=>this.searchSnapshot(raw,{now})).immediate();
  }
  searchSnapshot(raw, { now = Date.now() } = {}) {
    const input = SEARCH.parse(raw); this.assertSnapshot(); this.prune(now);
    const { known_packet_hash, bypass_cache, ...parameters } = input;
    const key = sha(JSON.stringify({ generation:this.meta("generation"), policy:POLICY_HASH, parameters }));
    const cached = !bypass_cache && this.db.prepare("SELECT * FROM packets WHERE key=? AND expires>?").get(key,now);
    if (cached) {
      this.db.prepare("UPDATE packets SET touched=? WHERE key=?").run(now,key);
      const packet = JSON.parse(cached.data);
      if (sha(cached.data) !== cached.hash) throw new Error("CACHE_INTEGRITY_FAILED");
      if (known_packet_hash === cached.hash) return { schema_version:"dwin.evidence-search/v1", status:"NOT_MODIFIED", cache_status:"hit", packet_hash:cached.hash,
        generation:packet.generation, context_id:input.context_id, retrieval_executed:false, packet:null,
        instruction_authority:"none", authority:"candidate-only", note:"Reuse the exact packet already available in this context; otherwise omit known_packet_hash." };
      return this.response(packet,cached.hash,"hit",false);
    }
    const terms = [...new Set(input.query.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) || [])].slice(0,30);
    if (!terms.length) throw new Error("QUERY_HAS_NO_TERMS");
    const match = terms.map(term => '"' + term.replaceAll('"','""') + '"').join(" OR ");
    const rows = this.db.prepare(`SELECT c.data,bm25(chunks_fts,0,3,1) AS rank FROM chunks_fts
      JOIN chunks c ON c.id=chunks_fts.id WHERE chunks_fts MATCH ? ${input.source_id ? "AND c.source_id=?" : ""}
      ORDER BY rank,c.id LIMIT ?`).all(...[match,...(input.source_id?[input.source_id]:[]),input.limit+1]);
    const packet = { schema_version:"dwin.evidence-packet/v1", generation:this.meta("generation"), policy_hash:POLICY_HASH,
      context_id:input.context_id, query:input.query, retrieval_method:"fts5-bm25-literal-or/v1", vector_status:"NOT_USED_BY_LEXICAL_SEARCH",
      authority:"candidate-only", instruction_authority:"none", privacy:POLICY.privacy, freshness:"indexed-snapshot-not-live",
      truncated:rows.length>input.limit, results:rows.slice(0,input.limit).map(row => {
        const { text, ...chunk } = JSON.parse(row.data);
        return { ...chunk, preview:text.slice(0,input.preview_chars), preview_truncated: text.length>input.preview_chars, lexical_rank:row.rank };
      }) };
    const data = JSON.stringify(packet), hash = sha(data);
    if (!bypass_cache) {
      this.db.prepare("INSERT OR REPLACE INTO packets VALUES (?,?,?,?,?)").run(key,data,hash,now+POLICY.cache_ttl_seconds*1000,now);
      this.prune(now);
    }
    return this.response(packet,hash,bypass_cache?"bypass":"miss",true);
  }
  response(packet, hash, cache_status, executed) {
    return { schema_version:"dwin.evidence-search/v1", status:packet.results.length?"OK":"NO_HITS", cache_status,
      packet_hash:hash,generation:packet.generation,context_id:packet.context_id,retrieval_executed:executed,packet,
      instruction_authority:"none",authority:"candidate-only",note:null };
  }
  reopen(id, options = {}) {
    const {verify_live}=REOPEN.parse({...options,chunk_id:id});
    return this.db.transaction(()=>this.reopenSnapshot(id,{verify_live}))();
  }
  reopenSnapshot(id, { verify_live = true } = {}) {
    this.assertSnapshot();
    const row = this.db.prepare("SELECT data FROM chunks WHERE id=?").get(id);
    if (!row) return { status:"NOT_FOUND",chunk:null,generation:this.meta("generation"),instruction_authority:"none",authority:"candidate-only",privacy:POLICY.privacy };
    const chunk = JSON.parse(row.data), doc = this.db.prepare("SELECT * FROM documents WHERE id=?").get(chunk.document_id);
    const bytes = Buffer.from(doc.text), span = bytes.subarray(chunk.byte_start,chunk.byte_start+chunk.byte_length);
    if (sha(bytes)!==doc.hash || sha(span)!==chunk.content_hash || span.toString("utf8")!==chunk.text) throw new Error("SNAPSHOT_INTEGRITY_FAILED");
    let status = "SNAPSHOT_VERIFIED";
    if (verify_live) {
      try {
        if (lstatSync(doc.path).isSymbolicLink() || realpathSync(doc.path)!==doc.path) throw new Error("Source no longer canonical");
        if (statSync(doc.path).size > POLICY.max_file_bytes) status = "SOURCE_CHANGED";
        else status = sha(readFileSync(doc.path)) === doc.hash ? "LIVE_VERIFIED" : "SOURCE_CHANGED";
      } catch (error) { status = error.code === "ENOENT" ? "SOURCE_MISSING" : "SOURCE_UNAVAILABLE"; }
    }
    return { status,chunk,generation:this.meta("generation"),instruction_authority:"none",authority:"candidate-only",privacy:POLICY.privacy };
  }
  neighbors(id, options = {}) {
    const {depth,max_nodes}=NEIGHBORS.parse({...options,node_id:id});
    return this.db.transaction(()=>this.neighborsSnapshot(id,{depth,max_nodes}))();
  }
  neighborsSnapshot(id, { depth=1,max_nodes=40 } = {}) {
    if (!Number.isInteger(depth)||depth<1||depth>2||!Number.isInteger(max_nodes)||max_nodes<1||max_nodes>100) throw new Error("Invalid graph bounds");
    this.assertSnapshot();
    const start = this.db.prepare("SELECT * FROM nodes WHERE id=?").get(id);
    if (!start) return { nodes:[],edges:[],truncated:false,authority:"candidate-only",instruction_authority:"none",generation:this.meta("generation") };
    const nodes = new Map([[id,start]]), edges = new Map(); let frontier=[id],truncated=false;
    for(let d=0;d<depth;d++) {
      const next=[];
      for(const current of frontier) {
        const adjacent=this.db.prepare("SELECT * FROM edges WHERE src=? OR dst=? ORDER BY id LIMIT 501").all(current,current);
        if(adjacent.length>500) truncated=true;
        for(const edge of adjacent.slice(0,500)) {
          const other=edge.src===current?edge.dst:edge.src;
          if(!nodes.has(other)) {
            if(nodes.size>=max_nodes) {truncated=true;continue;}
            nodes.set(other,this.db.prepare("SELECT * FROM nodes WHERE id=?").get(other)); next.push(other);
          }
          if(edges.size>=500) {truncated=true;continue;}
          edges.set(edge.id,{...edge,authority:edge.type==="DERIVED_FROM"?"source-lineage-only":"candidate-only"});
        }
      }
      frontier=next;
    }
    return {generation:this.meta("generation"),nodes:[...nodes.values()],edges:[...edges.values()],truncated,authority:"candidate-only",instruction_authority:"none"};
  }
  integrity() {
    this.assertSnapshot();
    let verified=0;
    for(const {id} of this.db.prepare("SELECT id FROM chunks").all()) { this.reopen(id,{verify_live:false}); verified++; }
    const orphan=this.db.prepare("SELECT count(*) AS n FROM edges e LEFT JOIN nodes s ON e.src=s.id LEFT JOIN nodes d ON e.dst=d.id LEFT JOIN chunks c ON e.evidence_chunk_id=c.id WHERE s.id IS NULL OR d.id IS NULL OR c.id IS NULL").get().n;
    const invalid=this.db.prepare("SELECT count(*) AS n FROM edges WHERE type NOT IN ('DERIVED_FROM','MENTIONS','REFERENCES')").get().n;
    return {verified_chunks:verified,orphan_edges:orphan,invalid_edges:invalid,passed:verified>0&&orphan===0&&invalid===0};
  }
}
