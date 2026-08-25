import assert from "node:assert/strict";
import test from "node:test";

import { expectedConfirmation, runIntegrationE2E } from "../integration/e2e.mjs";

test("live E2E stays UNTESTED without all three write guards", async () => {
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
    },
    runId,
    adapter: {
      async runScenario(scenario, context) {
        calls.push(`${scenario.id}:${context.resourceTag}`);
        return { status: "PASS", durationMs: 1, metrics: { githubApiCalls: 1, toolCalls: 1 } };
      },
      async cleanup(context) {
        return { status: "PASS", recoveryCommand: `cleanup ${context.resourceTag}` };
      },
    },
  });
  assert.equal(report.status, "COMPLETE");
  assert.equal(report.resourceTag, "ptp-e2e:run-2");
  assert.equal(calls.length >= 18, true);
  assert.equal(report.metrics.first_pass_success_rate, 1);
  assert.equal(report.metrics.unauthorized_write_count, 0);

  const wrong = await runIntegrationE2E({
    env: { PI_TICKET_PLAN_E2E: "1", E2E_REPO: repo, E2E_ALLOWLIST: repo, E2E_CONFIRM_WRITE: "wrong" },
    runId,
    adapter: {},
  });
  assert.equal(wrong.reasonCode, "E2E_CONFIRMATION_MISMATCH");
});
