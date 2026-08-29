import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { LIVE_SCENARIOS } from "../integration/e2e.mjs";
import { qualifyRelease } from "../integration/qualify.mjs";
import { verifyGitHubEvidence } from "../integration/provenance.mjs";
import { finalizeReport, reportMetadata } from "../integration/report.mjs";
import { runtimeMetadata } from "../installation/build-metadata.mjs";
import { validateArtifact } from "../protocol/kernel.mjs";
import { buildCapabilityReceipt } from "../capabilities/doctor.mjs";
import { REQUIRED_ADMISSION_CAPABILITIES } from "../capabilities/admission.mjs";
import { applyCompatibilityProposal, proposeCompatibility } from "../capabilities/compatibility.mjs";

const digest = (character) => `sha256:${character.repeat(64)}`;
const headSha = runtimeMetadata().sourceCommit;
const qualificationEnv = {
  GITHUB_RUN_ID: "300",
  GITHUB_RUN_ATTEMPT: "1",
  GITHUB_WORKFLOW: "Release qualification",
  GITHUB_REPOSITORY: "acme/product",
  GITHUB_ACTOR: "tester",
  GITHUB_SERVER_URL: "https://github.com",
  RUNNER_NAME: "test-runner",
};

function metadata(tier) {
  return {
    ...reportMetadata({ tier, provider: "openai-codex", model: "gpt-test", thinking: "high", observedAt: new Date().toISOString() }),
    piVersion: "0.84.2",
    piDigest: digest("1"),
    subagentVersion: "pi-interactive-subagents@c3e8b53c0754ae5ccc19fdab5a7481ec039bc2f7",
    profileDigest: digest("2"),
    harnessVersion: "1.0.0",
    harnessDigest: digest("3"),
  };
}

function e2eReport() {
  const scenarios = LIVE_SCENARIOS.flatMap((contract) => Array.from({ length: contract.id === "success" ? 10 : 3 }, (_, index) => ({
    id: `${contract.id}:${index + 1}`,
    scenarioId: contract.id,
    ordinal: index + 1,
    evidenceClass: contract.evidenceClass,
    expectedStatus: contract.expectedStatus,
    expectedReasonCode: contract.expectedReasonCode,
    expectedExternalWrites: contract.expectedExternalWrites,
    expectedRecovery: contract.expectedRecovery,
    expectedCleanup: true,
    status: contract.expectedStatus,
    reasonCode: contract.expectedReasonCode,
    durationMs: 1,
    retries: contract.expectedRecovery ? 1 : 0,
    recoveryAttempted: contract.expectedRecovery,
    evidenceVerified: true,
    metrics: { unauthorizedWrites: 0, externalWrites: contract.expectedExternalWrites, githubApiCalls: 1, modelTurns: 0, toolCalls: 1, contextTokens: 0 },
    evidenceDigests: [digest(((index + contract.id.length) % 9 + 1).toString())],
  })));
  return finalizeReport({
    schema: "pi-ticket-planning:e2e-report:v2",
    ...metadata("L3_REAL_DISPOSABLE_INTEGRATION"),
    runId: "test-e2e",
    repo: "acme/disposable",
    resourceTag: "ptp-e2e:test",
    status: "COMPLETE",
    reasonCode: "ALL_EXECUTIONS_MATCH",
    scenarios,
    metrics: {
      executions: 61, first_pass_success_rate: 43 / 61, eventual_success_rate: 1, retry_rate: 18 / 61,
      unclassified_failure_rate: 0, unauthorized_write_count: 0, recovery_attempts: 18, recovery_success_rate: 1,
      cleanup_success_rate: 1, p50_duration_ms: 1, p95_duration_ms: 1, model_turns: 0, tool_calls: 61,
      context_tokens: 0, github_api_calls: 61,
    },
    setup: { status: "PASS", externalWrites: 1, evidenceDigests: [digest("1")] },
    harnessEvidence: { status: "PASS", preflight: { exactTarget: true, readiness: true, validation: true, deliveryGate: true, noBypass: true }, final: { claimDetection: true, terminalOutcome: true }, evidenceDigests: [digest("2")] },
    providerEvidence: { status: "PASS", childResult: true, freshContext: true, strictSchema: true, namedSession: false, persistedSession: true, exactIdFileResume: true, sessionResume: true, timeoutCancellation: true, evidenceDigests: [digest("3")] },
    githubAppEvidence: { status: "PASS", appSlug: "ptp-e2e", installationIdentityDigest: digest("3"), targetRepo: "acme/disposable", permissions: { metadata: "read", issues: "write", contents: "none", administration: "none" }, writeActorReadback: true, evidenceDigests: [digest("3")] },
    cleanup: { status: "PASS", deleted: 61, remaining: 0, recoveryCommand: null, recoveredByAnotherProcess: true },
    recoveryCommand: null,
    evidenceDigests: [digest("4"), digest("5")],
  });
}

