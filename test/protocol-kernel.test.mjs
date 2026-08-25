import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createFactAttestation,
  evaluateMutation,
  evaluateTransition,
  loadProtocol,
  parseArtifactIdentity,
  validateArtifact,
  validateCodeSchemaCoverage,
  validateFactAttestation,
  validateProtocolRules,
  validateRegistry,
  verifyProtocol,
} from "../protocol/kernel.mjs";

const TARGET = "github:Notyet1307/example";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SUBJECT = {
  target: TARGET,
  kind: "release",
  id: "R001",
  revision: "r1",
  digest: `sha256:${"1".repeat(64)}`,
};

function fact(name, value = true, overrides = {}) {
  return createFactAttestation({
    id: `F-${name.replaceAll(".", "-")}`,
    fact: name,
    value,
    subject: SUBJECT,
    source: {
      kind: "release-readiness-check",
      producer: "pi-ticket-planning",
      producerVersion: "0.5.0-dev",
      producerDigest: `sha256:${"2".repeat(64)}`,
    },
    observedAt: "2026-08-25T00:00:00.000Z",
    expiresAt: null,
    evidence: {
      kind: "receipt",
      ref: "local:release-readiness/R001/r1",
      digest: `sha256:${"3".repeat(64)}`,
    },
    ...overrides,
  });
}

test("protocol registry resolves every current artifact and rejects unknown majors", () => {
  const protocol = loadProtocol();
  assert.equal(protocol.registry.schema, "pi-ticket-planning:artifact-registry:v1");
  assert.equal(protocol.registry.artifacts.length > 10, true);

  const current = parseArtifactIdentity("pi-ticket-planning:admission-plan:v1", protocol.registry);
  assert.deepEqual(current, { namespace: "pi-ticket-planning", name: "admission-plan", major: 1 });
  assert.throws(
    () => parseArtifactIdentity("pi-ticket-planning:admission-plan:v2", protocol.registry),
    /UNSUPPORTED_ARTIFACT_MAJOR/,
  );
  assert.throws(
    () => validateArtifact({ schema: "pi-ticket-planning:planning-case:v99" }, { protocol }),
    /UNSUPPORTED_ARTIFACT_MAJOR/,
  );
});

test("artifact registry has one writer, declared readers, and existing unique schemas", () => {
  assert.deepEqual(validateRegistry(), { ok: true, problems: [] });
  assert.deepEqual(validateCodeSchemaCoverage(), { ok: true, problems: [] });
  assert.deepEqual(validateProtocolRules(), { ok: true, problems: [] });
});

test("FactAttestation binds producer, subject, freshness, and evidence", () => {
  const attestation = fact("release.readinessPassed");
  assert.equal(validateFactAttestation(attestation).ok, true);

  const wrongProducer = structuredClone(attestation);
  wrongProducer.source.kind = "operator-asserted";
  assert.deepEqual(
    validateFactAttestation(wrongProducer).problems.map(({ code }) => code),
    ["FACT_PRODUCER_NOT_ALLOWED"],
  );

  const wrongSubject = structuredClone(attestation);
  wrongSubject.subject.target = "github:other/repo";
  assert.equal(validateFactAttestation(wrongSubject, { expectedSubject: SUBJECT }).problems[0].code, "FACT_SUBJECT_MISMATCH");
});

