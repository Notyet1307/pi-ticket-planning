import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateLocalSchema } from "../protocol/schema-runtime.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLAN_SCHEMA = "schemas/herdr-codex-release-plan.schema.json";
const RESULT_SCHEMA = "schemas/herdr-codex-release-result-v1.schema.json";

export const CONTROLLER_CONTRACT_VERSION = 1;
export const RELEASE_RESULT_SCHEMA = "herdr-codex-controller:release-result:v1";

export function validateReleasePlan(value) {
  if (value?.controllerContractVersion !== CONTROLLER_CONTRACT_VERSION) {
    return [{ code: "UNSUPPORTED_CONTROLLER_CONTRACT_VERSION" }];
  }
  return validateLocalSchema(value, PLAN_SCHEMA, { root: ROOT }).problems;
}

export function validateReleaseResult(value) {
  if (value?.schema !== RELEASE_RESULT_SCHEMA) return [{ code: "UNSUPPORTED_RELEASE_RESULT_CONTRACT" }];
  const problems = validateLocalSchema(value, RESULT_SCHEMA, { root: ROOT }).problems;
  if (!canonicalTime(value?.completedAt)) problems.push({ code: "RELEASE_RESULT_COMPLETED_AT_INVALID" });
  return problems;
}

export function assertReleasePlan(value) {
  const problems = validateReleasePlan(value);
  if (problems.length > 0) throw new Error(problems[0].code);
  return value;
}

export function assertReleaseResult(value) {
  const problems = validateReleaseResult(value);
  if (problems.length > 0) throw new Error(problems[0].code);
  return value;
}

function canonicalTime(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
