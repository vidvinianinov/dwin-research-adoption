import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

test("registry and npm identities stay aligned", () => {
  const pkg = read("../package.json");
  const server = read("../server.json");
  assert.equal(pkg.mcpName, server.name);
  assert.equal(pkg.name, server.packages[0].identifier);
  assert.equal(pkg.version, server.version);
  assert.equal(server.packages[0].transport.type, "stdio");
});

test("skills-only plugin contains exactly the public skill pack", () => {
  const plugin = read("../.codex-plugin/plugin.json");
  const catalog = read("../skills.sh.json");
  assert.equal(plugin.skills, "./skills/");
  assert.equal(plugin.mcpServers, undefined);
  assert.deepEqual(catalog.groupings[0].skills, ["triage-ai-research", "adopt-research-into-setup", "review-evidence-and-memory"]);
});

test("runtime policy is deny by default and narrowly allowlisted", () => {
  const policy = read("../policies/default.json");
  assert.equal(policy.default_network, "deny");
  assert.deepEqual(policy.allowed_network_domains.sort(), ["127.0.0.1", "arxiv.org", "export.arxiv.org"]);
});
