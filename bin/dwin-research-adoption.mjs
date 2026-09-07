#!/usr/bin/env node
import { validateAll } from "../src/manifests.mjs";

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
        args: ["-y", "dwin-research-adoption@0.1.0"]
      }
    }
  }, null, 2)}\n`);
} else {
  process.stderr.write(`Unknown command: ${command}. Use serve, doctor, validate, or config.\n`);
  process.exitCode = 2;
}
