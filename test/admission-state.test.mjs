import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { fingerprint } from "../execution-plan/domain.mjs";
import { EXECUTABLE_DELIVERY_SPEC_MARKER, ROADMAP_PARENT_MARKER, hashText } from "../scripts/check-delivery-graph.mjs";
import { validateAdmissionState } from "../scripts/check-admission-state.mjs";
import {
  buildTicketContextResult,
  checkTicketContext,
} from "../scripts/check-ticket-context.mjs";

const repositoryPath = fileURLToPath(new URL("..", import.meta.url));
const baseSha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repositoryPath, encoding: "utf8" }).stdout.trim();

function readyBundle() {
  const specBody = [
    "# Delivery Spec",
    "",
    "## Behavioral scenarios",
    "### S1: Accept input",
    "The user submits input.",
    "",
    "### S2: Return result",
    "The user receives a result.",
  ].join("\n");
  const children = [
    { id: "101", body: "# Accept input\n\nExact ticket body.", blockedBy: [] },
    { id: "102", body: "# Return result\n\nExact ticket body.", blockedBy: ["101"] },
  ];
  const parent = { id: "100", title: "Delivery Spec", body: `${specBody}\n\n${EXECUTABLE_DELIVERY_SPEC_MARKER}` };
  const acceptanceBody = {
    schema: "pi-ticket-planning:spec-acceptance:v1",
    parent: { number: 100, title: parent.title, bodyHash: hashText(parent.body) },
    source: { baseSha, specContentHash: hashText(specBody) },
    decision: { caseId: "PC-R1", approvalId: "F-spec-approval", acceptedAt: "2026-08-29T00:00:00Z" },
  };
  const snapshot = {
    schema: "pi-ticket-planning:delivery-release-graph:v3",
    kind: "EXECUTABLE_RELEASE",
    executable: true,
    readinessState: "GRAPH_REVIEWED",
    releaseId: "R1-C1-r1",
    releaseOrdinal: 1,
    planningBaseSha: baseSha,
    executionBaseSha: baseSha,
    roadmapDigest: null,
    predecessorReleaseId: null,
    predecessorReceipt: null,
    specAcceptance: { ...acceptanceBody, digest: fingerprint(acceptanceBody) },
    decisionManifestDigest: `sha256:${"d".repeat(64)}`,
    source: {
      identity: "PRODUCT_RELEASE R1",
      revision: "r2",
      specContentHash: hashText(specBody),
    },
    scenarios: [
      {
        id: "S1",
        behavior: "The user submits input.",
        entry: "external:input",
        exit: "accepted-input",
        releaseSignal: "Input accepted.",
        smallestLoop: true,
      },
      {
        id: "S2",
        behavior: "The user receives a result.",
        entry: "accepted-input",
        exit: "result",
        releaseSignal: "Result returned.",
        smallestLoop: true,
      },
    ],
    children: [
      {
        id: "101",
        title: "Accept input",
        coverageRole: "DIRECT",
        sourceScenarios: ["S1"],
        blockedBy: [],
        externalBlockers: [],
        bodyHash: hashText(children[0].body),
        startingState: "Input is available.",
        primaryVerification: "Submit valid input.",
        executionLane: "AGENT",
      },
      {
        id: "102",
        title: "Return result",
        coverageRole: "DIRECT",
        sourceScenarios: ["S2"],
        blockedBy: ["101"],
        externalBlockers: [],
        bodyHash: hashText(children[1].body),
        startingState: "Input has been accepted.",
        primaryVerification: "Read the result.",
        executionLane: "AGENT",
      },
    ],
    walkingSkeleton: ["101", "102"],
  };
  const source = {
    identity: "PRODUCT_RELEASE R1",
    revision: "r2",
    baseSha,
    specContentHash: hashText(specBody),
  };
  return {
    repositoryPath,
    source,
    parent,
    parentBody: parent.body,
    specAcceptance: snapshot.specAcceptance,
    deliveryGraph: snapshot,
    children,
    contextChecks: children.map((child) => ({
      candidateId: child.id,
      result: checkTicketContext({ repo: repositoryPath, base: source.baseSha, body: child.body }),
    })),
  };
}

