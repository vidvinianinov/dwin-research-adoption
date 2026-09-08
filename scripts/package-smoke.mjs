import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sandbox = mkdtempSync(join(tmpdir(), "dwin-package-smoke-"));
let archive = null;

function run(command, args, cwd = sandbox) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
  return result.stdout;
}

try {
  const packed = JSON.parse(run("npm", ["pack", "--json", "--ignore-scripts"], root))[0];
  archive = join(root, packed.filename);
  writeFileSync(join(sandbox, "package.json"), `${JSON.stringify({ name: "dwin-package-smoke", private: true, type: "module" })}\n`);
  run("npm", ["install", archive]);
  const bin = join(sandbox, "node_modules", ".bin", "dwin-research-adoption");
  const doctor = JSON.parse(run(bin, ["doctor"]));
  assert.equal(doctor.valid, true);
  assert.equal(doctor.capsules, 7);
  const data = join(sandbox, "data");
  const client = new Client({ name: "dwin-packed-smoke", version: "0.1.0" }, { capabilities: {} });
  let serverError = "";
  try {
    const transport = new StdioClientTransport({ command: bin, env: { ...process.env, DWIN_FACTORY_DATA: data }, stderr: "pipe" });
    transport.stderr?.on("data", chunk => { serverError += chunk.toString(); });
    await client.connect(transport);
    transport.stderr?.on("data", chunk => { serverError += chunk.toString(); });
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 38);
    const memory = await client.callTool({ name: "memory_status", arguments: {} });
    assert.equal(memory.structuredContent.promotion_gate, "explicit-human-approval");
  } catch (error) {
    throw new Error(`${error.message}\nPacked server stderr:\n${serverError}`);
  } finally {
    await client.close();
  }
  process.stdout.write(`${JSON.stringify({ passed: true, archive: basename(archive), packed_files: packed.entryCount, packed_bytes: packed.size, tools: 38 })}\n`);
} finally {
  if (archive) rmSync(archive, { force: true });
  rmSync(sandbox, { recursive: true, force: true });
}
