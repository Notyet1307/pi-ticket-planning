import fs from "node:fs";
import path from "node:path";

import { runtimeMetadata } from "../installation/build-metadata.mjs";
import { validateArtifactRuntime } from "../protocol/kernel.mjs";
import { validateCapabilityReceipt } from "../capabilities/doctor.mjs";
import { requireSupportedCapabilities } from "../capabilities/admission.mjs";
import { LIVE_SCENARIOS } from "./e2e.mjs";
import { finalizeReport, reportMetadata, validateReportEnvelope } from "./report.mjs";
import { verifyGitHubEvidence } from "./provenance.mjs";

const E2E_SCHEMA = "pi-ticket-planning:e2e-report:v2";
const MODEL_SCHEMA = "pi-ticket-planning:live-eval:v4";

function tuple(report) {
  return {
    piVersion: report.piVersion,
    piDigest: report.piDigest,
    subagentVersion: report.subagentVersion,
    provider: report.provider,
    model: report.model,
    thinking: report.thinking,
    profileDigest: report.profileDigest,
    harnessVersion: report.harnessVersion,
    harnessDigest: report.harnessDigest,
  };
}

function tupleKey(value) {
  return JSON.stringify(tuple(value));
}

function evidenceRecord(value) {
  return value?.report ? value : { report: value, provenanceVerified: false, workflowVerified: false, file: null };
}

function capabilityRecord(value) {
  return value?.receipt ? value : { receipt: value, provenanceVerified: false, workflowVerified: false, file: null, workflowRunUrl: null };
}

function issue(code, subject) {
  return subject === undefined ? { code } : { code, subject };
}

function deduplicate(records, problems) {
  const seenIds = new Set();
  const seenDigests = new Set();
  return records.filter(({ report }) => {
    if (seenIds.has(report.reportId) || seenDigests.has(report.reportDigest)) {
      problems.push(issue("DUPLICATE_REPORT", report.reportId));
      return false;
    }
    seenIds.add(report.reportId);
    seenDigests.add(report.reportDigest);
    return true;
  });
}

