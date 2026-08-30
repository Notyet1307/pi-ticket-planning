import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseChildTicket } from "../execution-plan/markdown.mjs";
import {
  graphReleaseClosureProblems,
  oracleValidationCoverageProblems,
  oracleVerifierProtectionProblems,
  roadmapReleaseBindingProblems,
} from "../scripts/check-release-closure.mjs";
import {
  controllerBinding,
  executionInput,
} from "./execution-plan-fixture.mjs";
import { git, write } from "./execution-freshness-fixture.mjs";

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

test("release closure rejects policy, Release, receipt, ADR, and handoff paths in a Ticket write set", () => {
  const input = executionInput();
  assert.deepEqual(graphReleaseClosureProblems(input.deliveryGraph), []);
  input.deliveryGraph.children[0].expectedPaths = [input.deliveryGraph.decisionManifest.policy.path];
  assert.ok(problemCodes(graphReleaseClosureProblems(input.deliveryGraph)).includes("AUTHORITY_PATH_IN_EXPECTED_WRITE_SET"));
});

test("release closure rejects tracked Spec and decision evidence in a Ticket write set", () => {
  const input = executionInput();
  input.deliveryGraph.children[0].expectedPaths = [input.deliveryGraph.specAcceptanceBinding.path];
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

test("Oracle verifier command definition and direct source stay outside the Ticket write set", () => {
  const input = executionInput();
  assert.deepEqual(oracleVerifierProtectionProblems({
    repositoryPath: input.repositoryPath,
    baseSha: input.source.baseSha,
    children: input.children,
    graphChildren: input.deliveryGraph.children,
  }), []);
  input.deliveryGraph.children[0].expectedPaths = ["scripts/verify-protocol.mjs"];
  let codes = problemCodes(oracleVerifierProtectionProblems({
    repositoryPath: input.repositoryPath,
    baseSha: input.source.baseSha,
    children: input.children,
    graphChildren: input.deliveryGraph.children,
  }));
  assert.ok(codes.includes("ORACLE_VERIFIER_PATH_IN_EXPECTED_WRITE_SET"));

  input.deliveryGraph.children[0].expectedPaths = ["package.json"];
  codes = problemCodes(oracleVerifierProtectionProblems({
    repositoryPath: input.repositoryPath,
    baseSha: input.source.baseSha,
    children: input.children,
    graphChildren: input.deliveryGraph.children,
  }));
  assert.ok(codes.includes("ORACLE_VERIFIER_PATH_IN_EXPECTED_WRITE_SET"));
});

test("Oracle verifier protection normalizes a direct ./ helper operand", (t) => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "oracle-verifier-relative-"));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.name", "Oracle Verifier Test"]);
  git(repo, ["config", "user.email", "oracle@example.invalid"]);
  write(repo, "package.json", `${JSON.stringify({ scripts: { "verify:oracle:o01": "node scripts/runner.mjs ./scripts/oracle-logic.mjs" } })}\n`);
  write(repo, "scripts/runner.mjs", "// runner\n");
  write(repo, "scripts/oracle-logic.mjs", "// Oracle logic\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-qm", "Oracle verifier"]);

  const input = executionInput();
  input.children[0].body = input.children[0].body.replace("npm run verify:protocol", "npm run verify:oracle:o01");
  input.deliveryGraph.children[0].expectedPaths = ["scripts/oracle-logic.mjs"];
  const codes = problemCodes(oracleVerifierProtectionProblems({
    repositoryPath: repo,
    baseSha: git(repo, ["rev-parse", "HEAD"]),
    children: input.children,
    graphChildren: input.deliveryGraph.children,
  }));
  assert.ok(codes.includes("ORACLE_VERIFIER_PATH_IN_EXPECTED_WRITE_SET"));
});

test("qualified Controller release validation must execute every bound Oracle command", () => {
  const input = executionInput();
  const controller = controllerBinding(input);
  assert.deepEqual(oracleValidationCoverageProblems({ controllerConfig: controller.config, children: input.children }), []);
  controller.config.validation.release = [];
  assert.deepEqual(problemCodes(oracleValidationCoverageProblems({ controllerConfig: controller.config, children: input.children })), [
    "ORACLE_VALIDATION_COMMAND_MISSING",
  ]);
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
