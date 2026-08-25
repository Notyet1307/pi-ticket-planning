import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

test("Registry and Rule corruption produce stable fail-closed codes", () => {
  const cases = [
    ["DUPLICATE_ARTIFACT_NAME", (protocol) => protocol.registry.artifacts.push(structuredClone(protocol.registry.artifacts[0]))],
    ["INVALID_CURRENT_SCHEMA_IDENTITY", (protocol) => { protocol.registry.artifacts[0].schemaIdentity = "pi-ticket-planning:artifact-registry:v2"; }],
    ["INVALID_READABLE_MAJORS", (protocol) => { protocol.registry.artifacts[0].readableMajors = []; }],
    ["MISSING_ARTIFACT_WRITER", (protocol) => { protocol.registry.artifacts[0].writer = ""; }],
    ["MISSING_ARTIFACT_READERS", (protocol) => { protocol.registry.artifacts[0].readers = []; }],
    ["MISSING_FINGERPRINT_ALGORITHM", (protocol) => { protocol.registry.artifacts[0].fingerprintAlgorithm = ""; }],
    ["MISSING_ARTIFACT_SCHEMA", (protocol) => { protocol.registry.artifacts[0].schemaPath = "schemas/missing.schema.json"; }],
    ["MISSING_ARTIFACT_MIGRATION", (protocol) => { protocol.registry.artifacts.find(({ name }) => name === "delivery-graph").migrationPath = null; }],
    ["MISSING_ARTIFACT_MIGRATION", (protocol) => { protocol.registry.artifacts.find(({ name }) => name === "delivery-graph").migrationPath = "scripts/missing.mjs#x"; }],
  ];
  for (const [code, mutate] of cases) {
    const protocol = loadProtocol();
    mutate(protocol);
    assert.equal(validateRegistry({ protocol }).problems.some((item) => item.code === code), true, code);
  }

  const rules = loadProtocol();
  rules.rules.rules.push(structuredClone(rules.rules.rules[0]));
  rules.rules.rules[0].ownerPath = "missing";
  rules.rules.rules[1].status = "invalid";
  rules.rules.rules[2].status = "deprecated";
  rules.rules.rules[2].replacement = "PTP-MISSING-999";
  assert.equal(validateProtocolRules({ protocol: rules }).ok, false);
  assert.deepEqual(new Set(validateProtocolRules({ protocol: rules }).problems.map(({ code }) => code)), new Set([
    "MISSING_RULE_OWNER", "INCOMPLETE_RULE_DECLARATION", "DUPLICATE_ACTIVE_RULE", "MISSING_RULE_REPLACEMENT",
  ]));
});

