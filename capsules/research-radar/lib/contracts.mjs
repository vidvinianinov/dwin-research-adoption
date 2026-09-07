import { z } from "zod";

const nullableText = z.string().nullable();
export const arxivIdSchema = z.string().max(100).regex(/^(?:\d{4}\.\d{4,5}|[a-z][a-z.-]*(?:\.[A-Z]{2})?\/\d{7})(?:v[1-9]\d*)?$/i);
export const pageMetadataSchema = z.object({ total_results: z.number().int().nonnegative().nullable(), start_index: z.number().int().nonnegative().nullable(), items_per_page: z.number().int().nonnegative().nullable(), verified: z.boolean() }).strict();
export const cacheSchema = z.object({ status: z.enum(["hit", "miss", "refresh", "stale-fallback"]), cache_key: nullableText, snapshot_id: nullableText, fetched_at: nullableText, expires_at: nullableText, age_seconds: z.number().int().nonnegative().nullable(), request_performed: z.boolean(), stale: z.boolean(), error: z.object({ class: z.string(), message: z.string().max(300) }).strict().nullable() }).strict();
export const paperSnapshotSchema = z.object({
  id: arxivIdSchema, version_id: arxivIdSchema.nullable(), version_key: z.string().regex(/^[a-f0-9]{64}$/), content_hash: z.string().regex(/^[a-f0-9]{64}$/),
  title: z.string(), summary: z.string(), authors: z.array(z.string()), categories: z.array(z.string()), primary_category: nullableText,
  published_at: nullableText, updated_at: nullableText, abs_url: z.string().url(), pdf_url: z.string().url(),
  content_trust: z.literal("untrusted-external"), source: z.literal("arxiv-api"),
}).strict();
export const coverageSchema = z.object({
  schema_version: z.literal("dwin.research-coverage/v1"), authority: z.literal("candidate-only"), status: z.enum(["partial", "bounded-observed-exhausted"]),
  counts: z.object({ papers: z.number().int(), queued_papers: z.number().int(), immutable_versions: z.number().int(), discovery_observations: z.number().int() }).strict(),
  states: z.array(z.object({
    id: z.string(), watch_id: nullableText, lane: z.enum(["submissions", "revisions", "tracked-revisions"]), query_hash: z.string(),
    window: z.object({ since: z.string(), until: z.string(), kind: z.enum(["initial-90-day-backfill", "incremental-overlap", "tracked-id-batch"]) }).strict(),
    next_start: z.number().int(), total_results: z.number().int().nullable(), duplicate_entries: z.number().int(),
    status: z.enum(["partial", "observed-exhausted"]), reason: z.string(), last_attempt_at: nullableText, not_before: nullableText,
    stale_fallbacks: z.number().int(), total_changed: z.boolean(), pages: z.number().int(), last_snapshot_id: nullableText,
    unique_papers_observed: z.number().int(), tracked_ids_count: z.number().int(),
  }).strict()),
  limitations: z.array(z.string()), default_page_size: z.literal(50), max_pages_per_run: z.literal(3), max_run_ms: z.literal(105000),
}).strict();
export const driftSchema = z.object({ watch_id: z.string(), enabled: z.boolean(), template_id: nullableText, state: z.enum(["custom", "drift", "aligned"]), changed_fields: z.array(z.enum(["name", "category", "query", "positive_keywords", "negative_keywords"])), watch_fingerprint: z.string(), catalog_fingerprint: nullableText, automatic_replacement: z.literal(false) }).strict();
