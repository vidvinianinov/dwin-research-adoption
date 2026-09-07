import { z } from "zod";
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const trust={instruction_authority:z.literal("none"),authority:z.literal("candidate-only")};
export const chunk=z.object({id:hash,document_id:hash,source_id:z.string(),locator:z.string(),heading:z.string(),source_hash:hash,content_hash:hash,
  char_start:z.number().int().nonnegative(),char_length:z.number().int().positive(),byte_start:z.number().int().nonnegative(),byte_length:z.number().int().positive(),line_start:z.number().int().positive(),line_end:z.number().int().positive()}).strict();
export const packet=z.object({schema_version:z.literal("dwin.evidence-packet/v1"),generation:hash,policy_hash:hash,context_id:z.string(),query:z.string(),
  retrieval_method:z.literal("fts5-bm25-literal-or/v1"),vector_status:z.literal("NOT_USED_BY_LEXICAL_SEARCH"),...trust,privacy:z.literal("local-private-no-export"),
  freshness:z.literal("indexed-snapshot-not-live"),truncated:z.boolean(),results:z.array(chunk.extend({preview:z.string(),preview_truncated:z.boolean(),lexical_rank:z.number()}))}).strict();
export const searchResult=z.object({schema_version:z.literal("dwin.evidence-search/v1"),status:z.enum(["OK","NO_HITS","NOT_MODIFIED"]),cache_status:z.enum(["hit","miss","bypass"]),packet_hash:hash,generation:hash,context_id:z.string(),retrieval_executed:z.boolean(),packet:packet.nullable(),...trust,note:z.string().nullable()}).strict();
export const statusResult=z.object({schema_version:z.literal("dwin.evidence-index/v1"),generation:hash.nullable(),indexed_at:z.string().nullable(),policy_hash:hash,index_policy_matches:z.boolean(),
  counts:z.object({documents:z.number().int(),chunks:z.number().int(),nodes:z.number().int(),edges:z.number().int(),packets:z.number().int()}).strict(),
  privacy:z.literal("local-private-no-export"),...trust,vector_status:z.literal("NOT_USED_BY_LEXICAL_SEARCH"),live_freshness:z.literal("not-checked-until-reopen")}).strict();
export const reopenResult=z.object({status:z.enum(["NOT_FOUND","SNAPSHOT_VERIFIED","LIVE_VERIFIED","SOURCE_CHANGED","SOURCE_MISSING","SOURCE_UNAVAILABLE"]),chunk:chunk.extend({text:z.string()}).nullable(),generation:hash,...trust,privacy:z.literal("local-private-no-export")}).strict();
export const graphResult=z.object({generation:hash,nodes:z.array(z.object({id:z.string(),type:z.enum(["source","chunk","concept","url"]),label:z.string()}).strict()),
  edges:z.array(z.object({id:hash,src:z.string(),dst:z.string(),type:z.enum(["DERIVED_FROM","MENTIONS","REFERENCES"]),evidence_chunk_id:hash,authority:z.enum(["source-lineage-only","candidate-only"])}).strict()),
  truncated:z.boolean(),...trust}).strict();
