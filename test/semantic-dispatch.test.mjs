import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { validateRegisteredArtifactSemantics } from "../protocol/semantic-dispatch.mjs";
import { fingerprint } from "../execution-plan/domain.mjs";
import { controllerResultFixture } from "./controller-result-fixture.mjs";
import { RISK_CLASS_REGISTRY } from "../scripts/risk-classes.mjs";

const identity = (name) => ({ namespace: "pi-ticket-planning", name, major: 1 });
const problems = async (name, value) => (await validateRegisteredArtifactSemantics(value, identity(name))).problems;
const digest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

test("semantic dispatcher gives every registered concern a fail-closed invariant", async () => {
  assert.deepEqual(await problems("result-envelope", { status: "COMPLETE", problems: [] }), []);
  assert.equal((await problems("result-envelope", { status: "COMPLETE", problems: [{}] }))[0].code, "COMPLETE_RESULT_HAS_PROBLEMS");

  const release = { schema: "pi-ticket-planning:release-projection:v1", target: "github:acme/product" };
  release.digest = digest(JSON.stringify(release));
  assert.deepEqual(await problems("release-projection", release), []);
  assert.equal((await problems("release-projection", { ...release, digest: digest("bad") }))[0].code, "RELEASE_PROJECTION_DIGEST_MISMATCH");
  const acceptanceBody = {
    schema: "pi-ticket-planning:spec-acceptance:v1",
    parent: { number: 1, title: "Spec", bodyHash: `sha256:${"a".repeat(64)}` },
    source: { baseSha: "a".repeat(40), specContentHash: `sha256:${"b".repeat(64)}` },
    decision: { caseId: "PC-semantic", approvalId: "F-approval", acceptedAt: "2026-08-29T00:00:00Z" },
  };
  const acceptance = { ...acceptanceBody, digest: fingerprint(acceptanceBody) };
  assert.deepEqual(await problems("spec-projection", { target: "x", source: { target: "x" }, acceptance }), []);
  assert.equal((await problems("spec-projection", { target: "x", source: { target: "y" }, acceptance }))[0].code, "SPEC_SOURCE_TARGET_MISMATCH");
  const waiverBody = {
    schema: "pi-ticket-planning:ticket-readiness-waiver:v1",
    kind: "RISK_CLASS_LIMIT",
    childId: "C1",
    exception: { riskClasses: ["A", "B", "C"] },
    approval: { kind: "HUMAN", approvalId: "F-waiver", approvedAt: "2026-08-29T00:00:00Z" },
  };
  const waiver = { ...waiverBody, digest: fingerprint(waiverBody) };
  assert.deepEqual(await problems("ticket-readiness-waiver", waiver), []);
  assert.equal((await problems("ticket-readiness-waiver", { ...waiver, digest: digest("bad") }))[0].code, "TICKET_READINESS_WAIVER_DIGEST_MISMATCH");
  assert.deepEqual(await problems("planning-case", { nextAction: {} }), []);
  assert.equal((await problems("planning-case", { nextAction: null }))[0].code, "PLANNING_CASE_NEXT_ACTION_MISSING");
  assert.deepEqual(await problems("reviewed-admission-state", { repo: "acme/product", target: "1", currentCheckpoint: { subject: { target: "github:acme/product", id: "1" } } }), []);
  assert.equal((await problems("reviewed-admission-state", { repo: "acme/product", target: "1", currentCheckpoint: { subject: { target: "x", id: "2" } } }))[0].code, "REVIEWED_CHECKPOINT_SUBJECT_MISMATCH");
  for (const name of ["admission-result", "delivery-gate-result", "release-qualification"]) {
    assert.deepEqual(await problems(name, { status: "COMPLETE", problems: [] }), []);
    assert.equal((await problems(name, { status: "COMPLETE", problems: [{}] })).length, 1);
  }
  assert.equal((await problems("planning-case-event", { digest: digest("bad") }))[0].code, "CASE_EVENT_DIGEST_MISMATCH");
  assert.equal((await problems("case-transaction", { status: "COMMITTED", event: { digest: "a" }, nextSnapshot: { lastEvent: "b" } }))[0].code, "COMMITTED_TRANSACTION_EVENT_MISMATCH");
  assert.deepEqual(await problems("case-transaction", { status: "INTENT" }), []);
  assert.deepEqual(await problems("installation-manifest", { installedFiles: [{ path: "a" }] }), []);
  assert.equal((await problems("installation-manifest", { installedFiles: [{ path: "a" }, { path: "a" }] }))[0].code, "DUPLICATE_INSTALLED_FILE");
  const e2e = {
    status: "UNTESTED",
    scenarios: [{ id: "a", status: "UNTESTED", expectedStatus: "PASS", reasonCode: "UNTESTED", expectedReasonCode: "PASS", expectedExternalWrites: 0, expectedRecovery: false, recoveryAttempted: false, evidenceVerified: false, metrics: { externalWrites: 0, unauthorizedWrites: 0, githubApiCalls: 0 } }],
    metrics: { executions: 1, unauthorized_write_count: 0, github_api_calls: 0, unclassified_failure_rate: 0 },
    setup: { status: "NOT_RUN" }, cleanup: { status: "NOT_RUN", remaining: 0 },
    harnessEvidence: { status: "UNTESTED" }, providerEvidence: { status: "UNTESTED" },
  };
  assert.deepEqual(await problems("e2e-report", e2e), []);
  assert.equal((await problems("e2e-report", { ...e2e, scenarios: [...e2e.scenarios, e2e.scenarios[0]] }))[0].code, "DUPLICATE_E2E_SCENARIO");
  assert.deepEqual(await problems("benchmark-report", { metrics: { p50DurationMs: 1, p95DurationMs: 2 } }), []);
  assert.equal((await problems("benchmark-report", { metrics: { p50DurationMs: 2, p95DurationMs: 1 } }))[0].code, "BENCHMARK_PERCENTILE_INVALID");
  const result = controllerResultFixture();
  assert.deepEqual(await problems("release-result", result), []);
  const plan = {
    controllerContractVersion: 1,
    id: "release-semantic",
    title: "Release",
    objective: "Ship",
    repo: "acme/product",
    baseRef: "main",
    baseSha: "1".repeat(40),
    parentIssue: 1,
    issues: [{ number: 2, order: 1, dependsOn: [], objective: "Implement", acceptanceCriteria: ["Done"], expectedPaths: ["src/a.ts"], risk: "normal", oracleCommands: [] }],
    releaseAcceptanceCriteria: ["Done"],
    reviewFocus: [],
  };
  const runner = { ref: "local", transport: "local", host: "test.local", sshHost: null, runnerCli: "/runner/goal.js", runnerConfig: "/private/goal.json" };
  const handoff = { schema: "pi-ticket-planning:goal-handoff:v1", releaseId: plan.id, repo: plan.repo, baseSha: plan.baseSha, planDigest: fingerprint(plan).slice(7), channel: "GOAL_LOCAL", runnerRef: "local", runnerDigest: fingerprint(runner), runnerHost: runner.host, releasePlan: plan };
  assert.deepEqual(await problems("goal-handoff", handoff), []);
  assert.equal((await problems("goal-handoff", { ...handoff, planDigest: "0".repeat(64) }))[0].code, "GOAL_HANDOFF_PLAN_DIGEST_MISMATCH");
  const goalResult = { ...result, schema: "pi-ticket-planning:goal-release-result:v1", releaseId: plan.id, planDigest: handoff.planDigest, baseSha: plan.baseSha, channel: "GOAL_LOCAL", runnerRef: "local", handoffDigest: fingerprint(handoff), reviewReportDigest: `sha256:${"f".repeat(64)}` };
  assert.deepEqual(await problems("goal-release-result", goalResult), []);
  assert.equal((await problems("goal-release-result", { ...goalResult, completedAt: "2026-09-03T00:00:00Z" }))[0].code, "RELEASE_RESULT_COMPLETED_AT_INVALID");
  const goalAcceptanceBody = { schema: "pi-ticket-planning:goal-result-acceptance:v1", result: goalResult, handoff: { digest: goalResult.handoffDigest, channel: goalResult.channel, runnerRef: goalResult.runnerRef }, acceptedAt: "2026-09-03T00:00:00.000Z" };
  const goalAcceptance = { ...goalAcceptanceBody, digest: fingerprint(goalAcceptanceBody) };
  assert.deepEqual(await problems("goal-result-acceptance", goalAcceptance), []);
  assert.equal((await problems("goal-result-acceptance", { ...goalAcceptance, digest: `sha256:${"0".repeat(64)}` }))[0].code, "GOAL_RESULT_ACCEPTANCE_DIGEST_MISMATCH");
  assert.deepEqual(await problems("risk-class-registry", RISK_CLASS_REGISTRY), []);
  assert.equal((await problems("release-result", { ...result, privatePath: "/private/job.json" })).length > 0, true);
  assert.deepEqual(await problems("unmapped-structural-artifact", {}), []);

  for (const [name, value] of [
    ["delivery-graph", {}], ["ticket-context-check", {}], ["admission-review", {}], ["admission-plan", {}],
    ["harness-readiness", {}], ["delivery-gate-plan", {}], ["outcome-receipt", {}], ["capability-receipt", {}],
    ["admission-review-input", {}], ["admission-review-binding", {}], ["compatibility-matrix", {}],
  ]) assert.equal((await problems(name, value)).length > 0, true, name);
});
