import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryStore } from "../lib/store.mjs";
if (!process.env.DWIN_RUN_OUTPUT) throw new Error("DWIN_RUN_OUTPUT required");
const store = new MemoryStore(); try { const report = store.validate(); writeFileSync(join(process.env.DWIN_RUN_OUTPUT, "memory-integrity.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }); process.stdout.write(`${JSON.stringify({ candidates: report.status.candidates, claims: report.status.claims, active: report.status.active_claims, invalid_sources: report.invalid_sources })}\n`); if (!report.passed) process.exitCode = 1; } finally { store.close(); }
