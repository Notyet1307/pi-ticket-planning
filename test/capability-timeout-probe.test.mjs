import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import capabilityTimeoutProbe from "../extensions/capability-timeout-probe.mjs";

test("controlled timeout tool aborts and reaps its child process", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-timeout-tool-"));
  const previousCwd = process.cwd();
  const previousEvidence = process.env.PTP_TIMEOUT_PROBE_EVIDENCE;
  t.after(() => {
    process.chdir(previousCwd);
    if (previousEvidence === undefined) delete process.env.PTP_TIMEOUT_PROBE_EVIDENCE;
    else process.env.PTP_TIMEOUT_PROBE_EVIDENCE = previousEvidence;
    fs.rmSync(directory, { recursive: true, force: true });
  });
  process.chdir(directory);
  process.env.PTP_TIMEOUT_PROBE_EVIDENCE = path.join(directory, "evidence.json");
  let tool;
  capabilityTimeoutProbe({ registerTool(value) { tool = value; } });
  const controller = new AbortController();
  const running = tool.execute("probe", {}, controller.signal);
  for (let attempt = 0; attempt < 100 && !fs.existsSync(process.env.PTP_TIMEOUT_PROBE_EVIDENCE); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(fs.existsSync(process.env.PTP_TIMEOUT_PROBE_EVIDENCE), true);
  controller.abort();
  await assert.rejects(running, /CONTROLLED_TIMEOUT_PROBE_ABORTED/);
  const receipt = JSON.parse(fs.readFileSync(process.env.PTP_TIMEOUT_PROBE_EVIDENCE, "utf8"));
  assert.equal(receipt.aborted, true);
  assert.equal(receipt.childExited, true);
  assert.throws(() => process.kill(receipt.childPid, 0));
});