function modelReport() {
  const attempts = Array.from({ length: 22 }, (_, caseIndex) => Array.from({ length: 3 }, (_, repeatIndex) => ({
    caseId: `case-${caseIndex + 1}`,
    attempt: repeatIndex + 1,
    status: "PASS",
    errors: [],
    cleanup: { workspace: "PASS", session: "PASS" },
    workspaceMutations: { count: 0, created: 0, modified: 0, deleted: 0, paths: [] },
    usage: { source: "pi-session-stats", toolCalls: 1, contextTokens: 10, totalTokens: 100 },
    forbiddenWrites: 0,
  }))).flat();
  return finalizeReport({
    schema: "pi-ticket-planning:live-eval:v4",
    ...metadata("L2_REAL_MODEL"),
    source: { revision: headSha, dirty: false },
    fixtureSha256: "a".repeat(64),
    caseSetSha256: "b".repeat(64),
    fixtureCaseIds: Array.from({ length: 22 }, (_, index) => `case-${index + 1}`),
    caseCount: 22,
    modelTurns: 66,
    toolCalls: 66,
    contextTokens: 660,
    totalTokens: 6600,
    forbiddenWrites: 0,
    cleanupFailures: 0,
    caseTypes: [],
    suite: "release",
    repeat: 3,
    retryFailures: 1,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    attempts,
    summary: { total: 66, passed: 66, semanticFailed: 0, infraFailed: 0, successRate: 1, cases: attempts.map(({ caseId }) => caseId).filter((id, index, all) => all.indexOf(id) === index).map((id) => ({ id, attempts: 3, passed: 3, successRate: 1 })) },
    gate: { passed: true, failed: [], flaky: [] },
    evidenceDigests: [digest("6"), digest("7")],
  });
}

function capabilityReceipt() {
  const observedAt = new Date().toISOString();
  return buildCapabilityReceipt({
    subject: { target: "github:acme/disposable", kind: "capability", id: "openai-codex/gpt-test", revision: headSha, digest: digest("8") },
    observedAt,
    expiresAt: new Date(Date.parse(observedAt) + 60 * 60 * 1000).toISOString(),
    pi: { path: "/test/pi", version: "0.84.2", digest: digest("1") },
    subagent: { version: "pi-interactive-subagents@c3e8b53c0754ae5ccc19fdab5a7481ec039bc2f7" },
    provider: { name: "openai-codex", model: "gpt-test", thinking: "high" },
    profileDigest: digest("2"),
    harness: { version: "1.0.0", configDigest: digest("3") },
    repo: { target: "github:acme/disposable", baseSha: headSha },
    capabilities: REQUIRED_ADMISSION_CAPABILITIES.map((name) => ({ name, status: "SUPPORTED", reasonCode: "ACTIVE_PROBE_PASS", evidence: [{ kind: "active-probe", digest: digest("9") }] })),
  });
}

