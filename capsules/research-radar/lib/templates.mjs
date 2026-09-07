import { buildArxivUrl, fetchArxivPage } from "./arxiv.mjs";
import { createHash } from "node:crypto";
import { cachedArxivSearch } from "./cache.mjs";
import { RadarStore } from "./db.mjs";

export const TEMPLATE_SCHEMA_VERSION = "dwin.arxiv-search-template/v1";
export const TAXONOMY_SCHEMA_VERSION = "dwin.ai-research-taxonomy/v1";
export const CATEGORY_SCHEMA_VERSION = "dwin.arxiv-category/v1";

const ARXIV_CATEGORIES = Object.freeze([
  {
    id: "cs.AI", name: "Artificial Intelligence", domain: "Computer Science", monitoring_tier: "adjacent",
    scope_hint: "AI methods, reasoning, planning, agents, evaluation, and applied intelligent systems.",
  },
  {
    id: "cs.IR", name: "Information Retrieval", domain: "Computer Science", monitoring_tier: "adjacent",
    scope_hint: "Search, ranking, recommendation, retrieval evaluation, and information access.",
  },
  {
    id: "cs.DB", name: "Databases", domain: "Computer Science", monitoring_tier: "adjacent",
    scope_hint: "Data systems, indexes, query processing, storage, provenance, and database architecture.",
  },
  {
    id: "cs.DS", name: "Data Structures and Algorithms", domain: "Computer Science", monitoring_tier: "adjacent",
    scope_hint: "Algorithms, data structures, graph procedures, complexity, and exact computational methods.",
  },
  {
    id: "cs.LG", name: "Machine Learning", domain: "Computer Science", monitoring_tier: "adjacent",
    scope_hint: "Learning algorithms, model training, adaptation, representation, and evaluation.",
  },
  {
    id: "cs.MA", name: "Multiagent Systems", domain: "Computer Science", monitoring_tier: "core",
    scope_hint: "Multi-agent coordination, communication, delegation, games, and collective behavior.",
  },
  {
    id: "stat.ML", name: "Machine Learning", domain: "Statistics", monitoring_tier: "core",
    scope_hint: "Statistical foundations, uncertainty, experimental design, estimation, and learning theory.",
  },
]);

const DIMENSIONS = Object.freeze([
  { id: "memory", name: "Agent memory", question: "How should agents retain, retrieve, validate, supersede, and forget evidence?" },
  { id: "agent-graphs", name: "Agent and evidence graphs", question: "Which graph structures improve retrieval, provenance, planning, and execution?" },
  { id: "agent-loops", name: "Loop engineering", question: "How should long-horizon agent loops allocate work, recover, and improve?" },
  { id: "skills", name: "Skills and procedural knowledge", question: "How do agents acquire, select, evaluate, and reuse procedures?" },
  { id: "context", name: "Context engineering", question: "How can context be selected, compressed, cached, and budgeted without losing evidence?" },
  { id: "evaluation", name: "Evaluation and reliability", question: "Which benchmarks expose agent failures, variance, regressions, and hidden costs?" },
  { id: "tools", name: "Tools and protocols", question: "How should agents discover and safely operate tools, APIs, and MCP-like protocols?" },
  { id: "multi-agent", name: "Multi-agent systems", question: "When does delegation or coordination outperform a single agent, and at what cost?" },
  { id: "coding", name: "Software-engineering agents", question: "How can agents understand repositories and make verified code changes efficiently?" },
  { id: "security", name: "Agent security and governance", question: "How do we contain prompt injection, poisoning, authority collapse, and unsafe trajectories?" },
  { id: "self-improvement", name: "Agent self-improvement", question: "When should an agent revise its strategy, learn from execution evidence, or update its procedures?" },
  { id: "embedded-retrieval", name: "Embedded retrieval", question: "How can SQLite, FTS and local vector retrieval provide measurable quality and bounded resource use?" },
  { id: "vector-indexing", name: "Vector indexing", question: "Which dense candidate indexes preserve recall against exact search, at what measured scale?" },
  { id: "retrieval-ranking", name: "Retrieval fusion and ranking", question: "When do multilingual retrieval, fusion and reranking improve candidate recall and final ranking?" },
]);

