import Database from "better-sqlite3";
import { chmodSync } from "node:fs";
import { createHash } from "node:crypto";
import { RADAR_DB, ensureRadarData } from "./paths.mjs";

const DEFAULT_WATCHES = [
  {
    id: "agent-memory", name: "Agent memory and context", query: "(cat:cs.AI OR cat:cs.CL OR cat:cs.LG OR cat:cs.IR) AND (all:\"long-term memory\" OR all:\"long term memory\" OR all:\"working memory\" OR all:\"agent memory\" OR all:\"memory consolidation\" OR all:\"memory retrieval\" OR all:\"context compression\")", category: "cs.AI",
    positive: ["agent memory", "long-term memory", "working memory", "memory consolidation", "memory retrieval", "context compression", "provenance", "authority", "freshness", "supersession", "memory poisoning"], negative: [],
  },
  {
    id: "agent-evaluation", name: "Agent evaluation", query: "all:\"language model\" AND (all:evaluation OR all:benchmark OR all:failure)", category: "cs.AI",
    positive: ["evaluation", "benchmark", "failure", "reliability", "agent"], negative: [],
  },
  {
    id: "context-efficiency", name: "Context efficiency", query: "all:\"language model\" AND (all:context OR all:prompt OR all:cache)", category: "cs.CL",
    positive: ["context", "prompt compression", "cache", "token", "retrieval"], negative: [],
  },
  {
    id: "tool-protocols", name: "Tool protocols", query: "all:\"language model\" AND (all:tool OR all:protocol)", category: "cs.AI",
    positive: ["tool", "protocol", "model context protocol", "agent interoperability"], negative: [],
  },
];

function hash(value) { return createHash("sha256").update(value).digest("hex"); }
function json(value) { return JSON.stringify(value || []); }
function parse(value, fallback = []) { try { return JSON.parse(value); } catch { return fallback; } }

