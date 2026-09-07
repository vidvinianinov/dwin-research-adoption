import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_HASH, POLICY, RUNTIME, runtimeStatus } from "./store.mjs";

function run(command, args, { timeoutMs = 280_000 } = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"], env: { PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8", HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", HF_HUB_DISABLE_TELEMETRY: "1", DOCLING_ARTIFACTS_PATH: join(RUNTIME, "models") } });
    let stdout = "", stderr = "", timedOut = false;
    const cap = text => text.length > 20_000 ? text.slice(-20_000) : text;
    child.stdout.on("data", chunk => { stdout = cap(stdout + chunk); }); child.stderr.on("data", chunk => { stderr = cap(stderr + chunk); });
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    child.on("error", error => { clearTimeout(timer); resolve({ ok: false, code: null, stdout, stderr: `${stderr}\n${error.message}`.trim(), timed_out: timedOut }); });
    child.on("close", code => { clearTimeout(timer); resolve({ ok: code === 0 && !timedOut, code, stdout, stderr, timed_out: timedOut }); });
  });
}

export async function extractDocument(source, stagingRoot) {
  const python = join(RUNTIME, "venv", "bin", "python"), models = join(RUNTIME, "models");
  const runtime = runtimeStatus(RUNTIME, { verify_artifacts: true });
  if (!runtime.ready || !existsSync(python) || !existsSync(models)) throw new Error(`DOCLING_RUNTIME_NOT_PROVISIONED: ${runtime.reason}`);
  mkdirSync(stagingRoot, { recursive: true, mode: 0o700 });
  const output = join(stagingRoot, `${source.id}-${source.source_sha256}.json`), script = new URL("../scripts/extract_docling.py", import.meta.url).pathname;
  const result = await run(python, [script, "--source-id", source.id, "--input", source.path, "--output", output, "--artifacts", models, "--config-hash", CONFIG_HASH, "--model-hash", runtime.manifest.model_tree_sha256, "--max-pages", String(POLICY.max_pages), "--max-file-bytes", String(POLICY.max_file_bytes)]);
  if (!result.ok) throw new Error(`DOCLING_EXTRACTION_FAILED: ${result.timed_out ? "timeout" : result.stderr || `exit ${result.code}`}`);
  if (!existsSync(output)) throw new Error("DOCLING_OUTPUT_MISSING");
  const bytes = readFileSync(output); if (bytes.length > 100 * 1024 * 1024) throw new Error("DOCLING_OUTPUT_TOO_LARGE");
  try { return JSON.parse(bytes.toString("utf8")); } finally { unlinkSync(output); }
}
