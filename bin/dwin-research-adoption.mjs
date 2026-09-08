#!/usr/bin/env node
import { validateAll } from "../src/manifests.mjs";
import { fileURLToPath } from "node:url";

const command = process.argv[2] || "serve";

if (command === "serve") {
  await import("../src/unified-server.mjs");
} else if (command === "validate") {
  const report = validateAll();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.valid) process.exitCode = 1;
} else if (command === "doctor") {
  const report = validateAll();
  process.stdout.write(`${JSON.stringify({
    schema_version: "dwin.doctor/v1",
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    capsules: report.capsule_count,
    valid: report.valid,
    storage: process.env.DWIN_FACTORY_DATA ? "operator-configured" : "default-private-application-data",
    network_policy: "deny-by-default-with-arxiv-and-loopback-allowlist"
  }, null, 2)}\n`);
  if (!report.valid) process.exitCode = 1;
} else if (command === "config") {
  process.stdout.write(`${JSON.stringify({
    mcpServers: {
      "dwin-research-adoption": {
        command: "npx",
        args: ["-y", "dwin-research-adoption@0.2.0"]
      }
    }
  }, null, 2)}\n`);
} else if (command === "daily") {
  const { runDaily } = await import("../src/executor.mjs");
  const receipts = await runDaily({ trigger: "manual" });
  const status = receipts.every(item => item.status === "ACCEPTED") ? "ACCEPTED" : "REJECTED";
  process.stdout.write(`${JSON.stringify({ schema_version: "dwin.daily-run/v1", status, runs: receipts.map(item => ({ run_id: item.run_id, capsule_id: item.capsule_id, job_id: item.job_id, status: item.status })) }, null, 2)}\n`);
  if (status !== "ACCEPTED") process.exitCode = 1;
} else if (command === "setup-register") {
  const [id, path] = process.argv.slice(3); if (!id || !path) throw new Error("Usage: dwin-research-adoption setup-register <id> <absolute-path>");
  const { registerRoot } = await import("../capsules/setup-intelligence/lib/store.mjs"); process.stdout.write(`${JSON.stringify(registerRoot(id, path), null, 2)}\n`);
} else if (command === "document-register") {
  const [id, path] = process.argv.slice(3); if (!id || !path) throw new Error("Usage: dwin-research-adoption document-register <id> <absolute-pdf-path>");
  const { registerSource } = await import("../capsules/document-intelligence/lib/store.mjs"); process.stdout.write(`${JSON.stringify(registerSource(id, path), null, 2)}\n`);
} else if (command === "evidence-register") {
  const [id, path] = process.argv.slice(3); if (!id || !path) throw new Error("Usage: dwin-research-adoption evidence-register <id> <absolute-file-or-directory>");
  const { registerSource } = await import("../capsules/evidence-graph/lib/store.mjs"); process.stdout.write(`${JSON.stringify(registerSource(id, path), null, 2)}\n`);
} else if (command === "document-provision") {
  await import("../capsules/document-intelligence/scripts/provision-docling.mjs");
} else if (command === "embedding-provision") {
  await import("../capsules/evidence-graph/scripts/download-model.mjs");
} else if (command === "schedule") {
  const action = process.argv[3] || "status", { installSchedule, removeSchedule, scheduleStatus } = await import("../src/scheduler.mjs"); let value;
  if (action === "status") value = scheduleStatus();
  else if (action === "install") { const hour = process.argv[4] === undefined ? 8 : Number(process.argv[4]), minute = process.argv[5] === undefined ? 0 : Number(process.argv[5]); value = installSchedule({ cliPath: fileURLToPath(import.meta.url), hour, minute }); }
  else if (action === "remove") value = removeSchedule();
  else throw new Error("Usage: dwin-research-adoption schedule [status|install [hour minute]|remove]");
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
} else {
  process.stderr.write(`Unknown command: ${command}. Use serve, doctor, validate, config, daily, setup-register, document-register, evidence-register, document-provision, embedding-provision, or schedule.\n`);
  process.exitCode = 2;
}
