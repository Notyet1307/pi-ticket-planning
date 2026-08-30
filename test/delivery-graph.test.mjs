import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { fingerprint } from "../execution-plan/domain.mjs";
import { predecessorReceiptFixture } from "./controller-completion-fixture.mjs";
import {
  DELIVERY_RELEASE_GRAPH_MARKER,
  DELIVERY_GRAPH_MARKER,
  DELIVERY_GRAPH_MARKER_V1,
  computeSpecContentHash,
  hashText,
  parseDeliveryGraph,
  validateDeliveryGraph,
} from "../scripts/check-delivery-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cases = JSON.parse(fs.readFileSync(path.join(root, "fixtures", "admission-cases.json"), "utf8")).graphCases;

function graph(item) {
  const { id: _id, expectedGraphVerdict: _verdict, expectedProblemCodes: _codes, ...snapshot } = structuredClone(item);
  for (const child of snapshot.children ?? []) child.externalBlockers ??= [];
  return snapshot;
}

function executableGraph(item = cases.find((entry) => entry.expectedGraphVerdict === "READY")) {
  const legacy = graph(item);
  const acceptanceBody = {
    schema: "pi-ticket-planning:spec-acceptance:v1",
    parent: { number: 100, title: "Accepted Spec", bodyHash: `sha256:${"9".repeat(64)}` },
    source: { baseSha: legacy.source.baseSha, specContentHash: legacy.source.specContentHash },
    decision: { caseId: "PC-graph", approvalId: "F-spec-approval", acceptedAt: "2026-08-29T00:00:00Z" },
  };
  const decisionManifestBody = {
    schema: "pi-ticket-planning:decision-manifest:v1",
    baseSha: legacy.source.baseSha,
    policy: { identity: "AGENTS.md", path: "AGENTS.md", sha256: `sha256:${"6".repeat(64)}`, byteCount: 1 },
    productRelease: { identity: "R001/r1", path: "README.md", sha256: `sha256:${"7".repeat(64)}`, byteCount: 1 },
    decisions: [],
    dependencyHandoffs: [],
  };
  return {
    schema: "pi-ticket-planning:delivery-release-graph:v3",
    kind: "EXECUTABLE_RELEASE",
    executable: true,
    readinessState: "GRAPH_REVIEWED",
    releaseId: "R001-C1-r1",
    releaseOrdinal: 1,
    planningBaseSha: legacy.source.baseSha,
    executionBaseSha: legacy.source.baseSha,
    executionBasePolicy: "PLANNING_BASE_OR_DESCENDANT",
    roadmapDigest: null,
    predecessorReleaseId: null,
    predecessorReceipt: null,
    predecessorReceiptBinding: null,
    specAcceptance: { ...acceptanceBody, digest: fingerprint(acceptanceBody) },
    specAcceptanceBinding: { path: "evidence/spec-acceptance.json", baseSha: legacy.source.baseSha, sha256: `sha256:${"5".repeat(64)}`, byteCount: 1 },
    decisionManifest: { ...decisionManifestBody, digest: fingerprint(decisionManifestBody) },
    decisionManifestBinding: { path: "evidence/decision-manifest.json", baseSha: legacy.source.baseSha, sha256: `sha256:${"8".repeat(64)}`, byteCount: 1 },
    decisionManifestDigest: `sha256:${"8".repeat(64)}`,
    source: { identity: legacy.source.identity, revision: legacy.source.revision, specContentHash: legacy.source.specContentHash },
    scenarios: legacy.scenarios,
    children: legacy.children.map((child, index) => ({
      ...child,
      primaryVerificationSeams: [child.primaryVerification],
      implementationOwner: `worker-${index + 1}`,
      riskClasses: ["BOUNDED_BEHAVIOR_CHANGE"],
      scopeBudget: { maxFiles: 8, maxChangedLines: 1500 },
      expectedPaths: [`src/ticket-${index + 1}.ts`],
      protectedPaths: [`oracles/o${index + 1}.json`],
      replanTriggers: ["ACCEPTED_DECISION_CHANGE_REQUIRED", "THIRD_RISK_CLASS_DISCOVERED", "SCOPE_BUDGET_EXCEEDED", "DOWNSTREAM_RELEASE_BEHAVIOR_DISCOVERED"],
      oracleBindingDigest: `sha256:${String(index + 1).repeat(64)}`,
      integrationOnly: null,
      waiverDigests: [],
    })),
    walkingSkeleton: legacy.walkingSkeleton,
  };
}