export async function qualifyRelease({
  e2eReports = [],
  modelReports = [],
  capabilityReceipts = [],
  headSha = runtimeMetadata().sourceCommit,
  now = new Date().toISOString(),
  requireProvenance = true,
  env = process.env,
} = {}) {
  const problems = [];
  const check = async (value, schema, tier) => {
    const record = evidenceRecord(value);
    let structural;
    try { structural = await validateArtifactRuntime(record.report); } catch { structural = { ok: false, problems: [issue("REPORT_SCHEMA_INVALID")] }; }
    if (record.report.schema !== schema || !structural.ok) problems.push(issue("REPORT_SCHEMA_INVALID", record.report.reportId));
    problems.push(...validateReportEnvelope(record.report, { tier, headSha, now, requireActions: requireProvenance }).problems);
    if (requireProvenance && !record.provenanceVerified) problems.push(issue("ATTESTATION_NOT_VERIFIED", record.report.reportId));
    if (requireProvenance && !record.workflowVerified) problems.push(issue("WORKFLOW_RUN_NOT_VERIFIED", record.report.reportId));
    return record;
  };
  const e2e = deduplicate(await Promise.all(e2eReports.map((value) => check(value, E2E_SCHEMA, "L3_REAL_DISPOSABLE_INTEGRATION"))), problems)
    .filter(({ report }) => report.status === "COMPLETE");
  const models = deduplicate(await Promise.all(modelReports.map((value) => check(value, MODEL_SCHEMA, "L2_REAL_MODEL"))), problems)
    .filter(({ report }) => report.gate?.passed === true);

  const scenarioIds = new Set();
  const scenarios = [];
  for (const { report } of e2e) {
    for (const scenario of report.scenarios) {
      if (scenarioIds.has(scenario.id)) {
        problems.push(issue("DUPLICATE_SCENARIO_EXECUTION", scenario.id));
        continue;
      }
      scenarioIds.add(scenario.id);
      scenarios.push(scenario);
    }
  }
  const expectedMatch = (scenario) => scenario.status === scenario.expectedStatus
    && scenario.reasonCode === scenario.expectedReasonCode
    && scenario.metrics.externalWrites === scenario.expectedExternalWrites
    && (!scenario.expectedRecovery || scenario.recoveryAttempted)
    && scenario.evidenceVerified === true;
  const scenarioCounts = new Map();
  for (const scenario of scenarios) scenarioCounts.set(scenario.scenarioId, (scenarioCounts.get(scenario.scenarioId) ?? 0) + 1);

  const attempts = [];
  const attemptKeys = new Set();
  for (const { report } of models) {
    for (const attempt of report.attempts ?? []) {
      const key = `${attempt.caseId}:${attempt.attempt}`;
      if (attemptKeys.has(key)) {
        problems.push(issue("DUPLICATE_MODEL_ATTEMPT", key));
        continue;
      }
      attemptKeys.add(key);
      attempts.push(attempt);
    }
  }
  const primary = attempts.filter((attempt) => attempt.retryOf === undefined);
  const eventual = primary.filter((attempt) => attempt.status === "PASS"
    || attempts.some(({ caseId, retryOf, status }) => caseId === attempt.caseId && retryOf === attempt.attempt && status === "PASS"));
  const modelTupleKeys = new Set(models.map(({ report }) => tupleKey(report)));
  const e2eTupleKeys = new Set(e2e.map(({ report }) => tupleKey(report)));
  const supportedTupleKeys = [...modelTupleKeys].filter((key) => e2eTupleKeys.has(key));
  const tuples = supportedTupleKeys.map(JSON.parse);
  const activeCapabilities = [];
  const capabilityDigests = new Set();
  for (const value of capabilityReceipts) {
    const record = capabilityRecord(value);
    const receipt = record.receipt;
    if (!validateCapabilityReceipt(receipt, { now }).ok || receipt.subject?.revision !== headSha) continue;
    const repo = e2e.find(({ report }) => report.repo && receipt.subject.target === `github:${report.repo}`)?.report.repo;
    try { requireSupportedCapabilities(receipt, { repo, baseSha: headSha, now }); } catch { continue; }
    if (requireProvenance && (!record.provenanceVerified || !record.workflowVerified)) {
      problems.push(issue("CAPABILITY_PROVENANCE_NOT_VERIFIED", receipt.subject.id));
      continue;
    }
    if (capabilityDigests.has(receipt.digest)) {
      problems.push(issue("DUPLICATE_CAPABILITY_RECEIPT", receipt.subject.id));
      continue;
    }
    capabilityDigests.add(receipt.digest);
    activeCapabilities.push(record);
  }
  const recoveryAttempts = scenarios.filter(({ expectedRecovery, recoveryAttempted, retries }) => expectedRecovery || recoveryAttempted || retries > 0);
  const metrics = {
    realE2EScenarios: scenarios.length,
    scenarioKinds: scenarioCounts.size,
    providersAndModels: new Set(models.map(({ report }) => `${report.provider}\n${report.model}`)).size,
    supportedTuples: tuples.length,
    firstAttempts: primary.length,
    firstPassSuccessRate: primary.length ? primary.filter(({ status }) => status === "PASS").length / primary.length : 0,
    eventualSuccessRate: primary.length ? eventual.length / primary.length : 0,
    retryRate: attempts.length ? attempts.filter(({ retryOf }) => retryOf !== undefined).length / attempts.length : 0,
    unclassifiedInfrastructureFailures: attempts.filter(({ status, infrastructureCode }) => status === "INFRA_FAIL" && infrastructureCode === "UNCLASSIFIED").length,
    modelForbiddenWrites: models.reduce((total, { report }) => total + report.forbiddenWrites, 0),
    modelCleanupFailures: models.reduce((total, { report }) => total + report.cleanupFailures, 0),
    unauthorizedWriteCount: e2e.reduce((total, { report }) => total + report.metrics.unauthorized_write_count, 0) + models.reduce((total, { report }) => total + report.forbiddenWrites, 0),
    recoveryAttempts: recoveryAttempts.length,
    recoverySuccessRate: recoveryAttempts.length ? recoveryAttempts.filter(expectedMatch).length / recoveryAttempts.length : 0,
    cleanupSuccessRate: e2e.length ? Math.min(...e2e.map(({ report }) => report.metrics.cleanup_success_rate)) : 0,
    unclassifiedFailureRate: e2e.length ? Math.max(...e2e.map(({ report }) => report.metrics.unclassified_failure_rate)) : 1,
    p50DurationMs: e2e.length ? Math.max(...e2e.map(({ report }) => report.metrics.p50_duration_ms ?? 0)) : null,
    p95DurationMs: e2e.length ? Math.max(...e2e.map(({ report }) => report.metrics.p95_duration_ms ?? 0)) : null,
    githubApiCalls: e2e.reduce((total, { report }) => total + report.metrics.github_api_calls, 0),
    modelTurns: models.reduce((total, { report }) => total + report.modelTurns, 0),
    toolCalls: e2e.reduce((total, { report }) => total + report.metrics.tool_calls, 0) + models.reduce((total, { report }) => total + report.toolCalls, 0),
    contextTokens: e2e.reduce((total, { report }) => total + report.metrics.context_tokens, 0) + models.reduce((total, { report }) => total + report.contextTokens, 0),
  };

  if (metrics.realE2EScenarios < 50) problems.push(issue("INSUFFICIENT_REAL_E2E"));
  const expectedScenarioIds = new Set(LIVE_SCENARIOS.map(({ id }) => id));
  if (scenarioCounts.size !== expectedScenarioIds.size || [...scenarioCounts.keys()].some((id) => !expectedScenarioIds.has(id))) problems.push(issue("E2E_SCENARIO_COVERAGE_INCOMPLETE"));
  if ((scenarioCounts.get("success") ?? 0) < 10) problems.push(issue("SUCCESS_REPETITION_THRESHOLD_NOT_MET"));
  if ([...scenarioCounts].some(([id, count]) => id !== "success" && count < 2)) problems.push(issue("FAULT_REPETITION_THRESHOLD_NOT_MET"));
  if (!scenarios.every(expectedMatch)) problems.push(issue("E2E_EXPECTATION_MISMATCH"));
  if (!scenarios.some(({ evidenceClass, evidenceVerified }) => evidenceClass === "REAL_EXTERNAL" && evidenceVerified)) problems.push(issue("REAL_GITHUB_EVIDENCE_MISSING"));
  if (!scenarios.some(({ evidenceClass, evidenceVerified }) => evidenceClass === "REAL_PROVIDER" && evidenceVerified)) problems.push(issue("REAL_PROVIDER_EVIDENCE_MISSING"));
  if (!e2e.some(({ report }) => report.harnessEvidence?.status === "PASS"
    && ["exactTarget", "readiness", "validation", "deliveryGate", "noBypass"].every((name) => report.harnessEvidence.preflight?.[name] === true)
    && ["claimDetection", "terminalOutcome"].every((name) => report.harnessEvidence.final?.[name] === true))) problems.push(issue("REAL_HARNESS_EVIDENCE_MISSING"));
  if (metrics.firstAttempts < 60) problems.push(issue("INSUFFICIENT_FIRST_ATTEMPTS"));
  if (metrics.firstPassSuccessRate < 0.95) problems.push(issue("FIRST_PASS_THRESHOLD_NOT_MET"));
  if (metrics.eventualSuccessRate !== 1) problems.push(issue("EVENTUAL_THRESHOLD_NOT_MET"));
  if (metrics.unclassifiedInfrastructureFailures !== 0) problems.push(issue("UNCLASSIFIED_INFRASTRUCTURE_FAILURE"));
  if (metrics.modelForbiddenWrites !== 0) problems.push(issue("MODEL_FORBIDDEN_WRITE"));
  if (metrics.modelCleanupFailures !== 0) problems.push(issue("MODEL_CLEANUP_FAILURE"));
  if (metrics.unauthorizedWriteCount !== 0) problems.push(issue("UNAUTHORIZED_WRITES_DETECTED"));
  if (metrics.recoveryAttempts === 0 || metrics.recoverySuccessRate !== 1) problems.push(issue("RECOVERY_THRESHOLD_NOT_MET"));
  if (metrics.cleanupSuccessRate !== 1) problems.push(issue("CLEANUP_THRESHOLD_NOT_MET"));
  if (metrics.unclassifiedFailureRate !== 0) problems.push(issue("UNCLASSIFIED_FAILURES_REMAIN"));
  if (metrics.supportedTuples < 1) problems.push(issue("QUALIFIED_TUPLE_MISSING"));
  for (const value of tuples) {
    const matched = activeCapabilities.some(({ receipt }) => receipt.pi.version === value.piVersion
      && receipt.pi.digest === value.piDigest
      && receipt.subagent.version === value.subagentVersion
      && receipt.provider.name === value.provider
      && receipt.provider.model === value.model
      && receipt.provider.thinking === value.thinking
      && receipt.profileDigest === value.profileDigest
      && (receipt.harness?.version ?? "UNTESTED") === value.harnessVersion
      && (receipt.harness?.configDigest ?? null) === value.harnessDigest);
    if (!matched) problems.push(issue("ACTIVE_CAPABILITY_RECEIPT_MISSING", `${value.provider}/${value.model}`));
  }

  const evidence = [...e2e, ...models].map(({ report, file }) => ({
    reportId: report.reportId,
    tier: report.tier,
    digest: report.reportDigest,
    workflowRunUrl: report.workflowRunUrl,
    file: file ? path.basename(file) : null,
  }));
  evidence.push(...activeCapabilities.map(({ receipt, workflowRunUrl, file }) => ({ reportId: receipt.subject.id, tier: "ACTIVE_CAPABILITY", digest: receipt.digest, workflowRunUrl, file: file ? path.basename(file) : null })));
  const primaryTuple = tuples[0] ?? {};
  const metadata = reportMetadata({
    tier: "L4_COMMIT_BOUND_QUALIFICATION",
    provider: primaryTuple.provider,
    model: primaryTuple.model,
    thinking: primaryTuple.thinking,
    env,
    observedAt: now,
  });
  return finalizeReport({
    schema: "pi-ticket-planning:release-qualification:v2",
    ...metadata,
    ...(primaryTuple.piVersion ? primaryTuple : {}),
    status: problems.length ? "BLOCKED" : "COMPLETE",
    metrics,
    tuples,
    evidenceRefs: evidence,
    problems,
    evidenceDigests: evidence.length ? [...new Set(evidence.map(({ digest }) => digest))] : [`sha256:${"0".repeat(64)}`],
  });
}