test("Fact, Checkpoint, and Mutation malformed branches fail closed", () => {
  const base = fact("release.readinessPassed");
  for (const [code, mutate] of [
    ["INVALID_FACT_SCHEMA", (value) => { value.schema = "bad"; }],
    ["INVALID_FACT_ID", (value) => { value.id = "bad"; }],
    ["INVALID_FACT_NAME", (value) => { value.fact = "bad"; }],
    ["INVALID_FACT_SUBJECT", (value) => { value.subject.digest = "bad"; }],
    ["INVALID_FACT_SOURCE", (value) => { value.source.producerDigest = "bad"; }],
    ["INVALID_FACT_OBSERVED_AT", (value) => { value.observedAt = "bad"; }],
    ["INVALID_FACT_EXPIRES_AT", (value) => { value.expiresAt = "bad"; }],
    ["INVALID_FACT_EVIDENCE", (value) => { value.evidence.digest = "bad"; }],
  ]) {
    const value = structuredClone(base);
    mutate(value);
    assert.equal(validateFactAttestation(value).problems.some((item) => item.code === code), true, code);
  }
  assert.equal(validateFactAttestation(null).problems[0].code, "INVALID_FACT_ATTESTATION");
  const future = structuredClone(base);
  assert.equal(validateFactAttestation(future, { now: "2026-08-24T00:00:00Z" }).problems[0].code, "FACT_FROM_FUTURE");
  const expired = structuredClone(base);
  expired.expiresAt = "2026-08-25T00:00:01Z";
  assert.equal(validateFactAttestation(expired, { now: "2026-08-25T01:00:00Z" }).problems.some(({ code }) => code === "STALE_FACT"), true);
  assert.equal(validateFactAttestation(base, { now: "2026-08-25T02:00:01Z" }).problems.some(({ code }) => code === "STALE_FACT"), true);

  assert.throws(() => parseArtifactIdentity("bad"), /INVALID_ARTIFACT_IDENTITY/);
  assert.throws(() => parseArtifactIdentity("pi-ticket-planning:missing:v1"), /UNKNOWN_ARTIFACT/);
  assert.throws(() => validateArtifact(null), /INVALID_ARTIFACT/);
  const invalidCheckpoint = validateArtifact({
    schema: "pi-ticket-planning:checkpoint:v2",
    lane: "NOPE",
    stage: "NOPE",
    verdict: "NOPE",
    subject: SUBJECT,
  });
  assert.equal(invalidCheckpoint.ok, false);
  assert.equal(validateArtifact({ ...invalidCheckpoint, schema: "pi-ticket-planning:result-envelope:v1" }).ok, true);
  const badSubjectCheckpoint = validateArtifact({
    schema: "pi-ticket-planning:checkpoint:v2",
    lane: "PRODUCT",
    stage: "FRAME",
    verdict: "FRAME_CANDIDATE",
    subject: { ...SUBJECT, digest: "bad" },
  });
  assert.equal(badSubjectCheckpoint.problems.some(({ code }) => code === "INVALID_CHECKPOINT_SUBJECT"), true);
  const illegal = evaluateTransition({
    current: { schema: "pi-ticket-planning:checkpoint:v2", lane: "PRODUCT", stage: "COMMIT", verdict: "READY_TO_COMMIT", subject: SUBJECT },
    proposed: { schema: "pi-ticket-planning:checkpoint:v2", lane: "DELIVERY", stage: "ADMISSION", verdict: "BLOCKED", subject: SUBJECT },
  });
  assert.equal(illegal.problems.some(({ code }) => code === "ILLEGAL_STAGE_TRANSITION"), true);

  const transition = {
    current: { schema: "pi-ticket-planning:checkpoint:v2", lane: "DELIVERY", stage: "ADMISSION", verdict: "ACTIVATION_AWAITING_CONFIRMATION", subject: SUBJECT },
    proposed: { schema: "pi-ticket-planning:checkpoint:v2", lane: "DELIVERY", stage: "ADMISSION", verdict: "ADMITTED", subject: SUBJECT },
    approvalSubject: { ...SUBJECT, kind: "admission-plan", id: `sha256:${"4".repeat(64)}`, digest: `sha256:${"4".repeat(64)}` },
  };
  assert.equal(evaluateMutation({ mutation: "missing", actor: "x", transition }).problems[0].code, "UNKNOWN_MUTATION");
  const denied = evaluateMutation({ mutation: "admission.apply", actor: "model", transition, facts: [] });
  assert.equal(denied.problems.some(({ code }) => code === "UNAUTHORIZED_MUTATION_ACTOR"), true);
  assert.equal(denied.problems.some(({ code }) => code === "MISSING_REQUIRED_FACT"), true);
});

