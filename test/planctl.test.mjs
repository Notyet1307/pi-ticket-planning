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
import { buildOutcomeReceipt } from "../outcome/ingest.mjs";

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

function handoffPlan() {
  const releasePlan = { version: 2, source: { planner: "pi-ticket-planning", repo: "Notyet1307/example", baseRef: "main", baseSha: "a".repeat(40), parentBinding: { number: 90, expectedTitle: "Release", expectedBodyHash: `sha256:${"b".repeat(64)}` }, specContentHash: `sha256:${"c".repeat(64)}`, deliveryGraphDigest: `sha256:${"d".repeat(64)}` }, id: "release-90", title: "Release", objective: "Ship safely", parentIssue: 90, issues: [{ number: 91, order: 1, dependsOn: [], objective: "Build safely", acceptanceCriteria: ["One", "Two", "Three"], suggestedValidation: [], allowNoop: false, expectedTitle: "Child", expectedBodyHash: `sha256:${"e".repeat(64)}` }], releaseAcceptanceCriteria: ["S1: Done"], reviewFocus: [] };
  const plan = { schema: "pi-ticket-planning:execution-handoff-plan:v1", kind: "CODEX_RELEASE", repo: "Notyet1307/example", target: "90", source: { identity: "accepted", revision: "r1", baseRef: "main", baseSha: "a".repeat(40), specContentHash: `sha256:${"c".repeat(64)}`, deliveryGraphDigest: `sha256:${"d".repeat(64)}`, parentBodyHash: `sha256:${"b".repeat(64)}` }, children: [{ issue: "91", title: "Child", bodyHash: `sha256:${"e".repeat(64)}`, executionLane: "AGENT", blockedBy: [] }], reviewedFingerprint: `sha256:${"f".repeat(64)}`, policy: { identity: "policy", digest: `sha256:${"1".repeat(64)}` }, controller: { identity: "herdr-codex-controller", releasePlanVersion: 2, configDigest: "2".repeat(64), repo: "Notyet1307/example", baseRef: "main", maxIssues: 1, reviewEnabled: true }, releasePlan, controllerPlanDigest: "3".repeat(64), recovery: { strategy: "rebuild-on-source-drift", conflict: "rebuild" } };
  return { ...plan, planFingerprint: handoffFingerprint(plan) };
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
  assert.equal(run(stateDir, ["case", "create", "--target", TARGET, "--case-id", "PC-handoff", "--json"]).status, 0);
  const approved = run(stateDir, ["case", "approve-handoff", "PC-handoff", "--plan", handoffFile, "--expected-fingerprint", handoff.planFingerprint, "--json"]);
  assert.equal(approved.status, 0, approved.stderr);
  const approval = approved.json.data.approval;
  assert.equal(approval.fact, "human.executionHandoff");
  assert.deepEqual(approval.subject, { target: TARGET, kind: "execution-handoff-plan", id: handoff.planFingerprint, revision: "r1", digest: handoff.planFingerprint });
  assert.equal(Date.parse(approval.expiresAt) - Date.parse(approval.observedAt), 3600000);
  assert.equal(run(stateDir, ["case", "approve-handoff", "PC-handoff", "--plan", handoffFile, "--expected-fingerprint", `sha256:${"0".repeat(64)}`, "--json"]).json.problems[0].code, "EXPECTED_FINGERPRINT_MISMATCH");
  assert.equal(run(stateDir, ["case", "approve", "PC-handoff", "--plan", handoffFile, "--expected-fingerprint", handoff.planFingerprint, "--json"]).json.problems[0].code, "INVALID_ADMISSION_PLAN");
  const malformed = { ...handoff, unexpected: true }; malformed.planFingerprint = handoffFingerprint(((value) => { const { planFingerprint, ...rest } = value; return rest; })(malformed));
  const malformedFile = path.join(parent, "malformed.json"); fs.writeFileSync(malformedFile, JSON.stringify(malformed), { mode: 0o600 });
  assert.equal(run(stateDir, ["case", "approve-handoff", "PC-handoff", "--plan", malformedFile, "--expected-fingerprint", malformed.planFingerprint, "--json"]).json.problems[0].code, "INVALID_EXECUTION_HANDOFF_PLAN");
  const missing = structuredClone(handoff); delete missing.controller; missing.planFingerprint = handoffFingerprint(((value) => { const { planFingerprint, ...rest } = value; return rest; })(missing));
  const missingFile = path.join(parent, "missing.json"); fs.writeFileSync(missingFile, JSON.stringify(missing), { mode: 0o600 });
  assert.equal(run(stateDir, ["case", "approve-handoff", "PC-handoff", "--plan", missingFile, "--expected-fingerprint", missing.planFingerprint, "--json"]).json.problems[0].code, "INVALID_EXECUTION_HANDOFF_PLAN");
  assert.equal(run(stateDir, ["case", "create", "--target", "github:Other/example", "--case-id", "PC-foreign", "--json"]).status, 0);
  assert.equal(run(stateDir, ["case", "approve-handoff", "PC-foreign", "--plan", handoffFile, "--expected-fingerprint", handoff.planFingerprint, "--json"]).json.problems[0].code, "CASE_NOT_FOUND");
  const legacy = { schema: "pi-ticket-planning:admission-plan:v1", kind: "STANDALONE", repo: "Notyet1307/example", target: "90", reviewedFingerprint: `sha256:${"b".repeat(64)}`, resources: [], reviewed: { source: { revision: "r1" } } }; legacy.planFingerprint = fingerprint(approvalProjection(legacy));
  const legacyFile = path.join(parent, "legacy.json"); fs.writeFileSync(legacyFile, JSON.stringify(legacy), { mode: 0o600 });
  assert.equal(run(stateDir, ["case", "approve-handoff", "PC-handoff", "--plan", legacyFile, "--expected-fingerprint", legacy.planFingerprint, "--json"]).json.problems[0].code, "INVALID_EXECUTION_HANDOFF_PLAN");
  const status = run(stateDir, ["case", "status", "PC-handoff", "--json"]);
  assert.deepEqual(status.json.data.case.approvals.pending.map(({ id }) => id), [approval.id]);
  const replay = run(stateDir, ["case", "approve-handoff", "PC-handoff", "--plan", handoffFile, "--expected-fingerprint", handoff.planFingerprint, "--json"]);
  assert.equal(replay.status, 1);
  assert.equal(replay.json.problems[0].code, "HANDOFF_APPROVAL_ALREADY_EXISTS");
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
