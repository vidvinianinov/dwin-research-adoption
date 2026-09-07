import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, symlinkSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { EvidenceStore, registerSource, chunksOf, sha, POLICY } from "../capsules/evidence-graph/lib/store.mjs";
import { searchResult,graphResult,reopenResult,statusResult } from "../capsules/evidence-graph/lib/contracts.mjs";

function setup(){
  const root=mkdtempSync(join(tmpdir(),"dwin-evidence-test-")), source=join(root,"source"),data=join(root,"data");
  cpSync(new URL("./fixtures/evidence-graph/",import.meta.url),source,{recursive:true});
  registerSource("fixture",source,data);
  const store=new EvidenceStore(data);store.index();return {root,source,data,store};
}
const q={query:"generation cache",context_id:"test"};

test("section chunking ignores fenced code comments and treats plain text as plain text",()=>{
 const text="# Title\n\nIntro\n\n## Cache\n\nKeep source identity.\n```python\n# not a heading\n```\n\n## Authority\n\nNo automatic approval.\n";
 const doc={id:"id",source_id:"fixture",locator:"fixture/doc.md",hash:sha(text),text};
 const chunks=chunksOf(doc);assert.deepEqual(chunks.map(c=>c.heading),["Title","Cache","Authority"]);
 assert.equal(chunks.map(c=>c.text).join(""),text);
 assert.ok(chunksOf({...doc,locator:"fixture/doc.txt"}).every(c=>c.heading==="# Title"));
});