test("protocol links, schema files, code coverage, and explicit rebind are exercised", (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-protocol-negative-"));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  fs.cpSync(path.join(ROOT, "protocol"), path.join(temporary, "protocol"), { recursive: true });
  fs.cpSync(path.join(ROOT, "contracts"), path.join(temporary, "contracts"), { recursive: true });
  const workflowLink = path.join(temporary, "protocol", "workflow.json");
  fs.writeFileSync(workflowLink, JSON.stringify({ schema: "bad", ownerPath: "contracts/workflow.json" }));
  assert.throws(() => loadProtocol({ root: temporary }), /INVALID_PROTOCOL_LINK/);
  fs.writeFileSync(workflowLink, JSON.stringify({ schema: "pi-ticket-planning:protocol-link:v1", artifact: "workflow", ownerPath: "../escape" }));
  assert.throws(() => loadProtocol({ root: temporary }), /PROTOCOL_LINK_ESCAPE/);

  const invalidRegistry = loadProtocol();
  invalidRegistry.registry = { schema: "bad", artifacts: null };
  assert.equal(validateRegistry({ protocol: invalidRegistry }).problems[0].code, "INVALID_ARTIFACT_REGISTRY");
  const badSchema = loadProtocol();
  badSchema.root = temporary;
  fs.mkdirSync(path.join(temporary, "schemas"));
  fs.writeFileSync(path.join(temporary, "schemas", "bad.schema.json"), "{");
  badSchema.registry.artifacts = [structuredClone(badSchema.registry.artifacts[0])];
  badSchema.registry.artifacts[0].schemaPath = "schemas/bad.schema.json";
  assert.equal(validateRegistry({ protocol: badSchema }).problems.some(({ code }) => code === "INVALID_ARTIFACT_SCHEMA"), true);

  const codeProtocol = loadProtocol();
  codeProtocol.root = temporary;
  fs.mkdirSync(path.join(temporary, "scripts"));
  fs.writeFileSync(path.join(temporary, "scripts", "bad.mjs"), 'const UNKNOWN_SCHEMA = "pi-ticket-planning:unknown-code:v1";\n');
  assert.equal(validateCodeSchemaCoverage({ protocol: codeProtocol }).problems[0].code, "UNREGISTERED_CODE_SCHEMA");
  const invalidRules = loadProtocol();
  invalidRules.rules = { schema: "bad", rules: null };
  assert.equal(validateProtocolRules({ protocol: invalidRules }).problems[0].code, "INVALID_PROTOCOL_RULES");

  const current = { schema: "pi-ticket-planning:checkpoint:v2", lane: "PRODUCT", stage: "OUTCOME", verdict: "ACHIEVED", subject: SUBJECT };
  const proposedSubject = { ...SUBJECT, id: "R002", revision: "r1", digest: `sha256:${"9".repeat(64)}` };
  const proposed = { schema: "pi-ticket-planning:checkpoint:v2", lane: "PRODUCT", stage: "ORIENT", verdict: "NEEDS_TARGET", subject: proposedSubject };
  const rebindFact = fact("human.identityRebind", true, {
    subject: proposedSubject,
    source: { kind: "operator-asserted", producer: "operator", producerVersion: "human", producerDigest: `sha256:${"8".repeat(64)}` },
  });
  assert.equal(evaluateTransition({ current, proposed, facts: [rebindFact], rebind: true }).allowed, true);

  const malformedMutation = evaluateMutation({
    mutation: "admission.apply",
    actor: "admission-cli",
    transition: { current: proposed, proposed: current },
    facts: [rebindFact, rebindFact],
  });
  assert.equal(malformedMutation.problems.some(({ code }) => code === "INVALID_MUTATION_SOURCE"), true);
  assert.equal(malformedMutation.problems.some(({ code }) => code === "INVALID_MUTATION_TRANSITION"), true);
  assert.equal(malformedMutation.problems.some(({ code }) => code === "DUPLICATE_FACT_ATTESTATION"), true);
  assert.equal(malformedMutation.problems.some(({ code }) => code === "MISSING_APPROVAL_SUBJECT"), true);
  assert.equal(validateArtifact(fact("release.readinessPassed")).ok, true);
});

