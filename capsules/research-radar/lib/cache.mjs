import { buildArxivUrl, fetchArxivPage } from "./arxiv.mjs";
import { RadarStore } from "./db.mjs";

export const DEFAULT_ARXIV_CACHE_TTL_SECONDS = 86_400;
const unknownMetadata = () => ({ total_results: null, start_index: null, items_per_page: null, verified: false });
function cacheMetadata(entry, status, requestPerformed, now, error = null) {
  return {
    status, cache_key: entry?.cache_key || null, snapshot_id: entry?.snapshot_id || null,
    fetched_at: entry?.fetched_at || null, expires_at: entry?.expires_at || null,
    age_seconds: entry ? Math.max(0, Math.floor((new Date(now).getTime() - new Date(entry.fetched_at).getTime()) / 1000)) : null,
    request_performed: requestPerformed, stale: entry ? !entry.fresh : false,
    error: error ? { class: error.name || "Error", message: String(error.message || error).slice(0, 300) } : null,
  };
}

export async function cachedArxivSearch(options, {
  store: suppliedStore = null, fetcher = fetchArxivPage,
  ttlSeconds = DEFAULT_ARXIV_CACHE_TTL_SECONDS, now = new Date().toISOString(),
  beforeFetch = null, deadlineMs = Infinity,
  requestDelayMs = process.env.DWIN_ARXIV_FIXTURE ? 0 : 3000,
} = {}) {
  const store = suppliedStore || new RadarStore(), shouldClose = !suppliedStore;
  const requestUrl = buildArxivUrl(options).toString();
  const output = (entry, status, performed, error = null) => ({
    papers: entry.papers, metadata: entry.metadata, papers_new: entry.papers_new || 0,
    version_changes: entry.version_changes || 0,
    cache: cacheMetadata(entry, status, performed, now, error), request_url: requestUrl,
  });
  try {
    const fresh = store.cachedSearch(requestUrl, { now });
    if (fresh) return output(fresh, "hit", false);
    const stale = store.cachedSearch(requestUrl, { now, allowExpired: true });
    let requestPerformed = false;
    try {
      const delay = store.reserveRequest({ delayMs: requestDelayMs, deadlineMs: deadlineMs - 1000 });
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      if (Date.now() >= deadlineMs - 1000) throw new Error("arXiv request time budget exhausted");
      if (beforeFetch) await beforeFetch();
      requestPerformed = true;
      const fetched = await fetcher(options, { timeoutMs: Math.min(20_000, deadlineMs - Date.now() - 500) });
      const page = Array.isArray(fetched) ? { papers: fetched, metadata: unknownMetadata() } : fetched;
      if (!page || !Array.isArray(page.papers) || page.papers.length > options.maxResults || !page.metadata) throw new Error("Invalid bounded arXiv page");
      if (options.ids) {
        const allowed = new Set(options.ids.map((id) => id.replace(/v\d+$/i, "")));
        if (page.papers.some((paper) => !allowed.has(paper.id))) throw new Error("arXiv id_list response contained an unrequested paper");
        for (const requested of options.ids.filter((id) => /v\d+$/i.test(id))) {
          if (page.papers.some((paper) => paper.id === requested.replace(/v\d+$/i, "") && paper.version_id !== requested)) throw new Error("arXiv id_list returned a different requested version");
        }
      }
      if (page.metadata.verified && page.metadata.start_index !== (options.start || 0)) throw new Error("arXiv returned unexpected page offset");
      const stored = store.putCachedSearch({ requestUrl, request: options, ...page, fetchedAt: now, ttlSeconds });
      return output(stored, stale ? "refresh" : "miss", true);
    } catch (error) {
      if (stale) return output(stale, "stale-fallback", requestPerformed, error);
      throw error;
    }
  } finally { if (shouldClose) store.close(); }
}