export class RadarStore {
  constructor(path = RADAR_DB) {
    ensureRadarData();
    this.path = path;
    this.db = new Database(path);
    chmodSync(path, 0o600);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = FULL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    if (this.db.pragma("user_version", { simple: true }) > 2) { this.db.close(); throw new Error("Unsupported future Research Radar schema"); }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS watchlists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        query TEXT NOT NULL,
        category TEXT,
        positive_keywords_json TEXT NOT NULL,
        negative_keywords_json TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS papers (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        authors_json TEXT NOT NULL,
        categories_json TEXT NOT NULL,
        primary_category TEXT,
        published_at TEXT,
        updated_at TEXT,
        abs_url TEXT NOT NULL,
        pdf_url TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        content_trust TEXT NOT NULL DEFAULT 'untrusted-external' CHECK(content_trust='untrusted-external'),
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS papers_fts USING fts5(title, summary, paper_id UNINDEXED, tokenize='unicode61 remove_diacritics 2');
      CREATE TABLE IF NOT EXISTS matches (
        paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
        watch_id TEXT NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
        score REAL NOT NULL,
        score_version TEXT NOT NULL,
        reasons_json TEXT NOT NULL,
        authority TEXT NOT NULL DEFAULT 'candidate-only' CHECK(authority='candidate-only'),
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        last_sync_id TEXT NOT NULL,
        PRIMARY KEY(paper_id, watch_id)
      );
      CREATE TABLE IF NOT EXISTS reviews (
        paper_id TEXT PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK(status IN ('new','shortlisted','dismissed','read','applied')),
        note TEXT,
        reviewed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sync_runs (
        id TEXT PRIMARY KEY,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL,
        queries_attempted INTEGER NOT NULL DEFAULT 0,
        queries_succeeded INTEGER NOT NULL DEFAULT 0,
        queries_failed INTEGER NOT NULL DEFAULT 0,
        papers_seen INTEGER NOT NULL DEFAULT 0,
        papers_new INTEGER NOT NULL DEFAULT 0,
        matches_upserted INTEGER NOT NULL DEFAULT 0,
        report_json TEXT
      );
      CREATE TABLE IF NOT EXISTS query_cache (
        cache_key TEXT PRIMARY KEY,
        request_url TEXT NOT NULL UNIQUE,
        request_json TEXT NOT NULL,
        paper_ids_json TEXT NOT NULL,
        result_count INTEGER NOT NULL,
        fetched_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS query_cache_expires_idx ON query_cache(expires_at);
    `);
    this.migrate();
    this.seedDefaults();
  }

  close() { this.db.close(); }

  migrate() {
    this.db.transaction(() => {
      const add = (table, column, type) => {
        if (!this.db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      };
      add("papers", "version_id", "TEXT");
      add("papers", "version_key", "TEXT");
      add("reviews", "reviewed_version_key", "TEXT");
      add("query_cache", "snapshot_id", "TEXT");
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS paper_versions (
          version_key TEXT PRIMARY KEY, paper_id TEXT NOT NULL, version_id TEXT,
          content_hash TEXT NOT NULL, paper_json TEXT NOT NULL, first_seen_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS paper_versions_identity ON paper_versions(paper_id,version_id);
        CREATE TABLE IF NOT EXISTS query_snapshots (
          id TEXT PRIMARY KEY, request_url TEXT NOT NULL, request_json TEXT NOT NULL,
          papers_json TEXT NOT NULL, metadata_json TEXT NOT NULL, fetched_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS discoveries (
          id TEXT PRIMARY KEY, paper_id TEXT NOT NULL REFERENCES papers(id),
          version_key TEXT REFERENCES paper_versions(version_key), snapshot_id TEXT REFERENCES query_snapshots(id),
          result_rank INTEGER, origin TEXT NOT NULL, discovered_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS discoveries_paper ON discoveries(paper_id);
        CREATE TABLE IF NOT EXISTS review_history (
          id INTEGER PRIMARY KEY, paper_id TEXT NOT NULL, version_key TEXT,
          status TEXT NOT NULL, note TEXT, reviewed_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS api_limiter (id INTEGER PRIMARY KEY CHECK(id=1), next_start_ms INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS scan_lease (id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, until_ms INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS scan_states (
          id TEXT PRIMARY KEY, watch_id TEXT, lane TEXT NOT NULL, query_hash TEXT NOT NULL,
          state_json TEXT NOT NULL, last_attempt_at TEXT, not_before TEXT
        );
        CREATE TABLE IF NOT EXISTS scan_history (
          id TEXT PRIMARY KEY, state_id TEXT NOT NULL, state_json TEXT NOT NULL, recorded_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS revision_checks (paper_id TEXT PRIMARY KEY, checked_at TEXT NOT NULL);
      `);
      // Legacy cache references pointed at mutable latest rows. Keep the rows for audit,
      // but never fabricate a historic version snapshot or reuse them as a cache hit.
      this.db.prepare(`INSERT OR IGNORE INTO discoveries(id,paper_id,origin,discovered_at)
        SELECT 'legacy:'||id,id,'legacy-version-unknown',first_seen_at FROM papers WHERE version_key IS NULL`).run();
      this.db.pragma("user_version = 2");
    }).immediate();
  }

  reserveRequest({ nowMs = Date.now(), delayMs = 3000, deadlineMs = Infinity } = {}) {
    return this.db.transaction(() => {
      const row = this.db.prepare("SELECT next_start_ms FROM api_limiter WHERE id=1").get();
      const start = Math.max(nowMs, row?.next_start_ms || 0);
      if (start >= deadlineMs) throw new Error("arXiv request budget exhausted before shared rate-limit slot");
      this.db.prepare("INSERT INTO api_limiter(id,next_start_ms) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET next_start_ms=excluded.next_start_ms").run(start + delayMs);
      return start - nowMs;
    }).immediate();
  }

