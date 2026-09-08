import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { SetupStore } from "../lib/store.mjs";
if (!process.env.DWIN_RUN_OUTPUT) throw new Error("DWIN_RUN_OUTPUT required");
const store = new SetupStore();
try { const report = store.bridgeEvidence(); writeFileSync(join(process.env.DWIN_RUN_OUTPUT, "setup-evidence-bridge-report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }); process.stdout.write(`${JSON.stringify({ setup_generation: report.setup_generation, bridge_files: report.bridge_files, evidence_generation: report.evidence.generation })}\n`); } finally { store.close(); }
