import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applyGoalHandoff,
  buildGoalHandoff,
  goalHandoffFingerprint,
  verifyGoalHandoffExactReadback,
} from "../execution-plan/goal-handoff.mjs";
import { fingerprint, releasePlanDigest } from "../execution-plan/domain.mjs";
import { executionFreshnessProjection } from "../execution-plan/freshness.mjs";
import { createGoalHandoffApproval } from "../planning-case/cli.mjs";
import { createPlanningCaseStore } from "../planning-case/store.mjs";
import { advanceCaseToActivation } from "./execution-handoff-fixture.mjs";
import { compiledFixture, NOW } from "./execution-plan-fixture.mjs";

function setup(t, channel = "GOAL_LOCAL", runnerRef = "local", caseNow = NOW) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "goal-handoff-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stateDir = path.join(root, "state");
  const outputParent = path.join(root, "output");
  fs.mkdirSync(stateDir, { mode: 0o700 });
  fs.mkdirSync(outputParent, { mode: 0o700 });
  const outputDir = path.join(outputParent, "handoff");
  const { input, plan } = compiledFixture();
  const runner = channel === "GOAL_LOCAL"
    ? { ref: runnerRef, transport: "local", host: "test.local", sshHost: null, runnerCli: "/runner/goal-cli.js", runnerConfig: "/private/goal.json" }
    : { ref: runnerRef, transport: "ssh", host: "mac-mini.local", sshHost: "mac-mini", runnerCli: "/runner/goal-cli.js", runnerConfig: "/private/goal.json" };
  const handoff = buildGoalHandoff({ plan, channel, runnerRef, runnerDigest: fingerprint(runner), runnerHost: runner.host });
  const target = `github:${plan.repo}`;
  const caseId = "PC-goal-handoff";
  const store = createPlanningCaseStore({ stateDir, clock: () => caseNow });
  store.create({ target, caseId });
  const subject = { target, kind: "release", id: String(plan.parentIssue), revision: "r1", digest: fingerprint(plan) };
  advanceCaseToActivation({ store, caseId, target, subject, now: caseNow });
  const approval = createGoalHandoffApproval({ handoff, caseId, correlationId: "C-goal-handoff", observedAt: caseNow, revision: subject.revision });
  store.addApproval({ caseId, target, approval });
  return {
    root,
    input,
    plan,
    handoff,
    store,
    target,
    caseId,
    approval,
    subject,
    outputDir,
    base: {
      handoff,
      input,
      store,
      caseId,
      approvalId: approval.id,
      expectedFingerprint: goalHandoffFingerprint(handoff),
      outputDir,
      nextCommand: "node /runner/goal-cli.js start --approved",
      readFresh: executionFreshnessProjection,
      clock: () => NOW,
    },
  };
}

test("Goal apply consumes an exact channel approval and routes HANDOFF_READY by producer", (t) => {
  const ready = setup(t);
  const result = applyGoalHandoff(ready.base);
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.planDigest, releasePlanDigest(ready.plan));
  assert.equal(result.handoffFingerprint, goalHandoffFingerprint(ready.handoff));
  assert.deepEqual(fs.readdirSync(ready.outputDir), ["goal-handoff.json"]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(ready.outputDir, "goal-handoff.json"), "utf8")), ready.handoff);
  assert.deepEqual(verifyGoalHandoffExactReadback({ outputDir: ready.outputDir, handoff: ready.handoff }), []);
  const snapshot = ready.store.get({ caseId: ready.caseId, target: ready.target });
  assert.equal(snapshot.checkpoint.verdict, "HANDOFF_READY");
  assert.equal(snapshot.nextAction.reasonCode, "GOAL_LOCAL_START_REQUIRED");
  assert.equal(snapshot.facts.find(({ fact }) => fact === "execution.handoffReady")?.source.kind, "goal-handoff-apply");
  assert.equal(snapshot.approvals.pending.some(({ id }) => id === ready.approval.id), false);
  assert.equal(snapshot.approvals.consumed.some(({ id }) => id === ready.approval.id), true);
});

test("Goal handoff ignores expired approval history and replays a consumed approval after TTL", (t) => {
  const ready = setup(t, "GOAL_LOCAL", "local", "2026-08-19T22:00:00.000Z");
  const store = createPlanningCaseStore({ stateDir: path.join(ready.root, "state"), clock: () => NOW });
  const replacement = createGoalHandoffApproval({ handoff: ready.handoff, caseId: ready.caseId, correlationId: "C-goal-replacement", observedAt: NOW, revision: ready.subject.revision });
  store.addApproval({
    caseId: ready.caseId,
    target: ready.target,
    approval: replacement,
  });
  const base = { ...ready.base, store, approvalId: replacement.id };
  assert.equal(applyGoalHandoff(base).status, "COMPLETE");
  const snapshot = store.get({ caseId: ready.caseId, target: ready.target });
  assert.equal(snapshot.approvals.pending.some(({ id }) => id === ready.approval.id), true);
  assert.equal(snapshot.approvals.consumed.filter(({ id }) => id === replacement.id).length, 1);
  assert.equal(applyGoalHandoff({ ...base, clock: () => "2026-08-20T02:00:00.000Z" }).status, "COMPLETE");
});

test("Goal apply is byte-idempotent and rejects Plan drift without consuming approval", (t) => {
  const ready = setup(t);
  const first = applyGoalHandoff(ready.base);
  const bytes = fs.readFileSync(path.join(ready.outputDir, "goal-handoff.json"));
  assert.deepEqual(applyGoalHandoff(ready.base), first);
  assert.deepEqual(fs.readFileSync(path.join(ready.outputDir, "goal-handoff.json")), bytes);

  const drifted = setup(t);
  const changed = structuredClone(drifted.input);
  changed.children[0].body += "\ndrift";
  const result = applyGoalHandoff({ ...drifted.base, reloadInput: () => changed });
  assert.equal(result.status, "CONFLICT");
  assert.equal(drifted.store.get({ caseId: drifted.caseId, target: drifted.target }).approvals.pending.length, 1);
  assert.equal(fs.existsSync(drifted.outputDir), false);
});

test("Goal handoff closes local and remote target identity", (t) => {
  const local = setup(t);
  assert.throws(() => buildGoalHandoff({ plan: local.plan, channel: "GOAL_LOCAL", runnerRef: "mac-mini", runnerDigest: `sha256:${"1".repeat(64)}`, runnerHost: "test.local" }), /ARTIFACT_SCHEMA_INVALID|GOAL/u);
  const remote = setup(t, "GOAL_REMOTE", "mac-mini");
  const result = applyGoalHandoff(remote.base);
  assert.equal(result.status, "COMPLETE");
  assert.equal(remote.store.get({ caseId: remote.caseId, target: remote.target }).nextAction.reasonCode, "GOAL_REMOTE_START_REQUIRED");
});