test("indexes exact UTF-8 chunks with source-only graph edges and private database",()=>{
 const {store,data}=setup();try{
  const status=statusResult.parse(store.status());assert.equal(status.counts.documents,3);assert.ok(status.counts.edges>3);
  assert.equal(statSync(join(data,"evidence.sqlite")).mode&0o777,0o600);
  assert.equal(store.integrity().passed,true);
  const hit=searchResult.parse(store.search({query:"VECTOR_UNAVAILABLE",context_id:"unicode"}));
  const evidence=reopenResult.parse(store.reopen(hit.packet.results[0].id));assert.equal(evidence.status,"LIVE_VERIFIED");
  assert.ok(evidence.chunk.text.includes("東京"));assert.equal(sha(evidence.chunk.text),evidence.chunk.content_hash);
  const graph=graphResult.parse(store.neighbors(evidence.chunk.id,{depth:2,max_nodes:5}));assert.equal(graph.truncated,true);assert.ok(graph.nodes.length<=5);
  assert.ok(graph.edges.every(e=>["DERIVED_FROM","MENTIONS","REFERENCES"].includes(e.type)));
 }finally{store.close();}
});
test("CLI fallback enforces the same strict graph and reopen inputs as MCP",()=>{
 const root=mkdtempSync(join(tmpdir(),"dwin-evidence-cli-")),data=join(root,"capsules/evidence-graph");
 registerSource("fixture",new URL("./fixtures/evidence-graph/",import.meta.url).pathname,data);
 const store=new EvidenceStore(data);let id;
 try{store.index();id=store.search(q).packet.results[0].id;
  assert.throws(()=>store.neighbors(id,{max_edges:1}),/Unrecognized/);
  assert.throws(()=>store.reopen(id,{verify_live:"false"}));
 }finally{store.close();}
 const call=(op,input)=>spawnSync(process.execPath,[new URL("../capsules/evidence-graph/scripts/query.mjs",import.meta.url).pathname,op,JSON.stringify(input)],{env:{...process.env,DWIN_FACTORY_DATA:root},encoding:"utf8"});
 for(const input of [{node_id:id,limit:1},{node_id:id,max_edges:1},{node_id:id,max_nodes:101}]){
  const result=call("neighbors",input);assert.notEqual(result.status,0);assert.equal(result.stdout,"");
 }
 const result=call("neighbors",{node_id:id,depth:1,max_nodes:1});assert.equal(result.status,0,result.stderr);
 const graph=JSON.parse(result.stdout);assert.equal(graph.nodes.length,1);assert.equal(graph.edges.length,0);assert.equal(graph.truncated,true);
 assert.equal(JSON.parse(call("reopen",{chunk_id:id,verify_live:true}).stdout).status,"LIVE_VERIFIED");
});
test("warm and bypass results are equal; only an exact known packet suppresses repeated content",()=>{
 const {store}=setup();try{
  const cold=store.search(q), warm=store.search(q), bypass=store.search({...q,bypass_cache:true});
  assert.equal(cold.cache_status,"miss");assert.equal(warm.cache_status,"hit");assert.equal(warm.retrieval_executed,false);
  assert.equal(cold.packet_hash,warm.packet_hash);assert.equal(cold.packet_hash,bypass.packet_hash);
  assert.deepEqual(cold.packet,bypass.packet);
  const ack=searchResult.parse(store.search({...q,known_packet_hash:cold.packet_hash}));assert.equal(ack.status,"NOT_MODIFIED");assert.equal(ack.packet,null);
  assert.notEqual(store.search({...q,known_packet_hash:"0".repeat(64)}).packet,null);
  assert.notEqual(store.search({...q,context_id:"fresh-task",known_packet_hash:cold.packet_hash}).status,"NOT_MODIFIED");
 }finally{store.close();}
});
test("cache identity binds query, negation, filters, limits, preview and context; TTL expires",()=>{
 const {store}=setup();try{
  const cold=store.search(q,{now:1000});
  for(const change of [{query:"generation not cache"},{source_id:"missing"},{limit:1},{preview_chars:0},{context_id:"other"}])
    assert.equal(store.search({...q,...change},{now:1001}).cache_status,"miss");
  assert.equal(store.search({...q,known_packet_hash:cold.packet_hash},{now:1000+POLICY.cache_ttl_seconds*1000}).cache_status,"miss");
  assert.equal(store.search({query:"xyzzyunlikelyword",context_id:"test"}).status,"NO_HITS");
  assert.throws(()=>store.search({...q,command:"rm"}));
 }finally{store.close();}
});
test("source edit including same-size changes invalidates generation; unchanged indexing is idempotent",()=>{
 const {store,source}=setup();try{
  const cold=store.search(q);const counts=store.status().counts;
  assert.equal(store.index().changed,false);assert.equal(store.status().counts.chunks,counts.chunks);
  const file=join(source,"cache.md"), original=readFileSync(file,"utf8");writeFileSync(file,original.replace("immutable","MUTABLE!!"));
  assert.equal(Buffer.byteLength(readFileSync(file)),Buffer.byteLength(original));
  assert.equal(store.reopen(cold.packet.results[0].id).status,"SOURCE_CHANGED");
  assert.equal(store.search(q).packet.freshness,"indexed-snapshot-not-live");
  assert.equal(store.index().changed,true);const next=store.search({...q,known_packet_hash:cold.packet_hash});
  assert.equal(next.cache_status,"miss");assert.notEqual(next.generation,cold.generation);assert.notEqual(next.status,"NOT_MODIFIED");
  assert.equal(store.reopen(cold.packet.results[0].id).status,"NOT_FOUND");
  unlinkSync(file);store.index();assert.equal(store.status().counts.documents,2);
 }finally{store.close();}
});
test("rejects symlinks, secrets, changed scope and unsupported schema without replacing accepted snapshot",()=>{
 const {store,source,data}=setup();try{
  const generation=store.status().generation;
  symlinkSync(join(source,"cache.md"),join(source,"escape.md"));assert.throws(()=>store.index(),/Symlink/);unlinkSync(join(source,"escape.md"));
  writeFileSync(join(source,"secret.md"),"sk-"+"A".repeat(40));assert.throws(()=>store.index(),/SECRET_PATTERN/);unlinkSync(join(source,"secret.md"));
  assert.equal(store.status().generation,generation);
  const registry=JSON.parse(readFileSync(join(data,"sources.json"),"utf8"));registry.roots=[];writeFileSync(join(data,"sources.json"),JSON.stringify(registry));
  assert.throws(()=>store.search(q),/SOURCE_SCOPE_CHANGED/);
  store.db.pragma("user_version = 999");assert.throws(()=>new EvidenceStore(data),/Unsupported evidence schema/);
 }finally{store.close();}
});
test("single-file registration never ingests sibling files and source deletion is explicit",()=>{
 const root=mkdtempSync(join(tmpdir(),"dwin-file-test-")),data=join(root,"data"),file=join(root,"paper.txt");
 writeFileSync(file,"Cache evidence is bounded.");writeFileSync(join(root,"private.txt"),"Unselected sibling.");
 registerSource("paper",file,data);const store=new EvidenceStore(data);
 try{store.index();assert.equal(store.status().counts.documents,1);const hit=store.search({query:"cache",context_id:"single"});
  unlinkSync(file);assert.equal(store.reopen(hit.packet.results[0].id).status,"SOURCE_MISSING");assert.throws(()=>store.index());
 }finally{store.close();}
});
test("caps cache retention and rejects a corrupted packet or changed index policy",()=>{
 const {store}=setup();try{
  for(let i=0;i<POLICY.cache_max_entries+2;i++)store.search({...q,context_id:String(i)});
  assert.equal(store.status().counts.packets,POLICY.cache_max_entries);
  store.search(q);store.db.prepare("UPDATE packets SET hash=?").run("0".repeat(64));assert.throws(()=>store.search(q),/CACHE_INTEGRITY_FAILED/);
  store.setMeta("policy_hash","outdated");assert.throws(()=>store.search(q),/INDEX_POLICY_CHANGED/);
 }finally{store.close();}
});
