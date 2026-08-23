import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DELIVERY_GATE_PLAN_SCHEMA,
  MANAGED_CHECK_NAME,
  MANAGED_RULESET_NAME,
  MANAGED_WORKFLOW_PATH,
  applyDeliveryGatePlan,
  buildEnforcementPlan,
  buildWorkflowPlan,
  createWorkflowAdapter,
  deliveryGateFingerprint,
  inspectGitHubDeliveryGate,
  inspectWorkflowTarget,
  renderManagedRuleset,
  renderManagedWorkflow,
  validateDeliveryGatePlan,
} from "../scripts/delivery-gate.mjs";
import { hashText } from "../scripts/check-delivery-graph.mjs";

const sha = "a".repeat(40);
const script = "scripts/herdr-validate.sh";
const workflowContent = renderManagedWorkflow("main", script);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function workflowSnapshot() {
  return {
    repo: "owner/repo",
    branch: "main",
    baseSha: sha,
    validationScript: { path: script, digest: hashText("#!/bin/sh\nexit 0\n") },
    workflow: {
      path: MANAGED_WORKFLOW_PATH,
      beforeDigest: null,
      afterDigest: hashText(workflowContent),
      content: workflowContent,
    },
  };
}

function enforcementSnapshot() {
  const ruleset = renderManagedRuleset("main", 15368);
  return {
    repo: "owner/repo",
    branch: "main",
    defaultSha: sha,
    workflow: { path: MANAGED_WORKFLOW_PATH, validationScript: script, digest: hashText(workflowContent) },
    check: { name: MANAGED_CHECK_NAME, integrationId: 15368, headSha: sha },
    repositorySettings: {
      before: { allowAutoMerge: false, allowMergeCommit: true },
      after: { allowAutoMerge: true, allowMergeCommit: true },
    },
    ruleset: { id: null, before: null, after: ruleset },
    effective: {
      repositoryAutoMerge: false,
      pullRequestRequired: false,
      strictRequiredStatusChecks: false,
      requiredStatusChecks: [],
      statusCheckSourcesPinned: false,
      bypassActorsPresent: false,
      humanApprovalRequired: false,
      mergeCommitAllowed: true,
      mergeMethodAllowed: false,
    },
  };
}

test("managed workflow is one deterministic checkout plus canonical validation script", () => {
  assert.match(workflowContent, /^# pi-ticket-planning:delivery-gate:v1 validation-script=scripts\/herdr-validate\.sh/mu);
  assert.match(workflowContent, /permissions:\n  contents: read/u);
  assert.match(workflowContent, /actions\/checkout@[a-f0-9]{40}/u);
  assert.match(workflowContent, /run: \.\/scripts\/herdr-validate\.sh/u);
  assert.throws(() => renderManagedWorkflow("main", "../escape.sh"), /safe repository-relative path/);
});

test("delivery-gate CLI rejects duplicate and unknown options before any operation", () => {
  const duplicate = spawnSync(process.execPath, [
    path.resolve("scripts/delivery-gate.mjs"), "plan", "--repo", "owner/repo", "--repo", "other/repo",
  ], { encoding: "utf8" });
  assert.equal(duplicate.status, 2);
  assert.match(duplicate.stderr, /duplicate delivery-gate option --repo/u);

  const unknown = spawnSync(process.execPath, [
    path.resolve("scripts/delivery-gate.mjs"), "plan", "--unsafe", "yes",
  ], { encoding: "utf8" });
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /unknown delivery-gate option --unsafe/u);
});

test("workflow bootstrap inspects an exact tracked executable and writes only the managed file", { concurrency: false }, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pi-ticket-delivery-gate-"));
  const repo = path.join(root, "repo");
  const bin = path.join(root, "bin");
  const previousPath = process.env.PATH;
  try {
    mkdirSync(repo);
    mkdirSync(bin);
    command("git", ["-C", repo, "init", "--quiet", "-b", "main"]);
    command("git", ["-C", repo, "config", "user.email", "gate@example.test"]);
    command("git", ["-C", repo, "config", "user.name", "Gate Test"]);
    mkdirSync(path.join(repo, "scripts"));
    writeFileSync(path.join(repo, script), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    chmodSync(path.join(repo, script), 0o700);
    command("git", ["-C", repo, "add", script]);
    command("git", ["-C", repo, "commit", "--quiet", "-m", "base"]);
    const baseSha = command("git", ["-C", repo, "rev-parse", "HEAD"]).trim();
    command("git", ["-C", repo, "remote", "add", "origin", "https://github.com/acme/demo.git"]);
    const fakeGh = path.join(bin, "gh");
    writeFileSync(fakeGh, [
      "#!/usr/bin/env node",
      "const args = process.argv.slice(2);",
      "if (args[0] === 'repo') process.stdout.write(JSON.stringify({nameWithOwner:'acme/demo',defaultBranchRef:{name:'main'}}));",
      `else if (args[0] === 'api') process.stdout.write(JSON.stringify({sha:${JSON.stringify(baseSha)}}));`,
      "else process.exitCode = 1;",
    ].join("\n"), { mode: 0o700 });
    chmodSync(fakeGh, 0o700);
    process.env.PATH = `${bin}${path.delimiter}${previousPath ?? ""}`;

    const snapshot = inspectWorkflowTarget({ repoRoot: repo, validationScript: script });
    const plan = buildWorkflowPlan(snapshot);
    const applied = applyDeliveryGatePlan(plan, createWorkflowAdapter({ repoRoot: repo, plan }), {
      expectedFingerprint: plan.planFingerprint,
    });

    assert.equal(applied.status, "COMPLETE");
    assert.equal(readFileSync(path.join(repo, MANAGED_WORKFLOW_PATH), "utf8"), workflowContent);
    assert.equal(command("git", ["-C", repo, "status", "--short"]).trim(), "?? .github/");
  } finally {
    process.env.PATH = previousPath;
    rmSync(root, { recursive: true, force: true });
  }
});

