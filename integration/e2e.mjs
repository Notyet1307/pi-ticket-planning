import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";

import { finalizeReport, githubAppFinalPassed, harnessFinalPassed, harnessPreflightPassed, providerFinalPassed, reportMetadata } from "./report.mjs";
import { recoveryCommand as cleanupRecoveryCommand } from "./e2e-state.mjs";

const scenario = (id, evidenceClass, expectedStatus, expectedReasonCode, expectedExternalWrites, expectedRecovery = false) => ({
  id, evidenceClass, expectedStatus, expectedReasonCode, expectedExternalWrites, expectedRecovery, expectedCleanup: true,
});

export const LIVE_SCENARIOS = [
  scenario("success", "REAL_EXTERNAL", "PASS", "SUCCESS", 6),
  scenario("rate-limit", "FAULT_INJECTED", "RECOVERED", "RATE_LIMIT_RECOVERED", 6, true),
  scenario("timeout", "FAULT_INJECTED", "RECOVERED", "TIMEOUT_RECOVERED", 6, true),
  scenario("write-succeeded-response-lost", "REAL_EXTERNAL", "RECOVERED", "AMBIGUOUS_WRITE_RECOVERED", 6, true),
  scenario("comment-succeeded-label-failed", "REAL_EXTERNAL", "RECOVERED", "PARTIAL_WRITE_RECOVERED", 6, true),
  scenario("source-drift-before-activation", "REAL_EXTERNAL", "EXPECTED_BLOCK", "SOURCE_DRIFT", 4),
  scenario("body-title-policy-graph-context-drift", "REAL_EXTERNAL", "EXPECTED_BLOCK", "RESOURCE_DRIFT", 5),
  scenario("harness-claim-mid-apply", "REAL_EXTERNAL", "EXPECTED_BLOCK", "HARNESS_CLAIM_DETECTED", 4),
  scenario("provider-timeout", "REAL_PROVIDER", "RECOVERED", "PROVIDER_TIMEOUT_RECOVERED", 6, true),
  scenario("subagent-no-final-text", "FAULT_INJECTED", "EXPECTED_BLOCK", "SUBAGENT_FINAL_MISSING", 3),
  scenario("reviewer-schema-error", "FAULT_INJECTED", "EXPECTED_BLOCK", "REVIEWER_SCHEMA_INVALID", 3),
  scenario("reviewer-empty-axis", "FAULT_INJECTED", "EXPECTED_BLOCK", "REVIEWER_AXIS_EMPTY", 3),
  scenario("named-session-missing", "REAL_PROVIDER", "EXPECTED_BLOCK", "SESSION_NAME_NOT_RESUMABLE_BY_RUNTIME", 3),
  scenario("docker-environment-missing", "REAL_EXTERNAL", "EXPECTED_BLOCK", "DOCKER_ENVIRONMENT_MISSING", 3),
  scenario("readiness-expired", "REAL_EXTERNAL", "EXPECTED_BLOCK", "READINESS_EXPIRED", 3),
  scenario("receipt-forged", "DETERMINISTIC_ONLY", "EXPECTED_BLOCK", "RECEIPT_FORGED", 3),
  scenario("network-interruption-resume", "REAL_EXTERNAL", "RECOVERED", "NETWORK_INTERRUPTION_RECOVERED", 6, true),
  scenario("cleanup-failure", "FAULT_INJECTED", "RECOVERED", "CLEANUP_RECOVERED", 6, true),
];

export function expectedConfirmation({ repo, runId }) {
  return `sha256:${createHash("sha256").update(`ptp-e2e-v2:${repo}:${runId}`, "utf8").digest("hex")}`;
}

function evidenceDigest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

function percentile(values, quantile) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)];
}

function emptyMetrics() {
  return {
    executions: 0,
    first_pass_success_rate: 0,
    eventual_success_rate: 0,
    retry_rate: 0,
    unclassified_failure_rate: 0,
    unauthorized_write_count: 0,
    recovery_attempts: 0,
    recovery_success_rate: 0,
    cleanup_success_rate: 0,
    p50_duration_ms: null,
    p95_duration_ms: null,
    model_turns: 0,
    tool_calls: 0,
    context_tokens: 0,
    github_api_calls: 0,
  };
}

