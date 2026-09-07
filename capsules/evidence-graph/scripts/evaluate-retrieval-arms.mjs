import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,basename} from "node:path";
import {performance} from "node:perf_hooks";
import {EvidenceStore,registerSource} from "../lib/store.mjs";
import {SemanticStore} from "../lib/semantic-store.mjs";
import {LocalEmbedder,EMBEDDING_FINGERPRINT} from "../lib/embedding-runtime.mjs";
import {EP,digest,assertModel} from "../lib/model-artifacts.mjs";
import {ARMS,collectCandidates,rankMetrics,experimentFingerprint,EXPERIMENT_DEPENDENCIES} from "../lib/retrieval-experiment.mjs";

const protocol=JSON.parse(readFileSync(new URL("../evals/retrieval-arms-protocol.json",import.meta.url))),bytes=readFileSync(new URL("../evals/hybrid-cases.json",import.meta.url)),cases=JSON.parse(bytes);
assert.equal(digest(bytes),protocol.cases_sha256,"REGRESSION_CASES_CHANGED");
assert.equal(protocol.promotion_allowed,false);assert.equal(protocol.human_reviewed,false);
assert.equal(protocol.candidate_depth,EP.candidate_pool);assert.equal(cases.top_k,protocol.top_k);assert.deepEqual(protocol.arms,[...ARMS]);
assertModel();
const root=mkdtempSync(join(tmpdir(),"dwin-retrieval-arms-")),source=join(root,"source"),data=join(root,"data");mkdirSync(source);
for(const doc of cases.documents){assert.match(doc.id,/^[a-z0-9-]+$/);writeFileSync(join(source,doc.id+".txt"),doc.text,{mode:0o600});}
registerSource("fixture",source,data);
const evidence=new EvidenceStore(data),semantic=new SemanticStore(data),runtime=new LocalEmbedder();
const originalFetch=globalThis.fetch;let networkAttempts=0,citations=0;
globalThis.fetch=async()=>{networkAttempts++;throw new Error("OFFLINE_EVAL_NETWORK_DENIED");};
try{
 evidence.index();const buildStart=performance.now(),build=await semantic.build(evidence,runtime),buildMs=performance.now()-buildStart;
 assert.equal(build.status,"READY");assert.ok(semantic.integrity(evidence).passed);
 const map=new Map(evidence.db.prepare("select data from chunks order by id").all().map(r=>{const chunk=JSON.parse(r.data);return [chunk.id,basename(chunk.locator,".txt")];}));
 const documentIds=rows=>[...new Set(rows.map(r=>{assert.ok(map.has(r.id),"UNKNOWN_CANDIDATE");return map.get(r.id);}))];
 const rows=[];
 for(const query of cases.queries){
   const request={query:query.query,context_id:"regression-"+query.id,limit:protocol.top_k,preview_chars:0},before=runtime.modelCalls,windowsBefore=runtime.windowCalls,start=performance.now();
   const cold=await collectCandidates(evidence,semantic,runtime,request),coldMs=performance.now()-start,coldCalls=runtime.modelCalls-before,coldWindows=runtime.windowCalls-windowsBefore;
   const warmStart=performance.now(),warm=await collectCandidates(evidence,semantic,runtime,request),warmMs=performance.now()-warmStart;
   assert.equal(cold.query_embedding_cache,"miss");assert.equal(warm.query_embedding_cache,"hit");assert.equal(coldCalls,1);assert.equal(runtime.modelCalls-before-coldCalls,0);
   assert.deepEqual(cold.candidates,warm.candidates,"WARM_RANKING_CHANGED");
   assert.deepEqual(cold.candidates.exact_dense.slice(0,protocol.top_k),cold.candidates.union_dense_rescore.slice(0,protocol.top_k),"DENSE_CONTROL_DIVERGED");
   const armMetrics={};
   for(const arm of ARMS){
     const candidates=cold.candidates[arm],final=candidates.slice(0,protocol.top_k),candidateIds=documentIds(candidates),ids=documentIds(final);
     for(const candidate of final){const reopened=evidence.reopen(candidate.id);assert.equal(reopened.status,"LIVE_VERIFIED");assert.equal(reopened.chunk.id,candidate.id);citations++;}
     armMetrics[arm]={candidate_recall:rankMetrics(candidateIds,query.relevant).recall,...rankMetrics(ids,query.relevant),candidate_ids:candidateIds,ids};
   }
   rows.push({id:query.id,language:query.lang,kind:query.kind,prior_split:query.split,labels_status:"consumed-regression-only",query:query.query,relevant:query.relevant,
     latency_ms:{cold_query_warm_model:coldMs,warm_query_warm_model:warmMs},query_cache:{cold:cold.query_embedding_cache,warm:warm.query_embedding_cache,cold_model_calls:coldCalls,cold_window_calls:coldWindows,warm_model_calls:runtime.modelCalls-before-coldCalls},arms:armMetrics});
 }
 const aggregate=items=>Object.fromEntries(ARMS.map(arm=>[arm,{n:items.length,candidate_recall:items.reduce((s,r)=>s+r.arms[arm].candidate_recall,0)/items.length,recall_at_3:items.reduce((s,r)=>s+r.arms[arm].recall,0)/items.length,mrr_at_3:items.reduce((s,r)=>s+r.arms[arm].mrr,0)/items.length}]));
 const groups=field=>Object.fromEntries([...new Set(rows.map(r=>r[field]))].sort().map(value=>[value,aggregate(rows.filter(r=>r[field]===value))]));
 const repeatBefore=runtime.modelCalls,repeatBuild=await semantic.build(evidence,runtime);assert.equal(repeatBuild.computed,0);assert.equal(runtime.modelCalls,repeatBefore);
 const report={schema_version:"dwin.retrieval-arms-evaluation/v1",created_at:new Date().toISOString(),protocol,cases_hash:digest(bytes),
   experiment_fingerprint:experimentFingerprint(build.generation,JSON.stringify(protocol),readFileSync(new URL(import.meta.url))),
   experiment_dependencies:EXPERIMENT_DEPENDENCIES,generation:build.generation,freshness:"indexed-snapshot-not-live",
   model:EP.model,revision:EP.revision,embedding_fingerprint:EMBEDDING_FINGERPRINT,runtime:process.version,sqlite_vec:EP.sqlite_vec,
   human_reviewed:false,promoted:false,default_search:"bm25",promotion_status:"BLOCKED_FRESH_HUMAN_REVIEWED_HOLDOUT_REQUIRED",build_ms:buildMs,build,repeat_build:repeatBuild,
   aggregate:aggregate(rows),by_language:groups("language"),by_kind:groups("kind"),by_prior_split_regression_only:groups("prior_split"),
   latency_ms:{scope:protocol.latency_scope,mean_cold_query_warm_model:rows.reduce((s,r)=>s+r.latency_ms.cold_query_warm_model,0)/rows.length,mean_warm_query_warm_model:rows.reduce((s,r)=>s+r.latency_ms.warm_query_warm_model,0)/rows.length},
   integrity:{passed:true,offline_js_fetch_attempts:networkAttempts,citations_verified:citations,dense_control_equal:true,warm_ranking_stable:true,repeat_build_no_model_calls:true},
   local_embedding_calls:runtime.modelCalls,model_window_calls:runtime.windowCalls,rss_bytes:process.memoryUsage().rss,rows,
   limitations:["All 24 query labels were consumed previously; this is regression diagnosis only", "No real reranker, cross-encoder, instruction-tuned E5-large or SciClaimSeekers code integration", "The same-cosine union arm is mathematically a dense-only top-k control, not evidence of added quality", "Warm/cold-query latency covers shared four-arm collection, not independent per-arm or process startup latency", "JS fetch trap is not an OS network sandbox", "No financial savings, semantic-equivalence, truth or permission claim"]};
 assert.equal(networkAttempts,0);
 if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(report,null,2)+"\n",{mode:0o600});
 process.stdout.write(JSON.stringify(report,null,2)+"\n");
}finally{await runtime.close();semantic.close();evidence.close();globalThis.fetch=originalFetch;}
