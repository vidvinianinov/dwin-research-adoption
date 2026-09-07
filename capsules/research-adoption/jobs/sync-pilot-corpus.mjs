import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { syncPilotCorpus } from "../lib/corpus.mjs";

if (!process.env.DWIN_RUN_OUTPUT || !process.env.DWIN_RUN_ID) throw new Error("Factory runtime environment is incomplete");
const { report, lock } = await syncPilotCorpus({ runId: process.env.DWIN_RUN_ID });
writeFileSync(join(process.env.DWIN_RUN_OUTPUT, "research-adoption-report.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
writeFileSync(join(process.env.DWIN_RUN_OUTPUT, "corpus-lock.json"), `${JSON.stringify(lock, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ corpus_id: report.corpus_id, papers: report.papers.length, downloaded: report.network_requests })}\n`);
