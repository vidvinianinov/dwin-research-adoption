import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,statSync,unlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {EvidenceStore,registerSource} from "../capsules/evidence-graph/lib/store.mjs";
import {SemanticStore} from "../capsules/evidence-graph/lib/semantic-store.mjs";
import {EP,digest,allowedModelURL,verifyModel} from "../capsules/evidence-graph/lib/model-artifacts.mjs";
import {embeddingKey,normalized,vectorBytes,textWindows,LocalEmbedder} from "../capsules/evidence-graph/lib/embedding-runtime.mjs";
import {hybridResult,embeddingStatus} from "../capsules/evidence-graph/lib/hybrid-contracts.mjs";
class FakeEmbedder{calls=0;async embed(text){this.calls++;const values=new Float32Array(384),hash=digest(text);for(let i=0;i<32;i++)values[i]=parseInt(hash.slice(i*2,i*2+2),16)+1;return {vector:normalized(values),windows:1};}}
function setup(){const root=mkdtempSync(join(tmpdir(),"dwin-hybrid-unit-")),data=join(root,"data"),a=join(root,"alpha"),b=join(root,"beta");mkdirSync(a);mkdirSync(b);writeFileSync(join(a,"cache.txt"),"Cache evidence with exact hashes and source generations. Память и доказательства.");writeFileSync(join(b,"approval.txt"),"Human approval cannot be inferred from a semantic match or passing tests.");registerSource("alpha",a,data);registerSource("beta",b,data);const e=new EvidenceStore(data);e.index();return {root,data,a,b,e,s:new SemanticStore(data),runtime:new FakeEmbedder()};}
function close(x){x.s.close();x.e.close();}
test("embedding identity binds exact text, role and full configuration; validates vectors",()=>{
 assert.notEqual(embeddingKey("cache","query"),embeddingKey("cache","passage"));
 assert.notEqual(embeddingKey("cache","query"),embeddingKey("not cache","query"));
 assert.notEqual(embeddingKey("cache","query","a"),embeddingKey("cache","query","b"));
 assert.throws(()=>vectorBytes([1]));assert.throws(()=>vectorBytes(new Float32Array(384)));
 assert.throws(()=>vectorBytes(Float32Array.from({length:384},()=>NaN)));
});
test("windowing covers long multilingual tails without silent truncation",()=>{
 const text=Array.from({length:130},(_,i)=>`item${String(i).padStart(3,"0")} память 東京 🔬 `).join("")+"TAIL_MARKER";
 const windows=textWindows(text,"passage",x=>Array.from(x).length*2);
 assert.ok(windows.length>1);assert.ok(windows.at(-1).endsWith("TAIL_MARKER"));
 assert.ok(windows.every(w=>Array.from(w).length*2<=512));
 let covered=0;for(const w of windows){const body=w.slice(9),start=text.indexOf(body,Math.max(0,covered-300));assert.ok(start>=0&&start<=covered);covered=start+body.length;}assert.equal(covered,text.length);
 assert.throws(()=>textWindows("a".repeat(300),"query",x=>x.length*2),/QUERY_TOKEN_LIMIT/);
});
test("fixed model provisioning rejects other hosts and offline inference never downloads missing weights",async()=>{
 assert.equal(allowedModelURL("https://huggingface.co/a"),true);
 for(const u of ["http://huggingface.co/a","https://huggingface.co.evil.test/a","https://user:pass@huggingface.co/a","https://localhost/a","https://huggingface.co:8000/a"])assert.equal(allowedModelURL(u),false);
 const missing=join(mkdtempSync(join(tmpdir(),"dwin-model-missing-")),"none");assert.equal(verifyModel(missing).status,"MODEL_MISSING");
 const runtime=new LocalEmbedder(missing);await assert.rejects(()=>runtime.embed("memory","query"),/MODEL_MISSING/);
});
test("builds sqlite-vec sidecar, preserves evidence citations and reuses embeddings",async()=>{
 const x=setup();try{
  assert.equal(x.s.status(x.e,{checkModel:false}).index_status,"EMPTY");const first=await x.s.build(x.e,x.runtime);
  assert.equal(first.computed,2);assert.equal(x.s.integrity(x.e).passed,true);assert.equal(statSync(join(x.data,"semantic.sqlite")).mode&0o777,0o600);
  const again=await x.s.build(x.e,x.runtime);assert.equal(again.computed,0);assert.equal(again.cache_hits,2);
  const q={query:"cache evidence",context_id:"hybrid",limit:2},a=hybridResult.parse(await x.s.search(x.e,q,x.runtime)),b=hybridResult.parse(await x.s.search(x.e,q,x.runtime));
  assert.equal(a.query_embedding_cache,"miss");assert.equal(b.query_embedding_cache,"hit");assert.deepEqual(a.results,b.results);assert.equal(x.runtime.calls,3);
  assert.equal(a.results[0].id,x.e.search({...q,preview_chars:0}).packet.results[0].id);
  for(const item of a.results){const reopened=x.e.reopen(item.id);assert.equal(reopened.status,"LIVE_VERIFIED");assert.equal(item.source_hash,reopened.chunk.source_hash);assert.equal(item.byte_start,reopened.chunk.byte_start);}
  assert.equal(embeddingStatus.parse(x.s.status(x.e,{checkModel:false})).default_search,"bm25");
 }finally{close(x);}
});
test("source filters apply before vector top-k and never use sibling-scope results",async()=>{
 const x=setup();try{await x.s.build(x.e,x.runtime);
  const r=await x.s.search(x.e,{query:"approval",context_id:"filter",source_id:"alpha"},x.runtime);assert.ok(r.results.length>0);assert.ok(r.results.every(c=>c.source_id==="alpha"));
  const calls=x.runtime.calls,empty=await x.s.search(x.e,{query:"approval",context_id:"none",source_id:"unregistered"},x.runtime);
  assert.equal(empty.status,"NO_HITS");assert.equal(empty.query_embedding_cache,"not-needed");assert.equal(x.runtime.calls,calls);
  await assert.rejects(()=>x.s.search(x.e,{query:"cache",context_id:"x",model:"remote"},x.runtime));
 }finally{close(x);}
});
test("changed generation and registry scope block stale vectors; only changed chunks re-embed",async()=>{
 const x=setup();try{await x.s.build(x.e,x.runtime);writeFileSync(join(x.a,"cache.txt"),"Changed cache policy and exact identities.");x.e.index();
  assert.equal(x.s.status(x.e,{checkModel:false}).index_status,"STALE");await assert.rejects(()=>x.s.search(x.e,{query:"cache",context_id:"x"},x.runtime),/VECTOR_INDEX_STALE/);
  const report=await x.s.build(x.e,x.runtime);assert.equal(report.computed,1);assert.equal(report.cache_hits,1);assert.ok(x.s.integrity(x.e).passed);
  unlinkSync(join(x.b,"approval.txt"));x.e.index();await x.s.build(x.e,x.runtime);assert.equal(x.s.integrity(x.e).checked,1);
  const registry=JSON.parse(readFileSync(join(x.data,"sources.json")));registry.roots=[];writeFileSync(join(x.data,"sources.json"),JSON.stringify(registry));
  await assert.rejects(()=>x.s.search(x.e,{query:"cache",context_id:"x"},x.runtime),/SOURCE_SCOPE_CHANGED/);
 }finally{close(x);}
});
test("corrupt cache, vector table or future schema fails explicitly",async()=>{
 const x=setup();try{await x.s.build(x.e,x.runtime);await x.s.encode("cache","query",x.runtime);
  x.s.db.prepare("update embeddings set vector_hash=? where role='query'").run("0".repeat(64));assert.throws(()=>x.s.cached("cache","query"),/INTEGRITY/);
  x.s.db.prepare("delete from vec_chunks where rowid=1").run();assert.throws(()=>x.s.integrity(x.e),/VECTOR/);
  await assert.rejects(()=>x.s.search(x.e,{query:"evidence",context_id:"corrupt"},x.runtime),/VECTOR_COVERAGE/);
  x.s.db.pragma("user_version=999");assert.throws(()=>new SemanticStore(x.data),/UNSUPPORTED_SEMANTIC_SCHEMA/);
 }finally{close(x);}
});
test("failed embedding and concurrent evidence change cannot publish a partial vector generation",async()=>{
 const x=setup();try{
  await assert.rejects(()=>x.s.build(x.e,{embed:async()=>{throw new Error("synthetic inference failure");}}),/synthetic/);assert.equal(x.s.meta("generation"),null);
  let changed=false;const mutator={embed:async(text,role)=>{if(!changed){changed=true;writeFileSync(join(x.a,"cache.txt"),"Changed during embedding.");x.e.index();}return x.runtime.embed(text,role);}};
  await assert.rejects(()=>x.s.build(x.e,mutator),/GENERATION_CHANGED/);assert.equal(x.s.meta("generation"),null);
 }finally{close(x);}
});
test("query cache retention is bounded without deleting current passage vectors",async()=>{
 const x=setup();try{await x.s.build(x.e,x.runtime);for(let i=0;i<EP.query_cache_max_entries+2;i++)await x.s.encode("query "+i,"query",x.runtime);
  assert.equal(x.s.db.prepare("select count(*) n from embeddings where role='query'").get().n,EP.query_cache_max_entries);assert.equal(x.s.integrity(x.e).passed,true);
 }finally{close(x);}
});
