import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateMutation,
  evaluateTransition,
  parseCheckpoint,
  validateContracts,
} from "../scripts/workflow-contract.mjs";

const releaseIdentity = "R001/r2";
const nextReleaseIdentity = "R002/r1";
const ticketIdentity = "123@r2";

function fact(source, subject) {
  return { value: true, source, ...(subject ? { subject } : {}) };
}

test("workflow contracts load and parse one machine checkpoint", () => {
  assert.deepEqual(validateContracts(), { ok: true, problems: [] });
  assert.deepEqual(
    parseCheckpoint("Checkpoint: PRODUCT/EVIDENCE · R001/r2 · NEEDS_RESEARCH"),
    { lane: "PRODUCT", stage: "EVIDENCE", identity: releaseIdentity, verdict: "NEEDS_RESEARCH" },
  );
});

test("workflow contract rejects unknown states and illegal stage skips", () => {
  const unknown = evaluateTransition({
    current: { lane: "PRODUCT", stage: "FRAME", identity: releaseIdentity, verdict: "FRAME_CANDIDATE" },
    proposed: { lane: "DELIVERY", stage: "TICKETS", identity: releaseIdentity, verdict: "TICKET_GRAPH_CANDIDATE" },
    facts: {},
  });
  assert.equal(unknown.allowed, false);
  assert.equal(unknown.problems.some(({ code }) => code === "ILLEGAL_STAGE_TRANSITION"), true);

  const invented = evaluateTransition({
    current: null,
    proposed: { lane: "PRODUCT", stage: "EVIDENCE", identity: releaseIdentity, verdict: "MODEL_SAYS_READY" },
    facts: {},
  });
  assert.equal(invented.allowed, false);
  assert.equal(invented.problems.some(({ code }) => code === "INVALID_STAGE_VERDICT"), true);
});

test("COMMITTED requires passed readiness and human provenance", () => {
  const transition = {
    current: { lane: "PRODUCT", stage: "COMMIT", identity: releaseIdentity, verdict: "READY_TO_COMMIT" },
    proposed: { lane: "PRODUCT", stage: "COMMIT", identity: releaseIdentity, verdict: "COMMITTED" },
  };
  const notReady = evaluateTransition({
    ...transition,
    facts: {
      "human.commitment": fact("operator-asserted"),
      "release.persisted": fact("git"),
    },
  });
  assert.equal(notReady.allowed, false);
  assert.equal(notReady.problems.some(({ code, subject }) => code === "MISSING_REQUIRED_FACT" && subject === "release.readinessPassed"), true);

  const denied = evaluateTransition({
    ...transition,
    facts: {
      "release.readinessPassed": fact("release-readiness-check"),
      "human.commitment": fact("llm"),
      "release.persisted": fact("git"),
    },
  });
  assert.equal(denied.allowed, false);
  assert.equal(denied.problems.some(({ code }) => code === "UNTRUSTED_FACT_SOURCE"), true);

  const allowed = evaluateTransition({
    ...transition,
    facts: {
      "release.readinessPassed": fact("release-readiness-check"),
      "human.commitment": fact("operator-asserted"),
      "release.persisted": fact("git"),
    },
  });
  assert.equal(allowed.allowed, true);
});

test("HOLD pauses a not-ready Release only after a persisted human decision", () => {
  const transition = {
    current: { lane: "PRODUCT", stage: "EVIDENCE", identity: releaseIdentity, verdict: "NEEDS_RESEARCH" },
    proposed: { lane: "PRODUCT", stage: "COMMIT", identity: releaseIdentity, verdict: "HOLD" },
  };
  const denied = evaluateTransition({
    ...transition,
    facts: {
      "human.releaseDecision": fact("llm"),
      "release.persisted": fact("git"),
    },
  });
  assert.equal(denied.allowed, false);
  assert.equal(denied.problems.some(({ code, subject }) => code === "UNTRUSTED_FACT_SOURCE" && subject === "human.releaseDecision:llm"), true);

  const allowed = evaluateTransition({
    ...transition,
    facts: {
      "human.releaseDecision": fact("operator-asserted"),
      "release.persisted": fact("git"),
    },
  });
  assert.equal(allowed.allowed, true);

  const resume = {
    current: { lane: "PRODUCT", stage: "COMMIT", identity: releaseIdentity, verdict: "HOLD" },
    proposed: { lane: "PRODUCT", stage: "EVIDENCE", identity: "R001/r3", verdict: "NEEDS_RESEARCH" },
  };
  const premature = evaluateTransition({ ...resume, facts: {} });
  assert.equal(premature.allowed, false);
  assert.equal(premature.problems.some(({ code, subject }) => code === "MISSING_REQUIRED_FACT" && subject === "release.reopenConditionMet"), true);
  assert.equal(premature.problems.some(({ code, subject }) => code === "MISSING_REQUIRED_FACT" && subject === "human.releaseReopened"), true);

  const reopened = evaluateTransition({
    ...resume,
    facts: {
      "release.reopenConditionMet": fact("reopen-condition-check"),
      "human.releaseReopened": fact("operator-asserted"),
    },
  });
  assert.equal(reopened.allowed, true);

  const independentRelease = evaluateTransition({
    current: resume.current,
    proposed: { lane: "PRODUCT", stage: "FRAME", identity: nextReleaseIdentity, verdict: "FRAME_CANDIDATE" },
    facts: {},
  });
  assert.equal(independentRelease.allowed, true);
});

