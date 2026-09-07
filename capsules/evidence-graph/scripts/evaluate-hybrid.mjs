import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {performance} from "node:perf_hooks";
import {EvidenceStore,registerSource} from "../lib/store.mjs";
import {SemanticStore,RETRIEVAL_FINGERPRINT} from "../lib/semantic-store.mjs";
import {LocalEmbedder,EMBEDDING_FINGERPRINT,vectorBytes} from "../lib/embedding-runtime.mjs";
import {EP,digest,assertModel} from "../lib/model-artifacts.mjs";
import {hybridResult} from "../lib/hybrid-contracts.mjs";
const casesBytes=readFileSync(new URL("../evals/hybrid-cases.json",import.meta.url)),cases=JSON.parse(casesBytes);
assertModel();
const root=mkdtempSync(join(tmpdir(),"dwin-hybrid-eval-")),source=join(root,"source"),data=join(root,"data");mkdirSync(source);
for(const doc of cases.documents)writeFileSync(join(source,doc.id+".txt"),doc.text,{mode:0o600});
registerSource("fixture",source,data);const evidence=new EvidenceStore(data),semantic=new SemanticStore(data),runtime=new LocalEmbedder();
// Deny network at the JS fetch boundary during actual model inference. This is not an OS sandbox.
const originalFetch=globalThis.fetch;let networkAttempts=0;globalThis.fetch=async()=>{networkAttempts++;throw new Error("OFFLINE_EVAL_NETWORK_DENIED");};
const rank=(ids,relevant)=>{const position=ids.findIndex(id=>relevant.includes(id));return {recall_at_3:ids.filter(id=>relevant.includes(id)).length/relevant.length,mrr_at_3:position<0?0:1/(position+1)};};
try{
 evidence.index();const started=performance.now(),build=await semantic.build(evidence,runtime),buildMs=performance.now()-started;
 assert.equal(build.status,"READY");assert.ok(semantic.integrity(evidence).passed);
 const rows=[];let citations=0;
 for(const [i,q] of cases.queries.entries()){
  const row={id:q.id,language:q.lang,kind:q.kind,split:q.split,query:q.query,relevant:q.relevant};
  for(const arm of i%2?["hybrid","bm25"]:["bm25","hybrid"]){
   const start=performance.now(),request={query:q.query,context_id:"eval-"+q.id,limit:cases.top_k,preview_chars:100};
   const results=arm==="bm25"?evidence.search({...request,bypass_cache:true}).packet.results:hybridResult.parse(await semantic.search(evidence,request,runtime)).results;
   const elapsed=performance.now()-start,ids=[...new Set(results.map(r=>r.locator.split("/").at(-1).replace(/\.txt$/,"")))];
   for(const result of results){const reopened=evidence.reopen(result.id);assert.equal(reopened.status,"LIVE_VERIFIED");assert.equal(reopened.chunk.source_hash,result.source_hash);assert.equal(reopened.chunk.byte_start,result.byte_start);citations++;}
   row[arm]={...rank(ids,q.relevant),ids,latency_ms:elapsed};
  }
  // Post-hoc component diagnostic only; never changes frozen hybrid ranking or its gate.
  const cached=semantic.cached(q.query,"query");
  const dense=semantic.db.prepare("select rowid,distance from vec_chunks where embedding match ? and k=? order by distance").all(vectorBytes(cached.vector),BigInt(cases.top_k));
  const denseIds=dense.map(r=>{const m=semantic.db.prepare("select chunk_id from chunk_vectors where id=?").get(r.rowid);return evidence.reopen(m.chunk_id,{verify_live:false}).chunk.locator.split("/").at(-1).replace(/\.txt$/,"");});
  row.dense_diagnostic={...rank(denseIds,q.relevant),ids:denseIds};rows.push(row);
 }
 const aggregate=items=>Object.fromEntries(["bm25","hybrid"].map(arm=>[arm,{n:items.length,recall_at_3:items.reduce((s,r)=>s+r[arm].recall_at_3,0)/items.length,mrr_at_3:items.reduce((s,r)=>s+r[arm].mrr_at_3,0)/items.length,mean_latency_ms:items.reduce((s,r)=>s+r[arm].latency_ms,0)/items.length}]));
 const all=aggregate(rows),exact=aggregate(rows.filter(r=>r.kind==="exact")),holdout=aggregate(rows.filter(r=>r.split==="holdout"));
 const checks={citation_integrity:true,offline_fetch:networkAttempts===0,recall_gain:all.hybrid.recall_at_3-all.bm25.recall_at_3>=cases.gate.minimum_recall_at_3_gain,exact_mrr_non_regression:exact.hybrid.mrr_at_3>=exact.bm25.mrr_at_3-cases.gate.maximum_exact_mrr_regression,holdout_recall:holdout.hybrid.recall_at_3>=cases.gate.minimum_holdout_recall_at_3};
 const before=runtime.modelCalls,repeat=await semantic.build(evidence,runtime);assert.equal(repeat.computed,0);assert.equal(runtime.modelCalls,before);
 const repeatQuery=await semantic.search(evidence,{query:cases.queries[0].query,context_id:"eval-repeat",limit:3},runtime);assert.equal(repeatQuery.query_embedding_cache,"hit");assert.equal(runtime.modelCalls,before);
 const diagnostic=items=>({n:items.length,recall_at_3:items.reduce((s,r)=>s+r.dense_diagnostic.recall_at_3,0)/items.length,mrr_at_3:items.reduce((s,r)=>s+r.dense_diagnostic.mrr_at_3,0)/items.length});
 const report={schema_version:"dwin.hybrid-evaluation/v1",created_at:new Date().toISOString(),cases_hash:digest(casesBytes),model:EP.model,revision:EP.revision,embedding_fingerprint:EMBEDDING_FINGERPRINT,retrieval_fingerprint:RETRIEVAL_FINGERPRINT,runtime:process.version,sqlite_vec:EP.sqlite_vec,build_ms:buildMs,build,repeat_build:repeat,local_embedding_calls:runtime.modelCalls,model_window_calls:runtime.windowCalls,network_fetch_attempts:networkAttempts,citations_verified:citations,rss_bytes:process.memoryUsage().rss,aggregate:all,exact,holdout,dense_diagnostic:{purpose:"post-hoc component isolation, not a default-promotion arm",all:diagnostic(rows),holdout:diagnostic(rows.filter(r=>r.split==="holdout"))},by_language:{en:aggregate(rows.filter(r=>r.language==="en")),ru:aggregate(rows.filter(r=>r.language==="ru"))},checks,experimental_gate_passed:Object.values(checks).every(Boolean),default_search:"bm25",promoted:false,rows,limitations:["Author-labeled synthetic corpus, not independent or human-reviewed production ground truth","24 queries and 16 documents; no statistical significance claim","Holdout labels frozen before inference; not used to tune fusion/model","Timings single-run with model warm after document embedding; not a latency service guarantee","Local embedding calls are not hosted LLM token/billing measurements","No claim of semantic equivalence or answer-cache safety"]};
 if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(report,null,2)+"\n",{mode:0o600});
 process.stdout.write(JSON.stringify({cases_hash:report.cases_hash,aggregate:all,exact,holdout,dense_diagnostic:report.dense_diagnostic,checks,experimental_gate_passed:report.experimental_gate_passed,default_search:report.default_search,build_ms:buildMs,local_embedding_calls:runtime.modelCalls,networkAttempts,citations})+"\n");
 if(!report.experimental_gate_passed)process.exitCode=2;
 if(networkAttempts)process.exitCode=1;
}finally{await runtime.close();semantic.close();evidence.close();globalThis.fetch=originalFetch;}
