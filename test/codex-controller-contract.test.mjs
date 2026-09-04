import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { compileExecutionPlan } from "../execution-plan/compiler.mjs";
import { validateReleasePlan, validateReleaseResult } from "../execution-plan/release-contract.mjs";
import { ingestControllerResult } from "../execution-plan/release-result-ingest.mjs";
import { executionInput } from "./execution-plan-fixture.mjs";
import { controllerResultFixture } from "./controller-result-fixture.mjs";
import { buildGoalHandoff } from "../execution-plan/goal-handoff.mjs";
import { fingerprint } from "../execution-plan/domain.mjs";

test("semantic Controller fixtures are accepted without an exact build pin", () => {
  const plan = compileExecutionPlan(executionInput());
  const result = controllerResultFixture({ releaseId: plan.id, baseSha: plan.baseSha });
  assert.deepEqual(validateReleasePlan(plan), []);
  assert.equal(plan.controllerContractVersion, 2);
  assert.deepEqual(validateReleaseResult(result), []);
  assert.deepEqual(ingestControllerResult(result, { releaseId: result.releaseId, planDigest: result.planDigest, baseSha: result.baseSha }), result);
  assert.deepEqual(validateReleasePlan({ ...plan, controllerContractVersion: 1 }), [{ code: "UNSUPPORTED_CONTROLLER_CONTRACT_VERSION" }]);
  assert.deepEqual(validateReleaseResult({ ...result, schema: "herdr-codex-controller:release-result:v2" }), [{ code: "UNSUPPORTED_RELEASE_RESULT_CONTRACT" }]);
});

test("Planner fixtures validate in the checked-out Controller", { skip: !process.env.HERDR_CONTROLLER_ROOT }, async () => {
  const controllerRoot = path.resolve(process.env.HERDR_CONTROLLER_ROOT);
  assert.deepEqual(
    fs.readFileSync(path.resolve("schemas/herdr-codex-release-plan.schema.json")),
    fs.readFileSync(path.join(controllerRoot, "schemas/release-plan.schema.json")),
  );
  assert.deepEqual(
    fs.readFileSync(path.resolve("schemas/herdr-codex-release-result-v1.schema.json")),
    fs.readFileSync(path.join(controllerRoot, "schemas/release-result-v1.schema.json")),
  );
  assert.deepEqual(
    fs.readFileSync(path.resolve("schemas/goal-release-result-v1.schema.json")),
    fs.readFileSync(path.join(controllerRoot, "schemas/goal-release-result-v1.schema.json")),
  );
  const controllerPlan = await import(pathToFileURL(path.join(controllerRoot, "dist/src/plan.js")));
  const controllerResult = await import(pathToFileURL(path.join(controllerRoot, "dist/src/release-result.js")));
  const controllerStatus = await import(pathToFileURL(path.join(controllerRoot, "dist/src/public-status.js")));
  const controllerGoal = await import(pathToFileURL(path.join(controllerRoot, "dist/src/goal-state.js")));
  const plan = compileExecutionPlan(executionInput());
  const result = controllerResultFixture({ releaseId: plan.id, baseSha: plan.baseSha });
  assert.deepEqual(controllerPlan.validatePlan(plan), plan);
  assert.doesNotThrow(() => controllerResult.assertReleaseResult(result));
  const runner = { ref: "local", transport: "local", host: "test.local", sshHost: null, runnerCli: "/runner/goal-cli.js", runnerConfig: "/private/goal.json" };
  const goalHandoff = buildGoalHandoff({ plan, channel: "GOAL_LOCAL", runnerRef: "local", runnerDigest: fingerprint(runner), runnerHost: runner.host });
  assert.deepEqual(controllerGoal.validateGoalHandoff(goalHandoff), goalHandoff);
  const goalResult = {
    ...result,
    schema: "pi-ticket-planning:goal-release-result:v1",
    channel: "GOAL_LOCAL",
    runnerRef: "local",
    handoffDigest: fingerprint(goalHandoff),
    reviewReportDigest: `sha256:${"f".repeat(64)}`,
  };
  assert.doesNotThrow(() => controllerGoal.assertGoalReleaseResult(goalResult));

  const fixture = JSON.parse(fs.readFileSync(path.resolve("fixtures/controller-public-status-cases.json"), "utf8"));
  const config = {
    repo: fixture.approvedPlan.repo,
    localPath: "/private/controller-source",
    stateDir: "/private/controller-state",
    worktreeRoot: "/private/controller-worktrees",
    codex: { bin: "/private/bin/codex" },
    validation: { sandbox: { bin: "/private/bin/codex", root: "/private/controller-sandbox" } },
  };
  const baseJob = {
    ...fixture.baseStatus,
    configPath: "/private/controller.json",
    planPath: "/private/release-plan.json",
    worktreePath: "/private/controller-worktrees/release-fixture",
  };
  for (const item of fixture.cases.filter(({ statusPatch }) => statusPatch)) {
    let status;
    const sourceJob = {
      ...baseJob,
      ...item.statusPatch,
      plan: { ...baseJob.plan, ...(item.planPatch ?? {}) },
    };
    if (item.sourceLegacyBlockedKindMissing) delete sourceJob.blocked.kind;
    try { status = controllerStatus.publicStatus(config, sourceJob); }
    catch {
      assert.equal(item.expected.controller, "STATUS_UNAVAILABLE", item.id);
      continue;
    }
    if (item.sourceLegacyBlockedKindMissing) {
      assert.equal(status.legacy, true);
      assert.equal(status.blocked.kind, "recoverable");
    }
    const bindingsMatch = status.releaseId === fixture.approvedPlan.id
      && status.repo === fixture.approvedPlan.repo
      && status.planDigest === fixture.approvedPlan.planDigest
      && status.baseSha === fixture.approvedPlan.baseSha;
    const route = !bindingsMatch
      ? "STATUS_UNAVAILABLE"
      : status.status === "running"
        ? "RUNNING"
        : status.status === "completed"
          ? "COMPLETED"
          : status.status === "failed"
            ? "FAILED"
            : status.blocked?.kind === "recoverable"
              ? "BLOCKED_RECOVERABLE"
              : status.blocked?.kind === "manual"
                ? "BLOCKED_MANUAL"
                : status.blocked?.kind === "replan_required"
                  ? "BLOCKED_REPLAN_REQUIRED"
                  : "STATUS_UNAVAILABLE";
    assert.equal(route, item.expected.controller, item.id);
    const publicBytes = JSON.stringify(status);
    assert.equal(/job\.json|configPath|planPath|worktreePath|stateDir|detailsPath|promptPath|stderrPath/u.test(publicBytes), false);
    for (const privatePath of [config.localPath, config.stateDir, config.worktreeRoot, config.validation.sandbox.root]) {
      assert.equal(publicBytes.includes(privatePath), false);
    }
  }
});