test("workflow plan creates one file once and is idempotently recoverable", () => {
  const plan = buildWorkflowPlan(workflowSnapshot());
  let state = workflowSnapshot();
  const adapter = {
    read: () => clone(state),
    writeWorkflow(content) {
      assert.equal(content, workflowContent);
      state.workflow.beforeDigest = state.workflow.afterDigest;
    },
  };

  assert.equal(plan.schema, DELIVERY_GATE_PLAN_SCHEMA);
  assert.equal(validateDeliveryGatePlan(plan).ok, true);
  const applied = applyDeliveryGatePlan(plan, adapter, { expectedFingerprint: plan.planFingerprint });
  assert.deepEqual(applied.changed, ["write_file"]);
  assert.equal(applied.status, "COMPLETE");
  const recovered = applyDeliveryGatePlan(plan, adapter, { expectedFingerprint: plan.planFingerprint });
  assert.deepEqual(recovered.recovered, ["write_file"]);
  assert.equal(recovered.status, "COMPLETE");

  const tampered = clone(plan);
  tampered.workflow.content += "# unsafe\n";
  assert.equal(validateDeliveryGatePlan(tampered).ok, false);
  assert.notEqual(deliveryGateFingerprint(tampered), plan.planFingerprint);
});

test("workflow apply recovers an ambiguous write only after exact readback", () => {
  const plan = buildWorkflowPlan(workflowSnapshot());
  let state = workflowSnapshot();
  const applied = applyDeliveryGatePlan(plan, {
    read: () => clone(state),
    writeWorkflow() {
      state.workflow.beforeDigest = state.workflow.afterDigest;
      throw new Error("connection lost after write");
    },
  }, { expectedFingerprint: plan.planFingerprint });

  assert.equal(applied.status, "COMPLETE");
  assert.deepEqual(applied.changed, []);
  assert.deepEqual(applied.recovered, ["write_file"]);
});

test("enforcement plan rolls repository settings and ruleset forward with readback", () => {
  const plan = buildEnforcementPlan(enforcementSnapshot());
  let state = enforcementSnapshot();
  const adapter = {
    read: () => clone(state),
    setRepositorySettings(value) {
      state.repositorySettings.before = clone(value);
      state.effective.repositoryAutoMerge = true;
    },
    putRuleset(id, value) {
      assert.equal(id, null);
      state.ruleset = { id: 71, before: clone(value), after: clone(value) };
      state.effective = {
        repositoryAutoMerge: true,
        pullRequestRequired: true,
        strictRequiredStatusChecks: true,
        requiredStatusChecks: [MANAGED_CHECK_NAME],
        statusCheckSourcesPinned: true,
        bypassActorsPresent: false,
        humanApprovalRequired: false,
        mergeCommitAllowed: true,
        mergeMethodAllowed: true,
      };
    },
  };

  const applied = applyDeliveryGatePlan(plan, adapter, { expectedFingerprint: plan.planFingerprint });
  assert.equal(applied.status, "COMPLETE");
  assert.deepEqual(applied.changed, ["ruleset", "repository_settings"]);
  assert.equal(state.ruleset.id, 71);

  const recovered = applyDeliveryGatePlan(plan, adapter, { expectedFingerprint: plan.planFingerprint });
  assert.equal(recovered.status, "COMPLETE");
  assert.deepEqual(recovered.recovered, ["ruleset", "repository_settings"]);
});

