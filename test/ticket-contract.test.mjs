import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { validateReviewArtifact } from "../admission/domain.mjs";
import {
  reviewCandidateMatchesTicketContract,
  patternsOverlap,
  ticketContractDigest,
  ticketContractVerdict,
  validateTicketContract,
} from "../scripts/check-ticket-contract.mjs";
import {
  executionConstraints,
  graphContractFields,
  oracleBinding,
  reviewContractFields,
  ticketBody,
} from "./ticket-contract-fixture.mjs";

const regressionCases = JSON.parse(fs.readFileSync(new URL("../fixtures/ticket-readiness-contract-cases.json", import.meta.url), "utf8")).cases;

function git(repo, args) {
  const run = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(run.stderr);
  return run.stdout.trim();
}

function repository(t) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-ticket-contract-"));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.email", "ticket-contract@example.invalid"]);
  git(repo, ["config", "user.name", "Ticket Contract"]);
  fs.mkdirSync(path.join(repo, "fixtures", "oracles", "accord"), { recursive: true });
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  fs.mkdirSync(path.join(repo, "schemas"), { recursive: true });
  fs.mkdirSync(path.join(repo, "scripts", "lib"), { recursive: true });
  fs.writeFileSync(path.join(repo, "fixtures", "oracles", "accord", "o01.json"), "{\"expected\":\"PASS\"}\n");
  fs.writeFileSync(path.join(repo, "src", "schema.ts"), "export const schema = 1;\n");
  fs.writeFileSync(path.join(repo, "schemas", "o01.schema.json"), "{\"type\":\"object\"}\n");
  fs.writeFileSync(path.join(repo, "scripts", "lib", "o01-helper.mjs"), "export const expected = 1;\n");
  fs.writeFileSync(path.join(repo, "scripts", "verify-o01.mjs"), "import { expected } from './lib/o01-helper.mjs';\nif (expected !== 1) process.exit(1);\n");
  fs.writeFileSync(path.join(repo, "package.json"), `${JSON.stringify({ scripts: { "verify:oracle:o01": "node scripts/verify-o01.mjs" } })}\n`);
  git(repo, ["add", "."]);
  git(repo, ["commit", "-qm", "ticket contract fixture"]);
  return { repo, baseSha: git(repo, ["rev-parse", "HEAD"]) };
}

function readyTicket(t, overrides = {}) {
  const source = repository(t);
  const binding = oracleBinding({
    ...source,
    artifactPath: "fixtures/oracles/accord/o01.json",
    format: "accord.oracle.schema9/v1",
    command: "npm run verify:oracle:o01",
    verifierFiles: ["schemas/o01.schema.json", "scripts/lib/o01-helper.mjs", "scripts/verify-o01.mjs"],
  });
  const constraints = executionConstraints({
    riskClasses: ["SCHEMA_MIGRATION", "AUTHORITY_BOUNDARY"],
    scopeBudget: { maxFiles: 4, maxChangedLines: 500 },
    expectedPaths: ["src/schema.ts"],
    protectedPaths: [binding.artifact.path],
    primaryVerificationSeams: ["frozen schema migration oracle"],
    ...overrides.constraints,
  });
  const body = ticketBody({
    objective: "Apply one bounded schema migration.",
    primaryVerification: "Run the frozen schema migration Oracle.",
    binding: { ...binding, ...overrides.binding },
    constraints,
  });
  const child = { id: "C1", body };
  const graphChild = { id: child.id, ...graphContractFields(body), ...overrides.graphChild };
  return { ...source, binding, constraints, body, child, graphChild };
}

test("small schema migration with a frozen Oracle is READY", (t) => {
  assert.equal(regressionCases.some(({ id, kind }) => id === "small-schema-migration-frozen-oracle" && kind === "READY"), true);
  const ready = readyTicket(t);
  const checked = validateTicketContract({
    repositoryPath: ready.repo,
    baseSha: ready.baseSha,
    child: ready.child,
    graphChild: ready.graphChild,
    graphChildren: [ready.graphChild],
  });
  assert.equal(checked.ok, true, JSON.stringify(checked.problems));
  assert.equal(ticketContractVerdict(checked.problems), "READY");
  assert.equal(checked.projection.oracleBindingVerdict, "PASS");
  assert.equal(reviewCandidateMatchesTicketContract({ verdict: "READY", ...reviewContractFields(ready.body, ready.graphChild, [ready.graphChild]) }, checked.projection), true);
});

