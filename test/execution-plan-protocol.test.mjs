import assert from "node:assert/strict";
import test from "node:test";

import {
  createFactAttestation,
  evaluateMutation,
  evaluateTransition,
  loadProtocol,
  producerAttestationSource,
} from "../protocol/kernel.mjs";

const NOW = "2026-08-20T00:30:00.000Z";
const MUTATION_ID = `execution-plan-apply:sha256:${"a".repeat(64)}`;
const APPROVAL_MUTATION_ID = `execution-plan-approve:sha256:${"a".repeat(64)}`;
const SUBJECT = {
  target: "github:acme/product",
  kind: "release",
  id: "100",
  revision: "r1",
  digest: `sha256:${"b".repeat(64)}`,
};
const APPROVAL_SUBJECT = {
  target: SUBJECT.target,
  kind: "release-plan",
  id: `sha256:${"c".repeat(64)}`,
  revision: SUBJECT.revision,
  digest: `sha256:${"c".repeat(64)}`,
};

const SOURCE_KIND = {
  "source.unchanged": "execution-plan-compiler",
  "policy.accepted": "git-policy-check",
  "graph.passed": "execution-plan-compiler",
  "oracles.bound": "execution-plan-compiler",
  "review.ready": "ticket-readiness-reviewer",
  "executionPlan.validated": "execution-plan-compiler",
  "human.executionHandoff": "operator-asserted",
  "handoff.approved": "execution-plan-apply",
  "execution.handoffReady": "execution-plan-apply",
};

function fact(name, { id = name, subject = SUBJECT, expiresAt, mutationId = MUTATION_ID } = {}) {
  const protocol = loadProtocol();
  const rule = { ...protocol.authority.factDefaults, ...protocol.authority.facts[name] };
  const sourceKind = SOURCE_KIND[name] ?? rule.sources[0];
  const producer = protocol.producers.sources[sourceKind].producers[0];
  return createFactAttestation({
    id: `F-${id.replaceAll(".", "-")}`,
    fact: name,
    value: true,
    subject,
    source: producerAttestationSource(sourceKind, producer, { protocol, producerVersion: "test" }),
    observedAt: NOW,
    expiresAt: expiresAt ?? (rule.freshness?.mode === "max-age" ? "2026-08-20T01:30:00.000Z" : null),
    ...(rule.freshness?.mode === "same-mutation" ? { mutationId } : {}),
    evidence: {
      kind: rule.owner === "human" ? "operator" : "artifact",
      ref: `execution-plan:${name}`,
      digest: `sha256:${"d".repeat(64)}`,
    },
  });
}

function mutationFacts(mutationId = MUTATION_ID) {
  return [
    fact("source.unchanged", { mutationId }),
    fact("policy.accepted", { mutationId }),
    fact("graph.passed", { mutationId }),
    fact("oracles.bound", { mutationId }),
    fact("review.ready", { mutationId }),
    fact("executionPlan.validated", { mutationId }),
    fact("human.executionHandoff", { subject: APPROVAL_SUBJECT, mutationId }),
  ];
}

function applyFacts() {
  return [...mutationFacts(), fact("handoff.approved")];
}

const current = {
  schema: "pi-ticket-planning:checkpoint:v2",
  lane: "DELIVERY",
  stage: "ADMISSION",
  verdict: "ACTIVATION_AWAITING_CONFIRMATION",
  subject: SUBJECT,
};
const approved = { ...current, verdict: "HANDOFF_APPROVED" };
const proposed = { ...current, stage: "EXECUTION", verdict: "HANDOFF_READY" };

function evaluate(overrides = {}) {
  return evaluateMutation({
    mutation: "executionPlan.apply",
    actor: "execution-plan-apply",
    transition: { current: approved, proposed, approvalSubject: APPROVAL_SUBJECT },
    facts: applyFacts(),
    consumedApprovalIds: [],
    consumedFactIds: [],
    mutationId: MUTATION_ID,
    now: NOW,
    ...overrides,
  });
}

function evaluateApproval(overrides = {}) {
  return evaluateMutation({
    mutation: "executionPlan.approve",
    actor: "execution-plan-apply",
    transition: { current, proposed: approved, approvalSubject: APPROVAL_SUBJECT },
    facts: mutationFacts(APPROVAL_MUTATION_ID),
    consumedApprovalIds: [],
    consumedFactIds: [],
    mutationId: APPROVAL_MUTATION_ID,
    now: NOW,
    ...overrides,
  });
}

test("executionPlan.apply is strict, exact-subject-bound, and declares all handoff postconditions", () => {
  const approval = evaluateApproval();
  assert.equal(approval.allowed, true);
  assert.deepEqual(approval.postconditions, ["approval.exactPending"]);
  const allowed = evaluate();
  assert.equal(allowed.allowed, true);
  assert.deepEqual(allowed.postconditions, [
    "handoff.releasePlanExactReadback",
    "approval.singleConsumed",
  ]);

  for (const name of loadProtocol().authority.mutations["executionPlan.approve"].requiredFacts) {
    const result = evaluateApproval({ facts: mutationFacts(APPROVAL_MUTATION_ID).filter(({ fact: factName }) => factName !== name) });
    assert.equal(result.problems.some(({ code, subject }) => code === "MISSING_REQUIRED_FACT" && subject === name), true, `approve:${name}`);
  }

  for (const name of loadProtocol().authority.mutations["executionPlan.apply"].requiredFacts) {
    const result = evaluate({ facts: applyFacts().filter(({ fact: factName }) => factName !== name) });
    assert.equal(result.problems.some(({ code, subject }) => code === "MISSING_REQUIRED_FACT" && subject === name), true, name);
  }
  assert.equal(evaluate({ actor: "admission-cli" }).problems.some(({ code }) => code === "UNAUTHORIZED_MUTATION_ACTOR"), true);
  assert.equal(evaluate({ consumedApprovalIds: ["F-human-executionHandoff"] }).problems.some(({ code }) => code === "APPROVAL_ALREADY_CONSUMED"), true);

  const wrongApproval = applyFacts();
  wrongApproval.find(({ fact: name }) => name === "human.executionHandoff").subject.id = "foreign";
  assert.equal(evaluate({ facts: wrongApproval }).problems.some(({ code }) => code === "FACT_SUBJECT_MISMATCH"), true);

  const expired = applyFacts();
  expired.find(({ fact: name }) => name === "human.executionHandoff").expiresAt = "2026-08-20T00:29:59.000Z";
  assert.equal(evaluate({ facts: expired }).problems.some(({ code }) => code === "STALE_FACT"), true);
});

test("HANDOFF_READY requires the generic execution fact and legacy Admission declares that fact", () => {
  const trackerOnly = evaluateTransition({ current: approved, proposed, facts: [fact("tracker.ready")] });
  assert.equal(trackerOnly.problems.some(({ code, subject }) => code === "MISSING_REQUIRED_FACT" && subject === "execution.handoffReady"), true);
  assert.equal(evaluateTransition({ current: approved, proposed, facts: [fact("execution.handoffReady")] }).allowed, true);

  const protocol = loadProtocol();
  for (const name of ["admission.apply", "admission.applyStandaloneAgent", "admission.applyStandaloneHuman"]) {
    assert.equal(protocol.authority.mutations[name].producesFacts.includes("execution.handoffReady"), true, name);
  }
  assert.deepEqual(protocol.authority.facts["execution.handoffReady"].sources.sort(), ["admission-cli", "execution-plan-apply", "goal-handoff-apply"]);
});
