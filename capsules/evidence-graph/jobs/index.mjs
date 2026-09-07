import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { EvidenceStore } from "../lib/store.mjs";
if(!process.env.DWIN_RUN_OUTPUT) throw new Error("DWIN_RUN_OUTPUT required");
const store = new EvidenceStore();
try {
  const result = store.index(), integrity = store.integrity();
  const report = {schema_version:"dwin.evidence-index-report/v1",generation:result.generation,policy_hash:result.policy_hash,
    counts:result.counts,changed:result.changed,source_bytes_read:result.source_bytes_read,parsed_documents:result.parsed_documents,
    integrity,privacy:"local-private-no-export",authority:"candidate-only",instruction_authority:"none",network_requests:0};
  writeFileSync(join(process.env.DWIN_RUN_OUTPUT,"evidence-index-report.json"),JSON.stringify(report,null,2)+"\n",{mode:0o600});
  const graph=store.db.transaction(()=>({schema_version:"dwin.evidence-graph/v1",generation:store.status().generation,
    privacy:"local-private-no-export",authority:"candidate-only",instruction_authority:"none",
    nodes:store.db.prepare("SELECT * FROM nodes ORDER BY id").all(),edges:store.db.prepare("SELECT * FROM edges ORDER BY id").all()}))();
  writeFileSync(join(process.env.DWIN_RUN_OUTPUT,"private-evidence-graph.json"),JSON.stringify(graph,null,2)+"\n",{mode:0o600});
  process.stdout.write(JSON.stringify({generation:result.generation,counts:result.counts})+"\n");
  if(!integrity.passed) process.exitCode=1;
} finally {store.close();}
