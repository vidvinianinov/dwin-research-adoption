import { spawn } from "node:child_process";

export function runNodeScript(script, { cwd, env = {}, timeoutSeconds = 60, maxOutputBytes = 1_048_576 } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [script], {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH || "/usr/bin:/bin",
        TMPDIR: process.env.TMPDIR || "/tmp",
        LANG: process.env.LANG || "en_US.UTF-8",
        ...env,
      },
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let overflow = false;
    let timedOut = false;

    const append = (current, chunk) => {
      const next = Buffer.concat([current, chunk]);
      if (next.length > maxOutputBytes) {
        overflow = true;
        child.kill("SIGKILL");
        return next.subarray(0, maxOutputBytes);
      }
      return next;
    };

    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutSeconds * 1000);

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, code: null, stdout: stdout.toString("utf8"), stderr: `${stderr.toString("utf8")}\n${error.message}`.trim(), duration_ms: Date.now() - started, timed_out: timedOut, output_overflow: overflow });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0 && !timedOut && !overflow, code, stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8"), duration_ms: Date.now() - started, timed_out: timedOut, output_overflow: overflow });
    });
  });
}
