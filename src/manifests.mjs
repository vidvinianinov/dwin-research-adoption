import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import Ajv from "ajv";
import { CAPSULES_DIR, CONTRACTS_DIR, POLICY_PATH } from "./paths.mjs";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const capsuleSchema = readJson(join(CONTRACTS_DIR, "capsule.schema.json"));
const receiptSchema = readJson(join(CONTRACTS_DIR, "receipt.schema.json"));
const ajv = new Ajv({ allErrors: true, strict: true });
const validateCapsuleSchema = ajv.compile(capsuleSchema);
const validateReceiptSchema = ajv.compile(receiptSchema);

export function loadPolicy() {
  return readJson(POLICY_PATH);
}

export function safeChild(root, child) {
  const rootPath = resolve(root);
  const childPath = resolve(root, child);
  if (childPath !== rootPath && !childPath.startsWith(`${rootPath}/`)) {
    throw new Error(`Path escapes capsule root: ${child}`);
  }
  return childPath;
}

export function loadCapsule(capsuleId) {
  const capsuleRoot = safeChild(CAPSULES_DIR, capsuleId);
  const manifestPath = join(capsuleRoot, "capsule.json");
  if (!existsSync(manifestPath)) throw new Error(`Unknown capsule: ${capsuleId}`);
  const manifest = readJson(manifestPath);
  if (!validateCapsuleSchema(manifest)) {
    throw new Error(`Invalid capsule ${capsuleId}: ${ajv.errorsText(validateCapsuleSchema.errors, { separator: "; " })}`);
  }
  if (manifest.id !== capsuleId) throw new Error(`Capsule directory/id mismatch: ${capsuleId} != ${manifest.id}`);
  for (const item of [...manifest.jobs, ...manifest.evaluators]) {
    const script = safeChild(capsuleRoot, item.script);
    if (!existsSync(script)) throw new Error(`Missing capsule script: ${relative(capsuleRoot, script)}`);
  }
  return { manifest, capsuleRoot, manifestPath };
}

export function admitCapsule(manifest, trigger, policy = loadPolicy()) {
  const errors = [];
  if (!policy.allowed_triggers.includes(trigger)) errors.push(`Trigger is not allowed: ${trigger}`);
  const domains = manifest.capabilities.allowed_domains || [];
  if (manifest.capabilities.network) {
    if (domains.length === 0) errors.push("Networked capsules require allowed_domains");
    for (const domain of domains) {
      if (!policy.allowed_network_domains?.includes(domain)) errors.push(`Network domain is not allowed by policy: ${domain}`);
    }
  } else if (domains.length > 0) {
    errors.push("Network-disabled capsules cannot declare allowed_domains");
  }
  for (const item of [...manifest.jobs, ...manifest.evaluators]) {
    if (item.timeout_seconds > policy.max_timeout_seconds) errors.push(`${item.id} exceeds timeout policy`);
  }
  if (policy.require_evaluators && manifest.evaluators.length === 0) errors.push("At least one evaluator is required");
  return { admitted: errors.length === 0, errors, policy_version: policy.schema_version };
}

export function validateAll() {
  const results = [];
  const entries = readdirSync(CAPSULES_DIR, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  for (const entry of entries) {
    try {
      const { manifest } = loadCapsule(entry.name);
      const admission = admitCapsule(manifest, "manual");
      results.push({ capsule_id: entry.name, valid: admission.admitted, errors: admission.errors });
    } catch (error) {
      results.push({ capsule_id: entry.name, valid: false, errors: [error.message] });
    }
  }
  return {
    valid: results.length > 0 && results.every((result) => result.valid),
    capsule_count: results.length,
    capsules: results,
  };
}

export function assertReceipt(receipt) {
  if (!validateReceiptSchema(receipt)) {
    throw new Error(`Invalid receipt: ${ajv.errorsText(validateReceiptSchema.errors, { separator: "; " })}`);
  }
  return receipt;
}