const TEMPLATES = Object.freeze([
  {
    id: "sqlite-retrieval", name: "SQLite retrieval", dimension_id: "embedded-retrieval", default_watch_id: "sqlite-retrieval",
    intent: "Find embedded lexical/vector retrieval without requiring agent vocabulary.",
    query: '(cat:cs.IR OR cat:cs.DB OR cat:cs.CL) AND (all:sqlite OR all:"sqlite-vec" OR all:FTS5) AND (all:retrieval OR all:search)',
    positive_keywords: ["sqlite", "sqlite-vec", "fts5", "embedded retrieval", "local search"], negative_keywords: [],
  },
  {
    id: "dense-vector-indexing", name: "Dense vector indexing", dimension_id: "vector-indexing", default_watch_id: "dense-vector-indexing",
    intent: "Find dense candidate generation and coordinate/index methods for comparison with exact search.",
    query: '(cat:cs.IR OR cat:cs.DB OR cat:cs.LG) AND (abs:"dense vector retrieval" OR abs:"embedding index" OR abs:"coordinate-inverted" OR ti:"hypergraph embedding")',
    positive_keywords: ["dense vector retrieval", "embedding index", "coordinate-inverted", "hypergraph embedding", "candidate recall", "exact search"], negative_keywords: [],
  },
  {
    id: "governed-memory", name: "Governed memory lifecycle", dimension_id: "memory", default_watch_id: "governed-memory",
    intent: "Find verifiable memory lifecycle, temporal corrections, erasure and operational failure testing.",
    query: '(cat:cs.AI OR cat:cs.IR OR cat:cs.DB OR cat:cs.SE) AND (ti:memory OR abs:"agent memory") AND (abs:governed OR abs:"bi-temporal" OR abs:erasure OR abs:"verifiable memory" OR abs:"fault injection")',
    positive_keywords: ["governed", "bi-temporal", "erasure", "verifiable memory", "fault injection", "supersession", "memory lifecycle"], negative_keywords: [],
  },
  {
    id: "hybrid-retrieval-reranking", name: "Hybrid retrieval and scientific attribution", dimension_id: "retrieval-ranking", default_watch_id: "hybrid-retrieval-reranking",
    intent: "Find fusion, multilingual reranking, and scientific-source attribution; paper retrieval is not claim verification.",
    query: '(cat:cs.IR OR cat:cs.CL) AND (abs:"reciprocal rank fusion" OR abs:reranking OR abs:"hybrid retrieval") AND (abs:multilingual OR abs:"scientific sources" OR abs:BM25)',
    positive_keywords: ["reciprocal rank fusion", "reranking", "hybrid retrieval", "multilingual", "scientific sources", "bm25", "cross-language"], negative_keywords: [],
  },
  {
    id: "ai-memory-systems", name: "AI memory systems", dimension_id: "memory", default_watch_id: "agent-memory",
    intent: "Find working, long-term, consolidation, retrieval, and compression mechanisms for agent memory.",
    query: "(cat:cs.AI OR cat:cs.CL OR cat:cs.LG OR cat:cs.IR) AND (ti:memory OR abs:\"agent memory\" OR abs:\"working memory\" OR abs:\"long-term memory\" OR abs:\"memory consolidation\" OR abs:\"memory retrieval\" OR abs:\"context compression\")",
    positive_keywords: ["agent memory", "working memory", "long-term memory", "memory consolidation", "memory retrieval", "context compression", "provenance", "authority", "freshness", "supersession"], negative_keywords: [],
  },
  {
    id: "memory-safety-authority", name: "Memory safety and authority", dimension_id: "security", default_watch_id: "memory-safety-authority",
    intent: "Find memory poisoning, stale constraints, authority loss, privacy, and provenance failures.",
    query: "(cat:cs.AI OR cat:cs.CL OR cat:cs.CR) AND (abs:\"memory poisoning\" OR abs:\"authority collapse\" OR abs:\"stale memory\" OR abs:supersession OR abs:\"memory privacy\" OR abs:\"memory provenance\")",
    positive_keywords: ["memory poisoning", "authority", "stale", "supersession", "provenance", "privacy", "prompt injection"], negative_keywords: [],
  },
  {
    id: "agent-evidence-graphs", name: "Agent evidence graphs", dimension_id: "agent-graphs", default_watch_id: "agent-evidence-graphs",
    intent: "Find knowledge, evidence, memory, and execution graphs used by agents.",
    query: "(cat:cs.AI OR cat:cs.CL OR cat:cs.IR) AND (abs:\"memory graph\" OR abs:\"evidence graph\" OR abs:\"execution graph\" OR (abs:\"knowledge graph\" AND (abs:\"agent memory\" OR abs:\"agent reasoning\" OR abs:\"agent planning\" OR abs:\"tool-using agent\")))",
    positive_keywords: ["evidence graph", "memory graph", "knowledge graph", "execution graph", "provenance", "agent reasoning", "agent planning"], negative_keywords: [],
  },
  {
    id: "loop-engineering", name: "Agent loop engineering", dimension_id: "agent-loops", default_watch_id: "loop-engineering",
    intent: "Find execution-loop, harness, recovery, long-horizon, and validated self-improvement research.",
    query: "(cat:cs.AI OR cat:cs.CL OR cat:cs.SE) AND (abs:\"agent loop\" OR abs:\"execution loop\" OR abs:\"long-horizon\" OR abs:\"agent harness\" OR abs:\"self-improvement\" OR abs:\"failure recovery\")",
    positive_keywords: ["agent loop", "execution loop", "long-horizon", "agent harness", "self-improvement", "failure recovery"], negative_keywords: [],
  },
  {
    id: "agent-skills-procedural-memory", name: "Agent skills and procedural memory", dimension_id: "skills", default_watch_id: "agent-skills-procedural-memory",
    intent: "Find skill acquisition, procedural memory, skill libraries, routing, and tool-learning research.",
    query: "(cat:cs.AI OR cat:cs.CL OR cat:cs.LG) AND (ti:skill OR abs:\"skill library\" OR abs:\"procedural memory\" OR abs:\"skill learning\" OR abs:\"skill acquisition\" OR abs:\"tool learning\") AND (abs:agent OR ti:agent)",
    positive_keywords: ["skill", "procedural memory", "skill library", "skill learning", "skill routing", "tool learning", "agent"], negative_keywords: [],
  },
  {
    id: "context-engineering-efficiency", name: "Context engineering and efficiency", dimension_id: "context", default_watch_id: "context-efficiency",
    intent: "Find context selection, compression, caching, budgeting, and evidence-preserving techniques.",
    query: "(cat:cs.AI OR cat:cs.CL OR cat:cs.LG OR cat:cs.SE) AND (abs:\"context engineering\" OR abs:\"context compression\" OR abs:\"context selection\" OR abs:\"context caching\" OR abs:\"token budget\" OR abs:\"long context\")",
    positive_keywords: ["context engineering", "context compression", "context selection", "cache", "token budget", "retrieval"], negative_keywords: [],
  },
  {
    id: "agent-evaluation-reliability", name: "Agent evaluation and reliability", dimension_id: "evaluation", default_watch_id: "agent-evaluation",
    intent: "Find agent benchmarks, failure taxonomies, reliability, variance, and trajectory evaluation.",
    query: "(cat:cs.AI OR cat:cs.CL OR cat:cs.SE) AND (abs:\"agent evaluation\" OR abs:\"agent benchmark\" OR abs:\"failure taxonomy\" OR abs:\"trajectory evaluation\" OR abs:\"evaluation variance\" OR abs:\"agent reliability\")",
    positive_keywords: ["agent evaluation", "benchmark", "failure", "reliability", "variance", "trajectory", "regression"], negative_keywords: [],
  },
  {
    id: "mcp-tools-protocols", name: "MCP, tools, and agent protocols", dimension_id: "tools", default_watch_id: "tool-protocols",
    intent: "Find tool-use, protocol, interoperability, discovery, and Model Context Protocol research.",
    query: "(cat:cs.AI OR cat:cs.CL OR cat:cs.SE) AND (abs:\"model context protocol\" OR abs:\"tool use\" OR abs:\"tool discovery\" OR abs:\"agent protocol\" OR abs:\"agent interoperability\" OR abs:\"API orchestration\")",
    positive_keywords: ["model context protocol", "tool use", "tool discovery", "protocol", "interoperability", "api"], negative_keywords: [],
  },
  {
    id: "multi-agent-orchestration", name: "Multi-agent orchestration", dimension_id: "multi-agent", default_watch_id: "multi-agent-orchestration",
    intent: "Find delegation, coordination, communication, routing, and multi-agent evaluation.",
    query: "(cat:cs.AI OR cat:cs.CL OR cat:cs.MA) AND (abs:\"multi-agent\" OR abs:\"agent delegation\" OR abs:\"agent coordination\" OR abs:\"agent communication\" OR abs:\"agent routing\")",
    positive_keywords: ["multi-agent", "delegation", "coordination", "communication", "routing", "collaboration"], negative_keywords: [],
  },
  {
    id: "coding-agent-systems", name: "Coding-agent systems", dimension_id: "coding", default_watch_id: "coding-agent-systems",
    intent: "Find repository understanding, coding harnesses, code review, repair, and software-agent evaluation.",
    query: "(cat:cs.SE OR cat:cs.AI OR cat:cs.CL) AND (abs:\"coding agent\" OR abs:\"software engineering agent\" OR abs:\"repository understanding\" OR abs:\"automated code review\" OR abs:\"program repair\" OR abs:\"SWE-bench\")",
    positive_keywords: ["coding agent", "software engineering agent", "repository", "code review", "program repair", "swe-bench"], negative_keywords: [],
  },
  {
    id: "agent-security-containment", name: "Agent security and containment", dimension_id: "security", default_watch_id: "agent-security-containment",
    intent: "Find prompt injection, tool abuse, containment, trajectory safety, and capability-control research.",
    query: "(cat:cs.CR OR cat:cs.AI OR cat:cs.CL) AND (abs:\"prompt injection\" OR abs:\"agent security\" OR abs:\"agent containment\" OR abs:\"tool abuse\" OR abs:\"trajectory safety\" OR abs:\"capability control\")",
    positive_keywords: ["prompt injection", "agent security", "containment", "tool abuse", "trajectory", "capability control"], negative_keywords: [],
  },
  {
    id: "skill-evolution-persistent-knowledge", name: "Skill evolution and persistent knowledge", dimension_id: "skills", default_watch_id: "skill-evolution-persistent-knowledge",
    intent: "Find methods that accumulate agent experience into persistent knowledge and evolve reusable skills.",
    query: "(cat:cs.AI OR cat:cs.CL OR cat:cs.LG) AND ((ti:skill OR abs:\"agent skill\" OR abs:\"skill evolution\") AND (abs:\"persistent knowledge\" OR abs:\"knowledge accumulation\" OR abs:\"experience accumulation\" OR abs:\"procedural knowledge\" OR abs:\"skill evolution\"))",
    positive_keywords: ["agent skill", "skill evolution", "persistent knowledge", "knowledge accumulation", "experience accumulation", "procedural knowledge", "wiki"], negative_keywords: [],
  },
  {
    id: "empirical-agent-methods", name: "Empirical methods for agents", dimension_id: "evaluation", default_watch_id: "empirical-agent-methods",
    intent: "Find empirical analyses, controlled experiments, ablations, and evaluation methods for LLM agents and skills.",
    query: "(cat:cs.AI OR cat:cs.CL OR cat:cs.LG OR cat:cs.SE) AND (ti:empirical OR abs:\"empirical analysis\" OR abs:\"empirical method\" OR abs:\"controlled experiment\" OR abs:ablation) AND (abs:agent OR abs:\"language model\" OR ti:LLM)",
    positive_keywords: ["empirical analysis", "empirical method", "controlled experiment", "ablation", "evaluation", "benchmark", "agent", "language model"], negative_keywords: [],
  },
  {
    id: "agent-strategy-adaptation", name: "Agent strategy adaptation", dimension_id: "self-improvement", default_watch_id: "agent-strategy-adaptation",
    intent: "Find evidence about agents revising high-level strategies during execution, post-training, and self-improvement loops.",
    query: "(cat:cs.AI OR cat:cs.CL OR cat:cs.LG) AND (ti:\"post-training\" OR abs:\"post-training agent\" OR abs:\"strategy-level capability\" OR abs:\"strategy reevaluation\" OR abs:\"strategy adaptation\" OR abs:\"local adjustment\")",
    positive_keywords: ["post-training", "strategy-level capability", "strategy reevaluation", "strategy adaptation", "local adjustment", "self-improvement", "execution evidence"], negative_keywords: [],
  },
]);

