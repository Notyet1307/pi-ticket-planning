import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { approvalProjection, fingerprint } from "../admission/domain.mjs";
import { fingerprint as handoffFingerprint } from "../execution-plan/domain.mjs";
import { buildGoalHandoff, goalHandoffFingerprint } from "../execution-plan/goal-handoff.mjs";
import { buildOutcomeReceipt } from "../outcome/ingest.mjs";
import { buildSpecPublicationPlan, digestBytes, recordSpecPublicationArtifacts } from "../spec-publication/publication.mjs";
import { createExecutionHandoffApproval, runPlanningCaseCli } from "../planning-case/cli.mjs";
import { createPlanningCaseStore } from "../planning-case/store.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TARGET = "github:Notyet1307/example";

function run(stateDir, args) {
  const result = spawnSync(process.execPath, ["scripts/planctl.mjs", ...args], {
    cwd: ROOT,
    env: { ...process.env, PI_TICKET_PLAN_STATE_DIR: stateDir },
    encoding: "utf8",
  });
  return { ...result, json: result.stdout.trim() ? JSON.parse(result.stdout) : null };
}

function runSpecPublication(stateDir, args) {
  const result = spawnSync(process.execPath, ["scripts/spec-publication.mjs", ...args], {
    cwd: ROOT,
    env: { ...process.env, PI_TICKET_PLAN_STATE_DIR: stateDir },
    encoding: "utf8",
  });
  return { ...result, json: result.stdout.trim() ? JSON.parse(result.stdout) : null };
}

function handoffPlan() {
  return {
    controllerContractVersion: 2,
    id: "release-90",
    title: "Release",
    objective: "Ship safely",
    repo: "Notyet1307/example",
    baseRef: "main",
    baseSha: "a".repeat(40),
    parentIssue: 90,
    issues: [{ number: 91, order: 1, dependsOn: [], objective: "Build safely", acceptanceCriteria: ["One", "Two", "Three"], expectedPaths: ["src/child.ts"], scopeBudget: { maxFiles: 8, maxChangedLines: 1500 }, risk: "normal", oracleCommands: [] }],
    releaseAcceptanceCriteria: ["S1: Done"],
    reviewFocus: [],
  };
}

test("pi-ticket-planctl persists and resumes one case across processes", (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-planctl-test-"));
  const stateDir = path.join(parent, "state");
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));

  const created = run(stateDir, ["case", "create", "--target", TARGET, "--json"]);
  assert.equal(created.status, 0, created.stderr);
  assert.equal(created.json.schema, "pi-ticket-planning:result-envelope:v1");
  assert.equal(created.json.command, "case.create");
  assert.equal(created.json.ok, true);
  assert.equal(created.json.status, "COMPLETE");
  assert.match(created.json.data.caseId, /^PC-/);
  assert.match(created.json.meta.commit, /^[a-f0-9]{40}$/);
  const caseId = created.json.data.caseId;

  const listed = run(stateDir, ["case", "list", "--json"]);
  assert.equal(listed.status, 0, listed.stderr);
  assert.deepEqual(listed.json.data.cases.map((item) => item.caseId), [caseId]);

  const status = run(stateDir, ["case", "status", caseId, "--json"]);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(status.json.data.case.caseId, caseId);

  const resumed = run(stateDir, ["case", "resume", caseId, "--json"]);
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.equal(resumed.json.data.currentState.stage, "ORIENT");
  assert.equal(resumed.json.data.compatibility.capabilities, "UNTESTED");
  assert.match(resumed.json.data.recoveryCommand, new RegExp(`${caseId} --dry-run --json$`));

  const offline = run(stateDir, ["case", "resume", caseId, "--offline", "--json"]);
  assert.equal(offline.status, 1);
  assert.equal(offline.json.status, "DEGRADED");
  assert.equal(offline.json.data.mutationAllowed, false);

  const abandoned = run(stateDir, ["case", "abandon", caseId, "--reason", "superseded", "--json"]);
  assert.equal(abandoned.status, 0, abandoned.stderr);
  assert.equal(abandoned.json.data.case.blocker.code, "CASE_ABANDONED");

  const verified = run(stateDir, ["case", "verify", caseId, "--json"]);
  assert.equal(verified.status, 0, verified.stderr);
  assert.deepEqual(verified.json.data.verification, { status: "COMPLETE", problems: [] });

  const recovery = run(stateDir, ["case", "recover", caseId, "--dry-run", "--json"]);
  assert.equal(recovery.status, 0, recovery.stderr);
  assert.deepEqual(recovery.json.data.recovery, { status: "COMPLETE", actions: [], problems: [] });

  const migration = run(stateDir, ["case", "migrate", "--dry-run", "--json"]);
  assert.equal(migration.status, 0, migration.stderr);
  assert.deepEqual(migration.json.data, { dryRun: true, migrations: [] });
});

