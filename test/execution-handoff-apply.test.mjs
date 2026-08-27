import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { applyExecutionPlan } from "../execution-plan/handoff-apply.mjs";
import { fingerprint } from "../execution-plan/domain.mjs";
import {
  NOW,
  compiledFixture,
  controllerAdapter,
} from "./execution-plan-fixture.mjs";
import { createReadyCase } from "./execution-handoff-fixture.mjs";

const OUTPUT_FILES = [
  "execution-handoff-plan.json",
  "execution-handoff-receipt.json",
  "release-plan.json",
];

function setup(t, name) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const fixture = compiledFixture();
  const ready = createReadyCase({ stateDir: path.join(directory, "state"), plan: fixture.plan });
  const outputDir = path.join(directory, "handoff");
  const calls = [];
  const base = {
    plan: fixture.plan,
    input: fixture.input,
    adapter: controllerAdapter(fixture.controller, calls),
    store: ready.store,
    caseId: ready.caseId,
    approvalId: ready.approval.id,
    expectedFingerprint: fixture.plan.planFingerprint,
    outputDir,
    clock: () => NOW,
  };
  return { ...fixture, ...ready, directory, outputDir, calls, base };
}

function storeWith(store, overrides) {
  return {
    get: store.get.bind(store),
    transition: store.transition.bind(store),
    consumeApproval: store.consumeApproval.bind(store),
    ...overrides,
  };
}

function publishBeforeCheckpoint(ready) {
  let fail = true;
  const faulted = storeWith(ready.store, {
    transition(args) {
      if (fail) {
        fail = false;
        throw new Error("CRASH_AFTER_PUBLISH");
      }
      return ready.store.transition(args);
    },
  });
  assert.throws(() => applyExecutionPlan({ ...ready.base, store: faulted }), /CRASH_AFTER_PUBLISH/);
  assertExactOutput(ready.outputDir, ready.plan, ready.approval.id);
}

function assertExactOutput(outputDir, plan, approvalId) {
  assert.deepEqual(fs.readdirSync(outputDir).sort(), OUTPUT_FILES);
  assert.equal(fs.statSync(outputDir).mode & 0o777, 0o700);
  for (const name of OUTPUT_FILES) {
    const stat = fs.lstatSync(path.join(outputDir, name));
    assert.equal(stat.isFile(), true);
    assert.equal(stat.isSymbolicLink(), false);
    assert.equal(stat.nlink, 1);
    assert.equal(stat.mode & 0o777, 0o600);
  }
  const releasePlan = JSON.parse(fs.readFileSync(path.join(outputDir, "release-plan.json"), "utf8"));
  const handoffPlan = JSON.parse(fs.readFileSync(path.join(outputDir, "execution-handoff-plan.json"), "utf8"));
  const receipt = JSON.parse(fs.readFileSync(path.join(outputDir, "execution-handoff-receipt.json"), "utf8"));
  assert.deepEqual(releasePlan, plan.releasePlan);
  assert.deepEqual(handoffPlan, plan);
  assert.equal(receipt.schema, "pi-ticket-planning:execution-handoff-receipt:v1");
  assert.equal(receipt.status, "COMPLETE");
  assert.equal(receipt.repo, plan.repo);
  assert.equal(receipt.target, plan.target);
  assert.equal(receipt.planFingerprint, plan.planFingerprint);
  assert.equal(receipt.controllerPlanDigest, plan.controllerPlanDigest);
  assert.equal(receipt.controllerConfigDigest, plan.controller.configDigest);
  assert.equal(receipt.approvalId, approvalId);
  assert.equal(receipt.releasePlanDigest, fingerprint(plan.releasePlan));
  assert.equal(receipt.digest, fingerprint((({ digest, ...body }) => body)(receipt)));
  return receipt;
}

function assertCompleteCase(store, caseId, target, approvalId) {
  const snapshot = store.get({ caseId, target });
  assert.equal(snapshot.checkpoint.stage, "EXECUTION");
  assert.equal(snapshot.checkpoint.verdict, "HANDOFF_READY");
  assert.equal(snapshot.facts.some(({ fact }) => fact === "execution.handoffReady"), true);
  assert.equal(snapshot.approvals.pending.some(({ id }) => id === approvalId), false);
  assert.equal(snapshot.approvals.consumed.filter(({ id }) => id === approvalId).length, 1);
}

