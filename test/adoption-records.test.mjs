import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import Database from "better-sqlite3";
import {EvidenceStore,registerSource,sha} from "../capsules/evidence-graph/lib/store.mjs";
import {RadarStore} from "../capsules/research-radar/lib/db.mjs";
import {adoptionRecord,canonical,putAdoption,listAdoptions,validateAdoptionCollection,adoptionGraph} from "../capsules/evidence-graph/lib/adoption-records.mjs";

function span(text,chunk={}){const bytes=Buffer.from(text),length=Math.min(bytes.length,24);return {...chunk,span_start:0,span_length:length,span_hash:sha(bytes.subarray(0,length))};}
function setup(){
  const root=mkdtempSync(join(tmpdir(),"dwin-adoption-")),source=join(root,"source"),factoryData=join(root,"factory"),data=join(factoryData,"capsules/evidence-graph");
  mkdirSync(source,{recursive:true});mkdirSync(join(factoryData,"capsules/research-radar"),{recursive:true});
  writeFileSync(join(source,"one.md"),"# Retrieval\n\nHybrid retrieval needs a fresh human holdout.\n");
  writeFileSync(join(source,"two.md"),"# Provenance\n\nEvery proposal cites exact bytes.\n");
  registerSource("fixture",source,data);const evidence=new EvidenceStore(data);evidence.index();
  const radar=new RadarStore(join(factoryData,"capsules/research-radar/research.sqlite"));
  const paper={id:"2608.24060",version_id:"2608.24060v2",title:"A bounded paper",summary:"A paper proposes retrieval controls with explicit provenance.",authors:["Researcher"],categories:["cs.AI"],primary_category:"cs.AI",published_at:"2026-08-01T00:00:00Z",updated_at:"2026-08-30T00:00:00Z",abs_url:"https://arxiv.org/abs/2608.24060",pdf_url:"https://arxiv.org/pdf/2608.24060"};
  const up=radar.upsertPaper(paper,new Date().toISOString());radar.close();
  const make=(issue="Test retrieval",locator="fixture/one.md")=>{const parsed=evidence.db.prepare("SELECT data FROM chunks ORDER BY id").all().map(row=>JSON.parse(row.data)).find(chunk=>chunk.locator===locator);assert.ok(parsed);
    return adoptionRecord.parse({schema_version:"dwin.adoption-record/v1",paper:{id:paper.id,version:2,version_key:up.version_key,content_hash:up.content_hash,...span(paper.summary)},issue,hypothesis:"The bounded change may improve retrieval.",proposed_change:"Evaluate it without changing the default.",source_references:[span(parsed.text,{chunk_id:parsed.id,content_hash:parsed.content_hash})],protocol:{baseline:"BM25",intervention:"Candidate retrieval arm",metrics:["Recall@3"],acceptance_gate:"Fresh human-reviewed holdout must pass."},result:null,decision:"proposed",rationale:"Candidate only; no scientific verification."});};
  return {root,source,factoryData,data,evidence,make};
}

test("stores immutable records idempotently and excludes stale history without poisoning new work",()=>{
 const x=setup();try{
  const first=putAdoption(x.make(),x.evidence,{data:x.data,factoryData:x.factoryData});assert.equal(first.created,true);
  assert.equal(putAdoption(x.make(),x.evidence,{data:x.data,factoryData:x.factoryData}).created,false);
  assert.equal(listAdoptions({},x.data).total,1);assert.equal(validateAdoptionCollection(x.evidence,{data:x.data,factoryData:x.factoryData}).records_current,1);
  writeFileSync(join(x.source,"one.md"),"# Retrieval\n\nThe cited bytes changed and are historical now.\n");x.evidence.index();
  let report=validateAdoptionCollection(x.evidence,{data:x.data,factoryData:x.factoryData});assert.equal(report.records_excluded,1);assert.equal(report.edges.length,0);
  assert.equal(putAdoption(x.make("A second independent proposal","fixture/two.md"),x.evidence,{data:x.data,factoryData:x.factoryData}).created,true);
  report=validateAdoptionCollection(x.evidence,{data:x.data,factoryData:x.factoryData});assert.equal(report.records_checked,2);assert.equal(report.records_current,1);assert.equal(report.records_excluded,1);assert.ok(report.edges.length>0);
 }finally{x.evidence.close();}
});

