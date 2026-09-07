import { readFileSync } from "node:fs";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { ARXIV_ENDPOINT, ARXIV_FIXTURE } from "./paths.mjs";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", trimValues: true });
const SORT_BY = new Set(["relevance", "lastUpdatedDate", "submittedDate"]);
const SORT_ORDER = new Set(["ascending", "descending"]);
const MAX_BYTES = 8 * 1024 * 1024;
const ID = /^(?:\d{4}\.\d{4,5}|[a-z][a-z.-]*(?:\.[A-Z]{2})?\/\d{7})(?:v[1-9]\d*)?$/i;
function array(value) { return value == null ? [] : Array.isArray(value) ? value : [value]; }
function clean(value) { return String(value || "").replace(/\s+/g, " ").trim(); }

export function arxivVersionId(value) {
  const raw = String(value || "").replace(/^arXiv:/i, "").replace(/^https?:\/\/arxiv\.org\/(?:abs|pdf)\//i, "").replace(/\.pdf$/i, "");
  if (!ID.test(raw)) throw new Error("Invalid arXiv identifier");
  return raw;
}
export function normalizeArxivId(value) { return arxivVersionId(value).replace(/v\d+$/i, ""); }

export function buildArxivUrl({ query = null, ids = null, maxResults = 20, start = 0, sortBy = "submittedDate", sortOrder = "descending" }) {
  if ((!query && !ids) || (query && ids)) throw new Error("Exactly one arXiv query or ids list is required");
  if (query && (typeof query !== "string" || !query.trim() || query.length > 1000)) throw new Error("arXiv query must be 1-1000 characters");
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 200) throw new Error("maxResults must be 1-200");
  if (!Number.isInteger(start) || start < 0 || start > 30_000) throw new Error("start must be 0-30000");
  if (!SORT_BY.has(sortBy)) throw new Error("Unsupported sortBy: " + sortBy);
  if (!SORT_ORDER.has(sortOrder)) throw new Error("Unsupported sortOrder: " + sortOrder);
  const url = new URL(ARXIV_ENDPOINT);
  if (ids) {
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 50) throw new Error("ids must contain 1-50 arXiv identifiers");
    url.searchParams.set("id_list", [...new Set(ids.map(arxivVersionId))].join(","));
  } else url.searchParams.set("search_query", query.trim());
  url.searchParams.set("start", String(start));
  url.searchParams.set("max_results", String(maxResults));
  url.searchParams.set("sortBy", sortBy);
  url.searchParams.set("sortOrder", sortOrder);
  return url;
}

export function parseArxivPage(xml) {
  if (Buffer.byteLength(xml) > MAX_BYTES) throw new Error("arXiv response exceeds byte bound");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error("Invalid arXiv XML");
  const feed = parser.parse(xml)?.feed;
  if (!feed || typeof feed !== "object") throw new Error("arXiv response is not an Atom feed");
  const entries = array(feed.entry);
  if (entries.length > 200) throw new Error("arXiv page exceeds 200 entries");
  const papers = entries.map((entry) => {
    if (/api\/errors|#error/i.test(String(entry.id)) || /^error$/i.test(clean(entry.title))) throw new Error("arXiv Atom error: " + clean(entry.summary).slice(0, 200));
    const rawId = arxivVersionId(entry.id);
    const id = normalizeArxivId(rawId);
    const versionId = /v\d+$/i.test(rawId) ? rawId : null;
    const title = clean(entry.title), summary = clean(entry.summary);
    if (!title || title.length > 2000 || summary.length > 100_000) throw new Error("Invalid bounded arXiv paper metadata");
    for (const date of [entry.published, entry.updated]) if (!date || !Number.isFinite(Date.parse(date))) throw new Error("Invalid arXiv paper timestamp");
    return {
      id, version_id: versionId, title, summary,
      authors: array(entry.author).map((author) => clean(author?.name)).filter(Boolean),
      categories: array(entry.category).map((category) => clean(category?.term)).filter(Boolean),
      primary_category: clean(entry["arxiv:primary_category"]?.term) || null,
      published_at: clean(entry.published), updated_at: clean(entry.updated),
      abs_url: "https://arxiv.org/abs/" + (versionId || id), pdf_url: "https://arxiv.org/pdf/" + (versionId || id),
      content_trust: "untrusted-external", source: "arxiv-api",
    };
  });
  const number = (suffix) => {
    const key = Object.keys(feed).find((key) => key === suffix || key.endsWith(":" + suffix));
    if (!key) return null;
    const raw = String(feed[key]);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error("Invalid arXiv " + suffix);
    return Number(raw);
  };
  const metadata = { total_results: number("totalResults"), start_index: number("startIndex"), items_per_page: number("itemsPerPage") };
  metadata.verified = Object.values(metadata).every((value) => value !== null);
  if (metadata.verified && ((metadata.start_index > metadata.total_results && papers.length > 0) || papers.length > metadata.items_per_page || metadata.start_index + papers.length > metadata.total_results)) throw new Error("Inconsistent arXiv pagination metadata");
  return { papers, metadata };
}
export function parseArxivFeed(xml) { return parseArxivPage(xml).papers; }

export function assertArxivUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "export.arxiv.org" || url.username || url.password || (url.port && url.port !== "443")) throw new Error("arXiv endpoint escaped allowlist");
  return url;
}

export async function fetchArxivPage(options, { fixturePath = ARXIV_FIXTURE, fetchImpl = fetch, timeoutMs = 20_000 } = {}) {
  const requestUrl = buildArxivUrl(options);
  if (fixturePath) return parseArxivPage(readFileSync(fixturePath, "utf8"));
  let url = assertArxivUrl(requestUrl);
  const signal = AbortSignal.timeout(Math.max(1, Math.min(20_000, timeoutMs)));
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const response = await fetchImpl(url, { redirect: "manual", headers: { "User-Agent": "DWIN-Research-Radar/0.4 (local-personal-research-tool)" }, signal });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      if (redirects === 3) throw new Error("arXiv redirect limit exceeded");
      const location = response.headers.get("location");
      if (!location) throw new Error("arXiv redirect without location");
      url = assertArxivUrl(new URL(location, url));
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error("arXiv API returned HTTP " + response.status); }
    if (Number(response.headers.get("content-length")) > MAX_BYTES) { await response.body?.cancel(); throw new Error("arXiv response exceeds byte bound"); }
    if (!response.body) throw new Error("arXiv response has no body");
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > MAX_BYTES) throw new Error("arXiv response exceeds byte bound");
      chunks.push(Buffer.from(chunk));
    }
    return parseArxivPage(Buffer.concat(chunks).toString("utf8"));
  }
  throw new Error("arXiv redirect failure");
}
export async function fetchArxiv(options, dependencies = {}) { return (await fetchArxivPage(options, dependencies)).papers; }