test("pi-ticket-planctl returns stable INVALID problems", (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-planctl-invalid-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const invalid = run(stateDir, ["case", "status", "../../escape", "--json"]);
  assert.equal(invalid.status, 1);
  assert.equal(invalid.json.ok, false);
  assert.equal(invalid.json.status, "INVALID");
  assert.deepEqual(invalid.json.problems, [{ code: "INVALID_CASE_ID" }]);
  assert.equal(invalid.json.recovery, null);
});

test("pi-ticket-planctl records one operator approval bound to an exact Admission Plan", (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-planctl-approval-"));
  const stateDir = path.join(parent, "state");
  const planFile = path.join(parent, "plan.json");
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const plan = {
    schema: "pi-ticket-planning:admission-plan:v1",
    kind: "STANDALONE",
    repo: "Notyet1307/example",
    target: "90",
    reviewedFingerprint: `sha256:${"b".repeat(64)}`,
    resources: [],
    reviewed: { source: { revision: "r2" } },
  };
  plan.planFingerprint = fingerprint(approvalProjection(plan));
  fs.writeFileSync(planFile, `${JSON.stringify(plan)}\n`, { mode: 0o600 });
  const created = run(stateDir, ["case", "create", "--target", TARGET, "--case-id", "PC-approve", "--json"]);
  assert.equal(created.status, 0, created.stderr);

  const approved = run(stateDir, [
    "case", "approve", "PC-approve", "--plan", planFile, "--expected-fingerprint", plan.planFingerprint, "--json",
  ]);

  assert.equal(approved.status, 0, approved.stderr);
  assert.equal(approved.json.command, "case.approve");
  assert.equal(approved.json.data.approval.fact, "human.activation");
  assert.deepEqual(approved.json.data.approval.subject, {
    target: TARGET,
    kind: "admission-plan",
    id: plan.planFingerprint,
    revision: "r2",
    digest: plan.planFingerprint,
  });
  const status = run(stateDir, ["case", "status", "PC-approve", "--json"]);
  assert.deepEqual(status.json.data.case.approvals.pending.map(({ id }) => id), [approved.json.data.approval.id]);
});

