import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EvidenceStore } from "../../evidence-graph/lib/store.mjs";
import { buildPilotAudit, canonical, dailyPilotStateHonest } from "../lib/adoption.mjs";
import { CORPUS, POLICY, sha, verifyCorpus } from "../lib/corpus.mjs";
import { verifyLocalCandidateReport } from "../lib/local-extraction.mjs";

const root = process.env.DWIN_RUN_OUTPUT || ""; let checks = [];
if (existsSync(join(root, "research-adoption-daily.json"))) {
  const report = JSON.parse(readFileSync(join(root, "research-adoption-daily.json"), "utf8"));
  checks = [
    { id: "daily-bounded", passed: report.corpus.expected_papers === POLICY.max_papers && report.local_extraction.by_paper.length === POLICY.max_papers && report.research_review_queue.length <= 5 },
    { id: "daily-pilot-state-honest", passed: dailyPilotStateHonest(report) },
    { id: "daily-no-automatic-authority", passed: report.automatic_inference === false && report.automatic_memory_promotion === false && report.authority === "candidate-only" },
    { id: "daily-offline-private", passed: report.network_requests === 0 && report.privacy === "local-private-no-export" && !JSON.stringify(report).includes("/Users/") }
  ];
} else if (existsSync(join(root, "research-adoption-report.json"))) {
  const report = JSON.parse(readFileSync(join(root, "research-adoption-report.json"), "utf8")), lock = JSON.parse(readFileSync(join(root, "corpus-lock.json"), "utf8")), corpus = verifyCorpus();
  checks = [
    { id: "version-pinned-five-paper-corpus", passed: report.papers.length === POLICY.max_papers && JSON.stringify(report.papers.map(item => item.version_id)) === JSON.stringify(CORPUS.papers.map(item => item.version_id)) },
    { id: "official-bounded-fetch", passed: report.network_requests >= 0 && report.network_requests <= POLICY.max_papers && report.endpoint_domains.every(item => item === POLICY.allowed_pdf_domain) },
    { id: "immutable-pdf-snapshots", passed: corpus.ready && lock.papers.length === POLICY.max_papers && report.papers.every(item => item.registered && /^[a-f0-9]{64}$/.test(item.pdf_sha256)) },
    { id: "candidate-only-no-memory", passed: report.authority === "candidate-only" && report.instruction_authority === "none" && report.memory_promotion === "forbidden" },
    { id: "private-bounded-report", passed: report.privacy === "local-private-no-export" && !JSON.stringify(report).includes("/Users/") }
  ];
} else if (existsSync(join(root, "pilot-corpus-audit.json"))) {
  const report = JSON.parse(readFileSync(join(root, "pilot-corpus-audit.json"), "utf8")), independent = buildPilotAudit();
  checks = [
    { id: "audit-recomputed", passed: canonical(report) === canonical(independent) },
    { id: "all-papers-pass-parser-health", passed: report.aggregate.expected === POLICY.max_papers && report.aggregate.passed === POLICY.max_papers && report.gate_passed === true },
    { id: "honest-benchmark-claim", passed: report.benchmark_claim === "parser-health-and-provenance-audit-not-semantic-accuracy" && report.scientific_verification === false },
    { id: "offline-candidate-only", passed: report.network_requests === 0 && report.authority === "candidate-only" && report.memory_promotion === "forbidden" }
  ];
} else if (existsSync(join(root, "research-candidate-graph.json"))) {
  const report = JSON.parse(readFileSync(join(root, "research-candidate-graph.json"), "utf8")), ids = new Set(report.nodes.map(node => node.id)), evidence = new EvidenceStore(); let integrity;
  try { integrity = evidence.integrity(); checks = [
    { id: "accepted-audit-bound", passed: /^run_/.test(report.audit_receipt.run_id) && /^[a-f0-9]{64}$/.test(report.audit_receipt.receipt_sha256) },
    { id: "graph-closed-and-bounded", passed: report.nodes.length <= POLICY.max_papers * (POLICY.max_graph_blocks_per_paper + 8) && report.edges.length <= POLICY.max_papers * (POLICY.max_graph_blocks_per_paper + 8) && report.edges.every(edge => ids.has(edge.src) && ids.has(edge.dst) && edge.authority === "candidate-only") },
    { id: "document-evidence-bridge-current", passed: integrity.passed && report.evidence_graph.integrity_passed && report.evidence_graph.generation === evidence.status().generation },
    { id: "deterministic-not-scientific", passed: report.graph_semantics === "deterministic-structural-links-plus-candidate-dimensions" && report.scientific_verification === false && report.memory_promotion === "forbidden" },
    { id: "offline-private", passed: report.network_requests === 0 && report.privacy === "local-private-no-export" && !JSON.stringify(report).includes("/Users/") }
  ]; } finally { evidence.close(); }
} else if (existsSync(join(root, "local-candidate-extraction.json"))) {
  const report = JSON.parse(readFileSync(join(root, "local-candidate-extraction.json"), "utf8"));
  checks = [
    { id: "pinned-local-model-and-cache-identity", passed: report.model === POLICY.local_model && /^[a-f0-9]{64}$/.test(report.model_identity_hash) && /^[a-f0-9]{64}$/.test(report.cache_key) },
    { id: "source-bound-candidates", passed: verifyLocalCandidateReport(report) },
    { id: "bounded-loopback-only", passed: report.network_requests >= 1 && report.network_requests <= 2 && report.endpoint_domains.every(item => item === "127.0.0.1") },
    { id: "human-unverified-no-promotion", passed: report.scientific_verification === false && report.memory_promotion === "forbidden" && report.candidates.every(item => item.extraction_status === "human-unverified-agent-extraction") },
    { id: "private", passed: report.privacy === "local-private-no-export" && !JSON.stringify(report).includes("/Users/") }
  ];
} else throw new Error("No research-adoption artifact found");
const result = { passed: checks.every(check => check.passed), checks };
process.stdout.write(`${JSON.stringify(result)}\n`); if (!result.passed) process.exitCode = 1;
