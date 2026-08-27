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
const SUBJECT = {
  target: "github:acme/product",
  kind: "release",
  id: "100",
  revision: "r1",
  digest: `sha256:${"b".repeat(64)}`,
};
const APPROVAL_SUBJECT = {
  target: SUBJECT.target,
  kind: "execution-handoff-plan",
  id: `sha256:${"c".repeat(64)}`,
  revision: SUBJECT.revision,
  digest: `sha256:${"c".repeat(64)}`,
};

const SOURCE_KIND = {
  "source.unchanged": "execution-plan-compiler",
  "policy.accepted": "git-policy-check",
  "graph.passed": "execution-plan-compiler",
  "review.ready": "ticket-readiness-reviewer",
  "executionPlan.validated": "execution-plan-compiler",
  "controller.readinessPassed": "codex-controller-cli",
  "human.executionHandoff": "operator-asserted",
  "execution.handoffReady": "execution-plan-apply",
};

function fact(name, { id = name, subject = SUBJECT, expiresAt } = {}) {
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
    ...(rule.freshness?.mode === "same-mutation" ? { mutationId: MUTATION_ID } : {}),
    evidence: {
      kind: rule.owner === "human" ? "operator" : "artifact",
      ref: `execution-plan:${name}`,
      digest: `sha256:${"d".repeat(64)}`,
    },
  });
}

function mutationFacts() {
  return [
    fact("source.unchanged"),
    fact("policy.accepted"),
    fact("graph.passed"),
    fact("review.ready"),
    fact("executionPlan.validated"),
    fact("controller.readinessPassed"),
    fact("human.executionHandoff", { subject: APPROVAL_SUBJECT }),
  ];
}

const current = {
  schema: "pi-ticket-planning:checkpoint:v2",
  lane: "DELIVERY",
  stage: "ADMISSION",
  verdict: "ACTIVATION_AWAITING_CONFIRMATION",
  subject: SUBJECT,
};
const proposed = { ...current, stage: "EXECUTION", verdict: "HANDOFF_READY" };

function evaluate(overrides = {}) {
  return evaluateMutation({
    mutation: "executionPlan.apply",
    actor: "execution-plan-apply",
    transition: { current, proposed, approvalSubject: APPROVAL_SUBJECT },
    facts: mutationFacts(),
    consumedApprovalIds: [],
    consumedFactIds: [],
    mutationId: MUTATION_ID,
    now: NOW,
    ...overrides,
  });
}

test("executionPlan.apply is strict, exact-subject-bound, and declares all handoff postconditions", () => {
  const allowed = evaluate();
  assert.equal(allowed.allowed, true);
  assert.deepEqual(allowed.postconditions, [
    "handoff.filesExactReadback",
    "approval.singleConsumed",
    "handoff.receiptExact",
  ]);

  for (const name of loadProtocol().authority.mutations["executionPlan.apply"].requiredFacts) {
    const result = evaluate({ facts: mutationFacts().filter(({ fact: factName }) => factName !== name) });
    assert.equal(result.problems.some(({ code, subject }) => code === "MISSING_REQUIRED_FACT" && subject === name), true, name);
  }
  assert.equal(evaluate({ actor: "admission-cli" }).problems.some(({ code }) => code === "UNAUTHORIZED_MUTATION_ACTOR"), true);
  assert.equal(evaluate({ consumedApprovalIds: ["F-human-executionHandoff"] }).problems.some(({ code }) => code === "APPROVAL_ALREADY_CONSUMED"), true);

  const wrongApproval = mutationFacts();
  wrongApproval.at(-1).subject.id = "foreign";
  assert.equal(evaluate({ facts: wrongApproval }).problems.some(({ code }) => code === "FACT_SUBJECT_MISMATCH"), true);

  const expired = mutationFacts();
  expired.at(-1).expiresAt = "2026-08-20T00:29:59.000Z";
  assert.equal(evaluate({ facts: expired }).problems.some(({ code }) => code === "STALE_FACT"), true);
});

test("HANDOFF_READY requires the generic execution fact and legacy Admission declares that fact", () => {
  const trackerOnly = evaluateTransition({ current, proposed, facts: [fact("tracker.ready")] });
  assert.equal(trackerOnly.problems.some(({ code, subject }) => code === "MISSING_REQUIRED_FACT" && subject === "execution.handoffReady"), true);
  assert.equal(evaluateTransition({ current, proposed, facts: [fact("execution.handoffReady")] }).allowed, true);

  const protocol = loadProtocol();
  for (const name of ["admission.apply", "admission.applyStandaloneAgent", "admission.applyStandaloneHuman"]) {
    assert.equal(protocol.authority.mutations[name].producesFacts.includes("execution.handoffReady"), true, name);
  }
  assert.deepEqual(protocol.authority.facts["execution.handoffReady"].sources.sort(), ["admission-cli", "execution-plan-apply"]);
});
