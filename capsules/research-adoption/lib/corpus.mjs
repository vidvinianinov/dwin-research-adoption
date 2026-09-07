import Ajv from "ajv";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FACTORY_DATA } from "../../../src/paths.mjs";
import { RadarStore } from "../../research-radar/lib/db.mjs";
import { registerSource } from "../../document-intelligence/lib/store.mjs";

export const DATA = join(FACTORY_DATA, "capsules", "research-adoption");
export const POLICY = JSON.parse(readFileSync(new URL("../contracts/policy.json", import.meta.url), "utf8"));
export const CORPUS = JSON.parse(readFileSync(new URL("../contracts/pilot-corpus.json", import.meta.url), "utf8"));
const reportSchema = JSON.parse(readFileSync(new URL("../contracts/research-adoption-report.schema.json", import.meta.url), "utf8"));
const validateReport = new Ajv({ allErrors: true, strict: true }).compile(reportSchema);
export const sha = value => createHash("sha256").update(value).digest("hex");

function privateDir(path) { mkdirSync(path, { recursive: true, mode: 0o700 }); }
function atomicWrite(path, bytes) { const next = `${path}.next`; writeFileSync(next, bytes, { mode: 0o600 }); renameSync(next, path); }
export function sourceId(paper) { return `${POLICY.document_source_prefix}${paper.version_id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`; }
export function corpusRoot(data = DATA) { return join(data, "corpora", CORPUS.corpus_id); }
export function pdfPath(paper, data = DATA) { return join(corpusRoot(data), `${sourceId(paper)}.pdf`); }
export function lockPath(data = DATA) { return join(corpusRoot(data), "corpus-lock.json"); }

export function assertPdfUrl(raw) {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.hostname !== POLICY.allowed_pdf_domain || url.username || url.password || (url.port && url.port !== "443") || !/^\/pdf\/(?:\d{4}\.\d{4,5}|[a-z][a-z.-]*\/\d{7})v[1-9]\d*$/i.test(url.pathname)) throw new Error("PDF_URL_OUTSIDE_ALLOWLIST");
  return url;
}

export async function fetchPinnedPdf(versionId, { fetchImpl = fetch } = {}) {
  let url = assertPdfUrl(`https://${POLICY.allowed_pdf_domain}/pdf/${versionId}`);
  const signal = AbortSignal.timeout(POLICY.download_timeout_ms);
  for (let redirects = 0; redirects <= 2; redirects += 1) {
    const response = await fetchImpl(url, { redirect: "manual", signal, headers: { "User-Agent": "DWIN-Research-Adoption/0.1 (local-personal-research-tool)", Accept: "application/pdf" } });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      if (redirects === 2) throw new Error("PDF_REDIRECT_LIMIT");
      const location = response.headers.get("location");
      if (!location) throw new Error("PDF_REDIRECT_WITHOUT_LOCATION");
      url = assertPdfUrl(new URL(location, url));
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`PDF_HTTP_${response.status}`); }
    const length = Number(response.headers.get("content-length") || 0);
    if (length > POLICY.max_pdf_bytes) { await response.body?.cancel(); throw new Error("PDF_SIZE_BOUND"); }
    if (!response.body) throw new Error("PDF_BODY_MISSING");
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > POLICY.max_pdf_bytes) throw new Error("PDF_SIZE_BOUND"); chunks.push(Buffer.from(chunk)); }
    const bytes = Buffer.concat(chunks);
    if (bytes.length < 5 || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error("PDF_MAGIC_INVALID");
    return bytes;
  }
  throw new Error("PDF_FETCH_FAILED");
}

function readLock(data = DATA) {
  if (!existsSync(lockPath(data))) return null;
  const lock = JSON.parse(readFileSync(lockPath(data), "utf8"));
  if (lock.schema_version !== "dwin.research-corpus-lock/v1" || lock.corpus_id !== CORPUS.corpus_id || !Array.isArray(lock.papers)) throw new Error("CORPUS_LOCK_INVALID");
  return lock;
}

