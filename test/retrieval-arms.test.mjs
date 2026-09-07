import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {denseOrder,unionDenseRescore,rankMetrics,EXPERIMENT_INPUT,EXPERIMENT_RESULT,EXPERIMENT_DEPENDENCIES,experimentFingerprint,searchRetrievalExperiment} from "../capsules/evidence-graph/lib/retrieval-experiment.mjs";
import {EvidenceStore,registerSource,POLICY_HASH} from "../capsules/evidence-graph/lib/store.mjs";
import {SemanticStore,RETRIEVAL_FINGERPRINT} from "../capsules/evidence-graph/lib/semantic-store.mjs";
import {normalized} from "../capsules/evidence-graph/lib/embedding-runtime.mjs";
function fixture(){
 const root=mkdtempSync(join(tmpdir(),"dwin-retrieval-arms-unit-")),data=join(root,"data"),a=join(root,"alpha"),b=join(root,"beta");mkdirSync(a);mkdirSync(b);
 writeFileSync(join(a,"cache.txt"),"Cache evidence with exact hashes and source generations.");writeFileSync(join(b,"approval.txt"),"Human approval cannot follow from a semantic match.");registerSource("alpha",a,data);registerSource("beta",b,data);
 const evidence=new EvidenceStore(data);evidence.index();
 const runtime={calls:0,async embed(){this.calls++;return {vector:normalized(Float32Array.from({length:384},(_,i)=>i+1)),windows:1};}};
 return {evidence,semantic:new SemanticStore(data),runtime,a};
}
test("exact dense cutoff uses immutable ID tie order",()=>{
 const rows=[{id:"z",cosine_distance:0.2},{id:"a",cosine_distance:0.2},{id:"b",cosine_distance:0.1}];
 assert.deepEqual(denseOrder(rows).slice(0,2).map(r=>r.id),["b","a"]);
 assert.deepEqual(denseOrder(rows.reverse()).slice(0,2).map(r=>r.id),["b","a"]);
 assert.throws(()=>denseOrder([{id:"a",cosine_distance:NaN}]));
 assert.throws(()=>denseOrder([{id:"a",cosine_distance:0},{id:"a",cosine_distance:1}]));
});
test("union same-dense rescore is a control, deduplicates without invented scores",()=>{
 const all=new Map([["a",0.1],["b",0.2],["c",0.3]]),dense=[{id:"a"},{id:"b"}],lexical=[{id:"c"},{id:"a"}];
 assert.deepEqual(unionDenseRescore(lexical,dense,all).map(r=>r.id),["a","b","c"]);
 assert.throws(()=>unionDenseRescore([{id:"missing"}],dense,all),/MISSING_CANDIDATE_DISTANCE/);
});
test("metrics deduplicate retrieved IDs and preserve absent gold",()=>{
 assert.deepEqual(rankMetrics(["x","a","a"],["a","b"]),{recall:0.5,mrr:0.5});
 assert.deepEqual(rankMetrics([],["a"]),{recall:0,mrr:0});
 assert.throws(()=>rankMetrics(["a"],[]));assert.throws(()=>rankMetrics(["a"],["a","a"]));
});
test("bounded experiment input rejects unknown fields, arms and oversized requests",()=>{
 const base={query:"research memory",context_id:"test"};
 assert.equal(EXPERIMENT_INPUT.parse(base).arm,"existing_rrf");
 for(const extra of [{arm:"llm_rerank"},{limit:21},{candidate_depth:100},{source_id:"../private"},{preview_chars:1201}])assert.throws(()=>EXPERIMENT_INPUT.parse({...base,...extra}));
});
test("experiment identity binds source generation, protocol, evaluator and actual retrieval dependencies",()=>{
 const generation="a".repeat(64),first=experimentFingerprint(generation,"protocol","evaluator");
 assert.equal(first,experimentFingerprint(generation,"protocol","evaluator"));
 assert.notEqual(first,experimentFingerprint("b".repeat(64),"protocol","evaluator"));
 assert.notEqual(first,experimentFingerprint(generation,"changed","evaluator"));
 assert.notEqual(first,experimentFingerprint(generation,"protocol","changed"));
 assert.equal(EXPERIMENT_DEPENDENCIES.policy_hash,POLICY_HASH);assert.equal(EXPERIMENT_DEPENDENCIES.retrieval_fingerprint,RETRIEVAL_FINGERPRINT);
 for(const value of Object.values(EXPERIMENT_DEPENDENCIES))assert.match(value,/^[a-f0-9]{64}$/);
 assert.throws(()=>experimentFingerprint("invalid"));
});
test("experiment preserves scope, citations, empty-filter work avoidance and cache reuse",async()=>{
 const x=fixture();try{
  await x.semantic.build(x.evidence,x.runtime);
  const request={query:"cache evidence",context_id:"unit",source_id:"alpha",arm:"exact_dense"};
  const first=await searchRetrievalExperiment(x.evidence,x.semantic,x.runtime,request),calls=x.runtime.calls;
  const repeat=await searchRetrievalExperiment(x.evidence,x.semantic,x.runtime,request);
  assert.equal(first.query_embedding_cache,"miss");assert.equal(repeat.query_embedding_cache,"hit");assert.equal(x.runtime.calls,calls);
  assert.equal(first.promoted,false);assert.equal(first.human_reviewed,false);assert.equal(first.authority,"candidate-only");assert.equal(first.default_search,"bm25");
  assert.equal(first.freshness,"indexed-snapshot-not-live");assert.deepEqual(EXPERIMENT_RESULT.parse(first),first);
  for(const invalid of [{...first,freshness:"live"},{...first,promoted:true},{...first,unexpected:true},{...first,results:[{...first.results[0],byte_start:-1}]},{...first,results:[{...first.results[0],source_hash:"bad"}]},{...first,results:[{...first.results[0],untrusted_extra:true}]}])assert.throws(()=>EXPERIMENT_RESULT.parse(invalid));
  assert.deepEqual(first.results,repeat.results);assert.equal(first.results.length,1);
  for(const r of first.results){assert.equal(r.source_id,"alpha");const original=x.evidence.reopen(r.id);assert.equal(original.status,"LIVE_VERIFIED");assert.equal(r.source_hash,original.chunk.source_hash);assert.equal(r.byte_start,original.chunk.byte_start);}
  const empty=await searchRetrievalExperiment(x.evidence,x.semantic,x.runtime,{...request,source_id:"unknown"});
  assert.equal(empty.status,"NO_HITS");assert.equal(empty.query_embedding_cache,"not-needed");assert.equal(x.runtime.calls,calls);
 }finally{x.semantic.close();x.evidence.close();}
});
test("experiment fails closed on stale generation and corrupt vector mapping",async()=>{
 const x=fixture();try{
  await x.semantic.build(x.evidence,x.runtime);const request={query:"cache evidence",context_id:"unit"};
  x.semantic.db.prepare("update chunk_vectors set source_id='wrong' where id=1").run();
  await assert.rejects(()=>searchRetrievalExperiment(x.evidence,x.semantic,x.runtime,request),/VECTOR_INTEGRITY_FAILED/);
  await x.semantic.build(x.evidence,x.runtime);
  writeFileSync(join(x.a,"cache.txt"),"New changed cache evidence.");x.evidence.index();
  await assert.rejects(()=>searchRetrievalExperiment(x.evidence,x.semantic,x.runtime,request),/VECTOR_INDEX_STALE/);
 }finally{x.semantic.close();x.evidence.close();}
});
