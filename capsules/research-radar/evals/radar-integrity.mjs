import { readFileSync } from "node:fs";
import { join } from "node:path";
import { arxivCategoryCatalog, researchDimensions, researchTemplates } from "../lib/templates.mjs";

const report = JSON.parse(readFileSync(join(process.env.DWIN_RUN_OUTPUT || "", "research-sync-report.json"), "utf8"));
const serialized = JSON.stringify(report);
const dimensions = researchDimensions();
const templates = researchTemplates();
const categories = arxivCategoryCatalog();
const checks = [
  { id: "source-arxiv", passed: report.source === "arxiv-api" && report.endpoint_domain === "export.arxiv.org" },
  { id: "bounded-progress-or-honest-idle", passed: report.queries_attempted <= 3 && report.queries_failed === 0 && report.queries_succeeded === report.queries_attempted },
  { id: "coverage-is-explicit-not-recall", passed: ["partial", "bounded-observed-exhausted"].includes(report.coverage?.status) && Array.isArray(report.coverage?.limitations) },
  { id: "all-discovered-papers-have-inbox", passed: report.coverage?.counts?.queued_papers === report.coverage?.counts?.papers },
  { id: "stale-fallback-not-completion", passed: report.pages.every((page) => page.cache_status !== "stale-fallback" || page.status === "partial") },
  { id: "candidate-authority", passed: report.authority === "candidate-only" },
  { id: "untrusted-content", passed: report.content_trust === "untrusted-external" },
  { id: "bounded-report", passed: Buffer.byteLength(serialized) < 100_000 },
  { id: "no-paper-content-in-receipt", passed: !Object.hasOwn(report, "papers") && !Object.hasOwn(report, "abstracts") },
  { id: "template-catalog-bounded", passed: dimensions.length >= 8 && templates.length >= 10 && templates.every((item) => item.query.length <= 500) },
  { id: "template-candidate-authority", passed: templates.every((item) => item.authority === "candidate-only" && item.instruction_authority === "none") },
  { id: "category-catalog-exact", passed: JSON.stringify(categories.map((item) => item.id)) === JSON.stringify(["cs.AI", "cs.IR", "cs.DB", "cs.DS", "cs.LG", "cs.MA", "stat.ML"]) },
  { id: "category-core-tier", passed: JSON.stringify(categories.filter((item) => item.monitoring_tier === "core").map((item) => item.id)) === JSON.stringify(["cs.MA", "stat.ML"]) },
  { id: "category-candidate-authority", passed: categories.every((item) => item.authority === "candidate-only" && item.instruction_authority === "none") },
];
const result = { passed: checks.every((check) => check.passed), checks };
process.stdout.write(`${JSON.stringify(result)}\n`);
if (!result.passed) process.exitCode = 1;
