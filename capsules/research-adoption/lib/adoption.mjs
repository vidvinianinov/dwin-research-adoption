import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FactoryLedger } from "../../../src/db.mjs";
import { assertReceipt } from "../../../src/manifests.mjs";
import { FACTORY_DATA } from "../../../src/paths.mjs";
import { registerSource as registerEvidenceSource, EvidenceStore } from "../../evidence-graph/lib/store.mjs";
import { DocumentStore, CONFIG_HASH as DOCUMENT_CONFIG_HASH } from "../../document-intelligence/lib/store.mjs";
import { CORPUS, DATA, POLICY, sha, sourceId, verifyCorpus } from "./corpus.mjs";

const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b, "en"))) : item);
const wordTokens = text => [...new Set(String(text).normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])].filter(token => !new Set(["the", "and", "for", "with", "from", "into", "using"]).has(token));
const ratio = (n, d) => d ? n / d : 0;

export function dailyPilotStateHonest(report, policy = POLICY) {
  if (report.corpus.ready) return report.corpus.parser_gate_passed && report.local_extraction.papers_complete === policy.max_papers;
  return !report.corpus.parser_gate_passed && report.local_extraction.papers_complete < policy.max_papers && report.next_actions.includes("repair-pilot-parser-gate") && report.next_actions.includes("continue-bounded-local-extraction");
}

export function buildPilotAudit({ data = DATA } = {}) {
  const corpus = verifyCorpus(data), store = new DocumentStore();
  try {
    const results = CORPUS.papers.map(paper => {
      const locked = corpus.papers.find(item => item.version_key === paper.version_key), document = store.get(sourceId(paper));
      if (!locked?.valid || !document) return { id: paper.id, version_id: paper.version_id, source_id: sourceId(paper), indexed: false, gates: { snapshot_current: false, title_recovered: false, provenance: false, duplicates: false, encoding: false }, passed: false };
      const blocks = store.db.prepare("SELECT data FROM blocks WHERE source_id=? ORDER BY ordinal").all(sourceId(paper)).map(row => JSON.parse(row.data));
      const titleTokens = wordTokens(paper.title), recovered = new Set(wordTokens(blocks.slice(0, 40).map(block => block.text).join("\n"))), titleRecall = ratio(titleTokens.filter(token => recovered.has(token)).length, titleTokens.length);
      const provenanceCoverage = ratio(blocks.filter(block => block.provenance?.some(item => Number.isInteger(item.page_no))).length, blocks.length);
      const counts = new Map(); for (const block of blocks) counts.set(block.text_sha256, (counts.get(block.text_sha256) || 0) + 1);
      const duplicateRatio = ratio([...counts.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0), blocks.length);
      const totalCharacters = blocks.reduce((sum, block) => sum + block.text.length, 0), replacementCharacters = blocks.reduce((sum, block) => sum + (block.text.match(/�/g)?.length || 0), 0), replacementRatio = ratio(replacementCharacters, totalCharacters);
      const labels = Object.fromEntries([...new Set(blocks.map(block => block.label))].sort().map(label => [label, blocks.filter(block => block.label === label).length]));
      const gates = { snapshot_current: document.source_sha256 === locked.pdf_sha256 && document.parser_config_hash === DOCUMENT_CONFIG_HASH, title_recovered: titleRecall >= POLICY.minimum_title_token_recall, provenance: provenanceCoverage >= POLICY.minimum_page_provenance_coverage, duplicates: duplicateRatio <= POLICY.maximum_duplicate_block_ratio, encoding: replacementRatio <= POLICY.maximum_replacement_character_ratio };
      return { id: paper.id, version_id: paper.version_id, source_id: sourceId(paper), indexed: true, pdf_sha256: locked.pdf_sha256, document_snapshot: { parser: document.parser, parser_version: document.parser_version, parser_config_hash: document.parser_config_hash, model_artifacts_hash: document.model_artifacts_hash, markdown_sha256: document.markdown_sha256, page_count: document.page_count, block_count: document.block_count }, metrics: { title_token_recall: titleRecall, page_provenance_coverage: provenanceCoverage, duplicate_block_ratio: duplicateRatio, replacement_character_ratio: replacementRatio, total_characters: totalCharacters, labels }, gates, passed: Object.values(gates).every(Boolean) };
    });
    const integrity = store.integrity(results.filter(item => item.indexed).map(item => item.source_id));
    const state = results.map(item => [item.version_id, item.pdf_sha256 || null, item.document_snapshot?.markdown_sha256 || null, item.document_snapshot?.parser_config_hash || null]);
    return { schema_version: "dwin.pilot-corpus-audit/v1", corpus_id: CORPUS.corpus_id, corpus_state_hash: sha(canonical(state)), papers: results, aggregate: { expected: POLICY.max_papers, indexed: results.filter(item => item.indexed).length, passed: results.filter(item => item.passed).length }, integrity, gate_passed: corpus.ready && integrity.passed && results.length === POLICY.max_papers && results.every(item => item.passed), benchmark_claim: "parser-health-and-provenance-audit-not-semantic-accuracy", scientific_verification: false, network_requests: 0, privacy: POLICY.privacy, authority: POLICY.authority, instruction_authority: POLICY.instruction_authority, memory_promotion: POLICY.memory_promotion };
  } finally { store.close(); }
}