test("transition validation rejects illegal lane-stage combinations and identity jumps", () => {
  const valid = evaluateTransition({
    current: null,
    proposed: {
      schema: "pi-ticket-planning:checkpoint:v2",
      lane: "PRODUCT",
      stage: "COMMIT",
      verdict: "READY_TO_COMMIT",
      subject: SUBJECT,
    },
    facts: [fact("release.readinessPassed")],
    now: "2026-08-25T00:01:00.000Z",
  });
  assert.equal(valid.allowed, true);

  const illegalCombination = evaluateTransition({
    current: null,
    proposed: {
      schema: "pi-ticket-planning:checkpoint:v2",
      lane: "PRODUCT",
      stage: "ADMISSION",
      verdict: "BLOCKED",
      subject: SUBJECT,
    },
  });
  assert.equal(illegalCombination.problems.some(({ code }) => code === "INVALID_LANE_STAGE"), true);

  const jumped = evaluateTransition({
    current: {
      schema: "pi-ticket-planning:checkpoint:v2",
      lane: "PRODUCT",
      stage: "FRAME",
      verdict: "FRAME_CANDIDATE",
      subject: SUBJECT,
    },
    proposed: {
      schema: "pi-ticket-planning:checkpoint:v2",
      lane: "PRODUCT",
      stage: "EVIDENCE",
      verdict: "NEEDS_RESEARCH",
      subject: { ...SUBJECT, id: "R002" },
    },
  });
  assert.equal(jumped.problems.some(({ code }) => code === "ILLEGAL_IDENTITY_TRANSITION"), true);
});

test("strict mutation consumes one exact approval and declares postconditions", () => {
  const planFingerprint = `sha256:${"4".repeat(64)}`;
  const approvalSubject = { ...SUBJECT, kind: "admission-plan", id: planFingerprint, digest: planFingerprint };
  const facts = [
    fact("source.unchanged", true, { source: { ...fact("release.readinessPassed").source, kind: "check-admission-state" } }),
    fact("policy.accepted", true, { source: { ...fact("release.readinessPassed").source, kind: "git-policy-check" } }),
    fact("graph.passed", true, { source: { ...fact("release.readinessPassed").source, kind: "check-admission-state" } }),
    fact("review.ready", true, { source: { ...fact("release.readinessPassed").source, kind: "ticket-readiness-reviewer" } }),
    fact("human.activation", true, {
      subject: approvalSubject,
      source: { ...fact("release.readinessPassed").source, kind: "operator-asserted", producer: "operator" },
    }),
  ];
  const transition = {
    current: {
      schema: "pi-ticket-planning:checkpoint:v2",
      lane: "DELIVERY",
      stage: "ADMISSION",
      verdict: "ACTIVATION_AWAITING_CONFIRMATION",
      subject: SUBJECT,
    },
    proposed: {
      schema: "pi-ticket-planning:checkpoint:v2",
      lane: "DELIVERY",
      stage: "ADMISSION",
      verdict: "ADMITTED",
      subject: SUBJECT,
    },
    approvalSubject,
  };

  const allowed = evaluateMutation({
    mutation: "admission.apply",
    actor: "admission-cli",
    transition,
    facts,
    consumedApprovalIds: [],
    now: "2026-08-25T00:01:00.000Z",
  });
  assert.equal(allowed.allowed, true);
  assert.deepEqual(allowed.postconditions, [
    "comments.exactReadback",
    "labels.exactControlledState",
    "activation.parentLast",
    "harness.noClaimDuringApply",
    "tracker.matchesPlan",
  ]);

  const replay = evaluateMutation({
    mutation: "admission.apply",
    actor: "admission-cli",
    transition,
    facts,
    consumedApprovalIds: [facts.at(-1).id],
  });
  assert.equal(replay.problems.some(({ code }) => code === "APPROVAL_ALREADY_CONSUMED"), true);
});

test("protocol model checker reports a closed reachable machine", () => {
  assert.deepEqual(verifyProtocol(), {
    reachableStates: "9/9",
    unreachableStates: [],
    undeclaredDeadEnds: [],
    factsWithoutProducer: [],
    factsWithoutConsumer: [],
    mutationsWithoutPostconditions: [],
    ambiguousAuthorityOwners: [],
    invalidIdentityTransitions: [],
  });
});

test("verify:protocol CLI emits the stable machine report", () => {
  const run = spawnSync(process.execPath, ["scripts/verify-protocol.mjs"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), verifyProtocol());
});
