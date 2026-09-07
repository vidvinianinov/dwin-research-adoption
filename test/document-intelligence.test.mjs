import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, ""), data = mkdtempSync(join(tmpdir(), "dwin-document-test-"));
process.env.DWIN_FACTORY_ROOT = root; process.env.DWIN_FACTORY_DATA = data;
const { CONFIG_HASH, DocumentStore, POLICY, registerSource, sha } = await import("../capsules/document-intelligence/lib/store.mjs");

function snapshot(source) {
  const provenance = [{ page_no: 1, bbox: { l: 1, t: 2, r: 3, b: 4, coord_origin: "BOTTOMLEFT" }, charspan: [0, 17] }], text = "Grounded evidence";
  return { schema_version: "dwin.document-snapshot/v1", source_id: source.id, source_sha256: source.source_sha256, source_bytes: source.source_bytes, parser: "docling", parser_version: POLICY.parser_version, parser_config_hash: CONFIG_HASH, model_artifacts_hash: "0".repeat(64), page_count: 1, blocks: [{ id: sha(`${source.source_sha256}:0:text:${sha(text)}`), ordinal: 0, label: "text", text, text_sha256: sha(text), level: 1, provenance }], markdown: "# Grounded evidence\n", docling_document: { schema_name: "DoclingDocument" } };
}

test("registers only explicit regular PDF files", () => {
  const file = join(data, "fixture.pdf"); writeFileSync(file, "%PDF-1.4\nfixture\n");
  assert.equal(registerSource("fixture", file).registered, true);
  assert.throws(() => registerSource("bad", join(data, "missing.pdf")), /does not exist/);
  const text = join(data, "fixture.txt"); writeFileSync(text, "no"); assert.throws(() => registerSource("bad", text), /Unsupported/);
});

test("stores, searches, reopens and detects changed sources", () => {
  const file = join(data, "indexed.pdf"), bytes = Buffer.from("%PDF-1.4\nsource\n"); writeFileSync(file, bytes);
  registerSource("indexed", file); const source = { id: "indexed", path: file, source_sha256: sha(bytes), source_bytes: bytes.length };
  const store = new DocumentStore();
  try {
    store.save(snapshot(source), source);
    assert.equal(store.search({ query: "grounded" }).results.length, 1);
    const block = store.blocks({ source_id: "indexed" }).blocks[0];
    assert.equal(store.reopen({ block_id: block.id }).live.status, "LIVE_VERIFIED");
    writeFileSync(file, "%PDF-1.4\nchanged\n");
    assert.equal(store.reopen({ block_id: block.id }).live.status, "SOURCE_CHANGED");
    assert.equal(store.integrity().passed, true);
  } finally { store.close(); }
});

test("rejects forged text hashes", () => {
  const file = join(data, "forged.pdf"), bytes = Buffer.from("%PDF-1.4\nforged\n"); writeFileSync(file, bytes);
  const source = { id: "forged", path: file, source_sha256: sha(bytes), source_bytes: bytes.length }, forged = snapshot(source); forged.blocks[0].text_sha256 = "0".repeat(64);
  const store = new DocumentStore(join(data, "forged-store")); try { assert.throws(() => store.save(forged, source), /Block integrity/); } finally { store.close(); }
});
