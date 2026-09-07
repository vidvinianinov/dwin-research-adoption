import {z} from "zod";
import Database from "better-sqlite3";
import {mkdirSync,readFileSync,existsSync,lstatSync,realpathSync,chmodSync} from "node:fs";
import {join,relative,resolve} from "node:path";
import {FACTORY_DATA} from "../../../src/paths.mjs";
import {assertReceipt} from "../../../src/manifests.mjs";
import {DATA,sha} from "./store.mjs";

const hash=z.string().regex(/^[a-f0-9]{64}$/);
const text=max=>z.string().trim().min(1).max(max);
const artifactPath=z.string().min(1).max(180).refine(p=>!p.startsWith("/")&&!p.includes("\\")&&p.split("/").every(s=>s&&s!=="."&&s!==".."),"Relative artifact path required");
export const sourceReference=z.object({chunk_id:hash,content_hash:hash,span_start:z.number().int().min(0),span_length:z.number().int().min(1).max(2400),span_hash:hash}).strict();
export const resultReference=z.object({run_id:z.string().regex(/^run_[A-Za-z0-9_]{1,100}$/),receipt_hash:hash,artifact_path:artifactPath,artifact_hash:hash}).strict();
export const researchExtraction=z.object({
  kind:z.enum(["research-question","method","result","limitation","applicability-hypothesis"]),
  statement:text(1000),paper_location:text(160),
  evidence_basis:z.literal("review-note-paraphrase"),
  extraction_status:z.literal("human-unverified-agent-extraction"),
  source_reference:sourceReference
}).strict();
export const adoptionRecord=z.object({
  schema_version:z.literal("dwin.adoption-record/v1"),
  paper:z.object({id:z.string().regex(/^\d{4}\.\d{4,5}$/),version:z.number().int().min(1).max(100),version_key:hash,content_hash:hash,span_start:z.number().int().min(0),span_length:z.number().int().min(1).max(2400),span_hash:hash}).strict(),
  issue:text(500),hypothesis:text(1000),proposed_change:text(1000),
  source_references:z.array(sourceReference).min(1).max(6),
  research_extractions:z.array(researchExtraction).min(1).max(12).optional(),
  protocol:z.object({baseline:text(800),intervention:text(800),metrics:z.array(text(100)).min(1).max(10),acceptance_gate:text(1000)}).strict(),
  result:resultReference.nullable().default(null),
  decision:z.enum(["proposed","deferred","rejected"]),rationale:text(1000)
}).strict();
const trust={authority:z.literal("candidate-only"),instruction_authority:z.literal("none"),privacy:z.literal("local-private-no-export")};
export const adoptionValidation=z.object({record_id:hash,protocol_hash:hash,source_spans_checked:z.number().int(),result_status:z.enum(["not-run","ACCEPTED","REJECTED","ERROR"]),paper_verification:z.literal("cached-abstract-span-not-full-text"),scientific_verification:z.literal(false),...trust}).strict();
export const adoptionListInput=z.object({record_id:hash.optional(),limit:z.number().int().min(1).max(20).default(10)}).strict();
export const adoptionListOutput=z.object({records:z.array(z.object({record_id:hash,record:adoptionRecord}).strict()),total:z.number().int(),truncated:z.boolean(),validation:z.literal("stored-records-revalidate-before-use"),...trust}).strict();
const graphNode=z.object({id:z.string().min(1).max(200),type:z.enum(["PaperCitation","ProposedIssue","ExperimentProtocol","ProposedDecision","SourceChunk","ExecutionReceipt","CandidateResearchExtraction"]),kind:z.enum(["research-question","method","result","limitation","applicability-hypothesis"]).optional(),statement_hash:hash.optional(),paper_location:z.string().max(160).optional(),extraction_status:z.literal("human-unverified-agent-extraction").optional()}).strict();
const graphEdge=z.object({id:hash,src:z.string().min(1).max(200),dst:z.string().min(1).max(200),type:z.enum(["CANDIDATE_FOR","PROPOSES_TEST","HAS_PROPOSED_DECISION","CITES_SOURCE_BYTES","CITES_EXECUTION","HAS_AGENT_EXTRACTED_CANDIDATE","PARAPHRASED_IN_REVIEW_NOTE","MOTIVATES_ISSUE"]),record_id:hash,authority:z.literal("candidate-only")}).strict();
const currentGraphValidation=z.object({record_id:hash,state:z.literal("current"),validation:adoptionValidation}).strict();
const historicalGraphValidation=z.object({record_id:hash,state:z.literal("historical-unavailable"),reason_code:z.string().regex(/^[A-Z][A-Z0-9_]{1,100}$/)}).strict();
export const adoptionGraphInput=z.object({record_id:hash.optional(),max_nodes:z.number().int().min(1).max(500).default(200),max_edges:z.number().int().min(1).max(1000).default(500)}).strict();
export const adoptionGraphOutput=z.object({schema_version:z.literal("dwin.adoption-graph/v1"),records_checked:z.number().int().min(0).max(100),records_current:z.number().int().min(0).max(100),records_excluded:z.number().int().min(0).max(100),validations:z.array(z.union([currentGraphValidation,historicalGraphValidation])).max(100),nodes:z.array(graphNode).max(500),edges:z.array(graphEdge).max(1000),truncated:z.boolean(),network_requests:z.literal(0),scientific_verification:z.literal(false),...trust}).strict();
const MAX_RECORDS=100,MAX_RECORD_BYTES=20000,MAX_ARTIFACT_BYTES=1048576;
export const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==="object"&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b,"en"))):v);
const privateTrust={authority:"candidate-only",instruction_authority:"none",privacy:"local-private-no-export"};