  seedDefaults() {
    const now = new Date().toISOString();
    const insert = this.db.prepare(`INSERT INTO watchlists
      (id,name,query,category,positive_keywords_json,negative_keywords_json,enabled,created_at,updated_at)
      VALUES (?,?,?,?,?,?,1,?,?)`);
    const transaction = this.db.transaction(() => {
      if (this.db.prepare("SELECT COUNT(*) AS count FROM watchlists").get().count > 0) return;
      for (const watch of DEFAULT_WATCHES) insert.run(watch.id, watch.name, watch.query, watch.category, json(watch.positive), json(watch.negative), now, now);
    });
    transaction.immediate();
  }

  watches({ enabledOnly = false } = {}) {
    const rows = this.db.prepare(`SELECT * FROM watchlists ${enabledOnly ? "WHERE enabled=1" : ""} ORDER BY id`).all();
    return rows.map((row) => ({
      id: row.id, name: row.name, query: row.query, category: row.category,
      positive_keywords: parse(row.positive_keywords_json), negative_keywords: parse(row.negative_keywords_json),
      enabled: Boolean(row.enabled), updated_at: row.updated_at,
    }));
  }

  upsertWatch(watch) {
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO watchlists
      (id,name,query,category,positive_keywords_json,negative_keywords_json,enabled,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,query=excluded.query,category=excluded.category,
        positive_keywords_json=excluded.positive_keywords_json,negative_keywords_json=excluded.negative_keywords_json,
        enabled=excluded.enabled,updated_at=excluded.updated_at`)
      .run(watch.id, watch.name, watch.query, watch.category || null, json(watch.positive_keywords), json(watch.negative_keywords), watch.enabled ? 1 : 0, now, now);
    return this.watches().find((item) => item.id === watch.id);
  }

  upsertPaper(paper, seenAt) {
    const contentHash = hash(JSON.stringify([paper.title, paper.summary, paper.authors, paper.categories, paper.updated_at]));
    const versionId = paper.version_id || null;
    const versionKey = hash(JSON.stringify([paper.id, versionId, contentHash]));
    const snapshot = { ...paper, version_id: versionId, version_key: versionKey, content_hash: contentHash };
    this.db.prepare("INSERT OR IGNORE INTO paper_versions(version_key,paper_id,version_id,content_hash,paper_json,first_seen_at) VALUES (?,?,?,?,?,?)")
      .run(versionKey, paper.id, versionId, contentHash, JSON.stringify(snapshot), seenAt);
    const exists = this.db.prepare("SELECT version_id,version_key,updated_at FROM papers WHERE id=?").get(paper.id);
    const versionNumber = (value) => Number(value?.match(/v(\d+)$/)?.[1] || 0);
    const oldNumber = versionNumber(exists?.version_id), newNumber = versionNumber(versionId);
    // Historical lookups/cache snapshots may add an old version, never demote latest.
    if (exists && (newNumber < oldNumber || (newNumber === oldNumber && (paper.updated_at || "") < (exists.updated_at || "")))) {
      return { is_new: false, content_hash: contentHash, version_key: versionKey, paper: snapshot, became_current: false };
    }
    this.db.prepare(`INSERT INTO papers
      (id,title,summary,authors_json,categories_json,primary_category,published_at,updated_at,abs_url,pdf_url,content_hash,content_trust,first_seen_at,last_seen_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,'untrusted-external',?,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,summary=excluded.summary,authors_json=excluded.authors_json,
        categories_json=excluded.categories_json,primary_category=excluded.primary_category,published_at=excluded.published_at,
        updated_at=excluded.updated_at,abs_url=excluded.abs_url,pdf_url=excluded.pdf_url,content_hash=excluded.content_hash,last_seen_at=excluded.last_seen_at`)
      .run(paper.id, paper.title, paper.summary, json(paper.authors), json(paper.categories), paper.primary_category,
        paper.published_at, paper.updated_at, paper.abs_url, paper.pdf_url, contentHash, seenAt, seenAt);
    this.db.prepare("DELETE FROM papers_fts WHERE paper_id=?").run(paper.id);
    this.db.prepare("INSERT INTO papers_fts(title,summary,paper_id) VALUES (?,?,?)").run(paper.title, paper.summary, paper.id);
    this.db.prepare("UPDATE papers SET version_id=?,version_key=? WHERE id=?").run(versionId, versionKey, paper.id);
    return { is_new: !exists, content_hash: contentHash, version_key: versionKey, paper: snapshot, became_current: true, version_changed: Boolean(exists?.version_key && exists.version_key !== versionKey) };
  }

  paperVersion(versionKey) {
    const row = this.db.prepare("SELECT paper_json FROM paper_versions WHERE version_key=?").get(versionKey);
    return row ? JSON.parse(row.paper_json) : null;
  }

  searchPaper(id) {
    const row = this.db.prepare("SELECT * FROM papers WHERE id=?").get(id);
    if (!row) return null;
    return {
      id: row.id,
      version_id: row.version_id, version_key: row.version_key, content_hash: row.content_hash,
      title: row.title,
      summary: row.summary,
      authors: parse(row.authors_json),
      categories: parse(row.categories_json),
      primary_category: row.primary_category,
      published_at: row.published_at,
      updated_at: row.updated_at,
      abs_url: row.abs_url,
      pdf_url: row.pdf_url,
      content_trust: "untrusted-external",
      source: "arxiv-api",
    };
  }

  cachedSearch(requestUrl, { now = new Date().toISOString(), allowExpired = false } = {}) {
    const row = this.db.prepare("SELECT * FROM query_cache WHERE request_url=?").get(requestUrl);
    if (!row?.snapshot_id) return null;
    const fresh = row.expires_at > now;
    if (!fresh && !allowExpired) return null;
    const snapshot = this.db.prepare("SELECT * FROM query_snapshots WHERE id=?").get(row.snapshot_id);
    if (!snapshot) throw new Error("Missing immutable arXiv cache snapshot");
    const papers = JSON.parse(snapshot.papers_json);
    return {
      cache_key: row.cache_key,
      request_url: row.request_url,
      request: parse(row.request_json, {}),
      fetched_at: row.fetched_at,
      expires_at: row.expires_at,
      fresh,
      result_count: Number(row.result_count),
      papers,
      snapshot_id: snapshot.id,
      metadata: JSON.parse(snapshot.metadata_json),
    };
  }

  putCachedSearch({ requestUrl, request, papers, metadata = { total_results: null, start_index: null, items_per_page: null, verified: false }, fetchedAt = new Date().toISOString(), ttlSeconds = 86_400 }) {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 604_800) throw new Error("cache ttlSeconds must be 60-604800");
    const expiresAt = new Date(new Date(fetchedAt).getTime() + ttlSeconds * 1000).toISOString();
    const cacheKey = hash(requestUrl);
    let papersNew = 0;
    let versionChanges = 0;
    const transaction = this.db.transaction(() => {
      const snapshots = papers.map((paper) => {
        const result = this.upsertPaper(paper, fetchedAt);
        if (result.is_new) papersNew += 1;
        if (result.version_changed) versionChanges += 1;
        return result.paper;
      });
      const snapshotId = hash(JSON.stringify([requestUrl, fetchedAt, snapshots, metadata]));
      this.db.prepare("INSERT OR IGNORE INTO query_snapshots(id,request_url,request_json,papers_json,metadata_json,fetched_at) VALUES (?,?,?,?,?,?)")
        .run(snapshotId, requestUrl, JSON.stringify(request), JSON.stringify(snapshots), JSON.stringify(metadata), fetchedAt);
      snapshots.forEach((paper, index) => {
        this.db.prepare("INSERT OR IGNORE INTO discoveries(id,paper_id,version_key,snapshot_id,result_rank,origin,discovered_at) VALUES (?,?,?,?,?,'arxiv-query',?)")
          .run(hash(JSON.stringify([snapshotId, index])), paper.id, paper.version_key, snapshotId, (request.start || 0) + index + 1, fetchedAt);
      });
      this.db.prepare(`INSERT INTO query_cache
        (cache_key,request_url,request_json,paper_ids_json,result_count,fetched_at,expires_at)
        VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(cache_key) DO UPDATE SET request_url=excluded.request_url,request_json=excluded.request_json,
          paper_ids_json=excluded.paper_ids_json,result_count=excluded.result_count,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at`)
        .run(cacheKey, requestUrl, JSON.stringify(request), JSON.stringify(papers.map((paper) => paper.id)), papers.length, fetchedAt, expiresAt);
      this.db.prepare("UPDATE query_cache SET snapshot_id=? WHERE cache_key=?").run(snapshotId, cacheKey);
    });
    transaction.immediate();
    return { ...this.cachedSearch(requestUrl, { now: fetchedAt, allowExpired: true }), papers_new: papersNew, version_changes: versionChanges };
  }

  cacheStats({ now = new Date().toISOString() } = {}) {
    const row = this.db.prepare(`SELECT COUNT(*) AS entries,
      COALESCE(SUM(result_count),0) AS cached_result_refs,
      COALESCE(SUM(CASE WHEN expires_at>? THEN 1 ELSE 0 END),0) AS fresh_entries,
      MIN(fetched_at) AS oldest_fetch_at,MAX(fetched_at) AS newest_fetch_at
      FROM query_cache`).get(now);
    return {
      entries: Number(row.entries),
      cached_result_refs: Number(row.cached_result_refs),
      fresh_entries: Number(row.fresh_entries),
      stale_entries: Number(row.entries) - Number(row.fresh_entries),
      oldest_fetch_at: row.oldest_fetch_at || null,
      newest_fetch_at: row.newest_fetch_at || null,
      database_path: this.path,
    };
  }

  upsertMatch({ paperId, watchId, syncId, score, scoreVersion, reasons, seenAt }) {
    this.db.prepare(`INSERT INTO matches
      (paper_id,watch_id,score,score_version,reasons_json,authority,first_seen_at,last_seen_at,last_sync_id)
      VALUES (?,?,?,?,?,'candidate-only',?,?,?)
      ON CONFLICT(paper_id,watch_id) DO UPDATE SET score=excluded.score,score_version=excluded.score_version,
        reasons_json=excluded.reasons_json,last_seen_at=excluded.last_seen_at,last_sync_id=excluded.last_sync_id`)
      .run(paperId, watchId, score, scoreVersion, JSON.stringify(reasons), seenAt, seenAt, syncId);
  }

  paper(id) {
    const row = this.db.prepare(`SELECT p.*,CASE WHEN r.paper_id IS NOT NULL AND r.reviewed_version_key IS NOT p.version_key THEN 'needs-review' ELSE COALESCE(r.status,'new') END AS review_status,r.status AS previous_review_status,r.note,r.reviewed_at,r.reviewed_version_key
      FROM papers p LEFT JOIN reviews r ON r.paper_id=p.id WHERE p.id=?`).get(id);
    if (!row) return null;
    const matches = this.db.prepare(`SELECT m.watch_id,w.name AS watch_name,m.score,m.score_version,m.reasons_json,m.authority,m.last_seen_at
      FROM matches m JOIN watchlists w ON w.id=m.watch_id WHERE m.paper_id=? ORDER BY m.score DESC`).all(id)
      .map((item) => ({ ...item, reasons: parse(item.reasons_json), reasons_json: undefined }));
    return this.formatPaper(row, { matches });
  }

  formatPaper(row, extra = {}) {
    return {
      id: row.id, title: row.title, summary: row.summary, authors: parse(row.authors_json), categories: parse(row.categories_json),
      primary_category: row.primary_category, published_at: row.published_at, updated_at: row.updated_at,
      abs_url: row.abs_url, pdf_url: row.pdf_url, content_hash: row.content_hash,
      version_id: row.version_id || null, version_key: row.version_key || null,
      content_trust: "untrusted-external", review_status: row.review_status || "new", previous_review_status: row.previous_review_status || null,
      reviewed_version_key: row.reviewed_version_key || null, review_stale: row.review_status === "needs-review", note: row.note || null, ...extra,
    };
  }

  queue({ status = null, minScore = 0, limit = 50 } = {}) {
    const clauses = ["best_score >= ?"];
    const args = [minScore];
    if (status) { clauses.push("review_status = ?"); args.push(status); }
    args.push(Math.max(1, Math.min(200, limit)));
    return this.db.prepare(`SELECT * FROM (
      SELECT p.*,CASE WHEN r.paper_id IS NOT NULL AND r.reviewed_version_key IS NOT p.version_key THEN 'needs-review' ELSE COALESCE(r.status,'new') END AS review_status,r.status AS previous_review_status,r.note,r.reviewed_at,r.reviewed_version_key,
        COALESCE(MAX(m.score),0) AS best_score,GROUP_CONCAT(DISTINCT w.name) AS watch_names,
        (SELECT COUNT(*) FROM discoveries d WHERE d.paper_id=p.id) AS discovery_count
      FROM papers p LEFT JOIN matches m ON m.paper_id=p.id LEFT JOIN watchlists w ON w.id=m.watch_id
      LEFT JOIN reviews r ON r.paper_id=p.id GROUP BY p.id
    ) WHERE ${clauses.join(" AND ")} ORDER BY best_score DESC,published_at DESC LIMIT ?`).all(...args)
      .map((row) => this.formatPaper(row, { best_score: Number(row.best_score), discovery_count: row.discovery_count, watch_names: String(row.watch_names || "").split(",").filter(Boolean), authority: "candidate-only" }));
  }

  review(paperId, status, note = null, expectedVersionKey = null) {
    const paper = this.db.prepare("SELECT version_key FROM papers WHERE id=?").get(paperId);
    if (!paper) throw new Error(`Unknown paper: ${paperId}`);
    if (expectedVersionKey && paper.version_key !== expectedVersionKey) throw new Error("Paper changed since review context; reopen current version");
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO reviews(paper_id,status,note,reviewed_at,reviewed_version_key) VALUES (?,?,?,?,?)
        ON CONFLICT(paper_id) DO UPDATE SET status=excluded.status,note=excluded.note,reviewed_at=excluded.reviewed_at,reviewed_version_key=excluded.reviewed_version_key`)
        .run(paperId, status, note, now, paper.version_key);
      this.db.prepare("INSERT INTO review_history(paper_id,version_key,status,note,reviewed_at) VALUES (?,?,?,?,?)").run(paperId, paper.version_key, status, note, now);
    }).immediate();
    return this.paper(paperId);
  }

  search(query, limit = 20) {
    const tokens = String(query || "").normalize("NFKC").match(/[\p{L}\p{N}_-]{2,}/gu) || [];
    if (!tokens.length) throw new Error("Search query requires a searchable token");
    const fts = [...new Set(tokens.slice(0, 20))].map((token) => `"${token.replaceAll('"', '""')}"`).join(" OR ");
    return this.db.prepare(`SELECT p.id,p.title,p.published_at,p.primary_category,p.content_trust,
      snippet(papers_fts,1,'[',']','…',30) AS snippet,bm25(papers_fts) AS score
      FROM papers_fts JOIN papers p ON p.id=papers_fts.paper_id WHERE papers_fts MATCH ? ORDER BY score LIMIT ?`)
      .all(fts, Math.max(1, Math.min(100, limit)));
  }

  stats() {
    const row = this.db.prepare(`SELECT
      (SELECT COUNT(*) FROM papers) AS papers,
      (SELECT COUNT(*) FROM watchlists WHERE enabled=1) AS enabled_watches,
      (SELECT COUNT(*) FROM matches) AS matches,
      (SELECT COUNT(*) FROM reviews WHERE status='shortlisted') AS shortlisted,
      (SELECT COUNT(*) FROM reviews WHERE status='applied') AS applied,
      (SELECT COUNT(*) FROM sync_runs WHERE status='accepted') AS accepted_syncs,
      (SELECT COUNT(*) FROM query_cache) AS cached_queries`).get();
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
  }
}
