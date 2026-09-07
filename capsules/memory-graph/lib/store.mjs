import Ajv from "ajv";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { FACTORY_DATA } from "../../../src/paths.mjs";
import { EvidenceStore } from "../../evidence-graph/lib/store.mjs";
import { listAdoptions, validateAdoption } from "../../evidence-graph/lib/adoption-records.mjs";

export const DATA = join(FACTORY_DATA, "capsules", "memory-graph");
export const POLICY = JSON.parse(readFileSync(new URL("../contracts/policy.json", import.meta.url), "utf8"));
const schema = JSON.parse(readFileSync(new URL("../contracts/memory-candidate.schema.json", import.meta.url), "utf8")), ajv = new Ajv({ allErrors: true, strict: true }), validateCandidateSchema = ajv.compile(schema);
export const sha = value => createHash("sha256").update(value).digest("hex");
export const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b, "en"))) : item);
const hash = z.string().regex(/^[a-f0-9]{64}$/), candidate = z.object({ schema_version: z.literal("dwin.memory-candidate/v1"), claim: z.string().trim().min(1).max(POLICY.max_claim_characters), claim_type: z.enum(POLICY.allowed_claim_types), scope: z.string().trim().min(1).max(120), confidence: z.number().min(0).max(1), valid_until: z.string().datetime(), adoption_record_id: hash, rationale: z.string().trim().min(1).max(1000), tags: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/)).max(12).refine(items => new Set(items).size === items.length) }).strict();
const promotion = z.object({ candidate_id: hash, approved: z.literal(true), approval_actor: z.string().trim().min(1).max(120), approval_note: z.string().trim().min(1).max(1000), supersedes_claim_id: hash.nullable().default(null) }).strict();
const searchInput = z.object({ query: z.string().trim().min(2).max(300), limit: z.number().int().min(1).max(POLICY.max_search_results).default(5), include_expired: z.boolean().default(false) }).strict();

function privateDir(path) { mkdirSync(path, { recursive: true, mode: 0o700 }); }
function defaultSourceValidator(recordId) {
  const listed = listAdoptions({ record_id: recordId, limit: 1 }); if (listed.total !== 1) throw new Error("MEMORY_ADOPTION_RECORD_NOT_FOUND");
  const evidence = new EvidenceStore();
  try { const validation = validateAdoption(listed.records[0].record, evidence); if (validation.result_status !== "ACCEPTED" || !listed.records[0].record.result) throw new Error("MEMORY_ACCEPTED_EXPERIMENT_REQUIRED"); return { adoption_record_id: recordId, protocol_hash: validation.protocol_hash, result_run_id: listed.records[0].record.result.run_id, source_spans_checked: validation.source_spans_checked, paper: `${listed.records[0].record.paper.id}v${listed.records[0].record.paper.version}` }; } finally { evidence.close(); }
}