function scenarioProjection(contract, result, ordinal) {
  const metrics = {
    unauthorizedWrites: result.metrics?.unauthorizedWrites ?? 0,
    externalWrites: result.metrics?.externalWrites ?? 0,
    githubApiCalls: result.metrics?.githubApiCalls ?? 0,
    modelTurns: result.metrics?.modelTurns ?? 0,
    toolCalls: result.metrics?.toolCalls ?? 0,
    contextTokens: result.metrics?.contextTokens ?? 0,
  };
  return {
    id: `${contract.id}:${ordinal}`,
    scenarioId: contract.id,
    ordinal,
    evidenceClass: contract.evidenceClass,
    expectedStatus: contract.expectedStatus,
    expectedReasonCode: contract.expectedReasonCode,
    expectedExternalWrites: contract.expectedExternalWrites,
    expectedRecovery: contract.expectedRecovery,
    expectedCleanup: contract.expectedCleanup,
    status: result.status,
    reasonCode: result.reasonCode,
    durationMs: result.durationMs ?? 0,
    retries: result.retries ?? 0,
    recoveryAttempted: result.recoveryAttempted === true,
    metrics,
    evidenceVerified: result.evidenceVerified === true,
    evidenceDigests: result.evidenceDigests?.length ? [...new Set(result.evidenceDigests)] : [evidenceDigest({ contract, result, ordinal })],
  };
}

function matched(item) {
  return item.status === item.expectedStatus
    && item.reasonCode === item.expectedReasonCode
    && item.metrics.externalWrites === item.expectedExternalWrites
    && (!item.expectedRecovery || item.recoveryAttempted)
    && (!item.expectedCleanup || item.metrics.unauthorizedWrites === 0)
    && item.evidenceVerified;
}

function emptyHarnessEvidence(reasonCode) {
  return { status: "UNTESTED", preflight: { exactTarget: false, readiness: false, validation: false, deliveryGate: false, noBypass: false }, final: { claimDetection: false, terminalOutcome: false }, evidenceDigests: [evidenceDigest({ reasonCode, kind: "harness" })] };
}

function emptyProviderEvidence(reasonCode) {
  return { status: "UNTESTED", childResult: false, freshContext: false, strictSchema: false, namedSession: false, persistedSession: false, exactIdFileResume: false, sessionResume: false, timeoutCancellation: false, evidenceDigests: [evidenceDigest({ reasonCode, kind: "provider" })] };
}

function emptyGitHubAppEvidence(reasonCode) {
  return { status: "UNTESTED", appSlug: null, installationIdentityDigest: null, targetRepo: null, permissions: { metadata: "none", issues: "none", contents: "none", administration: "none" }, writeActorReadback: false, evidenceDigests: [evidenceDigest({ reasonCode, kind: "github-app" })] };
}

function untested({ runId, repo = null, reasonCode, env, harnessEvidence = emptyHarnessEvidence(reasonCode), providerEvidence = emptyProviderEvidence(reasonCode), githubAppEvidence = emptyGitHubAppEvidence(reasonCode) }) {
  const metadata = reportMetadata({ tier: "L3_REAL_DISPOSABLE_INTEGRATION", env });
  const scenarios = LIVE_SCENARIOS.map((contract, index) => scenarioProjection(contract, {
    status: "UNTESTED", reasonCode, metrics: {}, evidenceVerified: false, evidenceDigests: [evidenceDigest({ reasonCode, id: contract.id })],
  }, index + 1));
  return finalizeReport({
    schema: "pi-ticket-planning:e2e-report:v2",
    ...metadata,
    runId,
    repo,
    resourceTag: `ptp-e2e:${runId}`,
    status: "UNTESTED",
    reasonCode,
    scenarios,
    metrics: emptyMetrics(),
    setup: { status: "NOT_RUN", externalWrites: 0, evidenceDigests: [evidenceDigest({ reasonCode, kind: "setup" })] },
    harnessEvidence,
    providerEvidence,
    githubAppEvidence,
    cleanup: { status: "NOT_RUN", deleted: 0, remaining: 0, recoveryCommand: null },
    recoveryCommand: null,
    evidenceDigests: [...new Set(scenarios.flatMap((item) => item.evidenceDigests))],
  });
}

