import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pack = JSON.parse(readFileSync(new URL("../marketplace-test-pack.json", import.meta.url), "utf8"));
assert.equal(pack.schema_version, "dwin.marketplace-test-pack/v1");
assert.equal(pack.positive.length, 5, "OpenAI review pack requires five positive tests");
assert.equal(pack.negative.length, 3, "OpenAI review pack requires three negative tests");
for (const item of [...pack.positive, ...pack.negative]) {
  assert.match(item.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.ok(item.prompt.length >= 20);
  assert.ok(item.expected.length >= 2);
}
process.stdout.write(`${JSON.stringify({ passed: true, positive: 5, negative: 3 })}\n`);
