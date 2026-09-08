import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateReconciliation } from "../lib/evaluation.mjs";
import { SetupStore } from "../lib/store.mjs";
if (!process.env.DWIN_RUN_OUTPUT) throw new Error("DWIN_RUN_OUTPUT required");
const testCase = JSON.parse(readFileSync(new URL("../evals/memory-portability-case.json", import.meta.url), "utf8")), store = new SetupStore();
try { const report = evaluateReconciliation(store, testCase); writeFileSync(join(process.env.DWIN_RUN_OUTPUT, "setup-reconciliation-eval.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }); process.stdout.write(`${JSON.stringify({ case_id: report.case_id, passed: report.passed, accuracy: report.metrics.capability_status_accuracy, decision: report.boundaries.decision })}\n`); if (!report.passed) process.exitCode = 1; } finally { store.close(); }