const DIMENSION_IDS = new Set(DIMENSIONS.map((item) => item.id));
const TEMPLATE_BY_ID = new Map(TEMPLATES.map((item) => [item.id, item]));
const CATEGORY_BY_ID = new Map(ARXIV_CATEGORIES.map((item) => [item.id, item]));
const PHRASE_FIELDS = new Set(["all", "ti", "abs"]);
const SORT_BY = new Set(["relevance", "lastUpdatedDate", "submittedDate"]);
const SORT_ORDER = new Set(["ascending", "descending"]);

function clone(value) { return structuredClone(value); }
function publicCategory(category) {
  return {
    schema_version: CATEGORY_SCHEMA_VERSION,
    ...clone(category),
    api_query: `cat:${category.id}`,
    recent_list_url: `https://arxiv.org/list/${category.id}/recent`,
    default_sort_by: "submittedDate",
    default_sort_order: "descending",
    default_max_results: 20,
    authority: "candidate-only",
    content_trust: "catalog-authored",
    instruction_authority: "none",
  };
}
function publicTemplate(template) {
  return { schema_version: TEMPLATE_SCHEMA_VERSION, ...clone(template), authority: "candidate-only", content_trust: "catalog-authored", instruction_authority: "none", default_sort_by: "submittedDate", default_sort_order: "descending", default_max_results: 20 };
}
function templateById(id) {
  const template = TEMPLATE_BY_ID.get(String(id || ""));
  if (!template) throw new Error(`Unknown research template: ${id}`);
  return template;
}
function categoryById(id) {
  const category = CATEGORY_BY_ID.get(String(id || ""));
  if (!category) throw new Error(`Unknown arXiv category: ${id}`);
  return category;
}
function parseDate(value, label) {
  if (value == null) return null;
  const raw = String(value);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`${label} must be a valid YYYY-MM-DD date`);
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.toISOString().slice(0, 10) !== raw) throw new Error(`${label} must be a valid YYYY-MM-DD date`);
  return raw.replaceAll("-", "");
}
function literalPhrase(value) {
  const phrase = String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim();
  if (phrase.length < 2 || phrase.length > 100 || !/^[\p{L}\p{N}\s._+/#-]+$/u.test(phrase)) throw new Error("Refinements must be literal phrases without query operators or delimiters");
  return phrase;
}
function phraseClause(values, field) {
  const phrases = [...new Set((values || []).map(literalPhrase))];
  if (phrases.length > 8) throw new Error("At most 8 literal phrases are allowed per refinement");
  return phrases.length ? `(${phrases.map((phrase) => `${field}:\"${phrase}\"`).join(" OR ")})` : null;
}

export function researchDimensions() {
  return DIMENSIONS.map((item) => ({ schema_version: TAXONOMY_SCHEMA_VERSION, ...clone(item) }));
}

export function arxivCategoryCatalog({ monitoringTier = null } = {}) {
  if (monitoringTier && !["core", "adjacent"].includes(monitoringTier)) throw new Error(`Unknown monitoring tier: ${monitoringTier}`);
  return ARXIV_CATEGORIES.filter((item) => !monitoringTier || item.monitoring_tier === monitoringTier).map(publicCategory);
}

export function researchTemplates({ dimensionId = null } = {}) {
  if (dimensionId && !DIMENSION_IDS.has(dimensionId)) throw new Error(`Unknown research dimension: ${dimensionId}`);
  return TEMPLATES.filter((item) => !dimensionId || item.dimension_id === dimensionId).map(publicTemplate);
}

export function compileResearchTemplate({ templateId, since = null, until = null, includePhrases = [], excludePhrases = [], phraseField = "all", start: pageStart = 0, maxResults = 20, sortBy = "submittedDate", sortOrder = "descending" } = {}) {
  const template = templateById(templateId);
  if (!PHRASE_FIELDS.has(phraseField)) throw new Error(`Unsupported phrase field: ${phraseField}`);
  if (!Number.isInteger(pageStart) || pageStart < 0 || pageStart > 30_000) throw new Error("start must be 0-30000");
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 200) throw new Error("maxResults must be 1-200");
  if (!SORT_BY.has(sortBy)) throw new Error(`Unsupported sortBy: ${sortBy}`);
  if (!SORT_ORDER.has(sortOrder)) throw new Error(`Unsupported sortOrder: ${sortOrder}`);
  const dateStart = parseDate(since, "since") || "19910101";
  const dateEnd = parseDate(until, "until") || new Date().toISOString().slice(0, 10).replaceAll("-", "");
  if (dateStart > dateEnd) throw new Error("since date must not be later than until date");
  const clauses = [`(${template.query})`];
  if (since || until) clauses.push(`submittedDate:[${dateStart}0000 TO ${dateEnd}2359]`);
  const include = phraseClause(includePhrases, phraseField);
  const exclude = phraseClause(excludePhrases, phraseField);
  if (include) clauses.push(include);
  let query = clauses.join(" AND ");
  if (exclude) query += ` ANDNOT ${exclude}`;
  if (query.length > 500) throw new Error("Compiled query exceeds the 500-character DWIN contract limit");
  const request = { query, start: pageStart, maxResults, sortBy, sortOrder };
  return {
    schema_version: "dwin.arxiv-search-plan/v1", template: publicTemplate(template), query, request,
    request_url: buildArxivUrl(request).toString(), source: "arxiv-api", endpoint_domain: "export.arxiv.org",
    authority: "candidate-only", content_trust: "untrusted-external", instruction_authority: "none",
  };
}

export async function searchResearchTemplate(options, { fetcher = fetchArxivPage, store = null, ttlSeconds = 86_400, now = new Date().toISOString() } = {}) {
  const plan = compileResearchTemplate(options);
  const search = await cachedArxivSearch(plan.request, { fetcher, store, ttlSeconds, now });
  return { schema_version: "dwin.arxiv-template-search-result/v1", template_id: plan.template.id, query: plan.query, request_url: plan.request_url, source: "arxiv-api", content_trust: "untrusted-external", instruction_authority: "none", authority: "candidate-only", cache: search.cache, metadata: search.metadata, papers: search.papers };
}

export function compileCategorySearch({ categoryId, since = null, until = null, includePhrases = [], excludePhrases = [], phraseField = "all", start: pageStart = 0, maxResults = 20, sortBy = "submittedDate", sortOrder = "descending" } = {}) {
  const category = categoryById(categoryId);
  if (!PHRASE_FIELDS.has(phraseField)) throw new Error(`Unsupported phrase field: ${phraseField}`);
  if (!Number.isInteger(pageStart) || pageStart < 0 || pageStart > 30_000) throw new Error("start must be 0-30000");
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 200) throw new Error("maxResults must be 1-200");
  if (!SORT_BY.has(sortBy)) throw new Error(`Unsupported sortBy: ${sortBy}`);
  if (!SORT_ORDER.has(sortOrder)) throw new Error(`Unsupported sortOrder: ${sortOrder}`);
  const dateStart = parseDate(since, "since") || "19910101";
  const dateEnd = parseDate(until, "until") || new Date().toISOString().slice(0, 10).replaceAll("-", "");
  if (dateStart > dateEnd) throw new Error("since date must not be later than until date");
  const clauses = [`cat:${category.id}`];
  if (since || until) clauses.push(`submittedDate:[${dateStart}0000 TO ${dateEnd}2359]`);
  const include = phraseClause(includePhrases, phraseField);
  const exclude = phraseClause(excludePhrases, phraseField);
  if (include) clauses.push(include);
  let query = clauses.join(" AND ");
  if (exclude) query += ` ANDNOT ${exclude}`;
  if (query.length > 500) throw new Error("Compiled query exceeds the 500-character DWIN contract limit");
  const request = { query, start: pageStart, maxResults, sortBy, sortOrder };
  return {
    schema_version: "dwin.arxiv-category-search-plan/v1",
    category: publicCategory(category), query, request,
    request_url: buildArxivUrl(request).toString(), source: "arxiv-api", endpoint_domain: "export.arxiv.org",
    authority: "candidate-only", content_trust: "untrusted-external", instruction_authority: "none",
  };
}

