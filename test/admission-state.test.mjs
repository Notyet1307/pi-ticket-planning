import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fingerprint } from "../execution-plan/domain.mjs";
import { parseChildTicket } from "../execution-plan/markdown.mjs";
import { EXECUTABLE_DELIVERY_SPEC_MARKER, ROADMAP_PARENT_MARKER, hashText } from "../scripts/check-delivery-graph.mjs";
import { validateAdmissionState } from "../scripts/check-admission-state.mjs";
import {
  buildTicketContextResult,
  checkTicketContext,
} from "../scripts/check-ticket-context.mjs";
import {
  executionConstraints,
  graphContractFields,
  oracleBinding,
  ticketBody,
} from "./ticket-contract-fixture.mjs";
import { createAdmissionBindingFixture } from "./admission-binding-fixture.mjs";

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
const parent = { id: "100", title: "Delivery Spec", body: `${specBody}\n\n${EXECUTABLE_DELIVERY_SPEC_MARKER}` };
const bindings = createAdmissionBindingFixture({
  registerCleanup: after,
  parent,
  specBody,
  caseId: "PC-R1",
  approvalId: "F-spec-approval",
  acceptedAt: "2026-08-29T01:00:00Z",
  productReleaseIdentity: "R1/r2",
});
const {
  repositoryPath,
  planningBaseSha,
  executionBaseSha: baseSha,
  specAcceptance,
  specAcceptanceBinding,
  decisionManifest,
  decisionManifestBinding,
  predecessorReceipt,
  predecessorReceiptBinding,
} = bindings;

