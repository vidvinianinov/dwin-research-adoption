import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryStore, canonical } from "../lib/store.mjs";
const report = JSON.parse(readFileSync(join(process.env.DWIN_RUN_OUTPUT || "", "memory-integrity.json"), "utf8")), store = new MemoryStore(); let independent;
try { independent = store.validate(); } finally { store.close(); }
const checks = [
  { id: "recomputed-integrity", passed: canonical(report) === canonical(independent) },
  { id: "append-only-explicit-gates", passed: report.status.append_only && report.status.source_gate === "current-adoption-record-with-accepted-experiment" && report.status.promotion_gate === "explicit-human-approval" },
  { id: "historical-source-loss-not-corruption", passed: report.passed && report.structural_integrity },
  { id: "offline-private", passed: report.network_requests === 0 && report.privacy === "local-private-no-export" && !JSON.stringify(report).includes("/Users/") }
];
const result = { passed: checks.every(check => check.passed), checks }; process.stdout.write(`${JSON.stringify(result)}\n`); if (!result.passed) process.exitCode = 1;
