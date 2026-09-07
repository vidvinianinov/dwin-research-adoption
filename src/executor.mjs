import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { FactoryLedger } from "./db.mjs";
import { describeArtifacts, hashTree, sha256 } from "./hash.mjs";
import { admitCapsule, assertReceipt, loadCapsule, loadPolicy, safeChild } from "./manifests.mjs";
import { FACTORY_DATA, RECEIPTS_DIR, RUNS_DIR, ensureDataDirectories } from "./paths.mjs";
import { runNodeScript } from "./process.mjs";

function clipped(value, limit = 4000) {
  return value.length <= limit ? value : `${value.slice(0, limit)}\n…clipped`;
}

function parseEvaluatorOutput(stdout) {
  const value = stdout.trim();
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return { message: clipped(value) };
  }
}

export async function runCapsule(capsuleId, jobId, { trigger = "manual", ledger: suppliedLedger } = {}) {
  ensureDataDirectories();
  const ledger = suppliedLedger || new FactoryLedger();
  const shouldClose = !suppliedLedger;
  const startedAt = new Date().toISOString();
  const runId = `run_${startedAt.replace(/[-:.TZ]/g, "")}_${randomUUID().slice(0, 8)}`;
  let receiptPath = null;

  try {
    const { manifest, capsuleRoot } = loadCapsule(capsuleId);
    const policy = loadPolicy();
    const admission = admitCapsule(manifest, trigger, policy);
    if (!admission.admitted) throw new Error(`Capsule admission failed: ${admission.errors.join("; ")}`);
    const job = manifest.jobs.find((item) => item.id === jobId);
    if (!job) throw new Error(`Unknown job ${jobId} in capsule ${capsuleId}`);
    const sourceHash = hashTree(capsuleRoot);
    const runRoot = join(RUNS_DIR, runId);
    const outputRoot = join(runRoot, "output");
    mkdirSync(outputRoot, { recursive: true, mode: 0o700 });

    ledger.createRun({ id: runId, capsule_id: manifest.id, capsule_version: manifest.version, job_id: job.id, trigger, source_hash: sourceHash, started_at: startedAt });
    ledger.recordEvent(runId, "RUN_STARTED", { capsule_id: manifest.id, job_id: job.id, trigger, source_hash: sourceHash });

    const sharedEnv = {
      DWIN_FACTORY_ROOT: capsuleRoot.replace(/\/capsules\/[^/]+$/, ""),
      DWIN_FACTORY_DATA: FACTORY_DATA,
      DWIN_CAPSULE_ROOT: capsuleRoot,
      DWIN_RUN_ID: runId,
      DWIN_RUN_OUTPUT: outputRoot,
      // The child process receives only the bounded factory env and a sanitized
      // arXiv fixture override used by deterministic tests.
      ...(process.env.DWIN_ARXIV_FIXTURE
        ? { DWIN_ARXIV_FIXTURE: process.env.DWIN_ARXIV_FIXTURE }
        : {}),
    };
    const jobResult = await runNodeScript(safeChild(capsuleRoot, job.script), {
      cwd: capsuleRoot,
      env: sharedEnv,
      timeoutSeconds: job.timeout_seconds,
      maxOutputBytes: policy.max_output_bytes,
    });
    ledger.recordEvent(runId, "JOB_FINISHED", { ok: jobResult.ok, code: jobResult.code, duration_ms: jobResult.duration_ms, timed_out: jobResult.timed_out, output_overflow: jobResult.output_overflow, stderr: clipped(jobResult.stderr) });

    const artifacts = describeArtifacts(outputRoot);
    ledger.recordArtifacts(runId, artifacts);
    ledger.recordEvent(runId, "ARTIFACTS_HASHED", { count: artifacts.length, hashes: artifacts.map((artifact) => artifact.sha256) });

    const evaluations = [];
    if (jobResult.ok) {
      for (const evaluator of manifest.evaluators) {
        const result = await runNodeScript(safeChild(capsuleRoot, evaluator.script), {
          cwd: capsuleRoot,
          env: sharedEnv,
          timeoutSeconds: evaluator.timeout_seconds,
          maxOutputBytes: policy.max_output_bytes,
        });
        const details = { ...parseEvaluatorOutput(result.stdout), stderr: clipped(result.stderr), code: result.code, timed_out: result.timed_out, output_overflow: result.output_overflow };
        const evaluation = { evaluator_id: evaluator.id, status: result.ok ? "PASS" : "FAIL", duration_ms: result.duration_ms, details };
        evaluations.push(evaluation);
        ledger.recordEvaluation(runId, evaluation);
        ledger.recordEvent(runId, "EVALUATOR_FINISHED", evaluation);
      }
    }

    const accepted = jobResult.ok && artifacts.length > 0 && evaluations.length === manifest.evaluators.length && evaluations.every((evaluation) => evaluation.status === "PASS");
    const status = accepted ? "ACCEPTED" : "REJECTED";
    const finishedAt = new Date().toISOString();
    const receipt = assertReceipt({
      schema_version: "dwin.run-receipt/v1",
      run_id: runId,
      capsule_id: manifest.id,
      capsule_version: manifest.version,
      job_id: job.id,
      trigger,
      status,
      started_at: startedAt,
      finished_at: finishedAt,
      source_hash: sourceHash,
      artifacts,
      evaluations,
      policy: {
        schema_version: policy.schema_version,
        network: manifest.capabilities.network,
        allowed_domains: manifest.capabilities.allowed_domains || [],
        write_scope: manifest.capabilities.write_scope,
        enforcement: manifest.capabilities.network
          ? "manifest-admission-fixed-application-endpoint-and-limited-process-environment"
          : "manifest-admission-and-limited-process-environment"
      },
    });
    receiptPath = join(RECEIPTS_DIR, `${runId}.json`);
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    ledger.finishRun(runId, status, receiptPath, accepted ? null : clipped(jobResult.stderr || "Evaluator or artifact gate failed"));
    ledger.recordEvent(runId, "RUN_FINISHED", { status, receipt_sha256: sha256(JSON.stringify(receipt)) });
    return receipt;
  } catch (error) {
    const existing = ledger.getRun(runId);
    if (existing) {
      ledger.finishRun(runId, "ERROR", receiptPath, clipped(error.message));
      ledger.recordEvent(runId, "RUN_ERRORED", { error: clipped(error.message) });
    }
    throw error;
  } finally {
    if (shouldClose) ledger.close();
  }
}

export async function runDaily({ trigger = "manual" } = {}) {
  const { readdirSync } = await import("node:fs");
  const { CAPSULES_DIR } = await import("./paths.mjs");
  const policy = loadPolicy(), order = new Map((policy.daily_capsule_order || []).map((id, index) => [id, index]));
  const work = readdirSync(CAPSULES_DIR, { withFileTypes: true }).filter(item => item.isDirectory()).flatMap(entry => { const { manifest } = loadCapsule(entry.name); return manifest.jobs.filter(job => job.schedule === "daily").map(job => ({ capsule_id: manifest.id, job_id: job.id })); }).sort((a, b) => (order.get(a.capsule_id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.capsule_id) ?? Number.MAX_SAFE_INTEGER) || a.capsule_id.localeCompare(b.capsule_id, "en") || a.job_id.localeCompare(b.job_id, "en"));
  const receipts = [];
  for (const item of work) receipts.push(await runCapsule(item.capsule_id, item.job_id, { trigger }));
  return receipts;
}
