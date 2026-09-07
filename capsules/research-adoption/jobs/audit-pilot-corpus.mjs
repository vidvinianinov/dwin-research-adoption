import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildPilotAudit } from "../lib/adoption.mjs";
if (!process.env.DWIN_RUN_OUTPUT) throw new Error("DWIN_RUN_OUTPUT required");
const report = buildPilotAudit();
writeFileSync(join(process.env.DWIN_RUN_OUTPUT, "pilot-corpus-audit.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ indexed: report.aggregate.indexed, passed: report.aggregate.passed, gate_passed: report.gate_passed })}\n`);
if (!report.gate_passed) process.exitCode = 1;