test("a self-consistent plan still cannot grant a ruleset bypass", () => {
  const snapshot = enforcementSnapshot();
  snapshot.ruleset.after.bypass_actors = [{ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" }];
  const malicious = buildEnforcementPlan(snapshot);

  assert.equal(validateDeliveryGatePlan(malicious).ok, false);
});

test("enforcement apply recovers ambiguous GitHub writes through the same Plan", () => {
  const plan = buildEnforcementPlan(enforcementSnapshot());
  let state = enforcementSnapshot();
  const adapter = {
    read: () => clone(state),
    setRepositorySettings(value) {
      state.repositorySettings.before = clone(value);
      state.effective.repositoryAutoMerge = true;
      throw new Error("HTTP response lost after repository update");
    },
    putRuleset(_id, value) {
      state.ruleset = { id: 71, before: clone(value), after: clone(value) };
      state.effective = {
        repositoryAutoMerge: true,
        pullRequestRequired: true,
        strictRequiredStatusChecks: true,
        requiredStatusChecks: [MANAGED_CHECK_NAME],
        statusCheckSourcesPinned: true,
        bypassActorsPresent: false,
        humanApprovalRequired: false,
        mergeCommitAllowed: true,
        mergeMethodAllowed: true,
      };
      throw new Error("HTTP response lost after ruleset update");
    },
  };

  const applied = applyDeliveryGatePlan(plan, adapter, { expectedFingerprint: plan.planFingerprint });
  assert.equal(applied.status, "COMPLETE");
  assert.deepEqual(applied.changed, []);
  assert.deepEqual(applied.recovered, ["ruleset", "repository_settings"]);
});

test("repository-setting failure leaves the required ruleset active and reports PARTIAL", () => {
  const plan = buildEnforcementPlan(enforcementSnapshot());
  let state = enforcementSnapshot();
  const applied = applyDeliveryGatePlan(plan, {
    read: () => clone(state),
    putRuleset(_id, value) {
      state.ruleset = { id: 71, before: clone(value), after: clone(value) };
      state.effective = {
        ...state.effective,
        pullRequestRequired: true,
        strictRequiredStatusChecks: true,
        requiredStatusChecks: [MANAGED_CHECK_NAME],
        statusCheckSourcesPinned: true,
        mergeMethodAllowed: true,
      };
    },
    setRepositorySettings() {
      throw new Error("repository settings rejected");
    },
  }, { expectedFingerprint: plan.planFingerprint });

  assert.equal(applied.status, "PARTIAL");
  assert.deepEqual(applied.changed, ["ruleset"]);
  assert.equal(state.effective.pullRequestRequired, true);
  assert.equal(state.effective.repositoryAutoMerge, false);
});

test("effective gate projection exposes bypass and unpinned checks without raw rules", () => {
  const responses = new Map([
    ["repos/owner/repo", { allow_auto_merge: true, allow_merge_commit: true }],
    ["repos/owner/repo/rules/branches/main", [
      {
        type: "required_status_checks",
        ruleset_id: 7,
        parameters: {
          strict_required_status_checks_policy: true,
          required_status_checks: [{ context: MANAGED_CHECK_NAME, integration_id: null }],
        },
      },
      {
        type: "pull_request",
        ruleset_id: 7,
        parameters: {
          required_approving_review_count: 0,
          required_reviewers: [],
          require_code_owner_review: false,
          require_last_push_approval: false,
          allowed_merge_methods: ["merge"],
        },
      },
    ]],
    ["repos/owner/repo/rulesets/7", { enforcement: "active", bypass_actors: [{ actor_type: "RepositoryRole", actor_id: 5 }] }],
  ]);
  const gate = inspectGitHubDeliveryGate({
    repo: "owner/repo",
    branch: "main",
    api: (endpoint) => clone(responses.get(endpoint)),
  });

  assert.equal(gate.repositoryAutoMerge, true);
  assert.equal(gate.statusCheckSourcesPinned, false);
  assert.equal(gate.bypassActorsPresent, true);
  assert.deepEqual(gate.requiredStatusChecks, [MANAGED_CHECK_NAME]);
});

test("delivery-gate results redact credential-shaped adapter failures", () => {
  const plan = buildWorkflowPlan(workflowSnapshot());
  const applied = applyDeliveryGatePlan(plan, {
    read() {
      throw new Error("https://user:secret@example.test?access_token=ghp_DO_NOT_PRINT");
    },
  }, { expectedFingerprint: plan.planFingerprint });

  assert.equal(applied.status, "CONFLICT");
  assert.equal(JSON.stringify(applied).includes("DO_NOT_PRINT"), false);
  assert.equal(JSON.stringify(applied).includes("user:secret"), false);
});

function command(executable, args) {
  const result = spawnSync(executable, args, { encoding: "utf8" });
  assert.equal(result.status, 0, `${executable} ${args.join(" ")}\n${result.stderr}`);
  return result.stdout;
}