test("admission state accepts one exact v3 release, acceptance receipt, body, order, and native graph", () => {
  const checked = validateAdmissionState(readyBundle());
  assert.equal(checked.ok, true);
  assert.equal(checked.verdict, "READY");
  assert.deepEqual(checked.problems, []);
});

test("admission state rejects body, order, and native dependency drift", () => {
  const bodyDrift = readyBundle();
  bodyDrift.children[0].body += " changed";
  assert.equal(validateAdmissionState(bodyDrift).problems.some(({ code }) => code === "BODY_HASH_MISMATCH"), true);

  const orderDrift = readyBundle();
  orderDrift.children.reverse();
  const orderCodes = validateAdmissionState(orderDrift).problems.map(({ code }) => code);
  assert.equal(orderCodes.includes("CHILD_ORDER_MISMATCH"), true);

  const edgeDrift = readyBundle();
  edgeDrift.children[1].blockedBy = [];
  assert.equal(validateAdmissionState(edgeDrift).problems.some(({ code }) => code === "NATIVE_GRAPH_MISMATCH"), true);
});

test("admission state rejects source, Spec Scenario, and external dependency drift", () => {
  const sourceDrift = readyBundle();
  sourceDrift.source.revision = "r3";
  assert.equal(validateAdmissionState(sourceDrift).problems.some(({ code }) => code === "SOURCE_REVISION_MISMATCH"), true);

  const scenarioDrift = readyBundle();
  scenarioDrift.parentBody = scenarioDrift.parentBody.replace("### S2: Return result", "### S3: Return result");
  const scenarioCodes = validateAdmissionState(scenarioDrift).problems.map(({ code }) => code);
  assert.equal(scenarioCodes.includes("SPEC_ACCEPTANCE_RECEIPT_STALE"), true);
  assert.equal(scenarioCodes.includes("SPEC_SCENARIO_SET_MISMATCH"), true);

  const externalDrift = readyBundle();
  externalDrift.children[1].blockedBy.push("999");
  assert.equal(validateAdmissionState(externalDrift).problems.some(({ code }) => code === "OPEN_EXTERNAL_BLOCKER"), true);
});

test("admission state requires matching PASS Context checks", () => {
  const missing = readyBundle();
  missing.contextChecks.shift();
  assert.equal(validateAdmissionState(missing).problems.some(({ code }) => code === "MISSING_CONTEXT_CHECK"), true);

  const failed = readyBundle();
  failed.contextChecks[0].result = buildTicketContextResult({
    baseSha: failed.source.baseSha,
    body: failed.children[0].body,
    problems: [{ code: "CONTEXT_ANCHOR_NOT_FOUND" }],
  });
  assert.equal(validateAdmissionState(failed).problems.some(({ code }) => code === "CONTEXT_CHECK_FAILED"), true);

  const baseDrift = readyBundle();
  baseDrift.contextChecks[0].result = buildTicketContextResult({
    baseSha: "2222222222222222222222222222222222222222",
    body: baseDrift.children[0].body,
  });
  assert.equal(validateAdmissionState(baseDrift).problems.some(({ code }) => code === "CONTEXT_CHECK_BASE_SHA_MISMATCH"), true);
});

