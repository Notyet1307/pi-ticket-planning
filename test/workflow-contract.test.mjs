import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateMutation,
  evaluateTransition,
  validateCheckpointState,
  validateContracts,
} from "../scripts/workflow-contract.mjs";
import { parseLegacyCheckpoint } from "../protocol/legacy-adapter.mjs";
import { producerAttestationSource } from "../protocol/kernel.mjs";

const subject = {
  target: "github:acme/product",
  kind: "release",
  id: "R001",
  revision: "r2",
  digest: `sha256:${"a".repeat(64)}`,
};
const producer = (kind, name) => {
  const value = producerAttestationSource(kind, name, { producerVersion: "1" });
  return { name: value.producer, version: value.producerVersion, digest: value.producerDigest };
};
const context = {
  target: subject.target,
  subject,
  observedAt: "2026-08-25T00:00:00Z",
  producer: producer("release-readiness-check", "ask-yet"),
  producers: {
    "release-readiness-check": producer("release-readiness-check", "ask-yet"),
    "operator-asserted": producer("operator-asserted", "operator"),
    git: producer("git", "git"),
    "check-admission-state": producer("check-admission-state", "check-admission-state"),
    "git-policy-check": producer("git-policy-check", "git-policy-check"),
    "ticket-readiness-reviewer": producer("ticket-readiness-reviewer", "ticket-readiness-reviewer"),
  },
};
const evidence = { kind: "artifact", ref: "legacy:test", digest: `sha256:${"c".repeat(64)}` };
const fact = (source, extra = {}) => ({ value: true, source, evidence, ...extra });

test("legacy facade delegates contracts and checkpoints to the Kernel", () => {
  assert.deepEqual(validateContracts(), { ok: true, problems: [] });
  const line = "Checkpoint: PRODUCT/EVIDENCE · R001/r2 · NEEDS_RESEARCH";
  const checkpoint = parseLegacyCheckpoint(line, context);
  assert.equal(checkpoint.schema, "pi-ticket-planning:checkpoint:v2");
  assert.deepEqual(validateCheckpointState(checkpoint), []);
});

test("legacy input without exact producer and subject context fails closed", () => {
  assert.throws(
    () => parseLegacyCheckpoint("Checkpoint: PRODUCT/EVIDENCE · R001/r2 · NEEDS_RESEARCH", { target: subject.target }),
    /LEGACY_CONTEXT_INCOMPLETE/,
  );
});

test("legacy transition is converted once and decided by the Kernel", () => {
  const result = evaluateTransition({
    current: { lane: "PRODUCT", stage: "COMMIT", identity: "R001/r2", verdict: "READY_TO_COMMIT" },
    proposed: { lane: "PRODUCT", stage: "COMMIT", identity: "R001/r2", verdict: "COMMITTED" },
    facts: {
      "release.readinessPassed": fact("release-readiness-check", { expiresAt: "2026-08-25T00:30:00Z" }),
      "human.commitment": fact("operator-asserted"),
      "release.persisted": fact("git"),
    },
  }, context);
  assert.equal(result.allowed, true);
});

test("legacy mutation cannot bypass exact same-mutation or approval binding", () => {
  const planFingerprint = `sha256:${"d".repeat(64)}`;
  const approvalSubject = { ...subject, kind: "admission-plan", id: planFingerprint, digest: planFingerprint };
  const mutationContext = {
    ...context,
    subject: { ...subject, kind: "ticket", id: "42" },
    approvalSubject,
    mutationId: `admission:${planFingerprint}`,
  };
  const transition = {
    current: { lane: "DELIVERY", stage: "ADMISSION", identity: "42@r2", verdict: "ACTIVATION_AWAITING_CONFIRMATION" },
    proposed: { lane: "DELIVERY", stage: "ADMISSION", identity: "42@r2", verdict: "ADMITTED" },
    approvalSubject: planFingerprint,
  };
  const facts = {
    "source.unchanged": fact("check-admission-state"),
    "policy.accepted": fact("git-policy-check"),
    "graph.passed": fact("check-admission-state"),
    "review.ready": fact("ticket-readiness-reviewer"),
    "human.activation": fact("operator-asserted", { subject: approvalSubject }),
  };
  assert.equal(evaluateMutation({ mutation: "admission.apply", actor: "admission-cli", transition, facts }, mutationContext).allowed, true);
  assert.equal(evaluateMutation({ mutation: "admission.apply", actor: "llm", transition, facts }, mutationContext).allowed, false);
});
