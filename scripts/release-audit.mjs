import assert from "node:assert/strict";
import { lstatSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const root = new URL("../", import.meta.url);
const packed = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
if (packed.status !== 0) throw new Error(packed.stderr || "npm pack dry-run failed");
const report = JSON.parse(packed.stdout)[0];
const files = report.files.map(item => item.path).sort();
const required = ["LICENSE", "README.md", "SECURITY.md", "server.json", ".codex-plugin/plugin.json", "marketplace-test-pack.json"];
for (const file of required) assert.ok(files.includes(file), `missing packaged file ${file}`);

const forbidden = [
  { id: "personal-path", pattern: /(?:\/Users\/[A-Za-z0-9._-]+|[A-Za-z]:\\Users\\[^\s"']+)/i },
  { id: "private-location", pattern: /(?:Telegram Desktop|\/Downloads\/|Documents\/New project)/i },
  { id: "employer-or-finance", pattern: /\b(?:amazon|buildsimple|build simple|cibc|alona)\b/i },
  { id: "work-codename", pattern: /\b(?:rya|aria)\b/i },
  { id: "private-key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { id: "service-secret", pattern: /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[oprsu]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b/ }
];

const findings = [];
for (const file of files) {
  const url = new URL(file, root);
  if (lstatSync(url).isSymbolicLink()) findings.push({ file, id: "symlink" });
  if (file === "scripts/release-audit.mjs") continue;
  let text;
  try { text = readFileSync(url, "utf8"); } catch { continue; }
  for (const rule of forbidden) if (rule.pattern.test(text)) findings.push({ file, id: rule.id });
}

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const server = JSON.parse(readFileSync(new URL("../server.json", import.meta.url), "utf8"));
assert.equal(pkg.private, undefined);
assert.equal(pkg.license, "Apache-2.0");
assert.equal(pkg.mcpName, server.name);
assert.equal(pkg.version, server.version);
assert.equal(pkg.name, server.packages[0].identifier);
assert.equal(pkg.version, server.packages[0].version);
assert.deepEqual(findings, []);
process.stdout.write(`${JSON.stringify({ passed: true, package_files: files.length, package_bytes: report.size, findings: 0 })}\n`);
