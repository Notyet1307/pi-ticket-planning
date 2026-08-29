import assert from "node:assert/strict";
import test from "node:test";

import { compileExecutionPlan } from "../execution-plan/compiler.mjs";
import { parseChildTicket } from "../execution-plan/markdown.mjs";
import {
  graphReleaseClosureProblems,
  oracleValidationCoverageProblems,
  oracleVerifierProtectionProblems,
  roadmapReleaseBindingProblems,
} from "../scripts/check-release-closure.mjs";
import {
  BASE_SHA,
  ROOT,
  controllerBinding,
  executionInput,
} from "./execution-plan-fixture.mjs";

function problemCodes(problems) {
  return problems.map(({ code }) => code);
}

function roadmapFor(input) {
  const graph = input.deliveryGraph;
  return {
    schema: "pi-ticket-planning:roadmap-graph:v1",
    kind: "ROADMAP",
    executable: false,
    readinessState: "PLANNED",
    roadmapId: "roadmap-r1",
    planningBaseSha: graph.planningBaseSha,
    parent: { number: 99, title: "Roadmap", bodyHash: `sha256:${"f".repeat(64)}` },
    plannedReleases: [{
      releaseId: graph.releaseId,
      releaseOrdinal: graph.releaseOrdinal,
      readinessState: "PLANNED",
      objective: "Release the safe change.",
      scenarioCoverage: graph.scenarios.map(({ id }) => id),
      predecessors: [],
      candidateTickets: graph.children.map((child) => ({
        id: child.id,
        title: child.title,
        objective: parseChildTicket(input.children.find(({ id }) => String(id) === String(child.id)).body).objective,
        executionLane: "AGENT",
      })),
    }],
    digest: `sha256:${"e".repeat(64)}`,
  };
}

test("release closure requires every authority source in every Ticket protected set", () => {
  const input = executionInput();
  assert.deepEqual(graphReleaseClosureProblems(input.deliveryGraph), []);
  input.deliveryGraph.children[0].protectedPaths = input.deliveryGraph.children[0].protectedPaths
    .filter((value) => value !== input.deliveryGraph.decisionManifest.policy.path);
  assert.ok(problemCodes(graphReleaseClosureProblems(input.deliveryGraph)).includes("MISSING_PROTECTED_AUTHORITY_PATH"));
});

test("release closure rejects authority paths in the expected write set", () => {
  const input = executionInput();
  input.deliveryGraph.children[0].expectedPaths = ["AGENTS.md"];
  const codes = problemCodes(graphReleaseClosureProblems(input.deliveryGraph));
  assert.ok(codes.includes("AUTHORITY_PATH_IN_EXPECTED_WRITE_SET"));
});

test("release closure rejects overlapping expected path ownership", () => {
  const input = executionInput();
  const first = input.deliveryGraph.children[0];
  input.deliveryGraph.children.push({ ...structuredClone(first), id: "102", title: "Second owner" });
  const codes = problemCodes(graphReleaseClosureProblems(input.deliveryGraph));
  assert.ok(codes.includes("PATH_OWNERSHIP_OVERLAP"));
});

test("Oracle verifier definition and entry source must be protected", () => {
  const input = executionInput();
  assert.deepEqual(oracleVerifierProtectionProblems({
    repositoryPath: ROOT,
    baseSha: BASE_SHA,
    children: input.children,
    graphChildren: input.deliveryGraph.children,
  }), []);
  input.deliveryGraph.children[0].protectedPaths = input.deliveryGraph.children[0].protectedPaths
    .filter((value) => value !== "scripts/verify-protocol.mjs");
  const codes = problemCodes(oracleVerifierProtectionProblems({
    repositoryPath: ROOT,
    baseSha: BASE_SHA,
    children: input.children,
    graphChildren: input.deliveryGraph.children,
  }));
  assert.ok(codes.includes("MISSING_PROTECTED_ORACLE_VERIFIER_PATH"));
});

test("Controller release validation must execute every bound Oracle command", () => {
  const input = executionInput();
  const controller = controllerBinding(input);
  assert.deepEqual(oracleValidationCoverageProblems({ controllerConfig: controller.config, children: input.children }), []);
  controller.config.validation.release = [];
  assert.deepEqual(problemCodes(oracleValidationCoverageProblems({ controllerConfig: controller.config, children: input.children })), [
    "ORACLE_VALIDATION_COMMAND_MISSING",
  ]);
  assert.throws(() => compileExecutionPlan(input, { controller }), /ORACLE_VALIDATION_COMMAND_MISSING/);
});

test("Roadmap current Release binds exact AGENT membership, identity, objective, and scenarios", () => {
  const input = executionInput();
  const roadmap = roadmapFor(input);
  assert.deepEqual(roadmapReleaseBindingProblems({ roadmap, graph: input.deliveryGraph, children: input.children }), []);

  roadmap.plannedReleases[0].scenarioCoverage = ["S999"];
  assert.ok(problemCodes(roadmapReleaseBindingProblems({ roadmap, graph: input.deliveryGraph, children: input.children }))
    .includes("ROADMAP_SCENARIO_COVERAGE_MISMATCH"));

  const membership = roadmapFor(input);
  membership.plannedReleases[0].candidateTickets = [];
  assert.ok(problemCodes(roadmapReleaseBindingProblems({ roadmap: membership, graph: input.deliveryGraph, children: input.children }))
    .includes("ROADMAP_RELEASE_MEMBERSHIP_MISMATCH"));

  const identity = roadmapFor(input);
  identity.plannedReleases[0].candidateTickets[0].objective = "Different objective.";
  assert.ok(problemCodes(roadmapReleaseBindingProblems({ roadmap: identity, graph: input.deliveryGraph, children: input.children }))
    .includes("ROADMAP_TICKET_IDENTITY_MISMATCH"));
});
