import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { approvalProjection, fingerprint } from "../admission/domain.mjs";

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