export async function searchArxivCategory(options, { fetcher = fetchArxivPage, store = null, ttlSeconds = 86_400, now = new Date().toISOString() } = {}) {
  const plan = compileCategorySearch(options);
  const search = await cachedArxivSearch(plan.request, { fetcher, store, ttlSeconds, now });
  return {
    schema_version: "dwin.arxiv-category-search-result/v1", category_id: plan.category.id, query: plan.query,
    request_url: plan.request_url, source: "arxiv-api", content_trust: "untrusted-external",
    instruction_authority: "none", authority: "candidate-only", cache: search.cache,
    metadata: search.metadata, papers: search.papers,
  };
}

function normalizeProblem(value) {
  return String(value || "").normalize("NFKC").toLocaleLowerCase("en").replace(/[^\p{L}\p{N}+#./-]+/gu, " ").trim();
}

const ROUTE_ALIASES = Object.freeze({
  memory: ["memory", "remember", "retrieval", "consolidation", "памят", "контекст"],
  "agent-graphs": ["graph", "provenance", "relationship", "граф", "связ"],
  "agent-loops": ["loop", "recovery", "long-horizon", "цикл", "повтор"],
  skills: ["skill", "procedure", "experience", "скилл", "навык"],
  context: ["context", "compression", "cache", "token", "контекст", "токен"],
  evaluation: ["eval", "evaluation", "empirical", "benchmark", "experiment", "оцен", "эмпир", "эксперимент"],
  tools: ["tool", "mcp", "protocol", "api", "инструмент", "протокол"],
  "multi-agent": ["multi-agent", "delegation", "coordination", "мультиагент", "делег"],
  coding: ["coding", "repository", "software", "code", "код", "репозитор"],
  security: ["security", "injection", "poisoning", "safety", "безопас", "инъекц"],
  "self-improvement": ["self-improvement", "strategy", "adaptation", "post-training", "стратег", "самоулучш"],
  "embedded-retrieval": ["sqlite", "sqlite-vec", "fts5", "embedded retrieval"],
  "vector-indexing": ["indexing", "embedding", "dense", "hypergraph", "candidate recall"],
  "retrieval-ranking": ["retrieval", "reranking", "reranker", "fusion", "rrf", "bm25", "multilingual", "cross-language"],
});
const RU_STEMS = Object.freeze({ memory: ["памят"], "agent-graphs": ["граф", "связ"], "agent-loops": ["цикл", "повтор"], skills: ["скилл", "навык"], context: ["контекст", "токен"], evaluation: ["оцен", "эмпир", "эксперимент"], tools: ["инструмент", "протокол"], "multi-agent": ["мультиагент", "делег"], coding: ["код", "репозитор"], security: ["безопас", "инъекц"], "self-improvement": ["стратег", "самоулучш"], "vector-indexing": ["индекс", "эмбеддинг"], "retrieval-ranking": ["переранж", "мультиязыч", "поиск"] });

export function routeResearchProblem(problem, { dimensionId = null, limit = 3 } = {}) {
  const normalized = normalizeProblem(problem);
  if (normalized.length < 2) throw new Error("Research problem must contain at least two searchable characters");
  if (dimensionId && !DIMENSION_IDS.has(dimensionId)) throw new Error(`Unknown research dimension: ${dimensionId}`);
  if (!Number.isInteger(limit) || limit < 1 || limit > 5) throw new Error("route limit must be 1-5");
  const problemTokens = new Set(normalized.match(/[\p{L}\p{N}+#./-]{2,}/gu) || []);
  const candidates = TEMPLATES.filter((template) => !dimensionId || template.dimension_id === dimensionId).map((template) => {
    const dimension = DIMENSIONS.find((item) => item.id === template.dimension_id);
    const terms = [...new Set([
      ...(template.positive_keywords || []),
      ...(ROUTE_ALIASES[template.dimension_id] || []),
      template.id.replaceAll("-", " "),
      template.name,
      dimension?.name || "",
    ].map(normalizeProblem).filter(Boolean))];
    const reasons = [];
    let score = 0;
    for (const term of terms) {
      const termTokens = term.match(/[\p{L}\p{N}+#./-]{2,}/gu) || [];
      if (term.length >= 3 && (` ${normalized} `).includes(` ${term} `)) {
        const points = Math.min(12, 3 + termTokens.length * 2);
        score += points;
        reasons.push({ match: term, type: "phrase", points });
        continue;
      }
      const overlap = termTokens.filter((token) => problemTokens.has(token)).length;
      if (overlap) {
        const points = Math.min(4, overlap);
        score += points;
        reasons.push({ match: term, type: "token-overlap", points });
      }
    }
    for (const stem of RU_STEMS[template.dimension_id] || []) {
      if ([...problemTokens].some((token) => /^[а-яё]+$/u.test(token) && token.startsWith(stem))) {
        score += 5; reasons.push({ match: stem, type: "explicit-ru-stem", points: 5 });
      }
    }
    return { template_id: template.id, template_name: template.name, dimension_id: template.dimension_id, score, reasons: reasons.sort((a, b) => b.points - a.points || a.match.localeCompare(b.match)).slice(0, 8) };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.template_id.localeCompare(b.template_id)).slice(0, limit);
  return {
    schema_version: "dwin.research-route/v1",
    method: "deterministic-token-boundary-routing/v2",
    problem: String(problem).trim(),
    requested_dimension_id: dimensionId,
    routes: candidates,
    fallback: candidates.length ? null : "No lexical route matched. Select a dimension explicitly or inspect the template catalog.",
  };
}

export function activateResearchTemplate(templateId, { watchId = null, enabled = true, replaceExisting = false } = {}, suppliedStore = null) {
  const template = templateById(templateId);
  const id = watchId || template.default_watch_id || template.id;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || id.length > 64) throw new Error("watchId must be lower-case hyphen-case and at most 64 characters");
  const store = suppliedStore || new RadarStore();
  try {
    const desired = { id, name: template.name, query: template.query, category: null, positive_keywords: template.positive_keywords, negative_keywords: template.negative_keywords, enabled: Boolean(enabled) };
    const existing = store.watches().find((watch) => watch.id === id);
    const unchanged = existing && existing.name === desired.name && existing.query === desired.query && existing.category === desired.category && existing.enabled === desired.enabled
      && JSON.stringify(existing.positive_keywords) === JSON.stringify(desired.positive_keywords) && JSON.stringify(existing.negative_keywords) === JSON.stringify(desired.negative_keywords);
    if (existing && !unchanged && !replaceExisting) return { schema_version: "dwin.research-template-activation/v1", template_id: template.id, watch: existing, changed: false, conflict: true, proposed_watch: desired, network_request_performed: false, next_effect: "none; inspect drift and explicitly replace existing watch if intended" };
    const watch = unchanged ? existing : store.upsertWatch(desired);
    return { schema_version: "dwin.research-template-activation/v1", template_id: template.id, watch, changed: !unchanged, network_request_performed: false, next_effect: "future radar_sync runs" };
  } finally { if (!suppliedStore) store.close(); }
}

export function researchWatchDrift(suppliedStore = null) {
  const store = suppliedStore || new RadarStore();
  try {
    const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const fields = ["name", "category", "query", "positive_keywords", "negative_keywords"];
    return store.watches().map((watch) => {
      const template = TEMPLATES.find((item) => item.default_watch_id === watch.id);
      const desired = template ? { ...template, category: null } : null;
      const changedFields = template ? fields.filter((field) => JSON.stringify(watch[field]) !== JSON.stringify(desired[field])) : [];
      return { watch_id: watch.id, enabled: watch.enabled, template_id: template?.id || null, state: !template ? "custom" : changedFields.length ? "drift" : "aligned", changed_fields: changedFields, watch_fingerprint: digest(fields.map((field) => watch[field])), catalog_fingerprint: template ? digest(fields.map((field) => desired[field])) : null, automatic_replacement: false };
    });
  } finally { if (!suppliedStore) store.close(); }
}
