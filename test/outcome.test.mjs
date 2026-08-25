import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildOutcomeReceipt, confirmOutcomeLearning, ingestOutcomeReceipt, validateOutcomeReceipt } from "../outcome/ingest.mjs";
import { createFactAttestation, producerAttestationSource } from "../protocol/kernel.mjs";
import { createPlanningCaseStore } from "../planning-case/store.mjs";

const TARGET = "github:Notyet1307/example";
const SUBJECT = { target: TARGET, kind: "release", id: "R001", revision: "r1", digest: `sha256:${"a".repeat(64)}` };

function receipt() {
  return buildOutcomeReceipt({
    id: "OR-R001-r1",
    subject: SUBJECT,
    source: {
      kind: "harness",
      producer: "herdr-harness",
      producerVersion: "0.5.0-dev",
      producerDigest: `sha256:${"b".repeat(64)}`,
    },
    observedAt: "2026-08-25T01:00:00.000Z",
    status: "PARTIAL",
    evidence: [{ kind: "receipt", ref: "harness:delivery/R001", digest: `sha256:${"c".repeat(64)}` }],
  });
}

test("Outcome Receipt is read-only, subject-bound, and stored without changing workflow", (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-outcome-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const store = createPlanningCaseStore({ stateDir, clock: () => "2026-08-25T01:00:00.000Z", idGenerator: () => "PC-outcome" });
  store.create({ target: TARGET });
  const before = store.get({ caseId: "PC-outcome" }).checkpoint;
  const result = ingestOutcomeReceipt(receipt(), { expectedSubject: SUBJECT, store, caseId: "PC-outcome" });
  assert.equal(result.status, "COMPLETE");
  assert.deepEqual(result.allowedLearning, ["PROMOTE", "REVISE", "REJECT", "NO_CHANGE"]);
  assert.equal(result.kernelMutation, false);
  const current = store.get({ caseId: "PC-outcome" });
  assert.deepEqual(current.checkpoint, before);
  assert.equal(current.bindings.outcome.digest, receipt().digest);
});

test("forged producer, subject, and digest fail closed", () => {
  const forged = receipt();
  forged.source.producer = "model";
  assert.equal(validateOutcomeReceipt(forged).problems.some(({ code }) => code === "OUTCOME_PRODUCER_NOT_ALLOWED"), true);
  const drifted = receipt();
  drifted.subject.id = "R002";
  assert.equal(validateOutcomeReceipt(drifted, { expectedSubject: SUBJECT }).problems.some(({ code }) => code === "OUTCOME_SUBJECT_MISMATCH"), true);
  const changed = receipt();
  changed.status = "ACHIEVED";
  assert.equal(validateOutcomeReceipt(changed).problems.some(({ code }) => code === "OUTCOME_DIGEST_MISMATCH"), true);
});

test("Outcome learning requires one human attestation and never edits Kernel", (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-outcome-learn-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const store = createPlanningCaseStore({ stateDir, clock: () => "2026-08-25T01:00:00.000Z", idGenerator: () => "PC-learn" });
  store.create({ target: TARGET });
  const outcome = receipt();
  ingestOutcomeReceipt(outcome, { expectedSubject: SUBJECT, store, caseId: "PC-learn" });
  const decision = createFactAttestation({
    id: "F-outcome-learning",
    fact: "human.outcomeLearningDecision",
    value: "NO_CHANGE",
    subject: SUBJECT,
    source: producerAttestationSource("operator-asserted", "operator", { producerVersion: "human" }),
    observedAt: "2026-08-25T01:00:00.000Z",
    expiresAt: null,
    evidence: { kind: "operator", ref: `outcome:${outcome.digest}`, digest: outcome.digest },
  });
  const learned = confirmOutcomeLearning(outcome, decision, { store, caseId: "PC-learn" });
  assert.deepEqual(learned, { status: "COMPLETE", decision: "NO_CHANGE", kernelMutation: false });
  assert.throws(() => confirmOutcomeLearning(outcome, decision, { store, caseId: "PC-learn" }), /APPROVAL_ALREADY_CONSUMED|DUPLICATE_APPROVAL/);
});