export function latestAcceptedAudit({ data = DATA } = {}) {
  const ledger = new FactoryLedger();
  try {
    const run = ledger.listRuns(200).find(item => item.capsule_id === "research-adoption" && item.job_id === "audit-pilot-corpus" && item.status === "ACCEPTED");
    if (!run?.receipt_path || !existsSync(run.receipt_path)) throw new Error("ACCEPTED_AUDIT_REQUIRED");
    const receiptBytes = readFileSync(run.receipt_path), receipt = assertReceipt(JSON.parse(receiptBytes));
    const artifact = receipt.artifacts.find(item => item.path === "pilot-corpus-audit.json"); if (!artifact) throw new Error("AUDIT_ARTIFACT_MISSING");
    const path = join(FACTORY_DATA, "runs", run.id, "output", artifact.path), bytes = readFileSync(path);
    if (sha(bytes) !== artifact.sha256) throw new Error("AUDIT_ARTIFACT_CHANGED");
    const audit = JSON.parse(bytes); if (!audit.gate_passed) throw new Error("AUDIT_GATE_NOT_PASSED");
    return { run_id: run.id, receipt_sha256: sha(receiptBytes), artifact_sha256: artifact.sha256, audit };
  } finally { ledger.close(); }
}

export function buildCandidateGraph({ data = DATA } = {}) {
  const accepted = latestAcceptedAudit({ data }), liveAudit = buildPilotAudit({ data });
  if (liveAudit.corpus_state_hash !== accepted.audit.corpus_state_hash || !liveAudit.gate_passed) throw new Error("AUDIT_IS_STALE");
  const bridgeRoot = join(data, "evidence-bridge", CORPUS.corpus_id); mkdirSync(bridgeRoot, { recursive: true, mode: 0o700 });
  const documents = new DocumentStore(), nodes = new Map(), edges = [], lineage = [];
  const node = value => nodes.set(value.id, value), edge = (src, dst, type, evidenceBlockId = null) => edges.push({ id: sha(canonical([src, dst, type, evidenceBlockId])), src, dst, type, evidence_block_id: evidenceBlockId, authority: "candidate-only" });
  try {
    for (const paper of CORPUS.papers) {
      const document = documents.get(sourceId(paper)); if (!document) throw new Error(`DOCUMENT_MISSING:${paper.version_id}`);
      const source = `paper:${paper.version_id}`, pdf = `pdf:${document.source_sha256}`, snapshot = `document:${paper.version_id}:${document.markdown_sha256}`;
      node({ id: source, type: "PaperVersion", label: paper.version_id }); node({ id: pdf, type: "PdfSnapshot", sha256: document.source_sha256, bytes: document.source_bytes }); node({ id: snapshot, type: "DocumentSnapshot", sha256: document.markdown_sha256, parser_config_hash: document.parser_config_hash });
      edge(source, pdf, "HAS_PINNED_PDF"); edge(pdf, snapshot, "PARSED_INTO");
      for (const dimension of paper.dimensions) { const id = `dimension:${dimension}`; node({ id, type: "ResearchDimension", label: dimension }); edge(source, id, "CANDIDATE_FOR_DIMENSION"); }
      const all = documents.db.prepare("SELECT data FROM blocks WHERE source_id=? ORDER BY ordinal").all(sourceId(paper)).map(row => JSON.parse(row.data));
      const priority = block => ["title", "section_header", "formula", "table", "caption"].includes(block.label) ? 0 : 1;
      const selected = [...all].sort((a, b) => priority(a) - priority(b) || a.ordinal - b.ordinal).slice(0, POLICY.max_graph_blocks_per_paper).sort((a, b) => a.ordinal - b.ordinal);
      for (const block of selected) { node({ id: block.id, type: "DocumentBlock", label: block.label, ordinal: block.ordinal, page_no: block.provenance?.[0]?.page_no || null, content_hash: block.text_sha256 }); edge(snapshot, block.id, "CONTAINS_BLOCK", block.id); }
      const target = join(bridgeRoot, `${paper.version_id}.md`), markdown = readFileSync(document.markdown_path);
      if (sha(markdown) !== document.markdown_sha256) throw new Error("DOCUMENT_EXPORT_CHANGED");
      writeFileSync(target, markdown, { mode: 0o600 });
      lineage.push({ paper_id: paper.id, version_id: paper.version_id, source_id: sourceId(paper), pdf_sha256: document.source_sha256, document_markdown_sha256: document.markdown_sha256, selected_block_ids: selected.map(block => block.id) });
    }
  } finally { documents.close(); }
  registerEvidenceSource("research-pilot-docling", bridgeRoot);
  const evidence = new EvidenceStore(); let evidenceResult, evidenceIntegrity;
  try { evidenceResult = evidence.index(); evidenceIntegrity = evidence.integrity(); } finally { evidence.close(); }
  return { schema_version: "dwin.research-candidate-graph/v1", corpus_id: CORPUS.corpus_id, corpus_state_hash: liveAudit.corpus_state_hash, audit_receipt: { run_id: accepted.run_id, receipt_sha256: accepted.receipt_sha256, artifact_sha256: accepted.artifact_sha256 }, evidence_graph: { generation: evidenceResult.generation, integrity_passed: evidenceIntegrity.passed, bridge_source_id: "research-pilot-docling" }, nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id, "en")), edges: edges.sort((a, b) => a.id.localeCompare(b.id, "en")), lineage, graph_semantics: "deterministic-structural-links-plus-candidate-dimensions", scientific_verification: false, network_requests: 0, privacy: POLICY.privacy, authority: POLICY.authority, instruction_authority: POLICY.instruction_authority, memory_promotion: POLICY.memory_promotion };
}

export { canonical };
