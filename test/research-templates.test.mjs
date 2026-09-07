import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const testRoot = mkdtempSync(join(tmpdir(), "dwin-research-templates-"));
process.env.DWIN_FACTORY_DATA = join(testRoot, "factory-data");
process.env.DWIN_ARXIV_FIXTURE = join(root, "test", "fixtures", "research-radar", "arxiv-sample.xml");

const { RadarStore } = await import("../capsules/research-radar/lib/db.mjs");
const { fetchArxiv } = await import("../capsules/research-radar/lib/arxiv.mjs");
const {
  activateResearchTemplate,
  arxivCategoryCatalog,
  compileCategorySearch,
  compileResearchTemplate,
  researchDimensions,
  researchTemplates,
  routeResearchProblem,
  searchArxivCategory,
  searchResearchTemplate,
} = await import("../capsules/research-radar/lib/templates.mjs");

test("publishes the selected recent-feed categories as a versioned, schema-valid catalog", () => {
  const categories = arxivCategoryCatalog();
  assert.deepEqual(categories.map((item) => item.id), ["cs.AI", "cs.IR", "cs.DB", "cs.DS", "cs.LG", "cs.MA", "stat.ML"]);
  assert.deepEqual(arxivCategoryCatalog({ monitoringTier: "core" }).map((item) => item.id), ["cs.MA", "stat.ML"]);
  assert.ok(categories.every((item) => item.api_query === `cat:${item.id}`));
  assert.ok(categories.every((item) => item.recent_list_url === `https://arxiv.org/list/${item.id}/recent`));
  const schema = JSON.parse(readFileSync(join(root, "capsules", "research-radar", "contracts", "arxiv-category.schema.json"), "utf8"));
  const ajv = new Ajv({ strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  assert.ok(categories.every((item) => validate(item)), JSON.stringify(validate.errors));
});

test("classifies a bounded AI research space into versioned dimensions and templates", () => {
  const dimensions = researchDimensions();
  const templates = researchTemplates();
  assert.ok(dimensions.length >= 8);
  assert.ok(templates.length >= 10);
  assert.equal(new Set(dimensions.map((item) => item.id)).size, dimensions.length);
  assert.equal(new Set(templates.map((item) => item.id)).size, templates.length);
  assert.ok(templates.every((item) => dimensions.some((dimension) => dimension.id === item.dimension_id)));
  assert.ok(templates.every((item) => item.query.length <= 500 && item.instruction_authority === "none"));
  assert.ok(researchTemplates({ dimensionId: "memory" }).some((item) => item.id === "ai-memory-systems"));
  assert.ok(templates.some((item) => item.id === "loop-engineering"));
  assert.ok(templates.some((item) => item.id === "agent-skills-procedural-memory"));
  assert.ok(templates.some((item) => item.id === "skill-evolution-persistent-knowledge"));
  assert.ok(templates.some((item) => item.id === "empirical-agent-methods"));
  assert.ok(templates.some((item) => item.id === "agent-strategy-adaptation"));
  const schema = JSON.parse(readFileSync(join(root, "capsules", "research-radar", "contracts", "search-template.schema.json"), "utf8"));
  const validate = new Ajv({ strict: true }).compile(schema);
  assert.ok(templates.every((item) => validate(item)), JSON.stringify(validate.errors));
});

test("keeps the four supplied papers as explicitly post-hoc mechanism-template regressions", () => {
  const regression = JSON.parse(readFileSync(join(root, "capsules", "research-radar", "evals", "discovery-known-items.json"), "utf8"));
  assert.equal(regression.method.startsWith("Post-hoc"), true);
  assert.deepEqual(regression.cases.map((item) => item.expected_arxiv_id), ["2608.24060", "2608.22980", "2608.08253", "2607.24803"]);
  for (const item of regression.cases) {
    const template = researchTemplates().find((candidate) => candidate.id === item.template_id);
    assert.ok(template, item.template_id);
    assert.equal(item.observed_rank_2026_08_31, 1);
  }
  assert.ok(regression.limitations.some((item) => item.includes("independently judged")));
});

test("routes skill-evolution and post-training problems to inspectable templates", () => {
  const skillRoute = routeResearchProblem("persistent knowledge compiled from agent experience for skill evolution", { limit: 3 });
  assert.equal(skillRoute.routes[0].template_id, "skill-evolution-persistent-knowledge");
  assert.ok(skillRoute.routes[0].reasons.length > 0);
  const strategyRoute = routeResearchProblem("empirical post-training agent strategy reevaluation during execution", { limit: 3 });
  assert.ok(strategyRoute.routes.some((route) => route.template_id === "agent-strategy-adaptation"));
  assert.ok(strategyRoute.routes.some((route) => route.template_id === "empirical-agent-methods"));
});

test("records the fixed retrieval cases and a schema-valid live evidence result", () => {
  const cases = JSON.parse(readFileSync(join(root, "capsules", "research-radar", "evals", "retrieval-cases.json"), "utf8"));
  assert.equal(cases.cases.length, 2);
  assert.ok(cases.requirements.some((item) => item.startsWith("[critical]")));
  const schema = JSON.parse(readFileSync(join(root, "capsules", "research-radar", "contracts", "retrieval-eval.schema.json"), "utf8"));
  const evidence = {
    schema_version: "dwin.research-retrieval-eval/v1",
    evaluated_at: "2026-09-06T00:00:00.000Z",
    source: "arxiv-api",
    cases: cases.cases.map(item => ({ case_id: item.id, expected_arxiv_id: item.expected_arxiv_id, template_id: item.template_id, found: true, rank: 1, returned: 1, first_call: { cache: "miss" }, second_call: { cache: "hit" } })),
    summary: { critical_pass: true, recall_at_page: 1, cache_hit_rate_on_repeat: 1 },
    limitations: ["Sanitized schema fixture; live retrieval quality is evaluated separately."]
  };
  const ajv = new Ajv({ strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  assert.equal(validate(evidence), true, JSON.stringify(validate.errors));
  assert.equal(evidence.summary.critical_pass, true);
});

test("compiles dates and literal refinements into an inspectable official API request", () => {
  const plan = compileResearchTemplate({
    templateId: "ai-memory-systems",
    since: "2026-08-01",
    until: "2026-08-30",
    includePhrases: ["authority preservation", "supersession"],
    excludePhrases: ["human memory"],
    phraseField: "abs",
    maxResults: 20,
    sortBy: "submittedDate",
    sortOrder: "descending",
  });
  assert.match(plan.query, /submittedDate:\[202608010000 TO 202608302359\]/);
  assert.match(plan.query, /abs:"authority preservation"/);
  assert.match(plan.query, /ANDNOT \(abs:"human memory"\)/);
  assert.equal(new URL(plan.request_url).hostname, "export.arxiv.org");
  assert.equal(plan.request.maxResults, 20);
  assert.equal(plan.request.start, 0);
  assert.equal(plan.authority, "candidate-only");
});

test("compiles and executes bounded category searches without conflating category with relevance", async () => {
  const plan = compileCategorySearch({
    categoryId: "cs.MA",
    since: "2026-09-01",
    until: "2026-09-05",
    includePhrases: ["agent coordination"],
    maxResults: 5,
  });
  assert.match(plan.query, /^cat:cs\.MA AND submittedDate:/);
  assert.match(plan.query, /all:"agent coordination"/);
  assert.equal(plan.category.monitoring_tier, "core");
  assert.equal(plan.authority, "candidate-only");
  const searched = await searchArxivCategory({ categoryId: "stat.ML", maxResults: 5 }, { fetcher: fetchArxiv });
  assert.equal(searched.category_id, "stat.ML");
  assert.equal(searched.papers.length, 3);
  assert.ok(searched.papers.every((paper) => paper.content_trust === "untrusted-external"));
});

test("rejects query-language injection and malformed dates in literal refinements", () => {
  assert.throws(() => compileResearchTemplate({ templateId: "ai-memory-systems", includePhrases: ['memory" OR all:malware'] }), /literal/);
  assert.throws(() => compileResearchTemplate({ templateId: "ai-memory-systems", since: "2026-02-30" }), /date/);
  assert.throws(() => compileResearchTemplate({ templateId: "missing-template" }), /Unknown research template/);
  assert.throws(() => compileCategorySearch({ categoryId: "cs.CV" }), /Unknown arXiv category/);
  assert.throws(() => compileCategorySearch({ categoryId: "cs.AI", includePhrases: ['agent" OR cat:cs.CR'] }), /literal/);
});

test("executes a template through the bounded official arXiv adapter", async () => {
  const result = await searchResearchTemplate({ templateId: "loop-engineering", maxResults: 5 }, { fetcher: fetchArxiv });
  assert.equal(result.source, "arxiv-api");
  assert.equal(result.template_id, "loop-engineering");
  assert.equal(result.papers.length, 3);
  assert.equal(result.cache.status, "miss");
  assert.ok(result.papers.every((paper) => paper.content_trust === "untrusted-external"));
});

test("activates a template as an idempotent local daily watch without a network call", () => {
  const store = new RadarStore(join(testRoot, "activation.sqlite"));
  try {
    const first = activateResearchTemplate("agent-skills-procedural-memory", { enabled: true }, store);
    const second = activateResearchTemplate("agent-skills-procedural-memory", { enabled: true }, store);
    assert.equal(first.watch.id, "agent-skills-procedural-memory");
    assert.deepEqual(second.watch, first.watch);
    assert.equal(store.watches().filter((watch) => watch.id === first.watch.id).length, 1);
    assert.match(first.watch.query, /procedural memory/);
    assert.equal(first.network_request_performed, false);
  } finally { store.close(); }
});
