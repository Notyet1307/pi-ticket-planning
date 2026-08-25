import assert from "node:assert/strict";
import test from "node:test";

import { expectedConfirmation, runIntegrationE2E } from "../integration/e2e.mjs";

const DIGEST = `sha256:${"a".repeat(64)}`;
const harnessEvidence = { status: "PASS", exactTarget: true, readiness: true, validation: true, deliveryGate: true, noBypass: true, claimDetection: true, terminalOutcome: true, evidenceDigests: [DIGEST] };
const providerEvidence = { status: "PASS", childResult: true, freshContext: true, strictSchema: true, namedSession: true, persistedSession: true, timeoutCancellation: true, evidenceDigests: [DIGEST] };
const preflight = { actor: "tester", topics: ["ptp-e2e"], defaultBranch: "main", isProductionRemote: false, setup: { status: "PASS", externalWrites: 1, evidenceDigests: [DIGEST] }, harnessEvidence, providerEvidence };

test("live E2E stays UNTESTED without its write guards", async () => {
  const report = await runIntegrationE2E({ env: {}, runId: "run-1" });
  assert.equal(report.status, "UNTESTED");
  assert.equal(report.reasonCode, "E2E_NOT_ENABLED");
  assert.equal(report.metrics.unauthorized_write_count, 0);
});

test("exact allowlist and one-time confirmation bind the run", async () => {
  const repo = "acme/ptp-e2e";
  const runId = "run-2";
  const token = expectedConfirmation({ repo, runId });
  const calls = [];
  const report = await runIntegrationE2E({
    env: {
      PI_TICKET_PLAN_E2E: "1",
      E2E_REPO: repo,
      E2E_ALLOWLIST: repo,
      E2E_CONFIRM_WRITE: token,
      E2E_ACTOR_ALLOWLIST: "tester",
      E2E_REPO_TOPIC: "ptp-e2e",
      E2E_DEFAULT_BRANCH: "main",
      E2E_NO_PRODUCTION_REMOTE: "1",
    },
    runId,
    adapter: {
      async preflight() { return preflight; },
      async runScenario(scenario, context) {
        calls.push(`${scenario.id}:${context.resourceTag}`);
        return {
          status: scenario.expectedStatus,
          reasonCode: scenario.expectedReasonCode,
          durationMs: 1,
          retries: scenario.expectedRecovery ? 1 : 0,
          recoveryAttempted: scenario.expectedRecovery,
          evidenceVerified: true,
          evidenceDigests: [DIGEST],
          metrics: { externalWrites: scenario.expectedExternalWrites, githubApiCalls: 1, toolCalls: 1 },
        };
      },
      async cleanup(context) {
        return { status: "PASS", deleted: 1, remaining: 0, recoveryCommand: `cleanup ${context.resourceTag}` };
      },
      async evidence() { return { harnessEvidence, providerEvidence }; },
    },
  });
  assert.equal(report.status, "COMPLETE");
  assert.equal(report.resourceTag, "ptp-e2e:run-2");
  assert.equal(calls.length, 61);
  assert.equal(report.metrics.eventual_success_rate, 1);
  assert.equal(report.metrics.unauthorized_write_count, 0);

  const wrong = await runIntegrationE2E({
    env: { PI_TICKET_PLAN_E2E: "1", E2E_REPO: repo, E2E_ALLOWLIST: repo, E2E_CONFIRM_WRITE: "wrong" },
    runId,
    adapter: {},
  });
  assert.equal(wrong.reasonCode, "E2E_CONFIRMATION_MISMATCH");
});

test("recovery metrics reflect attempted recovery instead of reporting a constant success", async () => {
  const repo = "acme/ptp-e2e";
  const runId = "run-recovery";
  const report = await runIntegrationE2E({
    env: {
      PI_TICKET_PLAN_E2E: "1",
      E2E_REPO: repo,
      E2E_ALLOWLIST: repo,
      E2E_CONFIRM_WRITE: expectedConfirmation({ repo, runId }),
      E2E_ACTOR_ALLOWLIST: "tester",
      E2E_REPO_TOPIC: "ptp-e2e",
      E2E_DEFAULT_BRANCH: "main",
      E2E_NO_PRODUCTION_REMOTE: "1",
    },
    runId,
    adapter: {
      async preflight() { return preflight; },
      async runScenario(contract) {
        if (contract.id === "timeout") return { status: "FAIL", reasonCode: "RECOVERY_FAILED", durationMs: 2, retries: 1, recoveryAttempted: true, evidenceVerified: false, evidenceDigests: [DIGEST], metrics: { externalWrites: 0 } };
        return {
          status: contract.expectedStatus,
          reasonCode: contract.expectedReasonCode,
          durationMs: 1,
          retries: contract.expectedRecovery ? 1 : 0,
          recoveryAttempted: contract.expectedRecovery,
          evidenceVerified: true,
          evidenceDigests: [DIGEST],
          metrics: { externalWrites: contract.expectedExternalWrites },
        };
      },
      async cleanup() { return { status: "PASS", deleted: 1, remaining: 0, recoveryCommand: null }; },
      async evidence() { return { harnessEvidence, providerEvidence }; },
    },
  });

  assert.equal(report.status, "PARTIAL");
  assert.equal(report.metrics.first_pass_success_rate, 40 / 61);
  assert.equal(report.metrics.eventual_success_rate, 58 / 61);
  assert.equal(report.metrics.recovery_success_rate, 18 / 21);
});
