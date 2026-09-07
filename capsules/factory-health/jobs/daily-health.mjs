import { accessSync, constants, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const factoryRoot = process.env.DWIN_FACTORY_ROOT;
const outputRoot = process.env.DWIN_RUN_OUTPUT;
if (!factoryRoot || !outputRoot) throw new Error("Factory runtime environment is incomplete");

const checks = [];
function check(id, fn) {
  try {
    const details = fn();
    checks.push({ id, passed: true, details: details ?? null });
  } catch (error) {
    checks.push({ id, passed: false, details: error.message });
  }
}

check("node-runtime", () => {
  const recommended = readFileSync(join(factoryRoot, ".nvmrc"), "utf8").trim();
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 20 || (major === 20 && minor < 19)) throw new Error(`Expected Node >=20.19.0, received ${process.versions.node}`);
  return { current: process.versions.node, recommended };
});
check("contracts-present", () => {
  for (const name of ["capsule.schema.json", "receipt.schema.json"]) JSON.parse(readFileSync(join(factoryRoot, "contracts", name), "utf8"));
  return 2;
});
check("policy-present", () => JSON.parse(readFileSync(join(factoryRoot, "policies", "default.json"), "utf8")).schema_version);
check("capsule-inventory", () => {
  const ids = readdirSync(join(factoryRoot, "capsules"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  if (ids.length === 0) throw new Error("No capsules installed");
  return ids;
});
check("output-writable", () => {
  mkdirSync(outputRoot, { recursive: true });
  accessSync(outputRoot, constants.W_OK);
  return true;
});

const report = {
  schema_version: "dwin.health/v1",
  run_id: process.env.DWIN_RUN_ID,
  checked_at: new Date().toISOString(),
  passed: checks.every((item) => item.passed),
  checks,
};
writeFileSync(join(outputRoot, "health.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ passed: report.passed, checks: checks.length })}\n`);
if (!report.passed) process.exitCode = 1;