test("pi-ticket-planctl isolates exact execution handoff approvals from Admission plans", (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-planctl-handoff-"));
  const stateDir = path.join(parent, "state"); const handoffFile = path.join(parent, "handoff.json");
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const handoff = handoffPlan(); fs.writeFileSync(handoffFile, `${JSON.stringify(handoff)}\n`, { mode: 0o600 });
  const handoffDigest = handoffFingerprint(handoff);
  assert.equal(run(stateDir, ["case", "create", "--target", TARGET, "--case-id", "PC-handoff", "--json"]).status, 0);
  const approved = run(stateDir, ["case", "approve-handoff", "PC-handoff", "--plan", handoffFile, "--expected-fingerprint", handoffDigest, "--json"]);
  assert.equal(approved.status, 0, approved.stderr);
  const approval = approved.json.data.approval;
  assert.equal(approval.fact, "human.executionHandoff");
  assert.deepEqual(approval.subject, { target: TARGET, kind: "release-plan", id: handoffDigest, revision: "0", digest: handoffDigest });
  assert.equal(Date.parse(approval.expiresAt) - Date.parse(approval.observedAt), 3600000);
  assert.equal(run(stateDir, ["case", "approve-handoff", "PC-handoff", "--plan", handoffFile, "--expected-fingerprint", `sha256:${"0".repeat(64)}`, "--json"]).json.problems[0].code, "EXPECTED_FINGERPRINT_MISMATCH");
  assert.equal(run(stateDir, ["case", "approve", "PC-handoff", "--plan", handoffFile, "--expected-fingerprint", handoffDigest, "--json"]).json.problems[0].code, "INVALID_ADMISSION_PLAN");
  const malformed = { ...handoff, unexpected: true };
  const malformedFile = path.join(parent, "malformed.json"); fs.writeFileSync(malformedFile, JSON.stringify(malformed), { mode: 0o600 });
  assert.equal(run(stateDir, ["case", "approve-handoff", "PC-handoff", "--plan", malformedFile, "--expected-fingerprint", handoffFingerprint(malformed), "--json"]).json.problems[0].code, "INVALID_RELEASE_PLAN");
  const missing = structuredClone(handoff); delete missing.issues;
  const missingFile = path.join(parent, "missing.json"); fs.writeFileSync(missingFile, JSON.stringify(missing), { mode: 0o600 });
  assert.equal(run(stateDir, ["case", "approve-handoff", "PC-handoff", "--plan", missingFile, "--expected-fingerprint", handoffFingerprint(missing), "--json"]).json.problems[0].code, "INVALID_RELEASE_PLAN");
  assert.equal(run(stateDir, ["case", "create", "--target", "github:Other/example", "--case-id", "PC-foreign", "--json"]).status, 0);
  assert.equal(run(stateDir, ["case", "approve-handoff", "PC-foreign", "--plan", handoffFile, "--expected-fingerprint", handoffDigest, "--json"]).json.problems[0].code, "CASE_NOT_FOUND");
  const legacy = { schema: "pi-ticket-planning:admission-plan:v1", kind: "STANDALONE", repo: "Notyet1307/example", target: "90", reviewedFingerprint: `sha256:${"b".repeat(64)}`, resources: [], reviewed: { source: { revision: "r1" } } }; legacy.planFingerprint = fingerprint(approvalProjection(legacy));
  const legacyFile = path.join(parent, "legacy.json"); fs.writeFileSync(legacyFile, JSON.stringify(legacy), { mode: 0o600 });
  assert.equal(run(stateDir, ["case", "approve-handoff", "PC-handoff", "--plan", legacyFile, "--expected-fingerprint", legacy.planFingerprint, "--json"]).json.problems[0].code, "INVALID_RELEASE_PLAN");
  const status = run(stateDir, ["case", "status", "PC-handoff", "--json"]);
  assert.deepEqual(status.json.data.case.approvals.pending.map(({ id }) => id), [approval.id]);
  const replay = run(stateDir, ["case", "approve-handoff", "PC-handoff", "--plan", handoffFile, "--expected-fingerprint", handoffDigest, "--json"]);
  assert.equal(replay.status, 1);
  assert.equal(replay.json.problems[0].code, "HANDOFF_APPROVAL_ALREADY_EXISTS");
});

test("pi-ticket-planctl renews only expired handoff approval history", (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-planctl-expired-handoff-"));
  const stateDir = path.join(parent, "state");
  const planFile = path.join(parent, "handoff.json");
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const plan = handoffPlan();
  fs.writeFileSync(planFile, `${JSON.stringify(plan)}\n`, { mode: 0o600 });
  const target = `github:${plan.repo}`;
  const caseId = "PC-expired-handoff";
  const expiredAt = "2026-08-20T00:00:00.000Z";
  const renewedAt = "2026-08-20T02:00:00.000Z";
  const store = createPlanningCaseStore({ stateDir, clock: () => expiredAt });
  store.create({ target, caseId });
  const expired = createExecutionHandoffApproval({ plan, caseId, correlationId: "C-expired", observedAt: expiredAt, revision: "0" });
  store.addApproval({ caseId, target, approval: expired });

  const renewed = runPlanningCaseCli([
    "case", "approve-handoff", caseId, "--plan", planFile, "--expected-fingerprint", handoffFingerprint(plan), "--json",
  ], { env: { ...process.env, PI_TICKET_PLAN_STATE_DIR: stateDir }, clock: () => renewedAt, correlationId: "C-renewed" });
  assert.equal(renewed.exitCode, 0);
  assert.notEqual(renewed.envelope.data.approval.id, expired.id);
  assert.deepEqual(createPlanningCaseStore({ stateDir }).get({ caseId, target }).approvals.pending.map(({ id }) => id), [
    expired.id,
    renewed.envelope.data.approval.id,
  ]);

  const duplicate = runPlanningCaseCli([
    "case", "approve-handoff", caseId, "--plan", planFile, "--expected-fingerprint", handoffFingerprint(plan), "--json",
  ], { env: { ...process.env, PI_TICKET_PLAN_STATE_DIR: stateDir }, clock: () => renewedAt, correlationId: "C-duplicate" });
  assert.equal(duplicate.envelope.problems[0].code, "HANDOFF_APPROVAL_ALREADY_EXISTS");
});

