import assert from "node:assert/strict";
import test from "node:test";

import { projectRelease, projectSpec } from "../protocol/projections.mjs";
import { migrateCheckpointV1, migrateDeliveryGraphV1 } from "../scripts/migrate-artifacts.mjs";
import {
  migrateCompatibilityMatrixV1,
  migrateE2EReportV1,
  migrateLiveEvalV3,
  migrateReleaseQualificationV1,
} from "../scripts/migrate-evidence-reports.mjs";
import { migrateCaseTransactionV1, migratePlanningCaseEventV1, migratePlanningCaseV1 } from "../scripts/migrate-planning-case.mjs";

test("Release and Spec projections bind exact source bytes", () => {
  const release = projectRelease({
    target: "github:acme/product",
    id: "R001",
    revision: "r1",
    status: "COMMITTED",
    ref: "refs/heads/main",
    baseSha: "a".repeat(40),
    path: "docs/releases/R001.md",
    bytes: Buffer.from("release-v1\n"),
  });
  assert.equal(release.schema, "pi-ticket-planning:release-projection:v1");
  const changed = projectRelease({ ...release, ref: release.source.ref, baseSha: release.source.baseSha, path: release.source.path, bytes: Buffer.from("changed\n") });
  assert.notEqual(changed.digest, release.digest);

  const spec = projectSpec({
    target: release.target,
    id: "100",
    revision: "r2",
    baseSha: release.source.baseSha,
    source: { target: release.target, kind: "release", id: release.id, revision: release.revision, digest: release.digest },
    scenarioIds: ["S1", "S2"],
    bytes: Buffer.from("spec\n"),
  });
  assert.equal(spec.schema, "pi-ticket-planning:spec-projection:v1");
  assert.match(spec.contentDigest, /^sha256:/);
});

test("legacy Checkpoint and Delivery Graph migration is explicit and deterministic", () => {
  const checkpoint = migrateCheckpointV1("Checkpoint: PRODUCT/EVIDENCE · R001/r2 · NEEDS_RESEARCH", {
    target: "github:acme/product",
    subject: { target: "github:acme/product", kind: "release", id: "R001", revision: "r2", digest: `sha256:${"d".repeat(64)}` },
    observedAt: "2026-08-25T00:00:00Z",
    producer: { name: "migration-test", version: "1", digest: `sha256:${"e".repeat(64)}` },
  });
  assert.equal(checkpoint.schema, "pi-ticket-planning:checkpoint:v2");
  assert.deepEqual(checkpoint.subject.kind, "release");
  assert.equal(checkpoint.subject.id, "R001");
  assert.equal(checkpoint.subject.revision, "r2");

  const v1 = {
    version: 1,
    source: { identity: "spec", revision: "r1", baseSha: "a".repeat(40) },
    scenarios: [{ id: "S1", behavior: "B", entry: "external:x", exit: "y", releaseSignal: "s", smallestLoop: true }],
    children: [{ id: "C1", title: "C", coverageRole: "DIRECT", sourceScenarios: ["S1"], blockedBy: [], externalBlockers: [], primaryVerification: "v", executionLane: "AGENT" }],
    walkingSkeleton: ["C1"],
  };
  const v2 = migrateDeliveryGraphV1(v1, {
    specContentHash: `sha256:${"b".repeat(64)}`,
    children: { C1: { bodyHash: `sha256:${"c".repeat(64)}`, startingState: "x" } },
  });
  assert.equal(v2.version, 2);
  assert.equal(v2.source.specContentHash, `sha256:${"b".repeat(64)}`);
  assert.throws(() => migrateDeliveryGraphV1(v1, {}), /migration context/);
});