test("kernel guard branches reject duplicates, false facts, and malformed rule graphs", (t) => {
  const duplicateMajors = loadProtocol();
  duplicateMajors.registry.artifacts[0].readableMajors = [1, 1];
  duplicateMajors.registry.artifacts[0].readers = ["x", "x"];
  assert.equal(validateRegistry({ protocol: duplicateMajors }).ok, false);

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-schema-branches-"));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  fs.mkdirSync(path.join(temporary, "schemas"));
  fs.writeFileSync(path.join(temporary, "schemas", "one.schema.json"), JSON.stringify({ $id: "same" }));
  fs.writeFileSync(path.join(temporary, "schemas", "two.schema.json"), JSON.stringify({ $id: "same" }));
  const duplicatedSchema = loadProtocol();
  duplicatedSchema.root = temporary;
  duplicatedSchema.registry.artifacts = duplicatedSchema.registry.artifacts.slice(0, 2);
  duplicatedSchema.registry.artifacts[0].schemaPath = "schemas/one.schema.json";
  duplicatedSchema.registry.artifacts[1].schemaPath = "schemas/two.schema.json";
  assert.equal(validateRegistry({ protocol: duplicatedSchema }).problems.some(({ code }) => code === "DUPLICATE_JSON_SCHEMA_ID"), true);
  fs.writeFileSync(path.join(temporary, "schemas", "two.schema.json"), "{}");
  assert.equal(validateRegistry({ protocol: duplicatedSchema }).problems.some(({ code }) => code === "MISSING_JSON_SCHEMA_ID"), true);

  const malformedRules = loadProtocol();
  malformedRules.rules.rules[0].id = "bad";
  malformedRules.rules.rules[0].ownerPath = null;
  assert.equal(validateProtocolRules({ protocol: malformedRules }).problems.some(({ code }) => code === "INVALID_RULE_ID"), true);

  const unknownFact = structuredClone(fact("release.readinessPassed"));
  unknownFact.fact = "unknown.fact";
  assert.equal(validateFactAttestation(unknownFact).problems.some(({ code }) => code === "UNKNOWN_FACT"), true);
  const mismatched = validateFactAttestation(fact("release.readinessPassed"), { expectedSubject: { ...SUBJECT, id: "other" } });
  assert.equal(mismatched.problems.some(({ code }) => code === "FACT_SUBJECT_MISMATCH"), true);
  const falseFact = fact("release.readinessPassed", false);
  const falseTransition = evaluateTransition({
    current: null,
    proposed: { schema: "pi-ticket-planning:checkpoint:v2", lane: "PRODUCT", stage: "COMMIT", verdict: "READY_TO_COMMIT", subject: SUBJECT },
    facts: [falseFact, falseFact],
  });
  assert.equal(falseTransition.problems.some(({ code }) => code === "DUPLICATE_FACT_ATTESTATION"), true);
  assert.equal(falseTransition.problems.some(({ code }) => code === "MISSING_REQUIRED_FACT"), true);

  const malformedCheckpoint = evaluateTransition({ current: null, proposed: null });
  assert.equal(malformedCheckpoint.problems.some(({ code }) => code === "INVALID_CHECKPOINT"), true);
  const wrongIdentity = evaluateTransition({
    current: null,
    proposed: { schema: "bad", lane: "PRODUCT", stage: "FRAME", verdict: "NOPE", subject: { ...SUBJECT, kind: "ticket" } },
  });
  assert.equal(wrongIdentity.allowed, false);

  const noRebindRule = evaluateTransition({
    current: { schema: "pi-ticket-planning:checkpoint:v2", lane: "PRODUCT", stage: "FRAME", verdict: "FRAME_CANDIDATE", subject: SUBJECT },
    proposed: { schema: "pi-ticket-planning:checkpoint:v2", lane: "PRODUCT", stage: "EVIDENCE", verdict: "NEEDS_RESEARCH", subject: { ...SUBJECT, revision: "r2" } },
    rebind: true,
  });
  assert.equal(noRebindRule.problems.some(({ code }) => code === "ILLEGAL_IDENTITY_TRANSITION"), true);

  const broken = loadProtocol();
  broken.workflow.allowedTransitions.OUTCOME = [];
  broken.workflow.allowedTransitions.SPEC = [];
  broken.authority.facts["release.readinessPassed"].sources = [];
  delete broken.authority.facts["release.readinessPassed"].owner;
  broken.authority.mutations["admission.apply"].postconditions = [];
  broken.workflow.rebindTransitions.push({ sourceStage: "NOPE", targetStage: "NOPE", changes: [], requiredFacts: ["missing"] });
  const report = verifyProtocol({ protocol: broken });
  assert.equal(report.undeclaredDeadEnds.includes("OUTCOME"), true);
  assert.equal(report.factsWithoutProducer.includes("release.readinessPassed"), true);
  assert.equal(report.mutationsWithoutPostconditions.includes("admission.apply"), true);
  assert.equal(report.ambiguousAuthorityOwners.includes("release.readinessPassed"), true);
  assert.equal(report.invalidIdentityTransitions.length > 0, true);
});

