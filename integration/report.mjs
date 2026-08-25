import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";

import { runtimeMetadata } from "../installation/build-metadata.mjs";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

export function reportDigest(value) {
  const { reportDigest: _digest, ...projection } = value;
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical(projection)), "utf8").digest("hex")}`;
}

function capability(file) {
  if (!file) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function reportMetadata({
  tier,
  provider = "UNTESTED",
  model = "UNTESTED",
  thinking = "UNTESTED",
  env = process.env,
  observedAt = new Date().toISOString(),
  ttlMs = 24 * 60 * 60 * 1000,
} = {}) {
  const build = runtimeMetadata();
  const receipt = capability(env.PTP_CAPABILITY_RECEIPT);
  const runId = env.GITHUB_RUN_ID ?? "LOCAL";
  return {
    reportId: `RPT-${randomUUID()}`,
    tier,
    packageVersion: build.packageVersion,
    headSha: build.sourceCommit,
    treeSha: build.treeDigest,
    workflowName: env.GITHUB_WORKFLOW ?? "LOCAL",
    workflowRunId: runId,
    workflowRunAttempt: Number(env.GITHUB_RUN_ATTEMPT ?? 0),
    workflowRunUrl: runId === "LOCAL" ? null : `${env.GITHUB_SERVER_URL ?? "https://github.com"}/${env.GITHUB_REPOSITORY}/actions/runs/${runId}`,
    repository: env.GITHUB_REPOSITORY ?? "LOCAL",
    actor: env.GITHUB_ACTOR ?? "LOCAL",
    runner: env.RUNNER_NAME ?? "LOCAL",
    provider: receipt?.provider?.name ?? provider,
    model: receipt?.provider?.model ?? model,
    thinking,
    piVersion: receipt?.pi?.version ?? "UNTESTED",
    piDigest: receipt?.pi?.digest ?? null,
    subagentVersion: receipt?.subagent?.version ?? build.subagentVersion,
    profileDigest: receipt?.profileDigest ?? null,
    harnessVersion: receipt?.harness?.version ?? "UNTESTED",
    harnessDigest: receipt?.harness?.configDigest ?? null,
    observedAt,
    expiresAt: new Date(Date.parse(observedAt) + ttlMs).toISOString(),
  };
}

export function finalizeReport(value) {
  return { ...value, reportDigest: reportDigest(value) };
}

export function validateReportEnvelope(report, {
  tier,
  headSha,
  now = new Date().toISOString(),
  requireActions = false,
} = {}) {
  const problems = [];
  if (report.tier !== tier) problems.push({ code: "REPORT_TIER_MISMATCH" });
  if (report.reportDigest !== reportDigest(report)) problems.push({ code: "REPORT_DIGEST_MISMATCH" });
  if (headSha && report.headSha !== headSha) problems.push({ code: "REPORT_COMMIT_MISMATCH" });
  if (!Number.isFinite(Date.parse(report.observedAt)) || !Number.isFinite(Date.parse(report.expiresAt))
    || Date.parse(report.expiresAt) <= Date.parse(report.observedAt)) problems.push({ code: "REPORT_TIME_INVALID" });
  else if (Date.parse(now) > Date.parse(report.expiresAt)) problems.push({ code: "REPORT_EXPIRED" });
  if (requireActions && (report.workflowRunId === "LOCAL" || report.repository === "LOCAL"
    || !Number.isInteger(report.workflowRunAttempt) || report.workflowRunAttempt < 1
    || !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/[0-9]+$/.test(report.workflowRunUrl ?? ""))) {
    problems.push({ code: "GITHUB_ACTIONS_PROVENANCE_MISSING" });
  }
  return { ok: problems.length === 0, problems };
}

const problem = (code, subject) => subject === undefined ? { code } : { code, subject };

export function validateModelReportSemantics(report) {
  const problems = [];
  const caseIds = Array.isArray(report.fixtureCaseIds) ? report.fixtureCaseIds : [];
  const attempts = Array.isArray(report.attempts) ? report.attempts : [];
  if (report.source?.revision !== report.headSha || (report.suite === "release" && report.source?.dirty !== false)) problems.push(problem("MODEL_SOURCE_NOT_CLEAN_CURRENT_COMMIT"));
  if (report.caseCount !== caseIds.length || new Set(caseIds).size !== caseIds.length) problems.push(problem("MODEL_CASE_SET_INVALID"));
  if (report.suite === "release" && (report.repeat !== 3 || caseIds.length * report.repeat < 60)) problems.push(problem("RELEASE_REPEAT_THRESHOLD_NOT_MET"));
  const seen = new Set();
  const failed = [];
  const flaky = [];
  for (const attempt of attempts) {
    const key = `${attempt.caseId}:${attempt.attempt}`;
    if (seen.has(key)) problems.push(problem("DUPLICATE_MODEL_ATTEMPT", key));
    seen.add(key);
    if (!caseIds.includes(attempt.caseId)) problems.push(problem("MODEL_ATTEMPT_CASE_UNKNOWN", attempt.caseId));
    if (attempt.retryOf !== undefined && (!Number.isInteger(attempt.retryOf) || attempt.retryOf < 1 || attempt.retryOf > report.repeat || !attempt.retryReason)) {
      problems.push(problem("MODEL_RETRY_BINDING_INVALID", key));
    }
    if (attempt.status === "INFRA_FAIL" && !["PROVIDER_AUTH", "NETWORK", "TIMEOUT", "RPC_PROTOCOL", "CHILD_EXIT", "CLEANUP_FAILURE", "UNCLASSIFIED"].includes(attempt.infrastructureCode)) {
      problems.push(problem("INFRASTRUCTURE_CLASSIFICATION_MISSING", key));
    }
    if (report.suite === "release" && (attempt.usage?.source !== "pi-session-stats"
      || !Number.isInteger(attempt.usage.toolCalls) || !Number.isInteger(attempt.usage.contextTokens) || !Number.isInteger(attempt.usage.totalTokens))) {
      problems.push(problem("MODEL_USAGE_EVIDENCE_MISSING", key));
    }
  }
  for (const caseId of caseIds) {
    const selected = attempts.filter((attempt) => attempt.caseId === caseId);
    const primary = selected.filter(({ retryOf }) => retryOf === undefined);
    if (primary.length !== report.repeat || JSON.stringify(primary.map(({ attempt }) => attempt).sort((a, b) => a - b)) !== JSON.stringify(Array.from({ length: report.repeat }, (_, index) => index + 1))) {
      problems.push(problem("MODEL_PRIMARY_ATTEMPTS_INCOMPLETE", caseId));
      continue;
    }
    const unresolved = primary.filter((attempt) => attempt.status !== "PASS"
      && !selected.some(({ retryOf, status }) => retryOf === attempt.attempt && status === "PASS"));
    if (unresolved.length) failed.push(caseId);
    else if (primary.some(({ status }) => status !== "PASS")) flaky.push(caseId);
  }
  const expectedGate = { passed: failed.length === 0, failed, flaky };
  if (JSON.stringify(report.gate) !== JSON.stringify(expectedGate)) problems.push(problem("MODEL_GATE_MISMATCH"));
  const counts = Object.fromEntries(["PASS", "SEMANTIC_FAIL", "INFRA_FAIL"].map((status) => [status, attempts.filter((attempt) => attempt.status === status).length]));
  if (report.summary?.total !== attempts.length || report.summary?.passed !== counts.PASS
    || report.summary?.semanticFailed !== counts.SEMANTIC_FAIL || report.summary?.infraFailed !== counts.INFRA_FAIL) {
    problems.push(problem("MODEL_SUMMARY_MISMATCH"));
  }
  const turns = attempts.reduce((total, attempt) => total + (attempt.turns?.length ?? 1), 0);
  if (report.modelTurns !== turns) problems.push(problem("MODEL_TURN_COUNT_MISMATCH"));
  if (report.toolCalls !== attempts.reduce((total, attempt) => total + (attempt.usage?.toolCalls ?? 0), 0)
    || report.contextTokens !== attempts.reduce((total, attempt) => total + (attempt.usage?.contextTokens ?? 0), 0)
    || report.totalTokens !== attempts.reduce((total, attempt) => total + (attempt.usage?.totalTokens ?? 0), 0)) problems.push(problem("MODEL_USAGE_TOTAL_MISMATCH"));
  if (report.forbiddenWrites !== attempts.reduce((total, attempt) => total + (attempt.forbiddenWrites ?? 0), 0)
    || report.cleanupFailures !== attempts.filter((attempt) => attempt.cleanup?.workspace === "FAIL" || attempt.cleanup?.session === "FAIL").length) problems.push(problem("MODEL_SAFETY_TOTAL_MISMATCH"));
  return problems;
}

export function validateE2EReportSemantics(report) {
  const problems = [];
  const scenarios = Array.isArray(report.scenarios) ? report.scenarios : [];
  const ids = scenarios.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) problems.push(problem("DUPLICATE_E2E_SCENARIO"));
  const matched = (scenario) => scenario.status === scenario.expectedStatus
    && scenario.reasonCode === scenario.expectedReasonCode
    && scenario.metrics?.externalWrites === scenario.expectedExternalWrites
    && (!scenario.expectedRecovery || scenario.recoveryAttempted)
    && scenario.evidenceVerified === true;
  const complete = scenarios.length > 0 && scenarios.every(matched)
    && report.setup?.status === "PASS"
    && report.cleanup?.status === "PASS" && report.cleanup?.remaining === 0
    && report.metrics?.unauthorized_write_count === 0 && report.metrics?.unclassified_failure_rate === 0
    && report.harnessEvidence?.status === "PASS" && report.providerEvidence?.status === "PASS";
  if ((report.status === "COMPLETE") !== complete) problems.push(problem("E2E_COMPLETION_MISMATCH"));
  if (report.metrics?.executions !== scenarios.length
    || report.metrics?.unauthorized_write_count !== scenarios.reduce((total, item) => total + (item.metrics?.unauthorizedWrites ?? 0), 0)
    || report.metrics?.github_api_calls !== scenarios.reduce((total, item) => total + (item.metrics?.githubApiCalls ?? 0), 0)) {
    problems.push(problem("E2E_METRICS_MISMATCH"));
  }
  return problems;
}

export function validateQualificationSemantics(report) {
  const problems = [];
  if ((report.status === "COMPLETE") !== (report.problems?.length === 0)) problems.push(problem("QUALIFICATION_STATUS_MISMATCH"));
  const refs = report.evidenceRefs ?? [];
  const keys = refs.map(({ reportId, digest }) => `${reportId}:${digest}`);
  if (new Set(keys).size !== keys.length) problems.push(problem("QUALIFICATION_EVIDENCE_DUPLICATE"));
  return problems;
}
