import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildOutcomeReceipt } from "../outcome/ingest.mjs";
import { noNextAction, reducePlanningCaseEvent } from "../planning-case/events.mjs";
import { createPlanningCaseStore } from "../planning-case/store.mjs";
import { createFactAttestation, producerAttestationSource } from "../protocol/kernel.mjs";

const TARGET = "github:acme/product";
const NOW = new Date().toISOString();
const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const subject = { target: TARGET, kind: "release", id: "R1", revision: "r1", digest: digest("release") };
const nextAction = (route) => ({
  kind: "SKILL", command: null, skill: "ask-yet", requiredInputs: [], blockingFacts: [], contextRoute: route, reasonCode: "TEST_ROUTE",
});

function fact(id, name, value, factSubject = subject) {
  const sourceKind = name.startsWith("human.") ? "operator-asserted" : "release-readiness-check";
  const producer = sourceKind === "operator-asserted" ? "operator" : "ask-yet";
  return createFactAttestation({
    id,
    fact: name,
    value,
    subject: factSubject,
    source: producerAttestationSource(sourceKind, producer, { producerVersion: "test" }),
    observedAt: NOW,
    expiresAt: sourceKind === "release-readiness-check" ? new Date(Date.parse(NOW) + 60 * 60 * 1000).toISOString() : null,
    evidence: { kind: "operator", ref: `test:${id}`, digest: digest(id) },
  });
}

test("Planning Case event defaults and missing snapshots fail deterministically", () => {
  assert.equal(noNextAction().reasonCode, "TERMINAL_STATE");
  assert.equal(noNextAction("CUSTOM_TERMINAL").reasonCode, "CUSTOM_TERMINAL");
  const created = { caseId: "PC-direct" };
  assert.deepEqual(reducePlanningCaseEvent(null, { type: "CASE_CREATED", at: NOW, data: { snapshot: created } }), created);
  assert.throws(
    () => reducePlanningCaseEvent(created, { type: "CASE_CREATED", at: NOW, data: { snapshot: created } }),
    (error) => error.code === "INVALID_CASE_EVENT",
  );
  assert.throws(
    () => reducePlanningCaseEvent(null, { type: "UNKNOWN", at: NOW, data: {} }),
    (error) => error.code === "INVALID_CASE_EVENT",
  );
  assert.throws(
    () => reducePlanningCaseEvent({}, { type: "UNKNOWN", at: NOW, data: {} }),
    (error) => error.code === "UNKNOWN_CASE_EVENT",
  );
});

test("Planning Case replay preserves facts from a registered historical producer build", (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-events-historical-producer-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const store = createPlanningCaseStore({ stateDir, clock: () => NOW, idGenerator: () => "PC-historical-producer" });
  store.create({ target: TARGET, caseId: "PC-historical-producer" });
  const snapshot = store.get({ caseId: "PC-historical-producer" });
  const historical = fact("F-historical", "human.targetSelected", true);
  historical.source.producerDigest = digest("registered-producer-at-record-time");
  const event = { type: "FACT_ATTACHED", at: NOW, data: { fact: historical } };

  assert.throws(
    () => reducePlanningCaseEvent(snapshot, event),
    (error) => error.code === "FACT_PRODUCER_DIGEST_MISMATCH",
  );
  const replayed = reducePlanningCaseEvent(snapshot, event, { replay: true });
  assert.deepEqual(replayed.facts, [historical]);
});