test("execution handoff apply publishes exact private files, records the Case, and is idempotent", (t) => {
  const ready = setup(t, "execution-handoff-success");
  const result = applyExecutionPlan(ready.base);
  assert.equal(result.status, "COMPLETE");
  assert.match(result.nextCommand, / start /);
  assert.equal(result.nextCommand.includes("run"), false);
  assertExactOutput(ready.outputDir, ready.plan, ready.approval.id);
  assertCompleteCase(ready.store, ready.caseId, ready.target, ready.approval.id);
  assert.deepEqual(ready.calls, ["config validate", "plan validate", "doctor"]);

  const replay = applyExecutionPlan(ready.base);
  assert.equal(replay.status, "COMPLETE");
  assert.deepEqual(replay.receipt, result.receipt);
  assert.deepEqual(ready.calls, ["config validate", "plan validate", "doctor"]);
});

test("execution handoff revalidates after publish and before the Case checkpoint", (t) => {
  const ready = setup(t, "execution-handoff-before-checkpoint");
  publishBeforeCheckpoint(ready);
  let snapshot = ready.store.get({ caseId: ready.caseId, target: ready.target });
  assert.equal(snapshot.checkpoint.verdict, "ACTIVATION_AWAITING_CONFIRMATION");
  assert.equal(snapshot.approvals.pending.some(({ id }) => id === ready.approval.id), true);

  ready.input.children[0].body += "\npost-publication drift";
  const result = applyExecutionPlan({ ...ready.base, clock: () => "2026-08-20T02:00:00.000Z" });
  assert.equal(result.status, "CONFLICT");
  assert.deepEqual(result.problems, [{ code: "CHILD_DRIFT:101" }]);
  snapshot = ready.store.get({ caseId: ready.caseId, target: ready.target });
  assert.equal(snapshot.checkpoint.verdict, "ACTIVATION_AWAITING_CONFIRMATION");
  assert.equal(snapshot.approvals.pending.some(({ id }) => id === ready.approval.id), true);
  assertExactOutput(ready.outputDir, ready.plan, ready.approval.id);
  assert.deepEqual(ready.calls, ["config validate", "plan validate", "doctor", "config validate"]);
});

test("execution handoff resumes exact pre-checkpoint output and blocks config or doctor drift", (t) => {
  {
    const ready = setup(t, "execution-handoff-pre-checkpoint-exact");
    publishBeforeCheckpoint(ready);
    assert.equal(applyExecutionPlan(ready.base).status, "COMPLETE");
    assertCompleteCase(ready.store, ready.caseId, ready.target, ready.approval.id);
    assert.deepEqual(ready.calls, ["config validate", "plan validate", "doctor", "config validate", "plan validate", "doctor"]);
  }
  {
    const ready = setup(t, "execution-handoff-pre-checkpoint-config-drift");
    publishBeforeCheckpoint(ready);
    const drifted = { ...ready.controller, configDigest: "d".repeat(64) };
    const result = applyExecutionPlan({ ...ready.base, adapter: controllerAdapter(drifted, ready.calls) });
    assert.equal(result.status, "CONFLICT");
    assert.equal(ready.store.get({ caseId: ready.caseId, target: ready.target }).approvals.pending.some(({ id }) => id === ready.approval.id), true);
    assertExactOutput(ready.outputDir, ready.plan, ready.approval.id);
  }
  {
    const ready = setup(t, "execution-handoff-pre-checkpoint-doctor-failure");
    publishBeforeCheckpoint(ready);
    const adapter = controllerAdapter(ready.controller, ready.calls);
    adapter.doctor = () => { ready.calls.push("doctor"); throw new Error("CONTROLLER_DOCTOR_FAILED"); };
    const result = applyExecutionPlan({ ...ready.base, adapter });
    assert.equal(result.status, "BLOCKED");
    assert.deepEqual(result.problems, [{ code: "CONTROLLER_DOCTOR_FAILED" }]);
    const snapshot = ready.store.get({ caseId: ready.caseId, target: ready.target });
    assert.equal(snapshot.checkpoint.verdict, "ACTIVATION_AWAITING_CONFIRMATION");
    assert.equal(snapshot.approvals.pending.some(({ id }) => id === ready.approval.id), true);
    assertExactOutput(ready.outputDir, ready.plan, ready.approval.id);
  }
});

