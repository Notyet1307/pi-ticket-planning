import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  DELIVERY_GRAPH_MARKER,
  DELIVERY_GRAPH_MARKER_V1,
  computeSpecContentHash,
  hashText,
  parseDeliveryGraph,
  validateDeliveryGraph,
} from "../scripts/check-delivery-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cases = JSON.parse(fs.readFileSync(path.join(root, "fixtures", "admission-cases.json"), "utf8")).graphCases;

test("delivery graph fixtures keep coverage, handoff, skeleton, and frontier fail-closed", () => {
  for (const item of cases) {
    const checked = validateDeliveryGraph(item);
    assert.equal(checked.verdict, item.expectedGraphVerdict, item.id);
    for (const code of item.expectedProblemCodes ?? []) {
      assert.equal(checked.problems.some((problem) => problem.code === code), true, `${item.id}: ${code}`);
    }
  }
});

test("delivery graph parser accepts raw JSON and one marked Markdown snapshot", () => {
  const ready = cases.find((item) => item.expectedGraphVerdict === "READY");
  assert.deepEqual(parseDeliveryGraph(JSON.stringify(ready)), ready);
  assert.deepEqual(parseDeliveryGraph(`${DELIVERY_GRAPH_MARKER}\n\n\`\`\`json\n${JSON.stringify(ready)}\n\`\`\``), ready);
  assert.throws(() => parseDeliveryGraph("# no graph"), /exactly one delivery-graph marker/);
});

test("delivery graph rejects malformed smallest-loop declarations", () => {
  const ready = structuredClone(cases.find((item) => item.expectedGraphVerdict === "READY"));
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
  const ready = structuredClone(cases.find((item) => item.expectedGraphVerdict === "READY"));
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
  const ready = structuredClone(cases.find((item) => item.expectedGraphVerdict === "READY"));
  ready.children[0].blockedBy = ["T2"];
  const checked = validateDeliveryGraph(ready);
  assert.equal(checked.ok, false);
  assert.equal(checked.problems.some(({ code }) => code === "DEPENDENCY_CYCLE"), true);
});

test("walking skeleton rejects a structurally redundant child", () => {
  const ready = structuredClone(cases.find((item) => item.expectedGraphVerdict === "READY"));
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
  const ready = structuredClone(cases.find((item) => item.expectedGraphVerdict === "READY"));
  ready.version = 2;
  delete ready.source.specContentHash;
  delete ready.children[0].bodyHash;
  delete ready.children[0].startingState;

  const codes = validateDeliveryGraph(ready).problems.map(({ code }) => code);
  assert.equal(codes.includes("MISSING_SPEC_CONTENT_HASH"), true);
  assert.equal(codes.includes("MISSING_CHILD_BODY_HASH"), true);
  assert.equal(codes.includes("MISSING_CHILD_STARTING_STATE"), true);
});

test("delivery graph v1 remains readable but cannot pass Admission", () => {
  const legacy = structuredClone(cases.find((item) => item.expectedGraphVerdict === "READY"));
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
