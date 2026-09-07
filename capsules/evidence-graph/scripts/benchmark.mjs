import assert from "node:assert/strict";
import { cpSync,mkdtempSync,readFileSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { EvidenceStore,registerSource,sha } from "../lib/store.mjs";
const casesFile=new URL("../evals/cases.json",import.meta.url),cases=JSON.parse(readFileSync(casesFile,"utf8"));
const root=mkdtempSync(join(tmpdir(),"dwin-cache-bench-")),data=join(root,"data"),source=join(root,"fixture");
cpSync(new URL("../../../test/fixtures/evidence-graph/",import.meta.url),source,{recursive:true});
registerSource("fixture",source,data);const store=new EvidenceStore(data);
try {
 store.index();const rows=[];
 for(const item of cases.queries){
  const request={query:item.query,context_id:item.query,limit:3};let known=null;
  const arms={baseline:{calls:0,executions:0,bytes:0,ms:[]},treatment:{calls:0,executions:0,bytes:0,ms:[]}};
  for(let i=0;i<20;i++)for(const arm of i%2?["treatment","baseline"]:["baseline","treatment"]){
   const started=performance.now();const result=store.search({...request,bypass_cache:arm==="baseline",...(arm==="treatment"&&known?{known_packet_hash:known}:{})});
   const metrics=arms[arm];metrics.calls++;metrics.executions+=Number(result.retrieval_executed);metrics.bytes+=Buffer.byteLength(JSON.stringify(result));metrics.ms.push(performance.now()-started);
   if(result.packet){assert.ok(result.packet.results.some(x=>x.locator.endsWith(item.expected)));if(known)assert.equal(result.packet_hash,known);else known=result.packet_hash;}
   else assert.equal(result.status,"NOT_MODIFIED");
  }
  for(const arm of Object.values(arms)){arm.ms.sort((a,b)=>a-b);arm.median_ms=arm.ms[10];delete arm.ms;}
  rows.push({query:item.query,expected:item.expected,passed:true,arms});
 }
 const integrity=store.integrity();assert.ok(integrity.passed);
 const report={schema_version:"dwin.evidence-cache-benchmark/v1",created_at:new Date().toISOString(),cases_hash:sha(readFileSync(casesFile)),generation:store.status().generation,
  runtime:process.version,repetitions_per_query:20,queries:rows,integrity,passed:true,
  model_calls:0,measured_model_tokens:null,actual_money_saved:null,
  limitations:["Fixture benchmark, not a sealed independent holdout","Response-byte reduction requires exact packet already in caller context","No model-quality or provider billing experiment","Warm cache can be slower for a tiny corpus; timing is observational"]};
 const output=process.argv[2];if(output)writeFileSync(output,JSON.stringify(report,null,2)+"\n",{mode:0o600});
 process.stdout.write(JSON.stringify(report,null,2)+"\n");
}finally{store.close();}