test("execution handoff recovers a crash after the checkpoint and before approval consumption", (t) => {
  const ready = setup(t, "execution-handoff-before-consume");
  let fail = true;
  const faulted = storeWith(ready.store, {
    consumeApproval(args) {
      if (fail) {
        fail = false;
        throw new Error("CRASH_BEFORE_CONSUME");
      }
      return ready.store.consumeApproval(args);
    },
  });
  assert.throws(() => applyExecutionPlan({ ...ready.base, store: faulted }), /CRASH_BEFORE_CONSUME/);
  const snapshot = ready.store.get({ caseId: ready.caseId, target: ready.target });
  assert.equal(snapshot.checkpoint.verdict, "HANDOFF_READY");
  assert.equal(snapshot.approvals.pending.some(({ id }) => id === ready.approval.id), true);

  assert.equal(applyExecutionPlan(ready.base).status, "COMPLETE");
  assertCompleteCase(ready.store, ready.caseId, ready.target, ready.approval.id);
  assert.deepEqual(ready.calls, ["config validate", "plan validate", "doctor"]);
});

test("execution handoff recovers when approval consumption committed before the response was lost", (t) => {
  const ready = setup(t, "execution-handoff-after-consume");
  let fail = true;
  const faulted = storeWith(ready.store, {
    consumeApproval(args) {
      const result = ready.store.consumeApproval(args);
      if (fail) {
        fail = false;
        throw new Error("CRASH_AFTER_CONSUME");
      }
      return result;
    },
  });
  assert.throws(() => applyExecutionPlan({ ...ready.base, store: faulted }), /CRASH_AFTER_CONSUME/);
  assertCompleteCase(ready.store, ready.caseId, ready.target, ready.approval.id);
  assert.equal(applyExecutionPlan(ready.base).status, "COMPLETE");
  assert.deepEqual(ready.calls, ["config validate", "plan validate", "doctor"]);
});

test("execution handoff rejects wrong, foreign, expired, and prematurely consumed approvals without publishing", (t) => {
  {
    const ready = setup(t, "execution-handoff-wrong-fingerprint");
    assert.throws(() => applyExecutionPlan({ ...ready.base, expectedFingerprint: `sha256:${"f".repeat(64)}` }), /EXPECTED_FINGERPRINT_MISMATCH/);
    assert.equal(fs.existsSync(ready.outputDir), false);
    assert.deepEqual(ready.calls, []);
  }
  {
    const ready = setup(t, "execution-handoff-foreign-approval");
    const foreign = structuredClone(ready.approval);
    foreign.id = "F-human-execution-handoff-foreign";
    foreign.subject.id = `sha256:${"e".repeat(64)}`;
    foreign.subject.digest = `sha256:${"e".repeat(64)}`;
    ready.store.addApproval({ caseId: ready.caseId, target: ready.target, approval: foreign });
    assert.throws(() => applyExecutionPlan({ ...ready.base, approvalId: foreign.id }), /INVALID_HANDOFF_APPROVAL/);
    assert.equal(fs.existsSync(ready.outputDir), false);
    assert.deepEqual(ready.calls, []);
  }
  {
    const ready = setup(t, "execution-handoff-expired-approval");
    assert.throws(
      () => applyExecutionPlan({ ...ready.base, clock: () => "2026-08-20T02:00:00.000Z" }),
      /STALE_FACT/,
    );
    assert.equal(fs.existsSync(ready.outputDir), false);
    assert.deepEqual(ready.calls, ["config validate", "plan validate", "doctor"]);
  }
  {
    const ready = setup(t, "execution-handoff-duplicate-approval");
    const duplicate = structuredClone(ready.approval);
    duplicate.id = "F-human-execution-handoff-duplicate";
    ready.store.addApproval({ caseId: ready.caseId, target: ready.target, approval: duplicate });
    assert.throws(() => applyExecutionPlan(ready.base), /INVALID_HANDOFF_APPROVAL/);
    assert.equal(fs.existsSync(ready.outputDir), false);
    assert.deepEqual(ready.calls, []);
  }
  {
    const ready = setup(t, "execution-handoff-premature-consume");
    ready.store.consumeApproval({ caseId: ready.caseId, target: ready.target, approvalId: ready.approval.id });
    assert.throws(() => applyExecutionPlan(ready.base), /HANDOFF_OUTPUT_CONFLICT/);
    assert.equal(fs.existsSync(ready.outputDir), false);
    assert.deepEqual(ready.calls, []);
  }
});

