import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const FACTORY_DATA = resolve(
  process.env.DWIN_FACTORY_DATA || join(homedir(), "Library", "Application Support", "DWIN Factory"),
);
export const RADAR_DATA = join(FACTORY_DATA, "capsules", "research-radar");
export const RADAR_DB = join(RADAR_DATA, "research.sqlite");
export const ARXIV_ENDPOINT = "https://export.arxiv.org/api/query";
export const ARXIV_FIXTURE = process.env.DWIN_ARXIV_FIXTURE || null;

export function ensureRadarData() {
  mkdirSync(RADAR_DATA, { recursive: true, mode: 0o700 });
}
