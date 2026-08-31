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

test("semantic Controller fixtures are accepted without an exact build pin", () => {
  const plan = compileExecutionPlan(executionInput());
  const result = controllerResultFixture({ releaseId: plan.id, baseSha: plan.baseSha });
  assert.deepEqual(validateReleasePlan(plan), []);
  assert.equal(plan.controllerContractVersion, 1);
  assert.deepEqual(validateReleaseResult(result), []);
  assert.deepEqual(ingestControllerResult(result, { releaseId: result.releaseId, planDigest: result.planDigest, baseSha: result.baseSha }), result);
  assert.deepEqual(validateReleasePlan({ ...plan, controllerContractVersion: 2 }), [{ code: "UNSUPPORTED_CONTROLLER_CONTRACT_VERSION" }]);
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
  const controllerPlan = await import(pathToFileURL(path.join(controllerRoot, "dist/src/plan.js")));
  const controllerResult = await import(pathToFileURL(path.join(controllerRoot, "dist/src/release-result.js")));
  const plan = compileExecutionPlan(executionInput());
  const result = controllerResultFixture({ releaseId: plan.id, baseSha: plan.baseSha });
  assert.deepEqual(controllerPlan.validatePlan(plan), plan);
  assert.doesNotThrow(() => controllerResult.assertReleaseResult(result));
});
