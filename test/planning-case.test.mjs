import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createFactAttestation } from "../protocol/kernel.mjs";
import { createPlanningCaseStore, PlanningCaseError } from "../planning-case/store.mjs";

const TARGET = "github:Notyet1307/example";
const NOW = "2026-08-25T01:00:00.000Z";
const later = (milliseconds) => new Date(Date.parse(NOW) + milliseconds).toISOString();

function targetHash(target = TARGET) {
  return createHash("sha256").update(target, "utf8").digest("hex");
}

function caseDirectory(root, caseId, target = TARGET) {
  return path.join(root, "cases", targetHash(target), caseId);
}

function temporaryState(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-state-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function approval(id = "F-human-activation") {
  const fingerprint = `sha256:${"a".repeat(64)}`;
  return createFactAttestation({
    id,
    fact: "human.activation",
    value: true,
    subject: {
      target: TARGET,
      kind: "admission-plan",
      id: fingerprint,
      revision: "v1",
      digest: fingerprint,
    },
    source: {
      kind: "operator-asserted",
      producer: "operator",
      producerVersion: "human",
      producerDigest: `sha256:${"b".repeat(64)}`,
    },
    observedAt: NOW,
    expiresAt: null,
    evidence: {
      kind: "operator",
      ref: `operator:${fingerprint}`,
      digest: `sha256:${"c".repeat(64)}`,
    },
  });
}

test("a new process resumes one private Planning Case without chat history", (t) => {
  const stateDir = temporaryState(t);
  const first = createPlanningCaseStore({ stateDir, clock: () => NOW, idGenerator: () => "PC-resume" });
  const created = first.create({ target: TARGET });
  assert.equal(created.caseId, "PC-resume");

  const second = createPlanningCaseStore({ stateDir, clock: () => later(1000) });
  const resumed = second.resume({ caseId: created.caseId });
  assert.equal(resumed.currentState.stage, "ORIENT");
  assert.equal(resumed.blocker, null);
  assert.equal(resumed.nextAction.kind, "ROUTE");
  assert.equal(resumed.bindings.source, null);
  assert.equal(resumed.compatibility.protocol, "SUPPORTED");
  assert.equal(resumed.compatibility.capabilities, "UNTESTED");
  assert.equal(resumed.contextManifest.route, "PRODUCT/ORIENT/NEEDS_TARGET");
  assert.deepEqual(resumed.contextManifest.required, ["skills/ask-yet/SKILL.md"]);
  assert.match(resumed.recoveryCommand, /case recover PC-resume --dry-run --json$/);

  const directory = caseDirectory(stateDir, created.caseId);
  assert.equal(fs.statSync(stateDir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(directory, "case.json")).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.join(directory, "events.jsonl")).mode & 0o777, 0o600);
  assert.deepEqual(second.verify({ caseId: created.caseId }), { status: "COMPLETE", problems: [] });
});

test("an event/snapshot crash requires explicit dry-run then rolls forward", (t) => {
  const stateDir = temporaryState(t);
  const base = createPlanningCaseStore({ stateDir, clock: () => NOW, idGenerator: () => "PC-crash" });
  base.create({ target: TARGET });

  const crashing = createPlanningCaseStore({
    stateDir,
    clock: () => later(1000),
    processAlive: () => false,
    failpoint(name) {
      if (name === "after_event") {
        const error = new PlanningCaseError("SIMULATED_CRASH");
        error.simulatedCrash = true;
        throw error;
      }
    },
  });
  assert.throws(
    () => crashing.abandon({ caseId: "PC-crash", reason: "superseded" }),
    (error) => error.code === "SIMULATED_CRASH",
  );
  assert.throws(
    () => activeMutation(stateDir).abandon({ caseId: "PC-crash", reason: "racing write" }),
    (error) => error.code === "CASE_LOCKED",
  );

  const active = createPlanningCaseStore({ stateDir, clock: () => later(2000), processAlive: () => true });
  assert.deepEqual(active.recover({ caseId: "PC-crash", dryRun: true }), {
    status: "BLOCKED",
    actions: [],
    problems: [{ code: "CASE_LOCKED" }],
  });

  const recovery = createPlanningCaseStore({ stateDir, clock: () => later(10 * 60 * 1000), processAlive: () => false });
  const dryRun = recovery.recover({ caseId: "PC-crash", dryRun: true });
  assert.equal(dryRun.status, "RECOVERY_REQUIRED");
  assert.deepEqual(dryRun.actions, ["REMOVE_STALE_LOCK", "ROLL_FORWARD_TRANSACTION"]);

  const recovered = recovery.recover({ caseId: "PC-crash" });
  assert.equal(recovered.status, "COMPLETE");
  assert.equal(recovery.get({ caseId: "PC-crash" }).blocker.code, "CASE_ABANDONED");
  assert.deepEqual(recovery.verify({ caseId: "PC-crash" }), { status: "COMPLETE", problems: [] });
});

function activeMutation(stateDir) {
  return createPlanningCaseStore({ stateDir, clock: () => later(2000), processAlive: () => true });
}