test("kernel type guards and human-gate reporting cover alternate branches", () => {
  const malformed = loadProtocol();
  malformed.registry.artifacts[0].currentMajor = "1";
  malformed.registry.artifacts[0].readableMajors = "1";
  malformed.registry.artifacts[0].writer = null;
  malformed.registry.artifacts[0].readers = null;
  malformed.registry.artifacts[0].fingerprintAlgorithm = null;
  malformed.registry.artifacts[0].schemaPath = null;
  assert.equal(validateRegistry({ protocol: malformed }).ok, false);

  const badSubjectFields = ["target", "kind", "id", "revision", "digest"];
  for (const field of badSubjectFields) {
    const value = fact("release.readinessPassed");
    value.subject[field] = "";
    assert.equal(validateFactAttestation(value).problems.some(({ code }) => code === "INVALID_FACT_SUBJECT"), true);
  }
  const noSource = fact("release.readinessPassed");
  noSource.source = null;
  assert.equal(validateFactAttestation(noSource).problems.some(({ code }) => code === "INVALID_FACT_SOURCE"), true);
  const noEvidence = fact("release.readinessPassed");
  noEvidence.evidence = null;
  assert.equal(validateFactAttestation(noEvidence).problems.some(({ code }) => code === "INVALID_FACT_EVIDENCE"), true);

  const humanGate = evaluateTransition({
    current: null,
    proposed: { schema: "pi-ticket-planning:checkpoint:v2", lane: "PRODUCT", stage: "COMMIT", verdict: "COMMITTED", subject: SUBJECT },
    facts: [],
  });
  assert.equal(humanGate.requiredHumanGates.includes("human.commitment"), true);
  const wrongApproval = fact("human.activation", true, {
    subject: { ...SUBJECT, kind: "admission-plan", id: "wrong" },
    source: { kind: "operator-asserted", producer: "operator", producerVersion: "human", producerDigest: `sha256:${"7".repeat(64)}` },
  });
  const sourceCheckpoint = { schema: "pi-ticket-planning:checkpoint:v2", lane: "DELIVERY", stage: "ADMISSION", verdict: "ACTIVATION_AWAITING_CONFIRMATION", subject: SUBJECT };
  const targetCheckpoint = { ...sourceCheckpoint, verdict: "ADMITTED" };
  const mismatch = evaluateMutation({
    mutation: "admission.apply",
    actor: "admission-cli",
    transition: { current: sourceCheckpoint, proposed: targetCheckpoint, approvalSubject: { ...SUBJECT, kind: "admission-plan", id: "expected" } },
    facts: [wrongApproval],
  });
  assert.equal(mismatch.problems.some(({ code }) => code === "FACT_SUBJECT_MISMATCH"), true);
});

test("kernel scoped requirements and supported deprecation paths remain deterministic", () => {
  const deprecated = loadProtocol();
  deprecated.rules.rules[0].status = "deprecated";
  deprecated.rules.rules[0].replacement = deprecated.rules.rules[1].id;
  assert.equal(validateProtocolRules({ protocol: deprecated }).ok, true);

  const withoutDefaults = loadProtocol();
  delete withoutDefaults.authority.factDefaults;
  assert.equal(validateFactAttestation(fact("release.readinessPassed"), { protocol: withoutDefaults }).ok, true);
  const invalidNow = validateFactAttestation(fact("release.readinessPassed"), { now: "not-a-time" });
  assert.equal(invalidNow.ok, true);

  const hold = { schema: "pi-ticket-planning:checkpoint:v2", lane: "PRODUCT", stage: "COMMIT", verdict: "HOLD", subject: SUBJECT };
  const evidence = { schema: "pi-ticket-planning:checkpoint:v2", lane: "PRODUCT", stage: "EVIDENCE", verdict: "NEEDS_RESEARCH", subject: SUBJECT };
  const blocked = evaluateTransition({ current: hold, proposed: evidence, facts: [] });
  assert.equal(blocked.problems.filter(({ code }) => code === "MISSING_REQUIRED_FACT").length, 2);
  const allowed = evaluateTransition({
    current: hold,
    proposed: evidence,
    facts: [
      fact("release.reopenConditionMet", true, { source: { kind: "reopen-condition-check", producer: "checker", producerVersion: "1", producerDigest: `sha256:${"6".repeat(64)}` } }),
      fact("human.releaseReopened", true, { source: { kind: "operator-asserted", producer: "operator", producerVersion: "human", producerDigest: `sha256:${"5".repeat(64)}` } }),
    ],
  });
  assert.equal(allowed.allowed, true);

  const registry = loadProtocol().registry;
  const entry = registry.artifacts.find(({ name }) => name === "admission-plan");
  const saved = entry.readableMajors;
  entry.readableMajors = undefined;
  assert.throws(() => parseArtifactIdentity("pi-ticket-planning:admission-plan:v1", registry), /UNSUPPORTED_ARTIFACT_MAJOR/);
  entry.readableMajors = saved;
});

