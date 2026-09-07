import { readFileSync } from "node:fs";
import { join } from "node:path";

const path = join(process.env.DWIN_RUN_OUTPUT || "", "health.json");
const report = JSON.parse(readFileSync(path, "utf8"));
const failed = report.checks.filter((item) => !item.passed);
const result = { passed: report.passed && failed.length === 0, failed_checks: failed.map((item) => item.id), total_checks: report.checks.length };
process.stdout.write(`${JSON.stringify(result)}\n`);
if (!result.passed) process.exitCode = 1;
