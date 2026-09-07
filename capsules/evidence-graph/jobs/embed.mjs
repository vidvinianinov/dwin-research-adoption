import {writeFileSync} from "node:fs";
import {join} from "node:path";
import {EvidenceStore} from "../lib/store.mjs";
import {SemanticStore} from "../lib/semantic-store.mjs";
import {LocalEmbedder} from "../lib/embedding-runtime.mjs";
if(!process.env.DWIN_RUN_OUTPUT)throw new Error("DWIN_RUN_OUTPUT required");
const evidence=new EvidenceStore(),semantic=new SemanticStore(),runtime=new LocalEmbedder();
try{
  const report=await semantic.build(evidence,runtime);
  if(report.status==="READY")report.integrity=semantic.integrity(evidence);
  writeFileSync(join(process.env.DWIN_RUN_OUTPUT,"embedding-report.json"),JSON.stringify(report,null,2)+"\n",{mode:0o600});
  process.stdout.write(JSON.stringify({status:report.status,computed:report.computed,cache_hits:report.cache_hits,pending:report.pending})+"\n");
}finally{await runtime.close();semantic.close();evidence.close();}