test("execution handoff blocks source, Controller config, Plan, and doctor drift before publication", (t) => {
  {
    const ready = setup(t, "execution-handoff-source-drift");
    ready.input.children[0].body += "\nsource drift";
    const result = applyExecutionPlan(ready.base);
    assert.equal(result.status, "CONFLICT");
    assert.deepEqual(result.problems, [{ code: "CHILD_DRIFT:101" }]);
    assert.equal(fs.existsSync(ready.outputDir), false);
  }
  {
    const ready = setup(t, "execution-handoff-config-drift");
    const drifted = { ...ready.controller, configDigest: "d".repeat(64) };
    const result = applyExecutionPlan({ ...ready.base, adapter: controllerAdapter(drifted, ready.calls) });
    assert.equal(result.status, "CONFLICT");
    assert.deepEqual(result.problems, [{ code: "SOURCE_OR_PLAN_DRIFT" }]);
    assert.equal(fs.existsSync(ready.outputDir), false);
  }
  {
    const ready = setup(t, "execution-handoff-plan-invalid");
    const adapter = controllerAdapter(ready.controller, ready.calls);
    adapter.validatePlan = () => {
      ready.calls.push("plan validate");
      throw new Error("CONTROLLER_PLAN_INVALID");
    };
    const result = applyExecutionPlan({ ...ready.base, adapter });
    assert.equal(result.status, "BLOCKED");
    assert.deepEqual(result.problems, [{ code: "CONTROLLER_PLAN_INVALID" }]);
    assert.equal(fs.existsSync(ready.outputDir), false);
  }
  {
    const ready = setup(t, "execution-handoff-doctor-failed");
    const adapter = controllerAdapter(ready.controller, ready.calls);
    adapter.doctor = () => {
      ready.calls.push("doctor");
      throw new Error("CONTROLLER_DOCTOR_FAILED");
    };
    const result = applyExecutionPlan({ ...ready.base, adapter });
    assert.equal(result.status, "BLOCKED");
    assert.deepEqual(result.problems, [{ code: "CONTROLLER_DOCTOR_FAILED" }]);
    assert.equal(fs.existsSync(ready.outputDir), false);
  }
});

test("execution handoff rejects conflicting files, permissions, and self-signed receipt drift", (t) => {
  {
    const ready = setup(t, "execution-handoff-extra-file");
    fs.mkdirSync(ready.outputDir, { mode: 0o700 });
    fs.writeFileSync(path.join(ready.outputDir, "unexpected"), "x", { mode: 0o600 });
    assert.throws(() => applyExecutionPlan(ready.base), /HANDOFF_OUTPUT_CONFLICT/);
    assert.deepEqual(ready.calls, []);
  }
  {
    const ready = setup(t, "execution-handoff-file-mode");
    assert.equal(applyExecutionPlan(ready.base).status, "COMPLETE");
    fs.chmodSync(path.join(ready.outputDir, "release-plan.json"), 0o400);
    assert.throws(() => applyExecutionPlan(ready.base), /HANDOFF_OUTPUT_CONFLICT/);
  }
  {
    const ready = setup(t, "execution-handoff-receipt-drift");
    assert.equal(applyExecutionPlan(ready.base).status, "COMPLETE");
    const file = path.join(ready.outputDir, "execution-handoff-receipt.json");
    const receipt = JSON.parse(fs.readFileSync(file, "utf8"));
    receipt.controllerConfigDigest = "d".repeat(64);
    receipt.digest = fingerprint((({ digest, ...body }) => body)(receipt));
    fs.writeFileSync(file, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    assert.throws(() => applyExecutionPlan(ready.base), /HANDOFF_OUTPUT_CONFLICT/);
  }
  {
    const ready = setup(t, "execution-handoff-existing-ancestor-symlink");
    const realParent = path.join(ready.directory, "real");
    const linkedParent = path.join(ready.directory, "linked");
    fs.mkdirSync(realParent, { mode: 0o700 });
    const realOutput = path.join(realParent, "handoff");
    assert.equal(applyExecutionPlan({ ...ready.base, outputDir: realOutput }).status, "COMPLETE");
    fs.symlinkSync(realParent, linkedParent);
    assert.throws(() => applyExecutionPlan({ ...ready.base, outputDir: path.join(linkedParent, "handoff") }), /PATH_CONTAINS_SYMLINK/);
  }
});

test("execution handoff artifacts and receipt contain no private paths, Issue bodies, review prose, labels, or runtime commands", (t) => {
  const ready = setup(t, "execution-handoff-redaction");
  const result = applyExecutionPlan(ready.base);
  const receiptText = JSON.stringify(result.receipt);
  const planText = fs.readFileSync(path.join(ready.outputDir, "execution-handoff-plan.json"), "utf8");
  for (const forbidden of [ready.outputDir, ready.input.repositoryPath, ready.input.children[0].body, "ready-for-agent", "ready-for-human", "harness", "reviewer"] ) {
    assert.equal(receiptText.includes(forbidden), false, `receipt leaked ${forbidden}`);
    assert.equal(planText.includes(forbidden), false, `plan leaked ${forbidden}`);
  }
  assert.equal(ready.calls.some((call) => /start|run|step/.test(call)), false);
});
