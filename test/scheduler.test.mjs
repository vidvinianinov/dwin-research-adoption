import test from "node:test";
import assert from "node:assert/strict";
import { launchAgentXml, SCHEDULER_LABEL } from "../src/scheduler.mjs";

test("launchd schedule is deterministic, bounded, escaped and contains no shell", () => {
  const value = launchAgentXml({ nodePath: "/usr/local/bin/node", cliPath: "/opt/dwin/bin/dwin.mjs", factoryRoot: "/opt/dwin", factoryData: "/tmp/dwin & data", hour: 9, minute: 15 });
  assert.match(value, new RegExp(SCHEDULER_LABEL.replaceAll(".", "\\.")));
  assert.match(value, /<key>Hour<\/key><integer>9<\/integer>/);
  assert.match(value, /<key>Minute<\/key><integer>15<\/integer>/);
  assert.match(value, /\/tmp\/dwin &amp; data/);
  assert.doesNotMatch(value, /<key>KeepAlive<\/key>|sh -c|bash -c/);
  assert.throws(() => launchAgentXml({ nodePath: "/node", cliPath: "/cli", hour: 24, minute: 0 }));
  assert.throws(() => launchAgentXml({ nodePath: "node", cliPath: "/cli" }), /absolute/);
});
