import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  DELIVERY_GRAPH_MARKER,
  hashText,
} from "../scripts/check-delivery-graph.mjs";
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
  const snapshot = {
    version: 2,
    source: {
      identity: "PRODUCT_RELEASE R1",
      revision: "r2",
      baseSha,
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
  const parentBody = `${specBody}\n\n## Ticket coverage\n\n${DELIVERY_GRAPH_MARKER}\n\n\`\`\`json\n${JSON.stringify(snapshot)}\n\`\`\``;
  const source = {
    identity: "PRODUCT_RELEASE R1",
    revision: "r2",
    baseSha,
  };
  return {
    repositoryPath,
    source,
    parentBody,
    children,
    contextChecks: children.map((child) => ({
      candidateId: child.id,
      result: checkTicketContext({ repo: repositoryPath, base: source.baseSha, body: child.body }),
    })),
  };
}

test("admission state accepts an exact v2 snapshot, Spec, body, order, and native graph", () => {
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
  assert.equal(scenarioCodes.includes("SPEC_CONTENT_HASH_MISMATCH"), true);
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