test("expected path patterns reject root wildcards and allow bounded child-segment wildcards", (t) => {
  assert.equal(patternsOverlap("*.ts", "foo*.ts"), true);
  for (const expectedPaths of [["*.ts"], ["foo*.ts"], ["*/x.ts"]]) {
    const ready = readyTicket(t, { constraints: { expectedPaths } });
    const checked = validateTicketContract({ repositoryPath: ready.repo, baseSha: ready.baseSha, child: ready.child });
    assert.equal(checked.problems.some(({ code }) => code === "INVALID_EXPECTED_PATH_PATTERN"), true);
  }
  const bounded = readyTicket(t, { constraints: { expectedPaths: ["src/*.ts"] } });
  const checked = validateTicketContract({ repositoryPath: bounded.repo, baseSha: bounded.baseSha, child: bounded.child });
  assert.equal(checked.problems.some(({ code }) => code === "INVALID_EXPECTED_PATH_PATTERN"), false);
});

test("review projection reports exact code-hotspot overlap", (t) => {
  const ready = readyTicket(t);
  const sibling = { ...structuredClone(ready.graphChild), id: "C2" };
  const checked = validateTicketContract({
    repositoryPath: ready.repo,
    baseSha: ready.baseSha,
    child: ready.child,
    graphChild: ready.graphChild,
    graphChildren: [ready.graphChild, sibling],
  });
  assert.deepEqual(checked.projection.codeHotspotOverlap, ["src/schema.ts"]);
});

test("machine review cannot downgrade a deterministic SPLIT to NEEDS_INFO", (t) => {
  const ready = readyTicket(t, { constraints: { riskClasses: ["PROVIDER_ATTEMPT_RECOVERY", "PUBLICATION_RECOVERY"] } });
  const checked = validateTicketContract({ repositoryPath: ready.repo, baseSha: ready.baseSha, child: ready.child });
  const candidate = { id: "C1", verdict: "SPLIT", executionLane: "AGENT", ...checked.projection };
  const review = {
    schema: "pi-ticket-planning:admission-review:v1",
    reviewer: "ticket-readiness-reviewer",
    reviewedAt: "2026-08-29T00:00:00Z",
    source: { identity: "R1", revision: "r1", baseSha: ready.baseSha },
    axes: { candidateReadiness: "FAIL", contextQuality: "PASS", deliveryGraph: "PASS", scenarioCoverage: "PASS", walkingSkeleton: "PASS", strictFrontier: "PASS", executionLane: "PASS", inputBinding: "PASS" },
    graphVerdict: "NEEDS_INFO",
    candidates: [candidate],
    inputBinding: {},
  };
  assert.equal(validateReviewArtifact(review), true);
  const rootWildcard = structuredClone(review);
  rootWildcard.candidates[0].expectedPaths = ["*.ts"];
  assert.equal(validateReviewArtifact(rootWildcard), false);
  review.candidates[0].verdict = "NEEDS_INFO";
  assert.equal(validateReviewArtifact(review), false);
});

test("Oracle binding failures return stable codes", (t) => {
  for (const [mutate, code] of [
    [(value) => { value.binding.artifact.path = "fixtures/oracles/accord/missing.json"; }, "ORACLE_ARTIFACT_NOT_FOUND"],
    [(value) => { value.binding.artifact.sha256 = `sha256:${"0".repeat(64)}`; }, "ORACLE_DIGEST_MISMATCH"],
    [(value) => { value.binding.artifact.baseSha = "f".repeat(40); }, "ORACLE_BASE_MISMATCH"],
    [(value) => { value.binding.workerMutationAllowed = true; }, "ORACLE_MUTABLE_BY_WORKER"],
    [(value) => { value.binding.owner.identity = value.constraints.implementationOwner; }, "ORACLE_OWNER_NOT_INDEPENDENT"],
    [(value) => { value.binding.execution.command = "npm run admit"; }, "ORACLE_COMMAND_NOT_ALLOWED"],
    [(value) => { delete value.binding.verifier; }, "ORACLE_VERIFIER_MANIFEST_MISSING"],
    [(value) => { value.binding.verifier.files[0].sha256 = `sha256:${"0".repeat(64)}`; }, "ORACLE_VERIFIER_BINDING_DRIFT"],
    [(value) => { value.binding.verifier.packageScript.definitionSha256 = `sha256:${"0".repeat(64)}`; }, "ORACLE_VERIFIER_BINDING_DRIFT"],
  ]) {
    const ready = readyTicket(t);
    mutate(ready);
    ready.child.body = ticketBody({ objective: "Apply one bounded schema migration.", primaryVerification: "Run the frozen schema migration Oracle.", binding: ready.binding, constraints: ready.constraints });
    const checked = validateTicketContract({ repositoryPath: ready.repo, baseSha: ready.baseSha, child: ready.child });
    assert.equal(checked.problems.some((problem) => problem.code === code), true, code);
  }
});