test("Fact structural predicates reject each control-bearing field", () => {
  const mutations = [
    (value) => { value.subject.target = "bad\n"; },
    (value) => { value.subject.kind = "BAD"; },
    (value) => { value.subject.id = "bad\n"; },
    (value) => { value.subject.revision = "bad\n"; },
    (value) => { value.source.kind = "bad\n"; },
    (value) => { value.source.producer = "bad\n"; },
    (value) => { value.source.producerVersion = "bad\n"; },
    (value) => { value.evidence.kind = "unknown"; },
    (value) => { value.evidence.ref = "bad\n"; },
  ];
  for (const mutate of mutations) {
    const value = fact("release.readinessPassed");
    mutate(value);
    assert.equal(validateFactAttestation(value).ok, false);
  }
  assert.throws(() => parseArtifactIdentity(null), /INVALID_ARTIFACT_IDENTITY/);
  const rules = loadProtocol();
  rules.rules.rules[0].ownerPath = "../escape";
  assert.equal(validateProtocolRules({ protocol: rules }).problems.some(({ code }) => code === "MISSING_RULE_OWNER"), true);

  const noApproval = loadProtocol();
  noApproval.authority.mutations["admission.apply"].approvalFact = null;
  noApproval.authority.mutations["admission.apply"].requiredFacts = [];
  const checkpoint = { schema: "pi-ticket-planning:checkpoint:v2", lane: "DELIVERY", stage: "ADMISSION", verdict: "ACTIVATION_AWAITING_CONFIRMATION", subject: SUBJECT };
  const result = evaluateMutation({
    mutation: "admission.apply",
    actor: "admission-cli",
    transition: { current: checkpoint, proposed: { ...checkpoint, verdict: "ADMITTED" } },
    facts: [],
  }, { protocol: noApproval });
  assert.equal(result.allowed, true);
});

test("null collections and unreachable workflow branches remain explicit", () => {
  assert.throws(() => parseArtifactIdentity("pi-ticket-planning:admission-plan:v1", null), /UNKNOWN_ARTIFACT/);
  const arraySubject = fact("release.readinessPassed");
  arraySubject.subject = [];
  assert.equal(validateFactAttestation(arraySubject).problems.some(({ code }) => code === "INVALID_FACT_SUBJECT"), true);
  const arraySource = fact("release.readinessPassed");
  arraySource.source = [];
  assert.equal(validateFactAttestation(arraySource).problems.some(({ code }) => code === "INVALID_FACT_SOURCE"), true);
  const arrayEvidence = fact("release.readinessPassed");
  arrayEvidence.evidence = [];
  assert.equal(validateFactAttestation(arrayEvidence).problems.some(({ code }) => code === "INVALID_FACT_EVIDENCE"), true);
  const invalid = evaluateTransition({ current: [], proposed: [] });
  assert.equal(invalid.allowed, false);
  const disconnected = loadProtocol();
  disconnected.workflow.allowedTransitions.ORIENT = [];
  assert.equal(verifyProtocol({ protocol: disconnected }).unreachableStates.length > 0, true);
  const directorySchema = loadProtocol();
  directorySchema.registry.artifacts[0].schemaPath = "schemas";
  assert.equal(validateRegistry({ protocol: directorySchema }).problems.some(({ code }) => code === "MISSING_ARTIFACT_SCHEMA"), true);
  const futureExpiry = fact("release.readinessPassed");
  futureExpiry.expiresAt = "2026-08-25T03:00:00Z";
  assert.equal(validateFactAttestation(futureExpiry, { now: "2026-08-25T00:30:00Z" }).ok, true);
});