test("REWORK resumes only from one persisted active action", () => {
  const transition = {
    current: { lane: "PRODUCT", stage: "COMMIT", identity: releaseIdentity, verdict: "REWORK" },
    proposed: { lane: "PRODUCT", stage: "EVIDENCE", identity: releaseIdentity, verdict: "NEEDS_RESEARCH" },
  };
  const missing = evaluateTransition({ ...transition, facts: {} });
  assert.equal(missing.allowed, false);
  assert.equal(missing.problems.some(({ code, subject }) => code === "MISSING_REQUIRED_FACT" && subject === "release.reworkActionRecorded"), true);

  const allowed = evaluateTransition({
    ...transition,
    facts: { "release.reworkActionRecorded": fact("git") },
  });
  assert.equal(allowed.allowed, true);
});

test("a durable draft Release cannot enter SPEC until its blob is accepted", () => {
  const transition = {
    current: { lane: "PRODUCT", stage: "COMMIT", identity: releaseIdentity, verdict: "COMMITTED" },
    proposed: { lane: "DELIVERY", stage: "SPEC", identity: releaseIdentity, verdict: "SPEC_IN_PROGRESS" },
  };
  const facts = {
    "human.commitment": fact("operator-asserted"),
    "release.persisted": fact("git"),
    "git.deliveryBase": fact("git"),
  };

  const draftOnly = evaluateTransition({ ...transition, facts });
  assert.equal(draftOnly.allowed, false);
  assert.equal(draftOnly.problems.some(({ code, subject }) => code === "MISSING_REQUIRED_FACT" && subject === "release.accepted"), true);

  facts["release.accepted"] = fact("accepted-artifact");
  assert.equal(evaluateTransition({ ...transition, facts }).allowed, true);
});

test("an approved local greenfield Release can reach COMMITTED before repository setup", () => {
  const result = evaluateTransition({
    current: { lane: "PRODUCT", stage: "COMMIT", identity: releaseIdentity, verdict: "READY_TO_COMMIT" },
    proposed: { lane: "PRODUCT", stage: "COMMIT", identity: releaseIdentity, verdict: "COMMITTED" },
    facts: {
      "release.readinessPassed": fact("release-readiness-check"),
      "human.commitment": fact("operator-asserted"),
      "release.persisted": fact("approved-local-artifact"),
    },
  });

  assert.equal(result.allowed, true);
});

test("Admission mutation requires the CLI actor and exact approved fingerprint", () => {
  const fingerprint = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const transition = {
    current: { lane: "DELIVERY", stage: "ADMISSION", identity: ticketIdentity, verdict: "ACTIVATION_AWAITING_CONFIRMATION" },
    proposed: { lane: "DELIVERY", stage: "ADMISSION", identity: ticketIdentity, verdict: "ADMITTED" },
    approvalSubject: fingerprint,
  };
  const facts = {
    "source.unchanged": fact("check-admission-state"),
    "policy.accepted": fact("git-policy-check"),
    "graph.passed": fact("check-admission-state"),
    "review.ready": fact("ticket-readiness-reviewer"),
    "human.activation": fact("operator-asserted", fingerprint),
    "tracker.ready": fact("admission-cli"),
  };

  assert.equal(evaluateMutation({ mutation: "admission.apply", actor: "llm", transition, facts }).allowed, false);
  assert.equal(evaluateMutation({ mutation: "admission.apply", actor: "admission-cli", transition, facts }).allowed, true);

  facts["human.activation"] = fact("operator-asserted", "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  const wrongSnapshot = evaluateMutation({ mutation: "admission.apply", actor: "admission-cli", transition, facts });
  assert.equal(wrongSnapshot.allowed, false);
  assert.equal(wrongSnapshot.problems.some(({ code }) => code === "APPROVAL_SUBJECT_MISMATCH"), true);
});
