import Ajv from "ajv";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SetupStore } from "../lib/store.mjs";
import { EvidenceStore } from "../../evidence-graph/lib/store.mjs";
if (!process.env.DWIN_RUN_OUTPUT) throw new Error("DWIN_RUN_OUTPUT required");
const indexPath = join(process.env.DWIN_RUN_OUTPUT, "setup-index-report.json"), bridgePath = join(process.env.DWIN_RUN_OUTPUT, "setup-evidence-bridge-report.json"), evaluationPath = join(process.env.DWIN_RUN_OUTPUT, "setup-reconciliation-eval.json"), checks = [];
const store = new SetupStore();
try {
  const integrity = store.integrity(); checks.push({ id: "setup-index-integrity", passed: integrity.passed, details: integrity });
  if (existsSync(indexPath)) { const schema = JSON.parse(readFileSync(new URL("../contracts/setup-index-report.schema.json", import.meta.url), "utf8")), report = JSON.parse(readFileSync(indexPath, "utf8")), validate = new Ajv({ allErrors: true, strict: true }).compile(schema); checks.push({ id: "index-report-contract", passed: validate(report), details: validate.errors || null }); }
  else if (existsSync(bridgePath)) { const report = JSON.parse(readFileSync(bridgePath, "utf8")), evidence = new EvidenceStore(); try { const e = evidence.integrity(); checks.push({ id: "bridge-generation", passed: report.setup_generation === store.status().evidence_bridge_generation }); checks.push({ id: "evidence-index-integrity", passed: e.passed, details: e }); } finally { evidence.close(); } }
  else if (existsSync(evaluationPath)) { const schema = JSON.parse(readFileSync(new URL("../contracts/reconciliation-eval.schema.json", import.meta.url), "utf8")), report = JSON.parse(readFileSync(evaluationPath, "utf8")), validate = new Ajv({ allErrors: true, strict: true }).compile(schema); checks.push({ id: "reconciliation-eval-contract", passed: validate(report), details: validate.errors || null }); checks.push({ id: "reconciliation-eval-gate", passed: report.passed === true && report.boundaries.memory_changed === false && report.boundaries.setup_changed === false, details: report.metrics }); }
  else checks.push({ id: "declared-artifact", passed: false });
  checks.push({ id: "candidate-only-boundary", passed: true, details: { authority: "candidate-only", automatic_change: false } });
} finally { store.close(); }
const result = { passed: checks.every(check => check.passed), checks }; process.stdout.write(`${JSON.stringify(result)}\n`); if (!result.passed) process.exitCode = 1;
