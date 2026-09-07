export const SCORE_VERSION = "lexical-relevance-v1";

function normalized(value) { return String(value || "").normalize("NFKC").toLocaleLowerCase("en"); }

export function scorePaper(paper, watch, now = new Date()) {
  const title = normalized(paper.title);
  const summary = normalized(paper.summary);
  const categories = new Set((paper.categories || []).map(normalized));
  let score = 0;
  const reasons = [];
  for (const raw of watch.positive_keywords || []) {
    const keyword = normalized(raw).trim();
    if (!keyword) continue;
    if (title.includes(keyword)) { score += 4; reasons.push({ type: "title-keyword", keyword, weight: 4 }); }
    else if (summary.includes(keyword)) { score += 1; reasons.push({ type: "abstract-keyword", keyword, weight: 1 }); }
  }
  for (const raw of watch.negative_keywords || []) {
    const keyword = normalized(raw).trim();
    if (keyword && (title.includes(keyword) || summary.includes(keyword))) {
      score -= 3; reasons.push({ type: "negative-keyword", keyword, weight: -3 });
    }
  }
  if (watch.category && categories.has(normalized(watch.category))) {
    score += 2; reasons.push({ type: "category", keyword: watch.category, weight: 2 });
  }
  const published = Date.parse(paper.published_at || "");
  if (Number.isFinite(published)) {
    const days = Math.max(0, (now.getTime() - published) / 86_400_000);
    const recency = days <= 2 ? 3 : days <= 7 ? 2 : days <= 30 ? 1 : 0;
    if (recency) { score += recency; reasons.push({ type: "recency", days: Math.floor(days), weight: recency }); }
  }
  return { score, reasons, score_version: SCORE_VERSION, authority: "candidate-only" };
}
