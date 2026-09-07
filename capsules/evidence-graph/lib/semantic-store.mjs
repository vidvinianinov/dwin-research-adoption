import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import {mkdirSync,chmodSync,readFileSync} from "node:fs";
import {join} from "node:path";
import {EP,digest,verifyModel} from "./model-artifacts.mjs";
import {DATA} from "./store.mjs";
import {EMBEDDING_FINGERPRINT,embeddingKey,vectorBytes} from "./embedding-runtime.mjs";
import {HYBRID} from "./hybrid-contracts.mjs";
export const RETRIEVAL_FINGERPRINT=digest(readFileSync(new URL(import.meta.url))+readFileSync(new URL("./hybrid-contracts.mjs",import.meta.url))+EMBEDDING_FINGERPRINT);
export class SemanticStore{
  constructor(data=DATA){
    mkdirSync(data,{recursive:true,mode:0o700});this.db=new Database(join(data,"semantic.sqlite"));chmodSync(join(data,"semantic.sqlite"),0o600);
    this.db.pragma("busy_timeout=5000");this.db.pragma("journal_mode=WAL");
    if(this.db.pragma("user_version",{simple:true})>1){this.db.close();throw new Error("UNSUPPORTED_SEMANTIC_SCHEMA");}
    sqliteVec.load(this.db);
    if(this.db.prepare("select vec_version() v").get().v!=="v"+EP.sqlite_vec){this.db.close();throw new Error("SQLITE_VEC_VERSION_MISMATCH");}
    this.db.exec(`CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS embeddings(key TEXT PRIMARY KEY,text_hash TEXT NOT NULL,role TEXT NOT NULL,fingerprint TEXT NOT NULL,vector BLOB NOT NULL,vector_hash TEXT NOT NULL,windows INTEGER NOT NULL,touched INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS chunk_vectors(id INTEGER PRIMARY KEY,chunk_id TEXT UNIQUE NOT NULL,source_id TEXT NOT NULL,embedding_key TEXT NOT NULL);
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(embedding float[384] distance_metric=cosine,source_id TEXT partition key);
      PRAGMA user_version=1;`);
  }
  close(){this.db.close();}
  meta(k){return this.db.prepare("select value from meta where key=?").get(k)?.value??null;}
  setMeta(k,v){this.db.prepare("insert or replace into meta values(?,?)").run(k,v);}
  status(evidence,{checkModel=true}={}){
    const current=evidence.status().generation,indexed=this.meta("generation");
    let valid=false;try{evidence.assertSnapshot();valid=true;}catch{}
    return {schema_version:"dwin.embedding-status/v1",default_search:"bm25",model:EP.model,revision:EP.revision,fingerprint:EMBEDDING_FINGERPRINT,dimensions:384,
      index_status:!indexed?"EMPTY":valid&&indexed===current&&this.meta("fingerprint")===EMBEDDING_FINGERPRINT?"READY":"STALE",indexed_generation:indexed,current_generation:current,
      model_status:checkModel?verifyModel().status:"MODEL_MISSING",vectors:this.db.prepare("select count(*) n from chunk_vectors").get().n,cached_embeddings:this.db.prepare("select count(*) n from embeddings").get().n,
      network_inference:false,authority:"candidate-only",instruction_authority:"none",privacy:"local-private-no-export"};
  }
  cached(text,role){
    const key=embeddingKey(text,role),row=this.db.prepare("select * from embeddings where key=?").get(key);if(!row)return null;
    if(row.fingerprint!==EMBEDDING_FINGERPRINT||row.text_hash!==digest(text)||row.role!==role||digest(row.vector)!==row.vector_hash)throw new Error("EMBEDDING_CACHE_INTEGRITY_FAILED");
    const vector=new Float32Array(Uint8Array.from(row.vector).buffer);vectorBytes(vector);
    if(!Number.isInteger(row.windows)||row.windows<1||row.windows>EP.windowing.max_windows)throw new Error("INVALID_CACHED_WINDOWS");
    this.db.prepare("update embeddings set touched=? where key=?").run(Date.now(),key);
    return {key,vector,windows:row.windows,cache:"hit"};
  }
  async encode(text,role,runtime){
    const cached=this.cached(text,role);if(cached)return cached;
    const {vector,windows}=await runtime.embed(text,role),bytes=vectorBytes(vector),key=embeddingKey(text,role);
    if(!Number.isInteger(windows)||windows<1||windows>EP.windowing.max_windows)throw new Error("INVALID_EMBEDDING_WINDOWS");
    this.db.prepare("insert or replace into embeddings values(?,?,?,?,?,?,?,?)").run(key,digest(text),role,EMBEDDING_FINGERPRINT,bytes,digest(bytes),windows,Date.now());
    if(role==="query")this.prune();return {key,vector,windows,cache:"miss"};
  }
  prune(){
    this.db.exec(`DELETE FROM embeddings WHERE role='query' AND key IN (SELECT key FROM embeddings WHERE role='query' ORDER BY touched DESC,key LIMIT -1 OFFSET ${EP.query_cache_max_entries})`);
    this.db.exec(`DELETE FROM embeddings WHERE key IN (SELECT key FROM embeddings WHERE key NOT IN (SELECT embedding_key FROM chunk_vectors) ORDER BY touched DESC,key LIMIT -1 OFFSET ${EP.cache_max_entries-EP.max_chunks})`);
  }
  snapshot(evidence){return evidence.db.transaction(()=>{evidence.assertSnapshot();return {generation:evidence.meta("generation"),chunks:evidence.db.prepare("select data from chunks order by id").all().map(r=>JSON.parse(r.data))};})();}
  async build(evidence,runtime){
    const snapshot=this.snapshot(evidence);if(snapshot.chunks.length>EP.max_chunks)throw new Error("EMBEDDING_CORPUS_LIMIT");
    let computed=0,hits=0,pending=0,windows=0;
    for(const chunk of snapshot.chunks){
      if(digest(chunk.text)!==chunk.content_hash)throw new Error("SOURCE_CHUNK_HASH_MISMATCH");
      let item=this.cached(chunk.text,"passage");
      if(item)hits++;else if(computed<EP.max_embeddings_per_job){item=await this.encode(chunk.text,"passage",runtime);computed++;}else{pending++;continue;}
      windows+=item.windows;
    }
    evidence.assertSnapshot();if(evidence.meta("generation")!==snapshot.generation)throw new Error("SOURCE_GENERATION_CHANGED_DURING_EMBEDDING");
    if(!pending)this.db.transaction(()=>{
      this.db.exec("delete from vec_chunks;delete from chunk_vectors;");let id=0;
      for(const chunk of snapshot.chunks){const item=this.cached(chunk.text,"passage");if(!item)throw new Error("CACHE_EVICTED_DURING_BUILD");id++;
        this.db.prepare("insert into chunk_vectors values(?,?,?,?)").run(id,chunk.id,chunk.source_id,item.key);
        this.db.prepare("insert into vec_chunks(rowid,embedding,source_id) values(?,?,?)").run(BigInt(id),vectorBytes(item.vector),chunk.source_id);
      }
      this.setMeta("generation",snapshot.generation);this.setMeta("fingerprint",EMBEDDING_FINGERPRINT);
    })();
    this.prune();
    return {schema_version:"dwin.embedding-report/v1",generation:snapshot.generation,fingerprint:EMBEDDING_FINGERPRINT,status:pending?"PARTIAL":"READY",chunks:snapshot.chunks.length,computed,cache_hits:hits,pending,windows,network_requests:0,default_search:"bm25",authority:"candidate-only",instruction_authority:"none",privacy:"local-private-no-export"};
  }
  assertReady(evidence){
    evidence.assertSnapshot();if(this.meta("generation")!==evidence.meta("generation")||this.meta("fingerprint")!==EMBEDDING_FINGERPRINT)throw new Error("VECTOR_INDEX_STALE_OR_EMPTY: run evidence-graph embed");
    const expected=evidence.status().counts.chunks;
    if(this.db.prepare("select count(*) n from vec_chunks").get().n!==expected||this.db.prepare("select count(*) n from chunk_vectors").get().n!==expected)throw new Error("VECTOR_COVERAGE_FAILED");
  }
  integrity(evidence){
    this.assertReady(evidence);let checked=0;
    for(const row of this.db.prepare("select m.*,e.text_hash,e.vector,e.vector_hash,e.fingerprint,e.windows from chunk_vectors m join embeddings e on e.key=m.embedding_key order by m.id").all()){
      const source=evidence.db.prepare("select data from chunks where id=?").get(row.chunk_id);if(!source)throw new Error("ORPHAN_VECTOR");
      const chunk=JSON.parse(source.data),vec=this.db.prepare("select embedding,source_id from vec_chunks where rowid=?").get(BigInt(row.id));
      if(!vec||vec.source_id!==row.source_id||row.source_id!==chunk.source_id||row.text_hash!==chunk.content_hash||row.fingerprint!==EMBEDDING_FINGERPRINT||row.embedding_key!==embeddingKey(chunk.text,"passage")||digest(vec.embedding)!==row.vector_hash||digest(row.vector)!==row.vector_hash)throw new Error("VECTOR_INTEGRITY_FAILED");
      vectorBytes(new Float32Array(Uint8Array.from(row.vector).buffer));checked++;
    }
    const expected=evidence.status().counts.chunks;
    if(checked!==expected||this.db.prepare("select count(*) n from vec_chunks").get().n!==expected||this.db.prepare("select count(*) n from chunk_vectors").get().n!==expected)throw new Error("VECTOR_COVERAGE_FAILED");
    return {passed:true,checked,dimensions:EP.dimensions};
  }
  async search(evidence,raw,runtime){
    const input=HYBRID.parse(raw);this.assertReady(evidence);const generation=evidence.meta("generation");
    const count=this.db.prepare(`select count(*) n from chunk_vectors ${input.source_id?"where source_id=?":""}`).get(...(input.source_id?[input.source_id]:[])).n;
    let encoded=null;if(count)encoded=await this.encode(input.query,"query",runtime);
    return evidence.db.transaction(()=>{
      this.assertReady(evidence);if(evidence.meta("generation")!==generation)throw new Error("SOURCE_GENERATION_CHANGED_DURING_QUERY");
      return this.db.transaction(()=>{
        this.assertReady(evidence);
        const lexical=evidence.search({query:input.query,context_id:input.context_id,source_id:input.source_id,limit:EP.candidate_pool,preview_chars:0,bypass_cache:true}).packet;
        const dense=encoded?this.db.prepare(`select rowid,distance from vec_chunks where embedding match ? and k=? ${input.source_id?"and source_id=?":""} order by distance`).all(vectorBytes(encoded.vector),BigInt(Math.min(count,EP.candidate_pool)),...(input.source_id?[input.source_id]:[])):[];
        const candidates=new Map();const item=id=>{if(!candidates.has(id))candidates.set(id,{id,lexical_position:null,semantic_position:null,cosine_distance:null,rrf_score:0});return candidates.get(id);};
        lexical.results.forEach((row,i)=>{const c=item(row.id);c.lexical_position=i+1;c.rrf_score+=1/(EP.rrf_k+i+1);});
        dense.sort((a,b)=>a.distance-b.distance||a.rowid-b.rowid).forEach((row,i)=>{
          const m=this.db.prepare("select m.chunk_id,e.vector_hash from chunk_vectors m join embeddings e on e.key=m.embedding_key where m.id=?").get(row.rowid);
          if(!m)throw new Error("ORPHAN_VECTOR");
          const vector=this.db.prepare("select embedding from vec_chunks where rowid=?").get(BigInt(row.rowid));
          if(!vector||digest(vector.embedding)!==m.vector_hash)throw new Error("VECTOR_INTEGRITY_FAILED");
          const c=item(m.chunk_id);c.semantic_position=i+1;c.cosine_distance=row.distance;c.rrf_score+=1/(EP.rrf_k+i+1);
        });
        const ordered=[...candidates.values()].sort((a,b)=>b.rrf_score-a.rrf_score||a.id.localeCompare(b.id));
        const results=ordered.slice(0,input.limit).map(c=>{
          const reopened=evidence.reopen(c.id,{verify_live:false});if(!reopened.chunk)throw new Error("ORPHAN_VECTOR");
          const {text,...chunk}=reopened.chunk;if(input.source_id&&chunk.source_id!==input.source_id)throw new Error("SOURCE_FILTER_VIOLATION");
          const cached=this.cached(text,"passage");if(!cached)throw new Error("MISSING_EMBEDDING");
          return {...chunk,preview:text.slice(0,input.preview_chars),preview_truncated:text.length>input.preview_chars,lexical_position:c.lexical_position,semantic_position:c.semantic_position,cosine_distance:c.cosine_distance,rrf_score:c.rrf_score,embedding_windows:cached.windows};
        });
        return {schema_version:"dwin.hybrid-search/v1",status:results.length?"OK":"NO_HITS",generation,embedding_fingerprint:EMBEDDING_FINGERPRINT,retrieval_fingerprint:RETRIEVAL_FINGERPRINT,context_id:input.context_id,query:input.query,method:"fts5-cosine-rrf/v1",freshness:"indexed-snapshot-not-live",query_embedding_cache:encoded?.cache??"not-needed",truncated:ordered.length>input.limit,candidate_pool_truncated:lexical.truncated||count>EP.candidate_pool,authority:"candidate-only",instruction_authority:"none",privacy:"local-private-no-export",results};
      })();
    })();
  }
}