test("fails closed on changed spans, invalid decisions and invented execution artifacts",()=>{
 const x=setup();try{
  const bad=x.make();bad.source_references[0].span_hash="0".repeat(64);assert.throws(()=>putAdoption(bad,x.evidence,{data:x.data,factoryData:x.factoryData}),/SPAN_MISMATCH/);
  assert.equal(adoptionRecord.safeParse({...x.make(),decision:"applied"}).success,false);
  const fake=x.make();fake.result={run_id:"run_missing",receipt_hash:"0".repeat(64),artifact_path:"report.json",artifact_hash:"0".repeat(64)};
  assert.throws(()=>putAdoption(fake,x.evidence,{data:x.data,factoryData:x.factoryData}));
 }finally{x.evidence.close();}
});

test("builds typed human-unverified extraction nodes from declared exact review-note spans",()=>{
 const x=setup();try{
  const record=x.make(),ref=record.source_references[0];record.research_extractions=[
    {kind:"method",statement:"The reviewed method compares bounded retrieval arms.",paper_location:"p. 4, Section 3",evidence_basis:"review-note-paraphrase",extraction_status:"human-unverified-agent-extraction",source_reference:ref},
    {kind:"limitation",statement:"The reviewed labels are not a fresh holdout.",paper_location:"p. 8, Limitations",evidence_basis:"review-note-paraphrase",extraction_status:"human-unverified-agent-extraction",source_reference:ref}
  ];
  const stored=putAdoption(record,x.evidence,{data:x.data,factoryData:x.factoryData}),graph=adoptionGraph({record_id:stored.record_id,max_nodes:50,max_edges:50},x.evidence,{data:x.data,factoryData:x.factoryData});
  assert.equal(graph.records_current,1);assert.equal(graph.scientific_verification,false);assert.equal(graph.truncated,false);
  assert.equal(graph.nodes.filter(node=>node.type==="CandidateResearchExtraction").length,2);
  assert.equal(graph.edges.filter(edge=>edge.type==="HAS_AGENT_EXTRACTED_CANDIDATE").length,2);
  assert.ok(graph.nodes.filter(node=>node.type==="CandidateResearchExtraction").every(node=>node.extraction_status==="human-unverified-agent-extraction"&&!Object.hasOwn(node,"statement")));
  const undeclared=structuredClone(record);undeclared.issue="Different issue";undeclared.research_extractions[0].source_reference={...ref,span_start:1};
  assert.throws(()=>putAdoption(undeclared,x.evidence,{data:x.data,factoryData:x.factoryData}),/EXTRACTION_SOURCE_NOT_DECLARED/);
 }finally{x.evidence.close();}
});

test("SQLite transaction enforces the immutable cross-process capacity",async()=>{
 const x=setup();try{
  const first=x.make("seed");putAdoption(first,x.evidence,{data:x.data,factoryData:x.factoryData});const db=new Database(join(x.data,"adoptions.sqlite"));
  const insert=db.prepare("INSERT INTO adoption_records(record_id,record_json) VALUES(?,?)");db.transaction(()=>{for(let i=0;i<98;i++){const record=x.make(`seed-${i}`),json=canonical(record);insert.run(sha(json),json);}})();db.close();
  const worker=join(x.root,"worker.mjs"),moduleUrl=new URL("../capsules/evidence-graph/lib/adoption-records.mjs",import.meta.url).href,storeUrl=new URL("../capsules/evidence-graph/lib/store.mjs",import.meta.url).href;
  writeFileSync(worker,`import {putAdoption} from ${JSON.stringify(moduleUrl)};import {EvidenceStore} from ${JSON.stringify(storeUrl)};const r=JSON.parse(Buffer.from(process.env.RECORD,'base64'));const s=new EvidenceStore(process.env.DATA);try{putAdoption(r,s,{data:process.env.DATA,factoryData:process.env.FACTORY});process.stdout.write('ok')}catch(e){process.stdout.write(e.message)}finally{s.close()}`);
  const {spawn}=await import("node:child_process"),run=record=>new Promise(resolve=>{const child=spawn(process.execPath,[worker],{env:{...process.env,DATA:x.data,FACTORY:x.factoryData,RECORD:Buffer.from(JSON.stringify(record)).toString("base64")}});let out="";child.stdout.on("data",b=>out+=b);child.on("close",()=>resolve(out));});
  const results=await Promise.all([run(x.make("racer-a","fixture/two.md")),run(x.make("racer-b","fixture/two.md"))]);assert.deepEqual(results.sort(),["ADOPTION_RECORD_LIMIT","ok"]);
  const check=new Database(join(x.data,"adoptions.sqlite"),{readonly:true});assert.equal(check.prepare("SELECT count(*) n FROM adoption_records").get().n,100);check.close();
 }finally{x.evidence.close();}
});