function roadmapGraph(plannedReleases) {
  const body = {
    schema: "pi-ticket-planning:roadmap-graph:v1",
    kind: "ROADMAP",
    executable: false,
    readinessState: "PLANNED",
    roadmapId: "R001",
    planningBaseSha: "1".repeat(40),
    parent: { number: 100, title: "Roadmap", bodyHash: `sha256:${"1".repeat(64)}` },
    plannedReleases,
  };
  return { ...body, digest: fingerprint(body) };
}

test("delivery graph fixtures keep coverage, handoff, skeleton, and frontier fail-closed", () => {
  for (const item of cases) {
    const checked = validateDeliveryGraph(graph(item));
    assert.equal(checked.legacyVerdict, item.expectedGraphVerdict, item.id);
    for (const code of item.expectedProblemCodes ?? []) {
      assert.equal(checked.problems.some((problem) => problem.code === code), true, `${item.id}: ${code}`);
    }
  }
});

test("delivery graph parser accepts raw JSON and one marked Markdown snapshot", () => {
  const ready = cases.find((item) => item.expectedGraphVerdict === "READY");
  assert.deepEqual(parseDeliveryGraph(JSON.stringify(ready)), ready);
  assert.deepEqual(parseDeliveryGraph(`${DELIVERY_GRAPH_MARKER}\n\n\`\`\`json\n${JSON.stringify(ready)}\n\`\`\``), ready);
  const release = executableGraph();
  assert.deepEqual(parseDeliveryGraph(`${DELIVERY_RELEASE_GRAPH_MARKER}\n\n\`\`\`json\n${JSON.stringify(release)}\n\`\`\``), release);
  assert.throws(() => parseDeliveryGraph("# no graph"), /exactly one delivery-graph marker/);
});

test("delivery graph rejects malformed smallest-loop declarations", () => {
  const ready = graph(cases.find((item) => item.expectedGraphVerdict === "READY"));
  for (const scenario of ready.scenarios) delete scenario.smallestLoop;
  let checked = validateDeliveryGraph(ready);
  assert.equal(checked.ok, false);
  assert.equal(checked.problems.some(({ code }) => code === "INVALID_SMALLEST_LOOP_TYPE"), true);
  assert.equal(checked.problems.some(({ code }) => code === "MISSING_SMALLEST_LOOP"), true);

  ready.scenarios[0].smallestLoop = "false";
  checked = validateDeliveryGraph(ready);
  assert.equal(checked.problems.some(({ code }) => code === "INVALID_SMALLEST_LOOP_TYPE"), true);
});

test("delivery graph rejects duplicate internal references and unresolved external blockers", () => {
  const ready = graph(cases.find((item) => item.expectedGraphVerdict === "READY"));
  ready.children[1].sourceScenarios.push("S2");
  ready.children[1].blockedBy.push("T1");
  ready.children[1].externalBlockers = ["security approval"];
  ready.children.push({
    id: "T3",
    title: "Prepare comparison engine",
    coverageRole: "ENABLER",
    sourceScenarios: ["S2"],
    downstreamConsumers: ["T2", "T2"],
    exitCondition: "The comparison engine is callable.",
    blockedBy: [],
    primaryVerification: "Call the comparison-engine seam.",
    executionLane: "AGENT",
  });

  const codes = validateDeliveryGraph(ready).problems.map(({ code }) => code);
  assert.equal(codes.includes("DUPLICATE_SOURCE_SCENARIO"), true);
  assert.equal(codes.includes("DUPLICATE_BLOCKER"), true);
  assert.equal(codes.includes("DUPLICATE_DOWNSTREAM_CONSUMER"), true);
  assert.equal(codes.includes("OPEN_EXTERNAL_BLOCKER"), true);
});

test("delivery graph reports dependency cycles explicitly", () => {
  const ready = graph(cases.find((item) => item.expectedGraphVerdict === "READY"));
  ready.children[0].blockedBy = ["T2"];
  const checked = validateDeliveryGraph(ready);
  assert.equal(checked.ok, false);
  assert.equal(checked.problems.some(({ code }) => code === "DEPENDENCY_CYCLE"), true);
});