test("pi-ticket-planctl records one exact Goal channel handoff approval", (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-planctl-goal-handoff-"));
  const stateDir = path.join(parent, "state");
  const handoffFile = path.join(parent, "goal-handoff.json");
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const runner = { ref: "local", transport: "local", host: "test.local", sshHost: null, runnerCli: "/runner/goal-cli.js", runnerConfig: "/private/goal.json" };
  const handoff = buildGoalHandoff({ plan: handoffPlan(), channel: "GOAL_LOCAL", runnerRef: "local", runnerDigest: handoffFingerprint(runner), runnerHost: runner.host });
  fs.writeFileSync(handoffFile, `${JSON.stringify(handoff)}\n`, { mode: 0o600 });
  const digest = goalHandoffFingerprint(handoff);
  assert.equal(run(stateDir, ["case", "create", "--target", TARGET, "--case-id", "PC-goal-approve", "--json"]).status, 0);
  const approved = run(stateDir, ["case", "approve-goal-handoff", "PC-goal-approve", "--handoff", handoffFile, "--expected-fingerprint", digest, "--json"]);
  assert.equal(approved.status, 0, approved.stderr);
  assert.equal(approved.json.data.approval.fact, "human.goalHandoff");
  assert.deepEqual(approved.json.data.approval.subject, { target: TARGET, kind: "goal-handoff", id: digest, revision: "0", digest });
  const replay = run(stateDir, ["case", "approve-goal-handoff", "PC-goal-approve", "--handoff", handoffFile, "--expected-fingerprint", digest, "--json"]);
  assert.equal(replay.status, 1);
  assert.equal(replay.json.problems[0].code, "GOAL_HANDOFF_APPROVAL_ALREADY_EXISTS");
  const wrong = run(stateDir, ["case", "approve-goal-handoff", "PC-goal-approve", "--handoff", handoffFile, "--expected-fingerprint", `sha256:${"0".repeat(64)}`, "--json"]);
  assert.equal(wrong.json.problems[0].code, "EXPECTED_FINGERPRINT_MISMATCH");
});

