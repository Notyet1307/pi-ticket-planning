import { createHash, randomUUID } from "node:crypto";

export const LIVE_SCENARIOS = [
  "success",
  "rate-limit",
  "timeout",
  "write-succeeded-response-lost",
  "comment-succeeded-label-failed",
  "source-drift-before-activation",
  "body-title-policy-graph-context-drift",
  "harness-claim-mid-apply",
  "provider-timeout",
  "subagent-no-final-text",
  "reviewer-schema-error",
  "reviewer-empty-axis",
  "named-session-missing",
  "docker-environment-missing",
  "readiness-expired",
  "receipt-forged",
  "network-interruption-resume",
  "cleanup-failure",
].map((id) => ({ id }));

export function expectedConfirmation({ repo, runId }) {
  return `sha256:${createHash("sha256").update(`ptp-e2e-v1:${repo}:${runId}`, "utf8").digest("hex")}`;
}

function percentile(values, quantile) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
}

function emptyMetrics() {
  return {
    first_pass_success_rate: 0,
    eventual_success_rate: 0,
    retry_rate: 0,
    unclassified_failure_rate: 0,
    unauthorized_write_count: 0,
    recovery_success_rate: 0,
    p50_duration_ms: null,
    p95_duration_ms: null,
    model_turns: 0,
    tool_calls: 0,
    context_tokens: 0,
    github_api_calls: 0,
  };
}

function untested({ runId, repo = null, reasonCode }) {
  return {
    schema: "pi-ticket-planning:e2e-report:v1",
    tier: "L3_REAL_DISPOSABLE_INTEGRATION",
    runId,
    repo,
    resourceTag: `ptp-e2e:${runId}`,
    status: "UNTESTED",
    reasonCode,
    scenarios: LIVE_SCENARIOS.map(({ id }) => ({ id, status: "UNTESTED", reasonCode })),
    metrics: emptyMetrics(),
    cleanup: { status: "NOT_RUN" },
    recoveryCommand: null,
  };
}

export async function runIntegrationE2E({ env = process.env, runId = env.GITHUB_RUN_ID ?? randomUUID(), adapter } = {}) {
  const repo = env.E2E_REPO;
  if (env.PI_TICKET_PLAN_E2E !== "1") return untested({ runId, repo, reasonCode: "E2E_NOT_ENABLED" });
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo ?? "")) return untested({ runId, repo, reasonCode: "E2E_REPO_INVALID" });
  const allowlist = new Set((env.E2E_ALLOWLIST ?? "").split(",").map((value) => value.trim()).filter(Boolean));
  if (!allowlist.has(repo)) return untested({ runId, repo, reasonCode: "E2E_REPO_NOT_ALLOWLISTED" });
  if (env.E2E_CONFIRM_WRITE !== expectedConfirmation({ repo, runId })) return untested({ runId, repo, reasonCode: "E2E_CONFIRMATION_MISMATCH" });
  if (!adapter?.runScenario || !adapter?.cleanup) return untested({ runId, repo, reasonCode: "LIVE_ADAPTER_UNAVAILABLE" });

  const context = { repo, runId, resourceTag: `ptp-e2e:${runId}` };
  const scenarios = [];
  for (const scenario of LIVE_SCENARIOS) {
    try {
      const result = await adapter.runScenario(scenario, context);
      scenarios.push({ id: scenario.id, retries: 0, ...result });
    } catch {
      scenarios.push({ id: scenario.id, status: "FAIL", reasonCode: "UNCLASSIFIED_FAILURE", durationMs: 0, retries: 0, metrics: {} });
    }
  }
  let cleanup;
  try { cleanup = await adapter.cleanup(context); } catch { cleanup = { status: "FAIL", recoveryCommand: `pi-ticket-planctl e2e cleanup --run-id ${runId}` }; }
  const passed = scenarios.filter(({ status, retries: count = 0 }) => status === "PASS" && count === 0).length;
  const eventual = scenarios.filter(({ status }) => ["PASS", "RECOVERED"].includes(status)).length;
  const retries = scenarios.reduce((total, scenario) => total + (scenario.retries ?? 0), 0);
  const recoveryAttempts = scenarios.filter(({ status, retries: count = 0, recoveryAttempted }) => (
    status === "RECOVERED" || count > 0 || recoveryAttempted === true
  ));
  const recovered = recoveryAttempts.filter(({ status }) => ["PASS", "RECOVERED"].includes(status)).length;
  const durations = scenarios.map(({ durationMs = 0 }) => durationMs);
  const metrics = {
    first_pass_success_rate: passed / scenarios.length,
    eventual_success_rate: eventual / scenarios.length,
    retry_rate: retries / scenarios.length,
    unclassified_failure_rate: scenarios.filter(({ reasonCode }) => reasonCode === "UNCLASSIFIED_FAILURE").length / scenarios.length,
    unauthorized_write_count: scenarios.reduce((total, scenario) => total + (scenario.metrics?.unauthorizedWrites ?? 0), 0),
    recovery_success_rate: recoveryAttempts.length === 0 ? 0 : recovered / recoveryAttempts.length,
    p50_duration_ms: percentile(durations, 0.5),
    p95_duration_ms: percentile(durations, 0.95),
    model_turns: scenarios.reduce((total, scenario) => total + (scenario.metrics?.modelTurns ?? 0), 0),
    tool_calls: scenarios.reduce((total, scenario) => total + (scenario.metrics?.toolCalls ?? 0), 0),
    context_tokens: scenarios.reduce((total, scenario) => total + (scenario.metrics?.contextTokens ?? 0), 0),
    github_api_calls: scenarios.reduce((total, scenario) => total + (scenario.metrics?.githubApiCalls ?? 0), 0),
  };
  const complete = eventual === scenarios.length
    && cleanup.status === "PASS"
    && metrics.unauthorized_write_count === 0
    && metrics.unclassified_failure_rate === 0;
  return {
    schema: "pi-ticket-planning:e2e-report:v1",
    tier: "L3_REAL_DISPOSABLE_INTEGRATION",
    runId,
    repo,
    resourceTag: context.resourceTag,
    status: complete ? "COMPLETE" : "PARTIAL",
    reasonCode: complete ? "ALL_SCENARIOS_PASS" : "SCENARIO_OR_CLEANUP_FAILED",
    scenarios,
    metrics,
    cleanup,
    recoveryCommand: cleanup.status === "PASS" ? null : (cleanup.recoveryCommand ?? `pi-ticket-planctl e2e cleanup --run-id ${runId}`),
  };
}

if (process.argv[1]?.endsWith("integration/e2e.mjs")) {
  const report = await runIntegrationE2E();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== "COMPLETE") process.exitCode = 1;
}