test("walking skeleton rejects a structurally redundant child", () => {
  const ready = graph(cases.find((item) => item.expectedGraphVerdict === "READY"));
  ready.children.splice(1, 0, {
    id: "T3",
    title: "Accept comparison inputs again",
    coverageRole: "DIRECT",
    sourceScenarios: ["S1"],
    blockedBy: [],
    primaryVerification: "Submit the same valid inputs.",
    executionLane: "AGENT",
  });
  ready.walkingSkeleton = ["T1", "T3", "T2"];

  const checked = validateDeliveryGraph(ready);
  assert.equal(checked.ok, false);
  assert.equal(checked.problems.some(({ code, subject }) => code === "REDUNDANT_SKELETON_CHILD" && subject === "T3"), true);
});

test("delivery graph v2 requires stable Spec and child body identities", () => {
  const ready = graph(cases.find((item) => item.expectedGraphVerdict === "READY"));
  ready.version = 2;
  delete ready.source.specContentHash;
  delete ready.children[0].bodyHash;
  delete ready.children[0].startingState;

  const codes = validateDeliveryGraph(ready).problems.map(({ code }) => code);
  assert.equal(codes.includes("MISSING_SPEC_CONTENT_HASH"), true);
  assert.equal(codes.includes("MISSING_CHILD_BODY_HASH"), true);
  assert.equal(codes.includes("MISSING_CHILD_STARTING_STATE"), true);
  const migration = validateDeliveryGraph(graph(cases.find((item) => item.expectedGraphVerdict === "READY")));
  assert.equal(migration.ok, false);
  assert.equal(migration.verdict, "NEEDS_MIGRATION");
  assert.equal(migration.problems.some(({ code }) => code === "NEEDS_MIGRATION"), true);
});

test("delivery release v3 represents exactly one bounded AGENT release", () => {
  const ready = executableGraph();
  assert.equal(validateDeliveryGraph(ready).ok, true);

  const human = structuredClone(ready);
  human.children[0].executionLane = "HUMAN";
  assert.equal(validateDeliveryGraph(human).problems.some(({ code }) => code === "HUMAN_CHILD_NOT_EXECUTABLE"), true);

  const fiveReleases = structuredClone(ready);
  fiveReleases.plannedReleases = Array.from({ length: 5 }, (_, index) => ({ releaseId: `R${index + 1}` }));
  assert.equal(validateDeliveryGraph(fiveReleases).problems.some(({ code }) => code === "MULTIPLE_RELEASES_NOT_EXECUTABLE"), true);

  for (const state of ["PLANNED", "SPEC_ACCEPTED", "ORACLES_BOUND"]) {
    const early = structuredClone(ready);
    early.readinessState = state;
    const checked = validateDeliveryGraph(early);
    assert.equal(checked.ok, true);
    assert.equal(checked.executable, false);
    assert.equal(checked.readinessProblems.some(({ code }) => code === "RELEASE_NOT_GRAPH_REVIEWED"), true);
  }

  const tooLarge = structuredClone(ready);
  tooLarge.children = Array.from({ length: 5 }, (_, index) => ({
    ...structuredClone(ready.children[0]),
    id: `T${index + 1}`,
    title: `Ticket ${index + 1}`,
    blockedBy: [],
  }));
  tooLarge.walkingSkeleton = ["T1"];
  assert.equal(validateDeliveryGraph(tooLarge).problems.some(({ code }) => code === "CHILD_COUNT_POLICY_EXCEEDED"), true);
});

test("delivery release rejects a leading-wildcard expected path", () => {
  const release = executableGraph();
  release.children[0].expectedPaths = ["*.ts"];
  const problems = validateDeliveryGraph(release).problems.map(({ code }) => code);
  assert.equal(problems.includes("INVALID_EXPECTED_PATH_PATTERN"), true);
  assert.equal(problems.includes("ARTIFACT_SCHEMA_INVALID"), true);
});

test("Roadmap can hold future releases and HUMAN work but is never executable", () => {
  const roadmap = roadmapGraph(Array.from({ length: 5 }, (_, index) => ({
      releaseId: `R001-C${index + 1}`,
      releaseOrdinal: index + 1,
      readinessState: "PLANNED",
      objective: `Future release ${index + 1}`,
      scenarioCoverage: ["S1"],
      predecessors: index === 0 ? [] : [`R001-C${index}`],
      candidateTickets: [{ id: `H${index + 1}`, title: "Human step", objective: "Human-controlled work", executionLane: "HUMAN" }],
    })));
  const checked = validateDeliveryGraph(roadmap);
  assert.equal(checked.ok, true);
  assert.equal(checked.verdict, "PLANNED");
  assert.equal(checked.executable, false);
});

