import { appendFileSync } from "node:fs";
import Database from "better-sqlite3";
import { DB_PATH, EVENTS_PATH, ensureDataDirectories } from "./paths.mjs";

function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export class FactoryLedger {
  constructor(path = DB_PATH, eventPath = EVENTS_PATH) {
    ensureDataDirectories();
    this.eventPath = eventPath;
    this.db = new Database(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        capsule_id TEXT NOT NULL,
        capsule_version TEXT NOT NULL,
        job_id TEXT NOT NULL,
        trigger TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('RUNNING','ACCEPTED','REJECTED','ERROR')),
        source_hash TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        receipt_path TEXT,
        error_text TEXT
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL REFERENCES runs(id),
        seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(run_id, seq)
      );

      CREATE TABLE IF NOT EXISTS artifacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL REFERENCES runs(id),
        path TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        UNIQUE(run_id, path)
      );

      CREATE TABLE IF NOT EXISTS evaluation_receipts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL REFERENCES runs(id),
        evaluator_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('PASS','FAIL','ERROR')),
        duration_ms INTEGER NOT NULL,
        details_json TEXT NOT NULL,
        UNIQUE(run_id, evaluator_id)
      );

      CREATE INDEX IF NOT EXISTS runs_started_idx ON runs(started_at DESC);
      CREATE INDEX IF NOT EXISTS events_run_idx ON events(run_id, seq);
    `);
  }

  close() {
    this.db.close();
  }

  createRun(run) {
    this.db.prepare(`
      INSERT INTO runs (id, capsule_id, capsule_version, job_id, trigger, status, source_hash, started_at)
      VALUES (?, ?, ?, ?, ?, 'RUNNING', ?, ?)
    `).run(run.id, run.capsule_id, run.capsule_version, run.job_id, run.trigger, run.source_hash, run.started_at);
  }

  recordEvent(runId, type, payload = {}) {
    const createdAt = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM events WHERE run_id = ?").get(runId);
      const seq = Number(row.seq);
      const payloadJson = JSON.stringify(payload);
      this.db.prepare("INSERT INTO events (run_id, seq, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(runId, seq, type, payloadJson, createdAt);
      this.db.exec("COMMIT");
      appendFileSync(this.eventPath, `${JSON.stringify({ schema_version: "dwin.event/v1", run_id: runId, seq, type, payload, created_at: createdAt })}\n`, { mode: 0o600 });
      return seq;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  recordArtifacts(runId, artifacts) {
    const statement = this.db.prepare("INSERT OR REPLACE INTO artifacts (run_id, path, sha256, bytes) VALUES (?, ?, ?, ?)");
    for (const artifact of artifacts) statement.run(runId, artifact.path, artifact.sha256, artifact.bytes);
  }

  recordEvaluation(runId, evaluation) {
    this.db.prepare(`
      INSERT OR REPLACE INTO evaluation_receipts (run_id, evaluator_id, status, duration_ms, details_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(runId, evaluation.evaluator_id, evaluation.status, evaluation.duration_ms, JSON.stringify(evaluation.details));
  }

  finishRun(runId, status, receiptPath, errorText = null) {
    this.db.prepare("UPDATE runs SET status = ?, finished_at = ?, receipt_path = ?, error_text = ? WHERE id = ?")
      .run(status, new Date().toISOString(), receiptPath, errorText, runId);
  }

  listRuns(limit = 20) {
    return this.db.prepare("SELECT * FROM runs ORDER BY started_at DESC LIMIT ?").all(Math.max(1, Math.min(200, limit)));
  }

  getRun(runId) {
    const run = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(runId);
    if (!run) return null;
    const events = this.db.prepare("SELECT seq, type, payload_json, created_at FROM events WHERE run_id = ? ORDER BY seq").all(runId)
      .map((row) => ({ ...row, payload: parseJson(row.payload_json, {}), payload_json: undefined }));
    const artifacts = this.db.prepare("SELECT path, sha256, bytes FROM artifacts WHERE run_id = ? ORDER BY path").all(runId);
    const evaluations = this.db.prepare("SELECT evaluator_id, status, duration_ms, details_json FROM evaluation_receipts WHERE run_id = ? ORDER BY evaluator_id").all(runId)
      .map((row) => ({ ...row, details: parseJson(row.details_json, {}), details_json: undefined }));
    return { ...run, events, artifacts, evaluations };
  }

  status() {
    const counts = Object.fromEntries(
      this.db.prepare("SELECT status, COUNT(*) AS count FROM runs GROUP BY status").all().map((row) => [row.status, Number(row.count)]),
    );
    const latest = this.db.prepare("SELECT id, capsule_id, job_id, status, started_at, finished_at FROM runs ORDER BY started_at DESC LIMIT 1").get() || null;
    return { database: DB_PATH, counts, latest };
  }
}