test("Qualification deduplicates evidence and binds one exact tuple", async (t) => {
  const e2e = e2eReport();
  const model = modelReport();
  assert.equal(validateArtifact(e2e).ok, true);
  assert.equal(validateArtifact(model).ok, true);
  const capability = capabilityReceipt();
  const result = await qualifyRelease({ e2eReports: [e2e], modelReports: [model], capabilityReceipts: [capability], headSha, requireProvenance: false, env: qualificationEnv });
  assert.equal(result.status, "COMPLETE", JSON.stringify(result.problems));
  assert.equal(result.metrics.realE2EScenarios, 61);
  assert.equal(result.metrics.firstAttempts, 66);
  assert.equal(result.metrics.providersAndModels, 1);
  assert.equal(result.metrics.supportedTuples, 1);
  assert.equal(validateArtifact(result).ok, true);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-compatibility-"));
  const oldPath = process.env.PATH;
  t.after(() => { process.env.PATH = oldPath; fs.rmSync(root, { recursive: true, force: true }); });
  const qualificationFile = path.join(root, "qualification.json");
  fs.writeFileSync(qualificationFile, JSON.stringify(result));
  const fakeGh = path.join(root, "gh");
  fs.writeFileSync(fakeGh, `#!/usr/bin/env node
const report = JSON.parse(process.env.PTP_TEST_QUALIFICATION);
if (process.argv[2] === "attestation") console.log(JSON.stringify([{ verificationResult: { signature: { certificate: { runnerInvocationURI: report.workflowRunUrl + "/attempts/" + report.workflowRunAttempt } } } }]));
else console.log(JSON.stringify({ conclusion: "success", headSha: report.headSha, url: report.workflowRunUrl, workflowName: report.workflowName, attempt: report.workflowRunAttempt }));
`, { mode: 0o755 });
  process.env.PATH = `${root}${path.delimiter}${oldPath}`;
  process.env.PTP_TEST_QUALIFICATION = JSON.stringify(result);
  t.after(() => { delete process.env.PTP_TEST_QUALIFICATION; });
  const verified = verifyGitHubEvidence(qualificationFile, result);
  assert.equal(verified.provenanceVerified && verified.workflowVerified, true);
  const qualificationProvenance = verified.receipt;
  assert.throws(() => proposeCompatibility({ qualification: result, capabilityReceipt: capability, qualificationProvenance, matrix: { schema: "pi-ticket-planning:compatibility-matrix:v2", defaultStatus: "UNTESTED", entries: [] } }), /QUALIFICATION_PROVENANCE_INVALID/);
  const proposal = proposeCompatibility({ qualification: result, capabilityReceipt: capability, qualificationProvenance, qualificationAuthorization: verified.authorization, matrix: { schema: "pi-ticket-planning:compatibility-matrix:v2", defaultStatus: "UNTESTED", entries: [] } });
  assert.equal(validateArtifact(proposal).ok, true);
  fs.mkdirSync(path.join(root, "compatibility"));
  fs.writeFileSync(path.join(root, "compatibility", "matrix.json"), `${JSON.stringify({ schema: "pi-ticket-planning:compatibility-matrix:v2", defaultStatus: "UNTESTED", entries: [] })}\n`);
  const applied = applyCompatibilityProposal(proposal, { expectedDigest: proposal.proposalDigest, qualification: result, capabilityReceipt: capability, qualificationProvenance, qualificationAuthorization: verified.authorization, packageCommit: headSha, root });
  assert.equal(applied.entries[0].status, "SUPPORTED");
  assert.throws(() => applyCompatibilityProposal(proposal, { expectedDigest: digest("0"), qualification: result, capabilityReceipt: capability, qualificationProvenance, qualificationAuthorization: verified.authorization, packageCommit: headSha, root }), /INVALID_COMPATIBILITY_PROPOSAL|EXPECTED_PROPOSAL_DIGEST_MISMATCH|COMPATIBILITY_MATRIX_DRIFT/);

  const replay = await qualifyRelease({ e2eReports: [e2e, e2e], modelReports: [model], capabilityReceipts: [capability], headSha, requireProvenance: false, env: qualificationEnv });
  assert.equal(replay.status, "BLOCKED");
  assert.equal(replay.problems.some(({ code }) => code === "DUPLICATE_REPORT"), true);
});