function checkedFile(root,path,maxBytes){
  const base=realpathSync(root),target=resolve(path),rel=relative(resolve(root),target);
  if(!rel||rel.startsWith("../")||rel==="..")throw new Error("REFERENCE_PATH_ESCAPE");
  let current=resolve(root);
  for(const part of rel.split("/")){current=join(current,part);if(lstatSync(current).isSymbolicLink())throw new Error("REFERENCE_SYMLINK_FORBIDDEN");}
  if(!realpathSync(target).startsWith(base+"/"))throw new Error("REFERENCE_PATH_ESCAPE");
  const stat=lstatSync(target);if(!stat.isFile()||stat.size>maxBytes)throw new Error("REFERENCE_FILE_BOUND");
  return target;
}
const regularFile=(root,path,maxBytes)=>readFileSync(checkedFile(root,path,maxBytes));
function verifySpan(text,ref){
  const bytes=Buffer.from(text),end=ref.span_start+ref.span_length;
  if(end>bytes.length||sha(bytes.subarray(ref.span_start,end))!==ref.span_hash)throw new Error("ADOPTION_SPAN_MISMATCH");
  new TextDecoder("utf-8",{fatal:true}).decode(bytes.subarray(ref.span_start,end));
}
export function validateAdoption(raw,evidence,{factoryData=FACTORY_DATA}={}){
  const record=adoptionRecord.parse(raw),serialized=canonical(record);
  if(Buffer.byteLength(serialized)>MAX_RECORD_BYTES)throw new Error("ADOPTION_RECORD_TOO_LARGE");
  if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|ghp_[A-Za-z0-9]{30,})\b/.test(serialized))throw new Error("SECRET_PATTERN_DETECTED");
  const radarPath=checkedFile(factoryData,join(factoryData,"capsules","research-radar","research.sqlite"),512*1024*1024),radar=new Database(radarPath,{readonly:true,fileMustExist:true});
  try{
    const row=radar.prepare("SELECT paper_id,version_id,content_hash,paper_json FROM paper_versions WHERE version_key=?").get(record.paper.version_key),ref=record.paper;
    if(!row||row.paper_id!==ref.id||row.version_id!==`${ref.id}v${ref.version}`||row.content_hash!==ref.content_hash)throw new Error("ADOPTION_PAPER_VERSION_MISMATCH");
    if(Buffer.byteLength(row.paper_json)>100000)throw new Error("ADOPTION_PAPER_SIZE_BOUND");
    const paper=JSON.parse(row.paper_json),computed=sha(JSON.stringify([paper.title,paper.summary,paper.authors,paper.categories,paper.updated_at]));
    if(paper.id!==ref.id||paper.version_id!==row.version_id||computed!==ref.content_hash||sha(JSON.stringify([ref.id,row.version_id,computed]))!==ref.version_key)throw new Error("ADOPTION_PAPER_HASH_MISMATCH");
    verifySpan(paper.summary,ref);
  }finally{radar.close();}
  evidence.assertSnapshot();
  const sourceKeys=new Set(record.source_references.map(ref=>canonical(ref)));
  if(record.research_extractions?.some(extraction=>!sourceKeys.has(canonical(extraction.source_reference))))throw new Error("EXTRACTION_SOURCE_NOT_DECLARED");
  for(const ref of record.source_references){
    const opened=evidence.reopen(ref.chunk_id,{verify_live:true});
    if(opened.status!=="LIVE_VERIFIED"||opened.chunk.content_hash!==ref.content_hash)throw new Error("ADOPTION_SOURCE_NOT_CURRENT");
    verifySpan(opened.chunk.text,ref);
  }
  let resultStatus="not-run";
  if(record.result){
    const ref=record.result,receiptBytes=regularFile(factoryData,join(factoryData,"receipts",ref.run_id+".json"),MAX_ARTIFACT_BYTES);
    if(sha(receiptBytes)!==ref.receipt_hash)throw new Error("ADOPTION_RECEIPT_HASH_MISMATCH");
    const receipt=assertReceipt(JSON.parse(receiptBytes));if(receipt.run_id!==ref.run_id)throw new Error("ADOPTION_RECEIPT_ID_MISMATCH");
    const entries=receipt.artifacts.filter(a=>a.path===ref.artifact_path);
    if(entries.length!==1||entries[0].sha256!==ref.artifact_hash)throw new Error("ADOPTION_ARTIFACT_NOT_IN_RECEIPT");
    const artifact=regularFile(factoryData,join(factoryData,"runs",ref.run_id,"output",ref.artifact_path),MAX_ARTIFACT_BYTES);
    if(sha(artifact)!==ref.artifact_hash||artifact.length!==entries[0].bytes)throw new Error("ADOPTION_ARTIFACT_CHANGED");
    resultStatus=receipt.status;
  }
  return adoptionValidation.parse({record_id:sha(serialized),protocol_hash:sha(canonical(record.protocol)),source_spans_checked:record.source_references.length,result_status:resultStatus,paper_verification:"cached-abstract-span-not-full-text",scientific_verification:false,...privateTrust});
}
function openRecords(data,write=false){
  const path=join(data,"adoptions.sqlite");
  if(!write&&!existsSync(path))return null;
  if(write)mkdirSync(data,{recursive:true,mode:0o700});
  for(const suffix of ["","-wal","-shm","-journal"]){const p=path+suffix;if(existsSync(p)&&lstatSync(p).isSymbolicLink())throw new Error("ADOPTION_DATABASE_SYMLINK");}
  if(existsSync(path))checkedFile(data,path,8*1024*1024);
  const db=new Database(path,{readonly:!write,fileMustExist:!write,timeout:5000});
  try{
    if(write){
      chmodSync(path,0o600);db.pragma("journal_mode = WAL");db.pragma("synchronous = FULL");
      db.exec(`CREATE TABLE IF NOT EXISTS adoption_records(record_id TEXT PRIMARY KEY CHECK(length(record_id)=64), record_json TEXT NOT NULL CHECK(length(CAST(record_json AS BLOB))<=20000));
        CREATE TRIGGER IF NOT EXISTS adoption_capacity BEFORE INSERT ON adoption_records WHEN (SELECT count(*) FROM adoption_records)>=100 BEGIN SELECT RAISE(ABORT,'ADOPTION_RECORD_LIMIT'); END;
        CREATE TRIGGER IF NOT EXISTS adoption_no_update BEFORE UPDATE ON adoption_records BEGIN SELECT RAISE(ABORT,'ADOPTION_IMMUTABILITY_VIOLATION'); END;
        CREATE TRIGGER IF NOT EXISTS adoption_no_delete BEFORE DELETE ON adoption_records BEGIN SELECT RAISE(ABORT,'ADOPTION_IMMUTABILITY_VIOLATION'); END;`);
    }
    return db;
  }catch(error){db.close();throw error;}
}
function storedRecords(data){
  const db=openRecords(data);if(!db)return [];
  try{
    const count=db.prepare("SELECT count(*) AS n FROM adoption_records").get().n;if(count>MAX_RECORDS)throw new Error("ADOPTION_RECORD_LIMIT");
    return db.prepare("SELECT record_id,record_json FROM adoption_records ORDER BY record_id LIMIT ?").all(MAX_RECORDS).map(row=>{
      if(Buffer.byteLength(row.record_json)>MAX_RECORD_BYTES)throw new Error("ADOPTION_RECORD_TOO_LARGE");
      const record=adoptionRecord.parse(JSON.parse(row.record_json));
      if(sha(canonical(record))!==row.record_id||canonical(record)!==row.record_json)throw new Error("ADOPTION_RECORD_HASH_MISMATCH");
      return {record_id:row.record_id,record};
    });
  }finally{db.close();}
}
export function putAdoption(raw,evidence,{data=DATA,factoryData=FACTORY_DATA}={}){
  const record=adoptionRecord.parse(raw),verified=validateAdoption(record,evidence,{factoryData}),db=openRecords(data,true),bytes=canonical(record);
  try{return db.transaction(()=>{
    const existing=db.prepare("SELECT record_json FROM adoption_records WHERE record_id=?").get(verified.record_id);
    if(existing){if(existing.record_json!==bytes)throw new Error("ADOPTION_IMMUTABILITY_VIOLATION");return {...verified,created:false};}
    db.prepare("INSERT INTO adoption_records(record_id,record_json) VALUES(?,?)").run(verified.record_id,bytes);
    return {...verified,created:true};
  }).immediate();}finally{db.close();}
}
export function listAdoptions(raw={},data=DATA){
  const input=adoptionListInput.parse(raw),all=storedRecords(data),selected=input.record_id?all.filter(r=>r.record_id===input.record_id):all,records=selected.slice(0,input.limit);
  return adoptionListOutput.parse({records,total:selected.length,truncated:selected.length>records.length,validation:"stored-records-revalidate-before-use",...privateTrust});
}
export function validateAdoptionCollection(evidence,{data=DATA,factoryData=FACTORY_DATA}={}){
  const records=storedRecords(data),validations=[],nodes=new Map(),edges=[];
  const node=(id,type)=>nodes.set(id,{id,type});
  for(const {record_id,record} of records){
    let v;
    try{v=validateAdoption(record,evidence,{factoryData});}
    catch(error){
      // Historical citations never poison new work or contribute current-use edges.
      const reason=/^[A-Z][A-Z0-9_]{1,100}$/.test(error.message)?error.message:"REFERENCE_UNAVAILABLE_OR_INVALID";
      validations.push({record_id,state:"historical-unavailable",reason_code:reason});continue;
    }
    validations.push({record_id,state:"current",validation:v});
    const paper=`arxiv:${record.paper.id}v${record.paper.version}`,issue=`issue:${sha(record.issue)}`,protocol=`protocol:${v.protocol_hash}`,decision=`decision:${v.record_id}`;
    node(paper,"PaperCitation");node(issue,"ProposedIssue");node(protocol,"ExperimentProtocol");node(decision,"ProposedDecision");
    const edge=(src,dst,type)=>edges.push({id:sha(canonical([v.record_id,src,dst,type])),src,dst,type,record_id:v.record_id,authority:"candidate-only"});
    edge(paper,issue,"CANDIDATE_FOR");edge(issue,protocol,"PROPOSES_TEST");edge(protocol,decision,"HAS_PROPOSED_DECISION");
    for(const ref of record.source_references){node(ref.chunk_id,"SourceChunk");edge(decision,ref.chunk_id,"CITES_SOURCE_BYTES");}
    if(record.result){node(record.result.run_id,"ExecutionReceipt");edge(protocol,record.result.run_id,"CITES_EXECUTION");}
    for(const extraction of record.research_extractions||[]){
      const claim=`extraction:${sha(canonical([v.record_id,extraction.kind,extraction.statement,extraction.paper_location]))}`;
      nodes.set(claim,{id:claim,type:"CandidateResearchExtraction",kind:extraction.kind,statement_hash:sha(extraction.statement),paper_location:extraction.paper_location,extraction_status:extraction.extraction_status});
      edge(paper,claim,"HAS_AGENT_EXTRACTED_CANDIDATE");edge(claim,extraction.source_reference.chunk_id,"PARAPHRASED_IN_REVIEW_NOTE");edge(claim,issue,"MOTIVATES_ISSUE");
    }
  }
  return {schema_version:"dwin.adoption-integrity/v1",records_checked:records.length,records_current:validations.filter(v=>v.state==="current").length,records_excluded:validations.filter(v=>v.state!=="current").length,validations,nodes:[...nodes.values()].sort((a,b)=>a.id.localeCompare(b.id,"en")),edges,network_requests:0,scientific_verification:false,...privateTrust};
}
export function adoptionGraph(raw={},evidence,{data=DATA,factoryData=FACTORY_DATA}={}){
  const input=adoptionGraphInput.parse(raw),report=validateAdoptionCollection(evidence,{data,factoryData});
  const validations=input.record_id?report.validations.filter(v=>v.record_id===input.record_id):report.validations;
  const recordIds=new Set(validations.map(v=>v.record_id)),allEdges=report.edges.filter(edge=>recordIds.has(edge.record_id)).sort((a,b)=>a.id.localeCompare(b.id,"en"));
  const edgeSlice=allEdges.slice(0,input.max_edges),referenced=new Set(edgeSlice.flatMap(edge=>[edge.src,edge.dst]));
  const allNodes=report.nodes.filter(node=>referenced.has(node.id)).sort((a,b)=>a.id.localeCompare(b.id,"en")),nodes=allNodes.slice(0,input.max_nodes),nodeIds=new Set(nodes.map(node=>node.id)),edges=edgeSlice.filter(edge=>nodeIds.has(edge.src)&&nodeIds.has(edge.dst));
  return adoptionGraphOutput.parse({schema_version:"dwin.adoption-graph/v1",records_checked:validations.length,records_current:validations.filter(v=>v.state==="current").length,records_excluded:validations.filter(v=>v.state!=="current").length,validations,nodes,edges,truncated:allEdges.length>edgeSlice.length||allNodes.length>nodes.length||edges.length<edgeSlice.length,network_requests:0,scientific_verification:false,...privateTrust});
}