for (const failpoint of ["after_intent", "after_event", "after_snapshot_temp", "after_snapshot_rename", "after_commit"]) {
  test(`recovery is idempotent after ${failpoint}`, (t) => {
    const stateDir = temporaryState(t);
    createPlanningCaseStore({ stateDir, clock: () => NOW, idGenerator: () => `PC-${failpoint}` }).create({ target: TARGET });
    const crashing = createPlanningCaseStore({
      stateDir,
      clock: () => later(1000),
      processAlive: () => false,
      failpoint(name) {
        if (name === failpoint) {
          const error = new PlanningCaseError("SIMULATED_CRASH");
          error.simulatedCrash = true;
          throw error;
        }
      },
    });
    assert.throws(
      () => crashing.abandon({ caseId: `PC-${failpoint}`, reason: failpoint }),
      (error) => error.code === "SIMULATED_CRASH",
    );
    const recovery = createPlanningCaseStore({ stateDir, clock: () => later(10 * 60 * 1000), processAlive: () => false });
    assert.equal(recovery.recover({ caseId: `PC-${failpoint}` }).status, "COMPLETE");
    assert.equal(recovery.recover({ caseId: `PC-${failpoint}` }).status, "COMPLETE");
    assert.equal(recovery.get({ caseId: `PC-${failpoint}` }).blocker.reason, failpoint);
  });
}

test("Approval is consumed once and remains consumed after restart", (t) => {
  const stateDir = temporaryState(t);
  const store = createPlanningCaseStore({ stateDir, clock: () => NOW, idGenerator: () => "PC-approval" });
  store.create({ target: TARGET });
  store.addApproval({ caseId: "PC-approval", approval: approval() });
  store.consumeApproval({ caseId: "PC-approval", approvalId: "F-human-activation" });
  assert.throws(
    () => store.consumeApproval({ caseId: "PC-approval", approvalId: "F-human-activation" }),
    (error) => error.code === "APPROVAL_ALREADY_CONSUMED",
  );

  const restarted = createPlanningCaseStore({ stateDir, clock: () => later(1000) });
  const current = restarted.get({ caseId: "PC-approval" });
  assert.equal(current.approvals.pending.length, 0);
  assert.deepEqual(current.approvals.consumed.map(({ id }) => id), ["F-human-activation"]);
});

test("corruption, symlinks, and target substitution fail closed", (t) => {
  const stateDir = temporaryState(t);
  const store = createPlanningCaseStore({ stateDir, clock: () => NOW, idGenerator: () => "PC-secure" });
  store.create({ target: TARGET });
  const directory = caseDirectory(stateDir, "PC-secure");
  const snapshot = path.join(directory, "case.json");
  const held = `${snapshot}.held`;
  fs.renameSync(snapshot, held);
  fs.symlinkSync(held, snapshot);
  assert.throws(() => store.get({ caseId: "PC-secure" }), (error) => error.code === "UNSAFE_STATE_FILE");

  fs.unlinkSync(snapshot);
  fs.renameSync(held, snapshot);
  fs.appendFileSync(path.join(directory, "events.jsonl"), "{broken\n");
  assert.equal(store.verify({ caseId: "PC-secure" }).status, "RECOVERY_REQUIRED");

  const otherTarget = "github:Other/repo";
  const otherParent = path.join(stateDir, "cases", targetHash(otherTarget));
  fs.mkdirSync(otherParent, { recursive: true, mode: 0o700 });
  fs.renameSync(directory, path.join(otherParent, "PC-secure"));
  assert.throws(
    () => store.get({ caseId: "PC-secure", target: otherTarget }),
    (error) => error.code === "CASE_TARGET_MISMATCH",
  );
});

test("event replay repairs a drifted snapshot and source drift blocks resume", (t) => {
  const stateDir = temporaryState(t);
  const store = createPlanningCaseStore({ stateDir, clock: () => NOW, idGenerator: () => "PC-replay" });
  store.create({ target: TARGET });
  store.abandon({ caseId: "PC-replay", reason: "original" });
  const snapshotFile = path.join(caseDirectory(stateDir, "PC-replay"), "case.json");
  const snapshot = JSON.parse(fs.readFileSync(snapshotFile, "utf8"));
  snapshot.blocker.reason = "tampered";
  fs.writeFileSync(snapshotFile, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
  assert.equal(store.verify({ caseId: "PC-replay" }).problems.some(({ code }) => code === "SNAPSHOT_REBUILD_MISMATCH"), true);
  assert.deepEqual(store.recover({ caseId: "PC-replay", dryRun: true }).actions, ["REBUILD_SNAPSHOT_FROM_EVENTS"]);
  assert.equal(store.recover({ caseId: "PC-replay" }).status, "COMPLETE");
  assert.equal(store.get({ caseId: "PC-replay" }).blocker.reason, "original");

  store.bind({
    caseId: "PC-replay",
    name: "source",
    binding: { target: TARGET, kind: "git", revision: "main", digest: `sha256:${"d".repeat(64)}` },
  });
  const drifted = createPlanningCaseStore({
    stateDir,
    clock: () => later(1000),
    bindingVerifier: () => [{ code: "SOURCE_DRIFT" }],
  });
  assert.throws(() => drifted.resume({ caseId: "PC-replay" }), (error) => error.code === "SOURCE_DRIFT");
});

test("unsafe state roots and relaxed file permissions are rejected", (t) => {
  const parent = temporaryState(t);
  const real = path.join(parent, "real");
  fs.mkdirSync(real, { mode: 0o700 });
  const linked = path.join(parent, "linked");
  fs.symlinkSync(real, linked);
  assert.throws(() => createPlanningCaseStore({ stateDir: linked }), (error) => error.code === "UNSAFE_STATE_DIRECTORY");

  const stateDir = path.join(parent, "state");
  const store = createPlanningCaseStore({ stateDir, clock: () => NOW, idGenerator: () => "PC-mode" });
  store.create({ target: TARGET });
  const snapshot = path.join(caseDirectory(stateDir, "PC-mode"), "case.json");
  fs.chmodSync(snapshot, 0o644);
  assert.throws(() => store.get({ caseId: "PC-mode" }), (error) => error.code === "UNSAFE_STATE_FILE");
});