test("optional-field defaults are explicit rather than inferred", (t) => {
  const protocol = loadProtocol();
  protocol.registry.artifacts[0].schemaIdentity = null;
  assert.equal(validateRegistry({ protocol }).problems.some(({ code }) => code === "INVALID_CURRENT_SCHEMA_IDENTITY"), true);
  const rules = loadProtocol();
  rules.rules.rules[0].id = null;
  assert.equal(validateProtocolRules({ protocol: rules }).problems.some(({ code }) => code === "INVALID_RULE_ID"), true);

  for (const pathToDelete of [
    ["id"], ["fact"], ["subject", "digest"], ["source", "kind"], ["source", "producer"],
    ["source", "producerVersion"], ["source", "producerDigest"], ["evidence", "ref"], ["evidence", "digest"],
  ]) {
    const value = fact("release.readinessPassed");
    const [parent, child] = pathToDelete;
    if (child) delete value[parent][child]; else delete value[parent];
    assert.equal(validateFactAttestation(value).ok, false);
  }
  const arraySubject = { ...SUBJECT, extra: ["a", "b"] };
  const arrayFact = fact("release.readinessPassed", true, { subject: arraySubject });
  assert.equal(validateFactAttestation(arrayFact, { expectedSubject: arraySubject }).ok, true);
  const noCheckpointSubject = evaluateTransition({
    current: null,
    proposed: { schema: "pi-ticket-planning:checkpoint:v2", lane: "PRODUCT", stage: "FRAME", verdict: "FRAME_CANDIDATE" },
  });
  assert.equal(noCheckpointSubject.allowed, false);

  const noRequirements = loadProtocol();
  noRequirements.workflow.transitionRequirements = null;
  noRequirements.workflow.rebindTransitions[0].requiredFacts = null;
  const current = { schema: "pi-ticket-planning:checkpoint:v2", lane: "PRODUCT", stage: "OUTCOME", verdict: "ACHIEVED", subject: SUBJECT };
  const proposed = { schema: "pi-ticket-planning:checkpoint:v2", lane: "PRODUCT", stage: "ORIENT", verdict: "NEEDS_TARGET", subject: { ...SUBJECT, id: "R9", revision: "r9" } };
  assert.equal(evaluateTransition({ current, proposed, rebind: true }, { protocol: noRequirements }).allowed, true);
  const initial = { schema: "pi-ticket-planning:checkpoint:v2", lane: "PRODUCT", stage: "ORIENT", verdict: "NEEDS_TARGET", subject: SUBJECT };
  assert.equal(evaluateTransition({ current: null, proposed: initial, facts: null }, { protocol: noRequirements }).allowed, true);

  const noMutationLists = loadProtocol();
  noMutationLists.authority.mutations["admission.apply"].requiredFacts = null;
  noMutationLists.authority.mutations["admission.apply"].approvalFact = null;
  noMutationLists.authority.mutations["admission.apply"].postconditions = null;
  const mutation = evaluateMutation({
    mutation: "admission.apply",
    actor: "admission-cli",
    transition: {
      current: { schema: "pi-ticket-planning:checkpoint:v2", lane: "DELIVERY", stage: "ADMISSION", verdict: "ACTIVATION_AWAITING_CONFIRMATION", subject: SUBJECT },
      proposed: { schema: "pi-ticket-planning:checkpoint:v2", lane: "DELIVERY", stage: "ADMISSION", verdict: "ADMITTED", subject: SUBJECT },
    },
    facts: null,
  }, { protocol: noMutationLists });
  assert.deepEqual(mutation.postconditions, []);

  const emptyGraph = loadProtocol();
  emptyGraph.workflow.allowedTransitions = null;
  emptyGraph.workflow.verdictRequirements = null;
  emptyGraph.workflow.transitionRequirements = null;
  emptyGraph.workflow.rebindTransitions = null;
  emptyGraph.authority.mutations = null;
  assert.equal(verifyProtocol({ protocol: emptyGraph }).reachableStates, "1/9");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-code-recursion-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "scripts", "nested"), { recursive: true });
  fs.writeFileSync(path.join(root, "scripts", "nested", "known.mjs"), 'const X_SCHEMA = "pi-ticket-planning:admission-plan:v1";\n');
  const recursive = loadProtocol();
  recursive.root = root;
  assert.equal(validateCodeSchemaCoverage({ protocol: recursive }).ok, true);
});