function readyBundle() {
  const binding = oracleBinding({ repo: repositoryPath, baseSha });
  const children = [
    {
      id: "101",
      body: ticketBody({
        objective: "Accept one input.",
        primaryVerification: "Submit valid input.",
        binding,
        constraints: executionConstraints({
          expectedPaths: ["scripts/check-admission-state.mjs"],
          primaryVerificationSeams: ["Submit valid input."],
        }),
      }),
      blockedBy: [],
    },
    {
      id: "102",
      body: ticketBody({
        objective: "Return one result.",
        primaryVerification: "Read the result.",
        binding,
        constraints: executionConstraints({
          expectedPaths: ["scripts/check-delivery-graph.mjs"],
          primaryVerificationSeams: ["Read the result."],
        }),
      }),
      blockedBy: ["101"],
    },
  ];
  const snapshot = {
    schema: "pi-ticket-planning:delivery-release-graph:v3",
    kind: "EXECUTABLE_RELEASE",
    executable: true,
    readinessState: "GRAPH_REVIEWED",
    releaseId: "R1-C1-r1",
    releaseOrdinal: 1,
    planningBaseSha,
    executionBaseSha: baseSha,
    executionBasePolicy: "PLANNING_BASE_OR_DESCENDANT",
    roadmapDigest: null,
    predecessorReleaseId: null,
    predecessorPlanDigest: null,
    predecessorReceipt: null,
    predecessorReceiptBinding: null,
    specAcceptance: structuredClone(specAcceptance),
    specAcceptanceBinding: structuredClone(specAcceptanceBinding),
    decisionManifest: structuredClone(decisionManifest),
    decisionManifestBinding: structuredClone(decisionManifestBinding),
    decisionManifestDigest: decisionManifestBinding.sha256,
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
        ...graphContractFields(children[0].body),
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
        ...graphContractFields(children[1].body),
      },
    ],
    walkingSkeleton: ["101", "102"],
  };
  const source = {
    identity: "PRODUCT_RELEASE R1",
    revision: "r2",
    baseSha,
    baseRef: "main",
    specContentHash: hashText(specBody),
  };
  return {
    repo: "acme/product",
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

test("Admission dereferences tracked receipt and decision bytes at the execution base", () => {
  const receiptDrift = readyBundle();
  receiptDrift.deliveryGraph.specAcceptanceBinding.sha256 = `sha256:${"0".repeat(64)}`;
  assert.equal(validateAdmissionState(receiptDrift).problems.some(({ code }) => code === "SPEC_ACCEPTANCE_DRIFT"), true);

  const decisionDrift = readyBundle();
  decisionDrift.deliveryGraph.decisionManifest.policy.sha256 = `sha256:${"0".repeat(64)}`;
  const { digest: _digest, ...decisionBody } = decisionDrift.deliveryGraph.decisionManifest;
  decisionDrift.deliveryGraph.decisionManifest.digest = fingerprint(decisionBody);
  assert.equal(validateAdmissionState(decisionDrift).problems.some(({ code }) => code === "DECISION_MANIFEST_DRIFT"), true);
});

test("Admission rejects a natural-language Oracle without an exact binding", () => {
  const bundle = readyBundle();
  const parsed = parseChildTicket(bundle.children[0].body);
  parsed.executionConstraints.riskClasses = ["AUTHORITY_BOUNDARY"];
  bundle.children[0].body = ticketBody({
    objective: parsed.objective,
    primaryVerification: parsed.primaryVerification,
    acceptanceCriteria: parsed.acceptanceCriteria,
    guardrails: "Frozen Oracle O01.",
    binding: null,
    constraints: parsed.executionConstraints,
  });
  bundle.deliveryGraph.children[0].bodyHash = hashText(bundle.children[0].body);
  Object.assign(bundle.deliveryGraph.children[0], graphContractFields(bundle.children[0].body));
  bundle.contextChecks[0].result = checkTicketContext({ repo: bundle.repositoryPath, base: bundle.source.baseSha, body: bundle.children[0].body });
  assert.equal(validateAdmissionState(bundle).problems.some(({ code }) => code === "MISSING_ORACLE_BINDING"), true);
});

test("downstream release binds its predecessor receipt to the exact Roadmap sequence", () => {
  const bundle = readyBundle();
  bundle.roadmapParent = { id: "99", title: "R1 Roadmap", body: `# R1 Roadmap\n\n${ROADMAP_PARENT_MARKER}` };
  const roadmapBody = {
    schema: "pi-ticket-planning:roadmap-graph:v1",
    kind: "ROADMAP",
    executable: false,
    readinessState: "PLANNED",
    roadmapId: "R1",
    planningBaseSha,
    parent: { number: 99, title: bundle.roadmapParent.title, bodyHash: hashText(bundle.roadmapParent.body) },
    plannedReleases: [
      { releaseId: "r1-c1-r1", releaseOrdinal: 1, readinessState: "PLANNED", objective: "C1", scenarioCoverage: ["S1"], predecessors: [], candidateTickets: [] },
      {
        releaseId: "R1-C2-r1",
        releaseOrdinal: 2,
        readinessState: "PLANNED",
        objective: "C2",
        scenarioCoverage: bundle.deliveryGraph.scenarios.map(({ id }) => id),
        predecessors: ["r1-c1-r1"],
        candidateTickets: bundle.deliveryGraph.children.map((child) => ({
          id: child.id,
          title: child.title,
          objective: child.id === "101" ? "Accept one input." : "Return one result.",
          executionLane: "AGENT",
        })),
      },
    ],
  };
  bundle.roadmapGraph = { ...roadmapBody, digest: fingerprint(roadmapBody) };
  Object.assign(bundle.deliveryGraph, {
    releaseId: "R1-C2-r1",
    releaseOrdinal: 2,
    executionBasePolicy: "PREDECESSOR_MERGE_OR_DESCENDANT",
    roadmapDigest: bundle.roadmapGraph.digest,
    predecessorReleaseId: "r1-c1-r1",
    predecessorPlanDigest: predecessorReceipt.planDigest,
    predecessorReceipt: structuredClone(predecessorReceipt),
    predecessorReceiptBinding: structuredClone(predecessorReceiptBinding),
  });
  assert.equal(validateAdmissionState(bundle).ok, true);

  const receiptDrift = structuredClone(bundle);
  receiptDrift.deliveryGraph.predecessorReceiptBinding.sha256 = `sha256:${"0".repeat(64)}`;
  assert.equal(validateAdmissionState(receiptDrift).problems.some(({ code }) => code === "PREDECESSOR_RECEIPT_DRIFT"), true);

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
