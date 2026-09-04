import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadGoalRunnerConfig, resolveGoalRunner } from "../execution-plan/goal-runners.mjs";

test("Goal runner config is a private closed allowlist for local and SSH targets", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "goal-runners-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "runners.json");
  const config = {
    schema: "pi-ticket-planning:goal-runner-config:v1",
    runners: [
      { ref: "local", transport: "local", host: "workstation.local", sshHost: null, runnerCli: "/runner/goal.js", runnerConfig: "/private/local.json" },
      { ref: "mac-mini", transport: "ssh", host: "mac-mini.local", sshHost: "mac-mini", runnerCli: "/runner/goal.js", runnerConfig: "/private/remote.json" },
    ],
  };
  fs.writeFileSync(file, `${JSON.stringify(config)}\n`, { mode: 0o600 });
  const loaded = loadGoalRunnerConfig(file);
  assert.equal(resolveGoalRunner(loaded, { channel: "GOAL_LOCAL", runnerRef: "local" }).transport, "local");
  assert.equal(resolveGoalRunner(loaded, { channel: "GOAL_REMOTE", runnerRef: "mac-mini" }).sshHost, "mac-mini");
  assert.throws(() => resolveGoalRunner(loaded, { channel: "GOAL_REMOTE", runnerRef: "attacker.example" }), /GOAL_RUNNER_UNCONFIGURED/);
  assert.throws(() => resolveGoalRunner(loaded, { channel: "GOAL_REMOTE", runnerRef: "local" }), /GOAL_REMOTE_RUNNER_INVALID/);
  fs.chmodSync(file, 0o644);
  assert.throws(() => loadGoalRunnerConfig(file), /MUST_BE_PRIVATE/);
});
