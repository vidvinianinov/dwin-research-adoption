import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { RadarStore } from "../lib/db.mjs";
import { syncResearchRadar } from "../lib/sync.mjs";

const outputRoot = process.env.DWIN_RUN_OUTPUT;
if (!outputRoot) throw new Error("DWIN_RUN_OUTPUT is required");
const report = await syncResearchRadar({ mode: process.env.DWIN_RESEARCH_SCAN_MODE || "auto" });
const store = new RadarStore();
try { report.database_stats = store.stats(); } finally { store.close(); }
writeFileSync(join(outputRoot, "research-sync-report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ sync_id: report.sync_id, queries_succeeded: report.queries_succeeded, papers_seen: report.papers_seen })}\n`);
if (report.queries_failed > 0) process.exitCode = 1;