test("a downstream release needs an exact predecessor receipt and fresh execution base", () => {
  const release = executableGraph();
  release.releaseId = "R001-C2-r1";
  release.releaseOrdinal = 2;
  release.executionBasePolicy = "PREDECESSOR_MERGE_OR_DESCENDANT";
  release.predecessorReleaseId = "r001-c1-r1";
  const roadmap = roadmapGraph([
    { releaseId: "r001-c1-r1", releaseOrdinal: 1, readinessState: "PLANNED", objective: "C1", scenarioCoverage: ["S1"], predecessors: [], candidateTickets: [] },
    { releaseId: "R001-C2-r1", releaseOrdinal: 2, readinessState: "PLANNED", objective: "C2", scenarioCoverage: ["S1"], predecessors: ["r001-c1-r1"], candidateTickets: [] },
  ]);
  release.roadmapDigest = roadmap.digest;
  assert.equal(validateDeliveryGraph(release).problems.some(({ code }) => code === "MISSING_PREDECESSOR_RECEIPT"), true);
  const legacyBody = { schema: "pi-ticket-planning:release-predecessor-receipt:v1", releaseId: "r001-c1-r1", mergedMainSha: "2".repeat(40), handoffDigests: [], validationDigest: `sha256:${"2".repeat(64)}`, completedAt: "2026-08-29T01:00:00Z" };
  release.predecessorReceipt = { ...legacyBody, digest: fingerprint(legacyBody) };
  release.predecessorReceiptBinding = { path: "evidence/c1-completion.json", baseSha: release.executionBaseSha, sha256: `sha256:${"4".repeat(64)}`, byteCount: 1 };
  assert.equal(validateDeliveryGraph(release).problems.some(({ code }) => code === "PREDECESSOR_COMPLETION_EXPORT_REQUIRED"), true);
  release.predecessorReceipt = predecessorReceiptFixture({ releaseId: "r001-c1-r1", sourceBaseSha: "1".repeat(40), candidateSha: "1".repeat(40), mergedMainSha: "2".repeat(40) });
  assert.equal(validateDeliveryGraph(release).problems.some(({ code }) => code === "PREDECESSOR_EXECUTION_BASE_MISMATCH"), true);
  release.executionBaseSha = release.predecessorReceipt.mergedMainSha;
  release.predecessorReceiptBinding.baseSha = release.executionBaseSha;
  release.specAcceptanceBinding.baseSha = release.executionBaseSha;
  const { digest: _decisionDigest, ...decisionBody } = release.decisionManifest;
  decisionBody.baseSha = release.executionBaseSha;
  release.decisionManifest = { ...decisionBody, digest: fingerprint(decisionBody) };
  release.decisionManifestBinding.baseSha = release.executionBaseSha;
  assert.equal(validateDeliveryGraph(release).ok, true);

  release.predecessorReleaseId = "other-release";
  assert.equal(validateDeliveryGraph(release).problems.some(({ code }) => code === "PREDECESSOR_RELEASE_MISMATCH"), true);
});

test("delivery graph v1 remains readable but cannot pass Admission", () => {
  const legacy = graph(cases.find((item) => item.expectedGraphVerdict === "READY"));
  legacy.version = 1;
  const parsed = parseDeliveryGraph(`${DELIVERY_GRAPH_MARKER_V1}\n\n\`\`\`json\n${JSON.stringify(legacy)}\n\`\`\``);
  assert.equal(parsed.version, 1);
  const checked = validateDeliveryGraph(parsed);
  assert.equal(checked.ok, false);
  assert.equal(checked.problems.some(({ code }) => code === "NEEDS_MIGRATION"), true);
});

test("delivery graph hashes exact body text and excludes the Ticket coverage section from Spec identity", () => {
  assert.equal(hashText("body"), "sha256:230d8358dc8e8890b4c58deeb62912ee2f20357ae92a5cc861b98e68fe31acb5");
  const parent = "# Spec\n\nStable behavior.\n\n## Ticket coverage\n\nold graph\n\n## Notes\n\nKeep this.";
  assert.equal(computeSpecContentHash(parent), hashText("# Spec\n\nStable behavior.\n\n## Notes\n\nKeep this."));
});
