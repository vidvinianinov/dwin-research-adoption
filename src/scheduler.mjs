import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { FACTORY_DATA, FACTORY_ROOT, LOGS_DIR, ensureDataDirectories } from "./paths.mjs";

export const SCHEDULER_LABEL = "io.github.vidvinianinov.dwin-research-adoption.daily";
export const launchAgentPath = () => join(homedir(), "Library", "LaunchAgents", `${SCHEDULER_LABEL}.plist`);
const xml = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");

export function launchAgentXml({ nodePath, cliPath, factoryRoot = FACTORY_ROOT, factoryData = FACTORY_DATA, hour = 8, minute = 0 }) {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) throw new Error("Schedule hour/minute is outside 00:00-23:59");
  for (const value of [nodePath, cliPath, factoryRoot, factoryData]) if (!isAbsolute(value)) throw new Error("Scheduler paths must be absolute");
  const stdout = join(factoryData, "logs", "daily.stdout.log"), stderr = join(factoryData, "logs", "daily.stderr.log");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${SCHEDULER_LABEL}</string>
  <key>ProgramArguments</key><array><string>${xml(nodePath)}</string><string>${xml(cliPath)}</string><string>daily</string></array>
  <key>WorkingDirectory</key><string>${xml(factoryRoot)}</string>
  <key>EnvironmentVariables</key><dict><key>DWIN_FACTORY_ROOT</key><string>${xml(factoryRoot)}</string><key>DWIN_FACTORY_DATA</key><string>${xml(factoryData)}</string></dict>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>${minute}</integer></dict>
  <key>ProcessType</key><string>Background</string>
  <key>LowPriorityIO</key><true/><key>ThrottleInterval</key><integer>300</integer>
  <key>StandardOutPath</key><string>${xml(stdout)}</string><key>StandardErrorPath</key><string>${xml(stderr)}</string>
</dict></plist>
`;
}

function launchctl(args, { allowFailure = false } = {}) {
  try { return execFileSync("/bin/launchctl", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
  catch (error) { if (allowFailure) return null; throw new Error(`launchctl ${args[0]} failed: ${(error.stderr || error.message).toString().trim()}`); }
}

export function scheduleStatus() {
  if (process.platform !== "darwin") return { schema_version: "dwin.scheduler-status/v1", supported: false, installed: false, platform: process.platform, label: SCHEDULER_LABEL };
  const path = launchAgentPath(), domain = `gui/${process.getuid()}`;
  const loaded = Boolean(launchctl(["print", `${domain}/${SCHEDULER_LABEL}`], { allowFailure: true }));
  let configured = null; if (existsSync(path)) { const value = readFileSync(path, "utf8"); const hour = value.match(/<key>Hour<\/key><integer>(\d+)<\/integer>/)?.[1], minute = value.match(/<key>Minute<\/key><integer>(\d+)<\/integer>/)?.[1]; if (hour !== undefined && minute !== undefined) configured = { hour: Number(hour), minute: Number(minute) }; }
  return { schema_version: "dwin.scheduler-status/v1", supported: true, installed: existsSync(path), loaded, platform: process.platform, label: SCHEDULER_LABEL, configured, plist: path };
}

export function installSchedule({ cliPath, hour = 8, minute = 0 }) {
  if (process.platform !== "darwin") throw new Error("Automatic scheduler installation currently supports macOS launchd only");
  const canonicalCli = resolve(cliPath); if (canonicalCli.includes("/_npx/")) throw new Error("EPHEMERAL_PACKAGE_PATH: install the package globally or use a stable checkout before scheduling");
  ensureDataDirectories(); mkdirSync(dirname(launchAgentPath()), { recursive: true, mode: 0o700 }); mkdirSync(LOGS_DIR, { recursive: true, mode: 0o700 });
  const content = launchAgentXml({ nodePath: process.execPath, cliPath: canonicalCli, hour, minute }); writeFileSync(launchAgentPath(), content, { mode: 0o600 }); chmodSync(launchAgentPath(), 0o600);
  const domain = `gui/${process.getuid()}`; launchctl(["bootout", `${domain}/${SCHEDULER_LABEL}`], { allowFailure: true }); launchctl(["bootstrap", domain, launchAgentPath()]);
  return scheduleStatus();
}

export function removeSchedule() {
  if (process.platform !== "darwin") throw new Error("Automatic scheduler removal currently supports macOS launchd only");
  const path = launchAgentPath(), domain = `gui/${process.getuid()}`; launchctl(["bootout", `${domain}/${SCHEDULER_LABEL}`], { allowFailure: true }); if (existsSync(path)) unlinkSync(path);
  return scheduleStatus();
}