test("natural-language Oracle names do not satisfy the binding contract", (t) => {
  const { repo, baseSha } = repository(t);
  const body = "## What to build\nBuild one change.\n## Primary verification\nO01.\n## Acceptance criteria\n- [ ] A\n- [ ] B\n- [ ] C\n## Invariants and guardrails\nFrozen Oracle O01.\n## Execution constraints\n```json\n{}\n```\n## Out of scope\nNone.";
  const checked = validateTicketContract({ repositoryPath: repo, baseSha, child: { id: "C1", body } });
  const fixture = regressionCases.find(({ id }) => id === "accord-o01-natural-language-only");
  assert.equal(checked.problems[0].code, fixture.expectedCode);
  assert.equal(ticketContractVerdict(checked.problems), fixture.expectedVerdict);
});

test("risk, scope, protected paths, replan, and integration-only gates fail closed", (t) => {
  const cases = [
    ...regressionCases.filter(({ kind }) => kind === "CONSTRAINTS").map(({ constraints, expectedCode, expectedVerdict }) => [constraints, expectedCode, expectedVerdict]),
    [{ scopeBudget: { maxFiles: 9, maxChangedLines: 1501 } }, "SCOPE_BUDGET_TOO_LARGE", "NEEDS_INFO"],
    [{ replanTriggers: ["SCOPE_BUDGET_EXCEEDED"] }, "MISSING_REPLAN_TRIGGERS", "NEEDS_INFO"],
    [{ primaryVerificationSeams: ["provider recovery", "publication recovery"] }, "TICKET_REQUIRES_SPLIT", "SPLIT"],
  ];
  for (const [constraints, code, verdict] of cases) {
    const ready = readyTicket(t, { constraints });
    const checked = validateTicketContract({ repositoryPath: ready.repo, baseSha: ready.baseSha, child: ready.child });
    assert.equal(checked.problems.some((problem) => problem.code === code), true, code);
    assert.equal(ticketContractVerdict(checked.problems), verdict, code);
  }
});

test("exact human waivers bind a third risk class and mechanical migration budget", (t) => {
  const riskBody = {
    schema: "pi-ticket-planning:ticket-readiness-waiver:v1",
    kind: "RISK_CLASS_LIMIT",
    childId: "C1",
    exception: { riskClasses: ["SCHEMA_MIGRATION", "AUTHORITY_BOUNDARY", "DOMAIN_PERSISTENCE"] },
    approval: { kind: "HUMAN", approvalId: "F-risk-waiver", approvedAt: "2026-08-29T00:00:00Z" },
  };
  const riskWaiver = { ...riskBody, digest: ticketContractDigest(riskBody) };
  const scopeBody = {
    schema: "pi-ticket-planning:ticket-readiness-waiver:v1",
    kind: "MECHANICAL_MIGRATION",
    childId: "C1",
    exception: { scopeBudget: { maxFiles: 8, maxChangedLines: 3000 }, mechanicalMigration: true },
    approval: { kind: "HUMAN", approvalId: "F-scope-waiver", approvedAt: "2026-08-29T00:00:00Z" },
  };
  const scopeWaiver = { ...scopeBody, digest: ticketContractDigest(scopeBody) };
  const ready = readyTicket(t, { constraints: {
    riskClasses: riskBody.exception.riskClasses,
    scopeBudget: scopeBody.exception.scopeBudget,
    waivers: [riskWaiver, scopeWaiver],
  } });
  const checked = validateTicketContract({ repositoryPath: ready.repo, baseSha: ready.baseSha, child: ready.child });
  assert.equal(checked.problems.some(({ code }) => ["TOO_MANY_RISK_CLASSES", "SCOPE_BUDGET_TOO_LARGE"].includes(code)), false, JSON.stringify(checked.problems));
});
