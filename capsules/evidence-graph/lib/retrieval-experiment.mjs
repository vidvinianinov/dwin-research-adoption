import {z} from "zod";
import {performance} from "node:perf_hooks";
import {readFileSync} from "node:fs";
import {HYBRID} from "./hybrid-contracts.mjs";
import {chunk} from "./contracts.mjs";
import {EP,digest} from "./model-artifacts.mjs";
import {vectorBytes,EMBEDDING_FINGERPRINT} from "./embedding-runtime.mjs";
import {RETRIEVAL_FINGERPRINT} from "./semantic-store.mjs";
import {POLICY_HASH} from "./store.mjs";

export const ARMS=Object.freeze(["bm25","exact_dense","existing_rrf","union_dense_rescore"]);
export const EXPERIMENT_INPUT=HYBRID.extend({arm:z.enum(ARMS).default("existing_rrf")}).strict();
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export const EXPERIMENT_DEPENDENCIES=Object.freeze({
  policy_hash:POLICY_HASH,retrieval_fingerprint:RETRIEVAL_FINGERPRINT,embedding_fingerprint:EMBEDDING_FINGERPRINT,
  bm25_implementation_hash:digest(readFileSync(new URL("./store.mjs",import.meta.url))),
  rrf_implementation_hash:digest(readFileSync(new URL("./semantic-store.mjs",import.meta.url))),
  experiment_implementation_hash:digest(readFileSync(new URL(import.meta.url)))
});
export function experimentFingerprint(generation,protocolBytes="",evaluatorBytes=""){
  hash.parse(generation);
  return digest(JSON.stringify({...EXPERIMENT_DEPENDENCIES,generation,protocol_hash:digest(protocolBytes),evaluator_hash:digest(evaluatorBytes)}));
}
export const EXPERIMENT_RESULT=z.object({
  schema_version:z.literal("dwin.retrieval-experiment/v1"),arm:z.enum(ARMS),generation:hash,experiment_fingerprint:hash,
  policy_hash:hash,retrieval_fingerprint:hash,embedding_fingerprint:hash,query:z.string().min(2).max(300),context_id:z.string().min(1).max(100),
  status:z.enum(["OK","NO_HITS"]),authority:z.literal("candidate-only"),instruction_authority:z.literal("none"),privacy:z.literal("local-private-no-export"),
  freshness:z.literal("indexed-snapshot-not-live"),default_search:z.literal("bm25"),promoted:z.literal(false),human_reviewed:z.literal(false),
  query_embedding_cache:z.enum(["hit","miss","not-needed"]),candidate_depth:z.literal(EP.candidate_pool),candidate_count:z.number().int().min(0).max(EP.candidate_pool*2),
  candidate_ids:z.array(hash).max(EP.candidate_pool*2),eligible_chunks:z.number().int().min(0).max(EP.max_chunks),latency_ms:z.number().nonnegative(),
  latency_scope:z.literal("complete-four-arm-candidate-collection"),results:z.array(chunk.extend({preview:z.string().max(1200),preview_truncated:z.boolean(),cosine_distance:z.number().optional(),rrf_score:z.number().positive().optional()}).strict()).max(20)
}).strict();
const idOrder=(a,b)=>a.id<b.id?-1:a.id>b.id?1:0;
export function denseOrder(rows){
  const seen=new Set();
  for(const row of rows){if(typeof row.id!=="string"||!row.id||seen.has(row.id)||!Number.isFinite(row.cosine_distance))throw new Error("INVALID_DENSE_CANDIDATE");seen.add(row.id);}
  return [...rows].sort((a,b)=>a.cosine_distance-b.cosine_distance||idOrder(a,b));
}
export function unionDenseRescore(lexical,dense,allDistances){
  const ids=new Set([...lexical,...dense].map(r=>r.id));
  const rows=[...ids].map(id=>{if(!allDistances.has(id))throw new Error("MISSING_CANDIDATE_DISTANCE");return {id,cosine_distance:allDistances.get(id)};});
  return denseOrder(rows);
}
export function rankMetrics(ids,relevant){
  if(!Array.isArray(relevant)||!relevant.length||new Set(relevant).size!==relevant.length)throw new Error("INVALID_RELEVANCE_LABELS");
  const unique=[...new Set(ids)],position=unique.findIndex(id=>relevant.includes(id));
  return {recall:unique.filter(id=>relevant.includes(id)).length/relevant.length,mrr:position<0?0:1/(position+1)};
}