test("spec-publication CLI records one exact Delivery Spec publication approval", (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-planctl-spec-approval-"));
  const stateDir = path.join(parent, "state");
  const planFile = path.join(parent, "spec-publication-plan.json");
  const contextFile = path.join(parent, "spec-publication-context.json");
  const draftFile = path.join(parent, "r003-delivery-spec-draft.md");
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const context = {
      caseId: "PC-spec-approval",
      repo: "Notyet1307/example",
      source: { identity: "R003", revision: "r1", status: "COMMITTED", baseRef: "refs/remotes/origin/main", baseSha: "a".repeat(40), path: "docs/product/releases/r003.md", blobDigest: `sha256:${"b".repeat(64)}`, digest: `sha256:${"c".repeat(64)}` },
      policy: { identity: "AGENTS.md", path: "AGENTS.md", digest: `sha256:${"d".repeat(64)}`, accepted: true },
      adrs: [],
      tracker: { kind: "GITHUB", repo: "Notyet1307/example", configured: true, labels: ["needs-triage"], issueTracker: { path: "docs/agents/issue-tracker.md", digest: `sha256:${"e".repeat(64)}` }, triageLabels: { path: "docs/agents/triage-labels.md", digest: `sha256:${"f".repeat(64)}` } },
  };
  const draftBytes = Buffer.from(`# R003 Delivery Spec

## Source
R003/r1 at ${"a".repeat(40)}; policy AGENTS.md.
## Problem statement
Problem.
## Delivery outcome
Outcome.
## Behavioral scenarios
### S1: Ship one path
Result.
## Release signal mapping
S1 maps to signal.
## Walking skeleton target
S1.
## Decisions
Decided.
## Verification strategy
Verify S1.
## Constraints and dependencies
None.
## Out of scope
Other work.
## Unresolved decisions
None.
`);
  const contextBytes = Buffer.from(`${JSON.stringify(context, null, 2)}\n`);
  fs.writeFileSync(contextFile, contextBytes, { mode: 0o600 });
  fs.writeFileSync(draftFile, draftBytes, { mode: 0o600 });
  const plan = buildSpecPublicationPlan({ context, draftBytes, artifacts: { contextPath: contextFile, contextDigest: digestBytes(contextBytes), draftPath: draftFile, planPath: planFile } });
  fs.writeFileSync(planFile, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 });
  assert.equal(run(stateDir, ["case", "create", "--target", TARGET, "--case-id", plan.caseId, "--json"]).status, 0);
  recordSpecPublicationArtifacts({ plan, store: createPlanningCaseStore({ stateDir }), clock: () => "2026-08-28T01:00:00.000Z" });
  const approved = runSpecPublication(stateDir, ["approve", "--plan", planFile, "--expected-fingerprint", plan.planFingerprint, "--case-id", plan.caseId, "--json"]);
  assert.equal(approved.status, 0, approved.stderr);
  assert.equal(approved.json.approval.fact, "human.specPublication");
  assert.deepEqual(approved.json.approval.subject, { target: TARGET, kind: "spec-publication-plan", id: plan.planFingerprint, revision: "r1", digest: plan.planFingerprint });
  assert.equal(runSpecPublication(stateDir, ["approve", "--plan", planFile, "--expected-fingerprint", plan.planFingerprint, "--case-id", plan.caseId, "--json"]).json.problems[0].code, "SPEC_PUBLICATION_APPROVAL_ALREADY_EXISTS");
  assert.equal(runSpecPublication(stateDir, ["approve", "--plan", planFile, "--expected-fingerprint", `sha256:${"0".repeat(64)}`, "--case-id", plan.caseId, "--json"]).json.problems[0].code, "EXPECTED_FINGERPRINT_MISMATCH");
});

test("pi-ticket-planctl records domain inputs and Outcome decisions", (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-planctl-domain-"));
  const stateDir = path.join(parent, "state");
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  assert.equal(run(stateDir, ["case", "create", "--target", TARGET, "--case-id", "PC-domain", "--json"]).status, 0);
  const candidateFile = path.join(parent, "candidate.json");
  fs.writeFileSync(candidateFile, JSON.stringify({ id: "C1", revision: "r1", digest: `sha256:${"a".repeat(64)}`, title: "Candidate" }), { mode: 0o600 });
  const selected = run(stateDir, ["case", "select-candidate", "PC-domain", "--input", candidateFile, "--json"]);
  assert.equal(selected.status, 0, selected.stderr);
  assert.equal(selected.json.data.case.selectedCandidate.id, "C1");

  const subject = { target: TARGET, kind: "release", id: "R1", revision: "r1", digest: `sha256:${"b".repeat(64)}` };
  const outcome = buildOutcomeReceipt({
    id: "OR-domain",
    subject,
    baseSha: "a".repeat(40),
    source: { kind: "git", producer: "git", producerVersion: "test", producerDigest: `sha256:${"c".repeat(64)}` },
    observedAt: new Date().toISOString(),
    status: "ACHIEVED",
    evidence: [{ kind: "git", ref: "commit", digest: `sha256:${createHash("sha256").update("commit").digest("hex")}` }],
  });
  const receiptFile = path.join(parent, "outcome.json");
  fs.writeFileSync(receiptFile, JSON.stringify(outcome), { mode: 0o600 });
  assert.equal(run(stateDir, ["outcome", "ingest", "--case-id", "PC-domain", "--receipt", receiptFile, "--json"]).status, 0);
  const decided = run(stateDir, ["outcome", "decide", "--case-id", "PC-domain", "--receipt", receiptFile, "--decision", "NO_CHANGE", "--json"]);
  assert.equal(decided.status, 0, decided.stderr);
  assert.equal(decided.json.data.case.learningDecisions[0].decision, "NO_CHANGE");
});
