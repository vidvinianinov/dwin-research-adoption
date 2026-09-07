import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractNextLocalCandidate } from "../lib/local-extraction.mjs";
if (!process.env.DWIN_RUN_OUTPUT || !process.env.DWIN_RUN_ID) throw new Error("Factory runtime environment is incomplete");
const report = await extractNextLocalCandidate({ runId: process.env.DWIN_RUN_ID });
writeFileSync(join(process.env.DWIN_RUN_OUTPUT, "local-candidate-extraction.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ paper: report.paper.version_id, candidates: report.candidates.length, cache_status: report.cache_status, network_requests: report.network_requests })}\n`);
