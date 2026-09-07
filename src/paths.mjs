import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const moduleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function defaultDataRoot() {
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "DWIN Research Adoption");
  if (process.platform === "win32") return join(process.env.LOCALAPPDATA || homedir(), "DWIN Research Adoption");
  return join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "dwin-research-adoption");
}

export const FACTORY_ROOT = resolve(process.env.DWIN_FACTORY_ROOT || moduleRoot);
export const FACTORY_DATA = resolve(
  process.env.DWIN_FACTORY_DATA || defaultDataRoot(),
);
export const CAPSULES_DIR = join(FACTORY_ROOT, "capsules");
export const CONTRACTS_DIR = join(FACTORY_ROOT, "contracts");
export const POLICY_PATH = join(FACTORY_ROOT, "policies", "default.json");
export const DB_PATH = join(FACTORY_DATA, "factory.sqlite");
export const EVENTS_PATH = join(FACTORY_DATA, "events.jsonl");
export const RUNS_DIR = join(FACTORY_DATA, "runs");
export const RECEIPTS_DIR = join(FACTORY_DATA, "receipts");
export const LOGS_DIR = join(FACTORY_DATA, "logs");

export function ensureDataDirectories() {
  for (const path of [FACTORY_DATA, RUNS_DIR, RECEIPTS_DIR, LOGS_DIR]) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
  }
}
