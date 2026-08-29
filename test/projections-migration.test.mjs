import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { projectRelease, projectSpec } from "../protocol/projections.mjs";
import { migrateCheckpointV1, migrateDeliveryGraphV1, migrateDeliveryGraphV2 } from "../scripts/migrate-artifacts.mjs";
import { fingerprint } from "../execution-plan/domain.mjs";
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
    acceptance: {
      schema: "pi-ticket-planning:spec-acceptance:v1",
      parent: { number: 100, title: "Spec", bodyHash: `sha256:${"a".repeat(64)}` },
      source: { baseSha: release.source.baseSha, specContentHash: `sha256:${"b".repeat(64)}` },
      decision: { caseId: "PC-R001", approvalId: "F-approval", acceptedAt: "2026-08-29T00:00:00Z" },
      digest: `sha256:${"c".repeat(64)}`,
    },
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

test("Delivery Graph v2 migration emits deterministic approval-only v3 or Roadmap candidates", (t) => {
  const baseSha = "a".repeat(40);
  const v2 = {
    version: 2,
    source: { identity: "spec", revision: "r1", baseSha, specContentHash: `sha256:${"b".repeat(64)}` },
    scenarios: [{ id: "S1", behavior: "B", entry: "external:x", exit: "y", releaseSignal: "s", smallestLoop: true }],
    children: [{ id: "C1", title: "C", coverageRole: "DIRECT", sourceScenarios: ["S1"], blockedBy: [], externalBlockers: [], bodyHash: `sha256:${"c".repeat(64)}`, startingState: "x", primaryVerification: "v", executionLane: "AGENT" }],
    walkingSkeleton: ["C1"],
  };
  const acceptanceBody = { schema: "pi-ticket-planning:spec-acceptance:v1", parent: { number: 100, title: "Spec", bodyHash: `sha256:${"d".repeat(64)}` }, source: { baseSha, specContentHash: v2.source.specContentHash }, decision: { caseId: "PC-migration", approvalId: "F-approval", acceptedAt: "2026-08-29T00:00:00Z" } };
  const manifestBody = { schema: "pi-ticket-planning:decision-manifest:v1", baseSha, policy: { identity: "AGENTS.md", path: "AGENTS.md", sha256: `sha256:${"e".repeat(64)}`, byteCount: 1 }, productRelease: { identity: "R1/r1", path: "README.md", sha256: `sha256:${"f".repeat(64)}`, byteCount: 1 }, decisions: [], dependencyHandoffs: [] };
  const context = {
    releaseMembership: { singleCurrentRelease: true, releaseId: "R1-C1-r1", childIds: ["C1"] },
    release: {
      releaseId: "R1-C1-r1", releaseOrdinal: 1, planningBaseSha: baseSha, executionBaseSha: baseSha,
      executionBasePolicy: "PLANNING_BASE_OR_DESCENDANT", roadmapDigest: null, predecessorReleaseId: null,
      predecessorReceipt: null, predecessorReceiptBinding: null,
      specAcceptance: { ...acceptanceBody, digest: fingerprint(acceptanceBody) },
      specAcceptanceBinding: { path: "evidence/spec.json", baseSha, sha256: `sha256:${"1".repeat(64)}`, byteCount: 1 },
      decisionManifest: { ...manifestBody, digest: fingerprint(manifestBody) },
      decisionManifestBinding: { path: "evidence/decision.json", baseSha, sha256: `sha256:${"5".repeat(64)}`, byteCount: 1 },
    },
    childContracts: {
      C1: {
        primaryVerificationSeams: ["v"], implementationOwner: "worker", riskClasses: ["BOUNDED_CHANGE"],
        scopeBudget: { maxFiles: 2, maxChangedLines: 100 }, expectedPaths: ["src/c1.ts"], protectedPaths: ["fixtures/o1.json"],
        replanTriggers: ["ACCEPTED_DECISION_CHANGE_REQUIRED", "THIRD_RISK_CLASS_DISCOVERED", "SCOPE_BUDGET_EXCEEDED", "DOWNSTREAM_RELEASE_BEHAVIOR_DISCOVERED"],
        oracleBindingDigest: `sha256:${"2".repeat(64)}`, integrationOnly: null, waiverDigests: [],
      },
    },
  };
  const single = migrateDeliveryGraphV2(v2, context);
  assert.deepEqual(single, migrateDeliveryGraphV2(structuredClone(v2), structuredClone(context)));
  assert.equal(single.kind, "EXECUTABLE_RELEASE_CANDIDATE");
  assert.equal(single.requiresHumanApproval, true);
  assert.equal(single.currentReleaseCandidate.readinessState, "PLANNED");
  assert.throws(() => migrateDeliveryGraphV2(v2, { ...context, releaseMembership: undefined }), /roadmapCandidate/);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "v2-migration-cli-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const inputFile = path.join(directory, "v2.json");
  const contextFile = path.join(directory, "context.json");
  fs.writeFileSync(inputFile, JSON.stringify(v2));
  fs.writeFileSync(contextFile, JSON.stringify(context));
  const cli = spawnSync(process.execPath, ["scripts/migrate-artifacts.mjs", "--artifact", "delivery-graph-v2", "--input", inputFile, "--context", contextFile, "--dry-run", "true"], { encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stderr);
  assert.deepEqual(JSON.parse(cli.stdout), { dryRun: true, output: single });
  assert.notEqual(spawnSync(process.execPath, ["scripts/migrate-artifacts.mjs", "--artifact", "delivery-graph-v2", "--input", inputFile, "--context", contextFile, "--dry-run", "false"]).status, 0);

  const mixed = structuredClone(v2);
  mixed.children.push({ id: "H1", title: "Human", coverageRole: "ENABLER", sourceScenarios: ["S1"], blockedBy: [], externalBlockers: [], bodyHash: `sha256:${"3".repeat(64)}`, startingState: "x", primaryVerification: "human", executionLane: "HUMAN" });
  const roadmapBody = { schema: "pi-ticket-planning:roadmap-graph:v1", kind: "ROADMAP", executable: false, readinessState: "PLANNED", roadmapId: "R1", planningBaseSha: baseSha, parent: { number: 99, title: "Roadmap", bodyHash: `sha256:${"4".repeat(64)}` }, plannedReleases: [{ releaseId: "R1-C1-r1", releaseOrdinal: 1, readinessState: "PLANNED", objective: "C1", scenarioCoverage: ["S1"], predecessors: [], candidateTickets: [{ id: "C1", title: "C", objective: "C", executionLane: "AGENT" }, { id: "H1", title: "Human", objective: "Human", executionLane: "HUMAN" }] }] };
  const complexContext = { ...context, releaseMembership: undefined, currentReleaseChildIds: ["C1"], roadmapCandidate: { ...roadmapBody, digest: fingerprint(roadmapBody) } };
  const complex = migrateDeliveryGraphV2(mixed, complexContext);
  assert.equal(complex.kind, "ROADMAP_AND_CURRENT_RELEASE_CANDIDATES");
  assert.equal(complex.requiresHumanApproval, true);
  assert.deepEqual(complex.currentReleaseCandidate.children.map(({ id }) => id), ["C1"]);
  assert.throws(() => migrateDeliveryGraphV2(mixed, { ...complexContext, currentReleaseChildIds: ["H1"] }), /not one unblocked AGENT tranche/);
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