export class MemoryStore {
  constructor({ data = DATA, sourceValidator = defaultSourceValidator } = {}) {
    this.data = data; this.sourceValidator = sourceValidator; privateDir(data); const path = join(data, "memory.sqlite");
    this.db = new Database(path); chmodSync(path, 0o600); this.db.pragma("journal_mode = WAL"); this.db.pragma("synchronous = FULL"); this.db.pragma("busy_timeout = 5000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS candidates (id TEXT PRIMARY KEY CHECK(length(id)=64), data TEXT NOT NULL, source_snapshot TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS claims (id TEXT PRIMARY KEY CHECK(length(id)=64), candidate_id TEXT NOT NULL UNIQUE REFERENCES candidates(id), data TEXT NOT NULL, approval_actor TEXT NOT NULL, approval_note TEXT NOT NULL, supersedes_claim_id TEXT, approved_at TEXT NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS claims_fts USING fts5(claim_id UNINDEXED, claim, scope, tags, tokenize='unicode61');
      CREATE TRIGGER IF NOT EXISTS candidates_no_update BEFORE UPDATE ON candidates BEGIN SELECT RAISE(ABORT,'MEMORY_IMMUTABILITY_VIOLATION'); END;
      CREATE TRIGGER IF NOT EXISTS candidates_no_delete BEFORE DELETE ON candidates BEGIN SELECT RAISE(ABORT,'MEMORY_IMMUTABILITY_VIOLATION'); END;
      CREATE TRIGGER IF NOT EXISTS claims_no_update BEFORE UPDATE ON claims BEGIN SELECT RAISE(ABORT,'MEMORY_IMMUTABILITY_VIOLATION'); END;
      CREATE TRIGGER IF NOT EXISTS claims_no_delete BEFORE DELETE ON claims BEGIN SELECT RAISE(ABORT,'MEMORY_IMMUTABILITY_VIOLATION'); END;
    `);
  }
  close() { this.db.close(); }
  propose(raw) {
    const parsed = candidate.parse(raw); if (!validateCandidateSchema(parsed)) throw new Error(`MEMORY_CANDIDATE_SCHEMA:${ajv.errorsText(validateCandidateSchema.errors)}`);
    if (Date.parse(parsed.valid_until) <= Date.now()) throw new Error("MEMORY_EXPIRY_MUST_BE_FUTURE");
    const source = this.sourceValidator(parsed.adoption_record_id), bytes = canonical(parsed), id = sha(bytes), now = new Date().toISOString();
    const existing = this.db.prepare("SELECT data FROM candidates WHERE id=?").get(id); if (existing) { if (existing.data !== bytes) throw new Error("MEMORY_HASH_COLLISION"); return { candidate_id: id, created: false, source }; }
    if (this.db.prepare("SELECT count(*) AS n FROM candidates").get().n >= POLICY.max_candidates) throw new Error("MEMORY_CANDIDATE_LIMIT");
    this.db.prepare("INSERT INTO candidates VALUES (?,?,?,?)").run(id, bytes, canonical(source), now); return { candidate_id: id, created: true, source };
  }
  promote(raw) {
    const input = promotion.parse(raw), row = this.db.prepare("SELECT * FROM candidates WHERE id=?").get(input.candidate_id); if (!row) throw new Error("MEMORY_CANDIDATE_NOT_FOUND");
    const value = candidate.parse(JSON.parse(row.data)); this.sourceValidator(value.adoption_record_id);
    if (Date.parse(value.valid_until) <= Date.now()) throw new Error("MEMORY_CANDIDATE_EXPIRED");
    if (input.supersedes_claim_id) { const prior = this.db.prepare("SELECT id FROM claims WHERE id=?").get(input.supersedes_claim_id); if (!prior) throw new Error("MEMORY_SUPERSEDED_CLAIM_NOT_FOUND"); }
    const approvedAt = new Date().toISOString(), claimId = sha(canonical([input.candidate_id, input.approval_actor, input.approval_note, input.supersedes_claim_id]));
    const existing = this.db.prepare("SELECT id FROM claims WHERE candidate_id=?").get(input.candidate_id); if (existing) return { claim_id: existing.id, created: false };
    if (this.db.prepare("SELECT count(*) AS n FROM claims").get().n >= POLICY.max_claims) throw new Error("MEMORY_CLAIM_LIMIT");
    this.db.transaction(() => { this.db.prepare("INSERT INTO claims VALUES (?,?,?,?,?,?,?)").run(claimId, input.candidate_id, row.data, input.approval_actor, input.approval_note, input.supersedes_claim_id, approvedAt); this.db.prepare("INSERT INTO claims_fts VALUES (?,?,?,?)").run(claimId, value.claim, value.scope, value.tags.join(" ")); })();
    return { claim_id: claimId, created: true };
  }
  status() {
    const now = new Date().toISOString(), counts = this.db.prepare("SELECT (SELECT count(*) FROM candidates) candidates,(SELECT count(*) FROM claims) claims,(SELECT count(*) FROM claims c JOIN candidates x ON x.id=c.candidate_id WHERE json_extract(x.data,'$.valid_until')>?) active").get(now);
    return { schema_version: "dwin.memory-status/v1", candidates: Number(counts.candidates), claims: Number(counts.claims), active_claims: Number(counts.active), expired_claims: Number(counts.claims) - Number(counts.active), source_gate: POLICY.source_gate, promotion_gate: POLICY.promotion_gate, append_only: true, privacy: POLICY.privacy, authority: POLICY.authority, instruction_authority: POLICY.instruction_authority };
  }
  search(raw) {
    const input = searchInput.parse(raw), terms = [...new Set(input.query.toLowerCase().match(/[\p{L}\p{N}_-]+/gu) || [])].slice(0, 30); if (!terms.length) throw new Error("MEMORY_QUERY_HAS_NO_TERMS");
    const match = terms.map(term => `"${term.replaceAll('"', '""')}"`).join(" OR "), rows = this.db.prepare(`SELECT c.id,c.data,c.approved_at,bm25(claims_fts,0,3,1,1) rank FROM claims_fts JOIN claims c ON c.id=claims_fts.claim_id WHERE claims_fts MATCH ? ${input.include_expired ? "" : "AND json_extract(c.data,'$.valid_until')>?"} AND NOT EXISTS(SELECT 1 FROM claims newer WHERE newer.supersedes_claim_id=c.id) ORDER BY rank,c.id LIMIT ?`).all(...[match, ...(input.include_expired ? [] : [new Date().toISOString()]), input.limit]);
    return { schema_version: "dwin.memory-search/v1", query: input.query, retrieval_method: "fts5-bm25-literal-or/v1", results: rows.map(row => ({ claim_id: row.id, memory: JSON.parse(row.data), approved_at: row.approved_at, lexical_rank: row.rank })), privacy: POLICY.privacy, authority: POLICY.authority, instruction_authority: POLICY.instruction_authority };
  }
  graph() {
    const nodes = [], edges = [];
    for (const row of this.db.prepare("SELECT * FROM candidates ORDER BY id").all()) { const value = JSON.parse(row.data), source = JSON.parse(row.source_snapshot); nodes.push({ id: row.id, type: "MemoryCandidate" }, { id: `adoption:${value.adoption_record_id}`, type: "AdoptionRecord" }, { id: `experiment:${source.result_run_id}`, type: "AcceptedExperiment" }); edges.push({ src: row.id, dst: `adoption:${value.adoption_record_id}`, type: "PROPOSED_FROM" }, { src: `adoption:${value.adoption_record_id}`, dst: `experiment:${source.result_run_id}`, type: "SUPPORTED_BY" }); }
    for (const row of this.db.prepare("SELECT * FROM claims ORDER BY id").all()) { nodes.push({ id: row.id, type: "ApprovedMemory" }); edges.push({ src: row.id, dst: row.candidate_id, type: "APPROVED_FROM" }); if (row.supersedes_claim_id) edges.push({ src: row.id, dst: row.supersedes_claim_id, type: "SUPERSEDES" }); }
    return { schema_version: "dwin.memory-graph/v1", nodes: [...new Map(nodes.map(node => [node.id, node])).values()], edges: edges.map(edge => ({ id: sha(canonical(edge)), ...edge })), privacy: POLICY.privacy, authority: POLICY.authority, instruction_authority: POLICY.instruction_authority };
  }
  validate() {
    const validations = [], now = Date.now(); let invalid = 0;
    for (const row of this.db.prepare("SELECT * FROM candidates ORDER BY id").all()) {
      let state = "source-current"; try { const value = candidate.parse(JSON.parse(row.data)); if (sha(canonical(value)) !== row.id || canonical(value) !== row.data) throw new Error("CANDIDATE_HASH"); this.sourceValidator(value.adoption_record_id); if (Date.parse(value.valid_until) <= now) state = "expired"; } catch (error) { state = "source-unavailable"; invalid++; }
      validations.push({ candidate_id: row.id, state });
    }
    const structural = this.db.prepare("SELECT count(*) AS n FROM claims c LEFT JOIN candidates x ON x.id=c.candidate_id WHERE x.id IS NULL").get().n === 0;
    return { schema_version: "dwin.memory-integrity/v1", status: this.status(), records_checked: validations.length, validations, structural_integrity: structural, invalid_sources: invalid, passed: structural, network_requests: 0, privacy: POLICY.privacy, authority: POLICY.authority, instruction_authority: POLICY.instruction_authority };
  }
}