// Bounded offline diagnostic. Similarity is advisory, never identity/entailment.
// Existing search/cache calls may write their private caches; no claim/source mutation.
export async function collectCandidates(evidence,semantic,runtime,raw){
  const input=HYBRID.parse(raw);semantic.assertReady(evidence);
  const generation=evidence.meta("generation"),count=evidence.status().counts.chunks;
  if(count>EP.max_chunks)throw new Error("EXPERIMENT_CORPUS_LIMIT");
  semantic.integrity(evidence);
  const eligible=semantic.db.prepare(`select count(*) n from chunk_vectors ${input.source_id?"where source_id=?":""}`).get(...(input.source_id?[input.source_id]:[])).n;
  if(!eligible)return {generation,query_embedding_cache:"not-needed",eligible_chunks:0,candidate_depth:EP.candidate_pool,candidates:Object.fromEntries(ARMS.map(arm=>[arm,[]]))};
  const lexical=evidence.search({...input,limit:EP.candidate_pool,preview_chars:0,bypass_cache:true}).packet.results;
  const encoded=await semantic.encode(input.query,"query",runtime);
  semantic.assertReady(evidence);if(generation!==evidence.meta("generation"))throw new Error("SOURCE_GENERATION_CHANGED_DURING_QUERY");
  // Full bounded scan before top-k makes equal-distance cutoff ties explicit.
  const rows=semantic.db.prepare(`SELECT m.chunk_id AS id,m.source_id,e.vector_hash,v.embedding,
    vec_distance_cosine(v.embedding,?) AS cosine_distance FROM chunk_vectors m
    JOIN embeddings e ON e.key=m.embedding_key JOIN vec_chunks v ON v.rowid=m.id
    ${input.source_id?"WHERE m.source_id=?":""}`).all(vectorBytes(encoded.vector),...(input.source_id?[input.source_id]:[]));
  if(rows.length!==eligible)throw new Error("EXPERIMENT_VECTOR_COVERAGE_FAILED");
  for(const row of rows){if(digest(row.embedding)!==row.vector_hash)throw new Error("VECTOR_INTEGRITY_FAILED");vectorBytes(new Float32Array(Uint8Array.from(row.embedding).buffer));}
  const exact=denseOrder(rows.map(({id,cosine_distance})=>({id,cosine_distance}))),dense=exact.slice(0,EP.candidate_pool);
  const existing=await semantic.search(evidence,{...input,limit:EP.candidate_pool,preview_chars:0},runtime);
  semantic.assertReady(evidence);if(generation!==evidence.meta("generation"))throw new Error("SOURCE_GENERATION_CHANGED_DURING_QUERY");
  const union=unionDenseRescore(lexical,dense,new Map(exact.map(r=>[r.id,r.cosine_distance])));
  return {generation,query_embedding_cache:encoded.cache,eligible_chunks:rows.length,candidate_depth:EP.candidate_pool,
    candidates:{bm25:lexical.map(r=>({id:r.id})),exact_dense:dense,existing_rrf:existing.results.map(r=>({id:r.id,rrf_score:r.rrf_score})),union_dense_rescore:union}};
}

export async function searchRetrievalExperiment(evidence,semantic,runtime,raw){
  const input=EXPERIMENT_INPUT.parse(raw),{arm,...request}=input,started=performance.now();
  const collection=await collectCandidates(evidence,semantic,runtime,request);
  const pool=collection.candidates[arm],results=pool.slice(0,input.limit).map(candidate=>{
    const reopened=evidence.reopen(candidate.id,{verify_live:false});if(!reopened.chunk)throw new Error("ORPHAN_CANDIDATE");
    const {text,...chunk}=reopened.chunk;if(input.source_id&&chunk.source_id!==input.source_id)throw new Error("SOURCE_FILTER_VIOLATION");
    return {...chunk,...candidate,preview:text.slice(0,input.preview_chars),preview_truncated:text.length>input.preview_chars};
  });
  semantic.assertReady(evidence);if(collection.generation!==evidence.meta("generation"))throw new Error("SOURCE_GENERATION_CHANGED_DURING_QUERY");
  return EXPERIMENT_RESULT.parse({schema_version:"dwin.retrieval-experiment/v1",arm,generation:collection.generation,query:input.query,context_id:input.context_id,
    experiment_fingerprint:experimentFingerprint(collection.generation),policy_hash:POLICY_HASH,retrieval_fingerprint:RETRIEVAL_FINGERPRINT,embedding_fingerprint:EMBEDDING_FINGERPRINT,
    status:results.length?"OK":"NO_HITS",authority:"candidate-only",instruction_authority:"none",privacy:"local-private-no-export",
    freshness:"indexed-snapshot-not-live",
    default_search:"bm25",promoted:false,human_reviewed:false,query_embedding_cache:collection.query_embedding_cache,
    candidate_depth:collection.candidate_depth,candidate_count:pool.length,candidate_ids:pool.map(r=>r.id),eligible_chunks:collection.eligible_chunks,
    latency_ms:performance.now()-started,latency_scope:"complete-four-arm-candidate-collection",results});
}