test("Planning Case v2 reduces every domain event and replays identically", (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-events-v2-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const store = createPlanningCaseStore({ stateDir, clock: () => NOW, idGenerator: () => "PC-events" });
  store.create({ target: TARGET, caseId: "PC-events" });

  const targetSelected = fact("F-target", "human.targetSelected", true);
  store.transition({
    caseId: "PC-events",
    checkpoint: { schema: "pi-ticket-planning:checkpoint:v2", lane: "PRODUCT", stage: "FRAME", verdict: "FRAME_CANDIDATE", subject },
    facts: [targetSelected],
    rebind: true,
    nextAction: nextAction("PRODUCT/FRAME/FRAME_CANDIDATE"),
  });

  const candidate = { id: "C1", revision: "r1", digest: digest("candidate"), title: "Candidate one" };
  store.record({ caseId: "PC-events", type: "CANDIDATE_SELECTED", data: { candidate } });
  store.record({ caseId: "PC-events", type: "CANDIDATE_EXCLUDED", data: { candidate: { ...candidate, id: "C2", digest: digest("candidate-2") } } });
  store.record({ caseId: "PC-events", type: "DECISION_RECORDED", data: { decision: { id: "D1", subject, decision: "Proceed", rationaleRef: "operator:D1", observedAt: NOW } } });
  store.record({ caseId: "PC-events", type: "UNKNOWN_RECORDED", data: { unknown: { id: "U1", question: "Does it work?", truthOwner: "test", status: "OPEN", resolution: null, evidenceDigest: null } } });
  store.record({ caseId: "PC-events", type: "UNKNOWN_RESOLVED", data: { unknownId: "U1", resolution: "Yes", evidenceDigest: digest("evidence") } });
  store.record({ caseId: "PC-events", type: "ASSUMPTION_RECORDED", data: { assumption: { id: "A1", statement: "Assume one", status: "ACTIVE", evidenceDigest: null } } });
  store.record({ caseId: "PC-events", type: "ASSUMPTION_REVISED", data: { assumptionId: "A1", statement: "Assume two", evidenceDigest: digest("assumption") } });
  store.record({ caseId: "PC-events", type: "EVIDENCE_METHOD_SET", data: { method: { kind: "PROBE", truthOwner: "runtime", cost: "LOW", stoppingRule: "One exact pass", reasonCode: "PROBE_SELECTED" } } });
  store.record({ caseId: "PC-events", type: "EVIDENCE_RECORDED", data: { evidence: { id: "EV1", kind: "probe", ref: "local:probe", digest: digest("probe"), observedAt: NOW } } });
  const readiness = fact("F-readiness", "release.readinessPassed", true);
  store.record({ caseId: "PC-events", type: "FACT_ATTACHED", data: { fact: readiness } });
  store.record({ caseId: "PC-events", type: "FACT_CONSUMED", data: { factId: readiness.id, mutationId: "M1" } });
  store.record({ caseId: "PC-events", type: "BLOCKER_SET", data: { blocker: { id: "B1", code: "WAITING", reason: "Wait", requiredFacts: ["release.readinessPassed"] } } });
  store.record({ caseId: "PC-events", type: "BLOCKER_CLEARED", data: { id: "B1" } });
  store.record({ caseId: "PC-events", type: "NEXT_ACTION_SET", data: { nextAction: nextAction("PRODUCT/FRAME/FRAME_CANDIDATE") } });

  const bindingFile = path.join(stateDir, "binding.txt");
  fs.writeFileSync(bindingFile, "bound\n", { mode: 0o600 });
  const bindingDigest = digest("bound\n");
  store.bind({ caseId: "PC-events", name: "source", binding: {
    schema: "pi-ticket-planning:planning-case-binding:v1", target: TARGET, revision: "r1", baseSha: "a".repeat(40), digest: bindingDigest,
    producer: "test", observedAt: NOW, expiresAt: null, verification: { kind: "FILE", ref: bindingFile, digest: bindingDigest },
  } });
  store.clearBinding({ caseId: "PC-events", name: "source" });

  const planFingerprint = digest("plan");
  const activation = fact("F-activation", "human.activation", true, { ...subject, kind: "admission-plan", id: planFingerprint, digest: planFingerprint });
  store.addApproval({ caseId: "PC-events", approval: activation });
  let transaction = {
    schema: "pi-ticket-planning:admission-transaction:v1", caseId: "PC-events", target: TARGET,
    planFingerprint, reviewedFingerprint: digest("reviewed"), graphFingerprint: digest("graph"), sourceRevision: "r1",
    approvalId: activation.id, mutationId: `admission:${planFingerprint}`, state: "ADMISSION_PLANNED",
    startedAt: NOW, updatedAt: NOW, externalProjectionDigest: null, completedOperations: [],
  };
  for (const state of ["ADMISSION_PLANNED", "ADMISSION_AUTHORIZED", "ADMISSION_APPLYING"]) {
    transaction = { ...transaction, state };
    store.changeAdmissionTransaction({ caseId: "PC-events", transaction });
  }
  transaction = { ...transaction, state: "ADMISSION_EXTERNAL_COMPLETE", externalProjectionDigest: digest("external"), completedOperations: ["comment:1"] };
  store.changeAdmissionTransaction({ caseId: "PC-events", transaction });
  store.consumeApproval({ caseId: "PC-events", approvalId: activation.id });
  transaction = { ...transaction, state: "ADMISSION_APPROVAL_CONSUMED" };
  store.changeAdmissionTransaction({ caseId: "PC-events", transaction });
  transaction = { ...transaction, state: "ADMISSION_COMMITTED" };
  store.changeAdmissionTransaction({ caseId: "PC-events", transaction });

  const outcome = buildOutcomeReceipt({
    id: "OR-R1", subject, baseSha: "a".repeat(40), source: { kind: "git", producer: "git", producerVersion: "test", producerDigest: digest("git") },
    observedAt: NOW, status: "ACHIEVED", evidence: [{ kind: "git", ref: "commit", digest: digest("commit") }],
  });
  store.ingestOutcome({ caseId: "PC-events", receipt: outcome });
  const learningApproval = fact("F-learning", "human.outcomeLearningDecision", "NO_CHANGE");
  store.addApproval({ caseId: "PC-events", approval: learningApproval });
  store.consumeApproval({ caseId: "PC-events", approvalId: learningApproval.id });
  store.record({ caseId: "PC-events", type: "LEARNING_DECISION_RECORDED", data: { learning: {
    decision: "NO_CHANGE", subject, outcomeReceiptDigest: outcome.digest, operatorApproval: learningApproval.id,
    affectedRuleIds: [], rationaleRef: "operator:learning", observedAt: NOW,
  } } });
  store.abandon({ caseId: "PC-events", reason: "done" });

  const snapshot = store.get({ caseId: "PC-events" });
  assert.equal(snapshot.schema, "pi-ticket-planning:planning-case:v2");
  assert.equal(snapshot.unknowns[0].status, "RESOLVED");
  assert.equal(snapshot.assumptions[0].status, "REVISED");
  assert.equal(snapshot.admissionTransaction.state, "ADMISSION_COMMITTED");
  assert.equal(snapshot.learningDecisions[0].decision, "NO_CHANGE");
  assert.equal(snapshot.nextAction.kind, "NONE");
  assert.deepEqual(createPlanningCaseStore({ stateDir, clock: () => NOW }).get({ caseId: "PC-events" }), snapshot);
  assert.deepEqual(store.verify({ caseId: "PC-events" }), { status: "COMPLETE", problems: [] });
});