function readReports(value, schema) {
  return (value ?? "").split(",").filter(Boolean).map((file) => {
    const report = JSON.parse(fs.readFileSync(file, "utf8"));
    if (report.schema !== schema) throw new Error(`unexpected report schema in ${file}`);
    return { report, file, ...verifyGitHubEvidence(file, report) };
  });
}

function readCapabilities(value, reports) {
  return (value ?? "").split(",").filter(Boolean).map((file) => {
    const receipt = JSON.parse(fs.readFileSync(file, "utf8"));
    const record = reports.find(({ file: reportFile }) => reportFile && fs.realpathSync.native(path.dirname(reportFile)) === fs.realpathSync.native(path.dirname(file)));
    const verified = record ? verifyGitHubEvidence(file, record.report) : { provenanceVerified: false, workflowVerified: false };
    return { receipt, file, workflowRunUrl: record?.report.workflowRunUrl ?? null, ...verified };
  });
}

if (process.argv[1]?.endsWith("integration/qualify.mjs")) {
  const e2eReports = readReports(process.env.PTP_E2E_REPORTS, E2E_SCHEMA);
  const modelReports = readReports(process.env.PTP_MODEL_REPORTS, MODEL_SCHEMA);
  const result = await qualifyRelease({
    e2eReports,
    modelReports,
    capabilityReceipts: readCapabilities(process.env.PTP_CAPABILITY_RECEIPTS, [...e2eReports, ...modelReports]),
  });
  const output = process.env.PTP_QUALIFICATION_REPORT;
  if (output) fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== "COMPLETE") process.exitCode = 1;
}
