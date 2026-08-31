import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { applyExecutionPlan, verifyReleasePlanExactReadback } from "../execution-plan/handoff-apply.mjs";
import { fingerprint, releasePlanDigest } from "../execution-plan/domain.mjs";
import { executionFreshnessProjection } from "../execution-plan/freshness.mjs";
import { compiledFixture, NOW } from "./execution-plan-fixture.mjs";
import { createReadyCase } from "./execution-handoff-fixture.mjs";

function setup(t, name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stateDir = path.join(root, "state");
  const outputParent = path.join(root, "output");
  fs.mkdirSync(stateDir, { mode: 0o700 });
  fs.mkdirSync(outputParent, { mode: 0o700 });
  const outputDir = path.join(outputParent, "handoff");
  const { input, plan } = compiledFixture();
  const ready = createReadyCase({ stateDir, plan });
  return {
    ...ready,
    input,
    plan,
    outputDir,
    base: {
      plan,
      input,
      store: ready.store,
      caseId: ready.caseId,
      approvalId: ready.approval.id,
      expectedFingerprint: fingerprint(plan),
      outputDir,
      readFresh: executionFreshnessProjection,
      clock: () => NOW,
    },
  };
}

test("apply materializes only release-plan.json and prints one-digest start", (t) => {
  const ready = setup(t, "semantic-handoff-success");
  const result = applyExecutionPlan(ready.base);
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.planDigest, releasePlanDigest(ready.plan));
  assert.match(result.nextCommand, new RegExp(`--approve-plan ${releasePlanDigest(ready.plan)}`));
  assert.equal(/expected-controller|expected-config|provenance/u.test(result.nextCommand), false);
  assert.deepEqual(fs.readdirSync(ready.outputDir), ["release-plan.json"]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(ready.outputDir, "release-plan.json"), "utf8")), ready.plan);
  assert.deepEqual(verifyReleasePlanExactReadback({ outputDir: ready.outputDir, plan: ready.plan }), []);
  const snapshot = ready.store.get({ caseId: ready.caseId, target: ready.target });
  assert.equal(snapshot.checkpoint.verdict, "HANDOFF_READY");
  assert.equal(snapshot.approvals.pending.some(({ id }) => id === ready.approval.id), false);
  assert.equal(snapshot.approvals.consumed.some(({ id }) => id === ready.approval.id), true);
});

test("apply is byte-idempotent after approval consumption", (t) => {
  const ready = setup(t, "semantic-handoff-idempotent");
  const first = applyExecutionPlan(ready.base);
  const bytes = fs.readFileSync(path.join(ready.outputDir, "release-plan.json"));
  const second = applyExecutionPlan(ready.base);
  assert.deepEqual(second, first);
  assert.deepEqual(fs.readFileSync(path.join(ready.outputDir, "release-plan.json")), bytes);
});

test("freshness drift and wrong approval do not consume authority", (t) => {
  const drifted = setup(t, "semantic-handoff-drift");
  const changed = structuredClone(drifted.input);
  changed.children[0].body += "\ndrift";
  const result = applyExecutionPlan({ ...drifted.base, reloadInput: () => changed });
  assert.equal(result.status, "CONFLICT");
  assert.equal(drifted.store.get({ caseId: drifted.caseId, target: drifted.target }).approvals.pending.length, 1);
  assert.equal(fs.existsSync(drifted.outputDir), false);

  const wrong = setup(t, "semantic-handoff-wrong-digest");
  assert.throws(() => applyExecutionPlan({ ...wrong.base, expectedFingerprint: fingerprint("other") }), /EXPECTED_FINGERPRINT_MISMATCH/);
  assert.equal(wrong.store.get({ caseId: wrong.caseId, target: wrong.target }).approvals.pending.length, 1);
});

test("materialized Plan recovers after interruption before approval consumption", (t) => {
  const ready = setup(t, "semantic-handoff-recovery");
  let transitions = 0;
  const interruptedStore = {
    ...ready.store,
    get: ready.store.get.bind(ready.store),
    addApproval: ready.store.addApproval.bind(ready.store),
    consumeApproval: ready.store.consumeApproval.bind(ready.store),
    transition(input) {
      transitions += 1;
      if (transitions === 2) throw new Error("interrupted after materialization");
      return ready.store.transition(input);
    },
  };
  assert.throws(() => applyExecutionPlan({ ...ready.base, store: interruptedStore }), /interrupted after materialization/);
  assert.deepEqual(fs.readdirSync(ready.outputDir), ["release-plan.json"]);
  assert.equal(ready.store.get({ caseId: ready.caseId, target: ready.target }).approvals.pending.length, 1);
  assert.equal(applyExecutionPlan(ready.base).status, "COMPLETE");
});

test("existing extra output is a conflict", (t) => {
  const ready = setup(t, "semantic-handoff-conflict");
  applyExecutionPlan(ready.base);
  fs.writeFileSync(path.join(ready.outputDir, "unexpected"), "x", { mode: 0o600 });
  assert.throws(() => applyExecutionPlan(ready.base), /HANDOFF_OUTPUT_CONFLICT/);
});
