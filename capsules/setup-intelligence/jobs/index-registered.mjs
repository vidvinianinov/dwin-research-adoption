import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { SetupStore } from "../lib/store.mjs";
if (!process.env.DWIN_RUN_OUTPUT) throw new Error("DWIN_RUN_OUTPUT required");
const store = new SetupStore();
try { const report = store.index(); writeFileSync(join(process.env.DWIN_RUN_OUTPUT, "setup-index-report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }); process.stdout.write(`${JSON.stringify({ generation: report.generation, changed: report.changed, components: report.counts.components })}\n`); } finally { store.close(); }
