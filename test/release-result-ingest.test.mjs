import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { ingestControllerResult, validateControllerResult } from "../execution-plan/release-result-ingest.mjs";
import { compileExecutionPlan } from "../execution-plan/compiler.mjs";
import { releasePlanDigest } from "../execution-plan/domain.mjs";
import { controllerResultFixture } from "./controller-result-fixture.mjs";
import { executionInput } from "./execution-plan-fixture.mjs";

const codes = (problems) => problems.map(({ code }) => code);

test("Controller Release Result v1 ingests without build identity coupling", () => {
  const result = controllerResultFixture();
  const expected = { releaseId: result.releaseId, planDigest: result.planDigest, baseSha: result.baseSha };
  assert.deepEqual(validateControllerResult(result), []);
  assert.throws(() => ingestControllerResult(result), /RELEASE_RESULT_BINDING_REQUIRED/);
  assert.deepEqual(ingestControllerResult(result, expected), result);
  assert.deepEqual(ingestControllerResult(result, expected), ingestControllerResult(result, expected));
  assert.equal("controllerProvenance" in result, false);
  assert.equal("identityHistory" in result, false);
  assert.equal("privateJob" in result, false);
});

test("Release Result bindings and contract major fail closed", () => {
  const result = controllerResultFixture();
  assert.deepEqual(codes(validateControllerResult(result, { releaseId: "other" })), ["RELEASE_RESULT_RELEASE_MISMATCH"]);
  assert.deepEqual(codes(validateControllerResult(result, { planDigest: "0".repeat(64) })), ["RELEASE_RESULT_PLAN_MISMATCH"]);
  assert.deepEqual(codes(validateControllerResult(result, { baseSha: "0".repeat(40) })), ["RELEASE_RESULT_BASE_MISMATCH"]);
  assert.deepEqual(codes(validateControllerResult({ ...result, schema: "herdr-codex-controller:release-result:v2" })), ["UNSUPPORTED_RELEASE_RESULT_CONTRACT"]);
  for (const mutate of [
    (value) => { value.status = "ready"; },
    (value) => { value.requiredChecks.status = "pending"; },
    (value) => { value.requiredChecks.names = []; },
    (value) => { value.privatePath = "/private/job.json"; },
    (value) => { value.completedAt = "not-a-time"; },
  ]) {
    const invalid = structuredClone(result);
    mutate(invalid);
    assert.notEqual(validateControllerResult(invalid).length, 0);
    assert.throws(() => ingestControllerResult(invalid, { releaseId: result.releaseId, planDigest: result.planDigest, baseSha: result.baseSha }));
  }
});

test("result ingestion CLI accepts only a safe public artifact and writes exact private bytes", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "release-result-ingest-"));
  t.after(() => {
    try { chmodSync(path.join(root, "output"), 0o700); } catch {}
    rmSync(root, { recursive: true, force: true });
  });
  const resultPath = path.join(root, "release-result.json");
  const planPath = path.join(root, "release-plan.json");
  const outputRoot = path.join(root, "output");
  const outputPath = path.join(outputRoot, "accepted-result.json");
  mkdirSync(outputRoot, { mode: 0o700 });
  const plan = compileExecutionPlan(executionInput());
  const resultFixture = controllerResultFixture({ releaseId: plan.id, planDigest: releasePlanDigest(plan), baseSha: plan.baseSha });
  writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(resultPath, `${JSON.stringify(resultFixture, null, 2)}\n`, { mode: 0o644 });
  const cli = path.resolve("execution-plan", "release-result-ingest.mjs");
  const run = spawnSync(process.execPath, [cli, "--result", resultPath, "--plan", planPath, "--out", outputPath, "--json"], { cwd: path.resolve("."), encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(readFileSync(outputPath, "utf8")), resultFixture);
  assert.equal(statSync(outputPath).mode & 0o777, 0o600);
  assert.equal(run.stdout.includes(root), false);

  const privateResult = path.join(root, "private-result.json");
  writeFileSync(privateResult, `${JSON.stringify(resultFixture)}\n`, { mode: 0o600 });
  assert.match(spawnSync(process.execPath, [cli, "--result", privateResult, "--plan", planPath], { encoding: "utf8" }).stderr, /CONTROLLER_RESULT_INPUT_NOT_PUBLIC/);
  const link = path.join(root, "result-link.json");
  symlinkSync(resultPath, link);
  assert.match(spawnSync(process.execPath, [cli, "--result", link, "--plan", planPath], { encoding: "utf8" }).stderr, /CONTROLLER_RESULT_INPUT_NOT_PUBLIC/);

  const wrong = path.join(root, "wrong-result.json");
  writeFileSync(wrong, `${JSON.stringify({ ...resultFixture, planDigest: "0".repeat(64) })}\n`, { mode: 0o644 });
  assert.match(spawnSync(process.execPath, [cli, "--result", wrong, "--plan", planPath], { encoding: "utf8" }).stderr, /RELEASE_RESULT_PLAN_MISMATCH/);
});
