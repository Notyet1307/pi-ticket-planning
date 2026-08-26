import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function evidencePath() {
  const requested = path.resolve(process.env.PTP_TIMEOUT_PROBE_EVIDENCE ?? "");
  const file = path.join(fs.realpathSync(path.dirname(requested)), path.basename(requested));
  const cwd = fs.realpathSync(process.cwd());
  const relative = path.relative(cwd, file);
  if (!process.env.PTP_TIMEOUT_PROBE_EVIDENCE || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("TIMEOUT_PROBE_PATH_INVALID");
  return file;
}

function write(file, value) {
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, file);
}

export default function capabilityTimeoutProbe(pi) {
  pi.registerTool({
    name: "ptp_timeout_probe",
    label: "ptp_timeout_probe",
    description: "Run the controlled cancellation child used only by the active Capability probe.",
    parameters: { type: "object", additionalProperties: false },
    async execute(_id, _params, signal) {
      const file = evidencePath();
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      const startedAt = new Date().toISOString();
      write(file, { version: 1, parentPid: process.pid, childPid: child.pid, startedAt, aborted: false, childExited: false });
      const kill = () => { if (child.exitCode === null && !child.killed) child.kill("SIGTERM"); };
      process.once("exit", kill);
      return new Promise((resolve, reject) => {
        const abort = () => kill();
        signal?.addEventListener("abort", abort, { once: true });
        child.once("close", (code, processSignal) => {
          signal?.removeEventListener("abort", abort);
          process.removeListener("exit", kill);
          const aborted = signal?.aborted === true;
          write(file, { version: 1, parentPid: process.pid, childPid: child.pid, startedAt, aborted, childExited: true, exitCode: code, processSignal });
          if (aborted) reject(new Error("CONTROLLED_TIMEOUT_PROBE_ABORTED"));
          else resolve({ content: [{ type: "text", text: "CONTROLLED_TIMEOUT_PROBE_COMPLETED_UNEXPECTEDLY" }] });
        });
      });
    },
  });
}