export async function syncPilotCorpus({ data = DATA, fetchImpl = fetch, radar = null, register = registerSource, runId = "standalone" } = {}) {
  if (CORPUS.schema_version !== "dwin.research-corpus/v1" || CORPUS.corpus_id !== POLICY.corpus_id || CORPUS.papers.length !== POLICY.max_papers) throw new Error("CORPUS_CONTRACT_INVALID");
  privateDir(corpusRoot(data));
  const store = radar || new RadarStore(), closeRadar = !radar, prior = readLock(data), papers = [];
  let networkRequests = 0;
  try {
    for (const paper of CORPUS.papers) {
      const metadata = store.paperVersion(paper.version_key);
      if (!metadata || metadata.id !== paper.id || metadata.version_id !== paper.version_id || metadata.title !== paper.title) throw new Error(`RADAR_VERSION_NOT_PINNED:${paper.version_id}`);
      const path = pdfPath(paper, data), locked = prior?.papers.find(item => item.version_key === paper.version_key);
      let bytes, status;
      if (locked && existsSync(path)) {
        bytes = readFileSync(path);
        if (sha(bytes) !== locked.pdf_sha256 || bytes.length !== locked.pdf_bytes || bytes.subarray(0, 5).toString("ascii") !== "%PDF-") throw new Error(`CORPUS_SNAPSHOT_CHANGED:${paper.version_id}`);
        status = "cache-hit";
      } else {
        bytes = await fetchPinnedPdf(paper.version_id, { fetchImpl }); networkRequests += 1; status = "downloaded";
        if (locked && sha(bytes) !== locked.pdf_sha256) throw new Error(`PINNED_PDF_CHANGED:${paper.version_id}`);
        atomicWrite(path, bytes);
      }
      const item = { id: paper.id, version_id: paper.version_id, version_key: paper.version_key, source_id: sourceId(paper), pdf_sha256: sha(bytes), pdf_bytes: bytes.length, status, registered: false };
      register(item.source_id, path); item.registered = true; papers.push(item);
    }
  } finally { if (closeRadar) store.close(); }
  const lock = { schema_version: "dwin.research-corpus-lock/v1", corpus_id: CORPUS.corpus_id, created_at: prior?.created_at || new Date().toISOString(), papers: papers.map(({ status, registered, ...item }) => item) };
  if (prior) {
    const stable = value => JSON.stringify({ ...value, created_at: null });
    if (stable(prior) !== stable(lock)) throw new Error("CORPUS_LOCK_IMMUTABILITY_VIOLATION");
  } else atomicWrite(lockPath(data), `${JSON.stringify(lock, null, 2)}\n`);
  const report = { schema_version: "dwin.research-adoption-report/v1", run_id: runId, corpus_id: CORPUS.corpus_id, papers, network_requests: networkRequests, endpoint_domains: networkRequests ? [POLICY.allowed_pdf_domain] : [], privacy: POLICY.privacy, authority: POLICY.authority, instruction_authority: POLICY.instruction_authority, memory_promotion: POLICY.memory_promotion };
  if (!validateReport(report)) throw new Error(`REPORT_CONTRACT_FAILED:${new Ajv().errorsText(validateReport.errors)}`);
  return { report, lock };
}

export function verifyCorpus(data = DATA) {
  const lock = readLock(data); if (!lock) return { ready: false, reason: "CORPUS_LOCK_MISSING", papers: [] };
  const papers = lock.papers.map(item => { const paper = CORPUS.papers.find(candidate => candidate.version_key === item.version_key), path = paper ? pdfPath(paper, data) : null; let current = null; try { const bytes = readFileSync(path); current = { pdf_sha256: sha(bytes), pdf_bytes: bytes.length, pdf_magic: bytes.subarray(0, 5).toString("ascii") === "%PDF-" }; } catch {} return { ...item, current, valid: Boolean(current && current.pdf_sha256 === item.pdf_sha256 && current.pdf_bytes === item.pdf_bytes && current.pdf_magic) }; });
  return { ready: papers.length === POLICY.max_papers && papers.every(item => item.valid), reason: papers.every(item => item.valid) ? null : "CORPUS_INTEGRITY_FAILED", corpus_id: CORPUS.corpus_id, papers };
}
