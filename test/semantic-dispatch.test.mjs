import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { validateRegisteredArtifactSemantics } from "../protocol/semantic-dispatch.mjs";
import { fingerprint } from "../execution-plan/domain.mjs";
import { ingestControllerCompletion } from "../execution-plan/completion-ingest.mjs";
import { controllerCompletionFixture } from "./controller-completion-fixture.mjs";
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
  const completion = controllerCompletionFixture();
  assert.deepEqual(await problems("release-completion", completion), []);
  assert.deepEqual(await problems("release-predecessor-receipt", ingestControllerCompletion(completion)), []);
  assert.deepEqual(await problems("risk-class-registry", RISK_CLASS_REGISTRY), []);
  assert.equal((await problems("release-completion", { ...completion, digest: digest("bad") }))[0].code, "CONTROLLER_COMPLETION_DIGEST_MISMATCH");
  assert.deepEqual(await problems("unmapped-structural-artifact", {}), []);

  for (const [name, value] of [
    ["delivery-graph", {}], ["ticket-context-check", {}], ["admission-review", {}], ["admission-plan", {}],
    ["harness-readiness", {}], ["delivery-gate-plan", {}], ["outcome-receipt", {}], ["capability-receipt", {}],
    ["admission-review-input", {}], ["admission-review-binding", {}], ["compatibility-matrix", {}],
  ]) assert.equal((await problems(name, value)).length > 0, true, name);
});