function guardProblem(env, repo, runId) {
  if (env.PI_TICKET_PLAN_E2E !== "1") return "E2E_NOT_ENABLED";
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo ?? "")) return "E2E_REPO_INVALID";
  if (!new Set((env.E2E_ALLOWLIST ?? "").split(",").map((value) => value.trim()).filter(Boolean)).has(repo)) return "E2E_REPO_NOT_ALLOWLISTED";
  if (env.E2E_CONFIRM_WRITE !== expectedConfirmation({ repo, runId })) return "E2E_CONFIRMATION_MISMATCH";
  if (!env.E2E_ACTOR_ALLOWLIST || !env.E2E_REPO_TOPIC || !env.E2E_DEFAULT_BRANCH || env.E2E_NO_PRODUCTION_REMOTE !== "1") return "E2E_EXTENDED_GUARDS_MISSING";
  return null;
}

export async function runIntegrationE2E({ env = process.env, runId = env.E2E_RUN_ID ?? env.GITHUB_RUN_ID ?? randomUUID(), adapter } = {}) {
  const repo = env.E2E_REPO;
  const guard = guardProblem(env, repo, runId);
  if (guard) return untested({ runId, repo, reasonCode: guard, env });
  if (!adapter?.preflight || !adapter?.runScenario || !adapter?.cleanup) return untested({ runId, repo, reasonCode: "LIVE_ADAPTER_UNAVAILABLE", env });
  const context = { repo, runId, resourceTag: `ptp-e2e:${runId}` };
  let preflight;
  try { preflight = await adapter.preflight(context); } catch { return untested({ runId, repo, reasonCode: "LIVE_ADAPTER_PREFLIGHT_FAILED", env }); }
  const actors = new Set(env.E2E_ACTOR_ALLOWLIST.split(",").map((value) => value.trim()).filter(Boolean));
  if (!actors.has(preflight.actor) || !preflight.topics?.includes(env.E2E_REPO_TOPIC)
    || preflight.defaultBranch !== env.E2E_DEFAULT_BRANCH || preflight.isProductionRemote === true) {
    return untested({ runId, repo, reasonCode: "LIVE_ADAPTER_GUARD_MISMATCH", env });
  }
  const harnessEvidence = preflight.harnessEvidence ?? emptyHarnessEvidence("REAL_HARNESS_PREFLIGHT_MISSING");
  const providerEvidence = preflight.providerEvidence ?? emptyProviderEvidence("REAL_PROVIDER_PREFLIGHT_MISSING");
  const githubAppEvidence = preflight.githubAppEvidence ?? emptyGitHubAppEvidence("GITHUB_APP_PREFLIGHT_MISSING");
  const harnessPreflight = harnessPreflightPassed(harnessEvidence);
  if (!harnessPreflight || providerEvidence.status !== "PASS" || githubAppEvidence.status !== "PASS") {
    return untested({
      runId,
      repo,
      reasonCode: !harnessPreflight ? "REAL_HARNESS_PREFLIGHT_FAILED" : providerEvidence.status !== "PASS" ? "REAL_PROVIDER_PREFLIGHT_FAILED" : "GITHUB_APP_PREFLIGHT_FAILED",
      env,
      harnessEvidence,
      providerEvidence,
      githubAppEvidence,
    });
  }
  const setup = preflight.setup ?? { status: "NOT_RUN", externalWrites: 0, evidenceDigests: [evidenceDigest({ runId, kind: "setup-missing" })] };
  if (setup.status !== "PASS") return untested({ runId, repo, reasonCode: "LIVE_ADAPTER_SETUP_FAILED", env, harnessEvidence, providerEvidence, githubAppEvidence });

  const executions = [];
  for (const contract of LIVE_SCENARIOS) {
    const repetitions = contract.id === "success" ? 10 : 3;
    for (let ordinal = 1; ordinal <= repetitions; ordinal += 1) {
      try {
        executions.push(scenarioProjection(contract, await adapter.runScenario(contract, { ...context, ordinal }), ordinal));
      } catch {
        executions.push(scenarioProjection(contract, { status: "FAIL", reasonCode: "UNCLASSIFIED_FAILURE", metrics: {}, evidenceVerified: false }, ordinal));
      }
    }
  }
  let cleanup;
  try { cleanup = await adapter.cleanup(context); } catch { cleanup = { status: "FAIL", deleted: 0, remaining: 1, recoveryCommand: cleanupRecoveryCommand(repo, runId) }; }
  let finalEvidence = { harnessEvidence, providerEvidence };
  try { if (adapter.evidence) finalEvidence = await adapter.evidence(context); } catch { /* Keep preflight evidence and fail the complete gate. */ }
  const finalHarnessEvidence = finalEvidence.harnessEvidence ?? harnessEvidence;
  const finalProviderEvidence = finalEvidence.providerEvidence ?? providerEvidence;
  const successful = executions.filter(matched);
  const firstPass = successful.filter(({ retries }) => retries === 0);
  const recoveryAttempts = executions.filter(({ expectedRecovery, recoveryAttempted, retries }) => expectedRecovery || recoveryAttempted || retries > 0);
  const durations = executions.map(({ durationMs }) => durationMs);
  const metrics = {
    executions: executions.length,
    first_pass_success_rate: firstPass.length / executions.length,
    eventual_success_rate: successful.length / executions.length,
    retry_rate: executions.reduce((total, item) => total + item.retries, 0) / executions.length,
    unclassified_failure_rate: executions.filter(({ reasonCode }) => reasonCode === "UNCLASSIFIED_FAILURE").length / executions.length,
    unauthorized_write_count: executions.reduce((total, item) => total + item.metrics.unauthorizedWrites, 0),
    recovery_attempts: recoveryAttempts.length,
    recovery_success_rate: recoveryAttempts.length === 0 ? 0 : recoveryAttempts.filter(matched).length / recoveryAttempts.length,
    cleanup_success_rate: cleanup.status === "PASS" && cleanup.remaining === 0 ? 1 : 0,
    p50_duration_ms: percentile(durations, 0.5),
    p95_duration_ms: percentile(durations, 0.95),
    model_turns: executions.reduce((total, item) => total + item.metrics.modelTurns, 0),
    tool_calls: executions.reduce((total, item) => total + item.metrics.toolCalls, 0),
    context_tokens: executions.reduce((total, item) => total + item.metrics.contextTokens, 0),
    github_api_calls: executions.reduce((total, item) => total + item.metrics.githubApiCalls, 0),
  };
  const cleanupRecoveryVerified = !executions.some(({ scenarioId }) => scenarioId === "cleanup-failure") || cleanup.recoveredByAnotherProcess === true;
  const complete = successful.length === executions.length && cleanup.status === "PASS" && cleanup.remaining === 0
    && metrics.unauthorized_write_count === 0 && metrics.unclassified_failure_rate === 0
    && cleanupRecoveryVerified && harnessFinalPassed(finalHarnessEvidence) && providerFinalPassed(finalProviderEvidence) && githubAppFinalPassed(githubAppEvidence, repo);
  const metadata = reportMetadata({
    tier: "L3_REAL_DISPOSABLE_INTEGRATION",
    provider: env.PI_TICKET_PLAN_PROVIDER,
    model: env.PI_TICKET_PLAN_MODEL,
    thinking: env.PI_TICKET_PLAN_THINKING,
    env,
  });
  return finalizeReport({
    schema: "pi-ticket-planning:e2e-report:v2",
    ...metadata,
    runId,
    repo,
    resourceTag: context.resourceTag,
    status: complete ? "COMPLETE" : "PARTIAL",
    reasonCode: complete ? "ALL_EXECUTIONS_MATCH" : "SCENARIO_OR_CLEANUP_FAILED",
    scenarios: executions,
    metrics,
    setup,
    harnessEvidence: finalHarnessEvidence,
    providerEvidence: finalProviderEvidence,
    githubAppEvidence,
    cleanup,
    recoveryCommand: cleanup.status === "PASS" ? null : (cleanup.recoveryCommand ?? cleanupRecoveryCommand(repo, runId)),
    evidenceDigests: [...new Set(executions.flatMap((item) => item.evidenceDigests))],
  });
}

if (process.argv[1]?.endsWith("integration/e2e.mjs")) {
  let adapter;
  if (process.env.PI_TICKET_PLAN_E2E === "1") {
    try {
      const { createLiveAdapter } = await import("./live-adapter.mjs");
      adapter = createLiveAdapter({ env: process.env });
    } catch {
      // The report records LIVE_ADAPTER_UNAVAILABLE without exposing loader details.
    }
  }
  const report = await runIntegrationE2E({ adapter });
  if (process.env.PTP_E2E_REPORT) fs.writeFileSync(process.env.PTP_E2E_REPORT, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== "COMPLETE") process.exitCode = 1;
}