test("acceptance receipt fails closed on Parent contradiction or body drift", () => {
  const contradiction = readyBundle();
  contradiction.parentBody += "\n\nStatus: SPEC_IN_PROGRESS / not accepted";
  const contradictionCodes = validateAdmissionState(contradiction).problems.map(({ code }) => code);
  assert.equal(contradictionCodes.includes("PARENT_ACCEPTANCE_CONTRADICTION"), true);
  assert.equal(contradictionCodes.includes("SPEC_ACCEPTANCE_RECEIPT_STALE"), true);

  const childClaim = readyBundle();
  childClaim.children[0].body += "\n\nParent: Accepted Delivery Spec";
  childClaim.deliveryGraph.children[0].bodyHash = hashText(childClaim.children[0].body);
  childClaim.parentBody += "\nchanged";
  assert.equal(validateAdmissionState(childClaim).problems.some(({ code }) => code === "CHILD_ACCEPTANCE_WITHOUT_EXACT_RECEIPT"), true);
});

test("downstream release binds its predecessor receipt to the exact Roadmap sequence", () => {
  const bundle = readyBundle();
  bundle.roadmapParent = { id: "99", title: "R1 Roadmap", body: `# R1 Roadmap\n\n${ROADMAP_PARENT_MARKER}` };
  const receiptBody = {
    schema: "pi-ticket-planning:release-predecessor-receipt:v1",
    releaseId: "R1-C1-r1",
    mergedMainSha: baseSha,
    handoffDigests: [],
    validationDigest: `sha256:${"7".repeat(64)}`,
    completedAt: "2026-08-29T01:00:00Z",
  };
  const roadmapBody = {
    schema: "pi-ticket-planning:roadmap-graph:v1",
    kind: "ROADMAP",
    executable: false,
    readinessState: "PLANNED",
    roadmapId: "R1",
    planningBaseSha: baseSha,
    parent: { number: 99, title: bundle.roadmapParent.title, bodyHash: hashText(bundle.roadmapParent.body) },
    plannedReleases: [
      { releaseId: "R1-C1-r1", releaseOrdinal: 1, readinessState: "PLANNED", objective: "C1", scenarioCoverage: ["S1"], predecessors: [], candidateTickets: [] },
      { releaseId: "R1-C2-r1", releaseOrdinal: 2, readinessState: "PLANNED", objective: "C2", scenarioCoverage: ["S2"], predecessors: ["R1-C1-r1"], candidateTickets: [] },
    ],
  };
  bundle.roadmapGraph = { ...roadmapBody, digest: fingerprint(roadmapBody) };
  Object.assign(bundle.deliveryGraph, {
    releaseId: "R1-C2-r1",
    releaseOrdinal: 2,
    roadmapDigest: bundle.roadmapGraph.digest,
    predecessorReleaseId: "R1-C1-r1",
    predecessorReceipt: { ...receiptBody, digest: fingerprint(receiptBody) },
  });
  assert.equal(validateAdmissionState(bundle).ok, true);

  const forged = structuredClone(bundle);
  forged.roadmapGraph.plannedReleases[0].releaseId = "R999";
  forged.roadmapGraph.plannedReleases[1].predecessors = ["R999"];
  const { digest: _digest, ...forgedRoadmapBody } = forged.roadmapGraph;
  forged.roadmapGraph.digest = fingerprint(forgedRoadmapBody);
  forged.deliveryGraph.roadmapDigest = forged.roadmapGraph.digest;
  assert.equal(validateAdmissionState(forged).problems.some(({ code }) => code === "ROADMAP_PREDECESSOR_MISMATCH"), true);

  const planningBaseDrift = structuredClone(bundle);
  planningBaseDrift.roadmapGraph.planningBaseSha = "f".repeat(40);
  const { digest: _roadmapDigest, ...driftedRoadmapBody } = planningBaseDrift.roadmapGraph;
  planningBaseDrift.roadmapGraph.digest = fingerprint(driftedRoadmapBody);
  planningBaseDrift.deliveryGraph.roadmapDigest = planningBaseDrift.roadmapGraph.digest;
  assert.equal(validateAdmissionState(planningBaseDrift).problems.some(({ code }) => code === "ROADMAP_PLANNING_BASE_MISMATCH"), true);
});
