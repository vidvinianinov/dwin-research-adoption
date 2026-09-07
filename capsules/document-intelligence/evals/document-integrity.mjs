import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.env.DWIN_RUN_OUTPUT || "", fixturePath = join(root, "document-fixture-evaluation.json"), extractionPath = join(root, "document-extraction-report.json");
let checks;
if (existsSync(fixturePath)) {
  const report = JSON.parse(readFileSync(fixturePath, "utf8"));
  checks = [
    { id: "schema", passed: report.schema_version === "dwin.document-fixture-evaluation/v1" },
    { id: "pinned-parser", passed: report.observed.parser === report.expected.parser && report.observed.parser_version === report.expected.parser_version && report.observed.parser_config_hash === report.expected.parser_config_hash && /^[a-f0-9]{64}$/.test(report.observed.model_artifacts_hash) },
    { id: "source-bound-blocks", passed: report.observed.page_count === 1 && report.observed.block_count >= 4 && report.integrity.passed === true },
    { id: "layout-content", passed: report.observed.markdown_contains_title && report.observed.markdown_contains_table_terms && report.observed.markdown_contains_formula_token },
    { id: "retrieval", passed: report.observed.search_hits > 0 },
    { id: "offline-no-authority", passed: report.network_requests === 0 && report.instruction_authority === "none" && report.authority === "parsed-evidence-candidate-only" },
    { id: "private", passed: report.privacy === "local-private-no-export" && !JSON.stringify(report).includes("/Users/") },
  ];
} else if (existsSync(extractionPath)) {
  const report = JSON.parse(readFileSync(extractionPath, "utf8"));
  checks = [
    { id: "schema", passed: report.schema_version === "dwin.document-extraction-report/v1" },
    { id: "bounded", passed: report.processed.length <= 1 && report.processed.every(item => item.page_count > 0 && item.page_count <= 64 && item.block_count > 0 && item.block_count <= 20000 && item.extraction_duration_ms >= 0 && /^[a-f0-9]{64}$/.test(item.model_artifacts_hash)) },
    { id: "integrity", passed: report.integrity.passed === true },
    { id: "offline-no-authority", passed: report.network_requests === 0 && report.instruction_authority === "none" && report.authority === "parsed-evidence-candidate-only" },
    { id: "private", passed: report.privacy === "local-private-no-export" && !JSON.stringify(report).includes("/Users/") },
  ];
} else throw new Error("No document report artifact found");
const result = { passed: checks.every(check => check.passed), checks };
process.stdout.write(`${JSON.stringify(result)}\n`); if (!result.passed) process.exitCode = 1;