test("Planning Case v1 migration is explicit and fails on unprojectable free objects", () => {
  const checkpoint = {
    schema: "pi-ticket-planning:checkpoint:v2",
    lane: "PRODUCT",
    stage: "ORIENT",
    verdict: "NEEDS_TARGET",
    subject: { target: "github:acme/product", kind: "none", id: "NONE", revision: "0", digest: `sha256:${"a".repeat(64)}` },
  };
  const snapshot = {
    schema: "pi-ticket-planning:planning-case:v1",
    target: "github:acme/product",
    caseId: "PC-legacy",
    checkpoint,
    blocker: null,
    nextAction: { kind: "ROUTE", command: "pi-ticket-planctl case resume PC-legacy --json" },
    selectedCandidate: null,
    excludedCandidates: [],
    facts: [],
    decisions: [],
    unknowns: [],
    assumptions: [],
    evidenceMethod: null,
    truthOwner: null,
    cost: null,
    stoppingRule: null,
    bindings: { source: null, release: null, spec: null, graph: null, policy: null, harness: null, capability: null, outcome: null },
    approvals: { pending: [], consumed: [] },
    lastCheckpoint: checkpoint,
    lastEvent: null,
    createdAt: "2026-08-25T00:00:00Z",
    updatedAt: "2026-08-25T00:00:00Z",
  };
  const migrated = migratePlanningCaseV1(snapshot);
  assert.equal(migrated.schema, "pi-ticket-planning:planning-case:v2");
  assert.equal(migrated.nextAction.kind, "COMMAND");
  assert.deepEqual(migrated.consumedFactIds, []);

  const event = {
    schema: "pi-ticket-planning:planning-case-event:v1",
    id: "E-legacy",
    sequence: 1,
    caseId: snapshot.caseId,
    target: snapshot.target,
    type: "CASE_CREATED",
    at: snapshot.createdAt,
    data: { snapshot },
    transactionId: "TX-legacy",
    previousDigest: null,
    digest: `sha256:${"b".repeat(64)}`,
  };
  const migratedEvent = migratePlanningCaseEventV1(event);
  assert.equal(migratedEvent.schema, "pi-ticket-planning:planning-case-event:v2");
  const transaction = {
    schema: "pi-ticket-planning:case-transaction:v1",
    id: "TX-legacy",
    caseId: snapshot.caseId,
    target: snapshot.target,
    createdAt: snapshot.createdAt,
    beforeEvent: null,
    event,
    nextSnapshot: snapshot,
    status: "INTENT",
  };
  assert.equal(migrateCaseTransactionV1(transaction).schema, "pi-ticket-planning:case-transaction:v2");
  const ambiguous = structuredClone(snapshot);
  ambiguous.decisions.push({ arbitrary: true });
  assert.throws(() => migratePlanningCaseV1(ambiguous), /LEGACY_CONTEXT_INCOMPLETE/);
});

test("legacy evidence reports require explicit provenance before migration", () => {
  const digest = `sha256:${"d".repeat(64)}`;
  const context = {
    reportId: "RPT-migration-test",
    packageVersion: "0.5.0-alpha.0",
    headSha: "a".repeat(40),
    treeSha: digest,
    workflowName: "migration-test",
    workflowRunId: "1",
    workflowRunAttempt: 1,
    workflowRunUrl: "https://github.com/acme/product/actions/runs/1",
    repository: "acme/product",
    actor: "test",
    runner: "test",
    provider: "provider",
    model: "model",
    thinking: "high",
    piVersion: "1.0.0",
    piDigest: digest,
    subagentVersion: "1.0.0",
    profileDigest: digest,
    harnessVersion: "1.0.0",
    harnessDigest: digest,
    observedAt: "2026-08-25T00:00:00Z",
    expiresAt: "2026-08-26T00:00:00Z",
    evidenceDigests: [digest],
  };
  const scenarios = Array.from({ length: 18 }, (_, index) => ({ id: `S${index + 1}` }));

  const e2e = migrateE2EReportV1({ schema: "pi-ticket-planning:e2e-report:v1", status: "UNTESTED" }, {
    ...context,
    scenarios,
    setup: { status: "NOT_RUN" },
    harnessEvidence: { status: "UNTESTED" },
    providerEvidence: { status: "UNTESTED" },
    githubAppEvidence: { status: "UNTESTED" },
    cleanup: { status: "NOT_RUN" },
  });
  assert.equal(e2e.schema, "pi-ticket-planning:e2e-report:v2");
  assert.match(e2e.reportDigest, /^sha256:/);
  assert.equal(migrateLiveEvalV3({ schema: "pi-ticket-planning:live-eval:v3", summary: {} }, context).schema, "pi-ticket-planning:live-eval:v4");
  assert.equal(migrateReleaseQualificationV1(
    { schema: "pi-ticket-planning:release-qualification:v1", status: "BLOCKED", metrics: {}, problems: [] },
    { ...context, tuples: [], evidenceRefs: [] },
  ).schema, "pi-ticket-planning:release-qualification:v2");
  assert.equal(migrateCompatibilityMatrixV1(
    { schema: "pi-ticket-planning:compatibility-matrix:v1" },
    { entries: [] },
  ).schema, "pi-ticket-planning:compatibility-matrix:v2");
  assert.throws(
    () => migrateE2EReportV1({ schema: "pi-ticket-planning:e2e-report:v1" }, { scenarios }),
    /LEGACY_PROVENANCE_UNAVAILABLE/,
  );
});
