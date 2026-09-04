import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateLocalSchema } from "../protocol/schema-runtime.mjs";
import { fingerprint, releasePlanDigest } from "./domain.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLAN_SCHEMA = "schemas/herdr-codex-release-plan.schema.json";
const RESULT_SCHEMA = "schemas/herdr-codex-release-result-v1.schema.json";
const GOAL_HANDOFF_SCHEMA_PATH = "schemas/goal-handoff-v1.schema.json";
const GOAL_RESULT_SCHEMA_PATH = "schemas/goal-release-result-v1.schema.json";
const GOAL_RESULT_ACCEPTANCE_SCHEMA_PATH = "schemas/goal-result-acceptance-v1.schema.json";

export const CONTROLLER_CONTRACT_VERSION = 1;
export const RELEASE_RESULT_SCHEMA = "herdr-codex-controller:release-result:v1";
export const GOAL_HANDOFF_SCHEMA = "pi-ticket-planning:goal-handoff:v1";
export const GOAL_RELEASE_RESULT_SCHEMA = "pi-ticket-planning:goal-release-result:v1";
export const GOAL_RESULT_ACCEPTANCE_SCHEMA = "pi-ticket-planning:goal-result-acceptance:v1";

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

export function validateGoalHandoff(value) {
  if (value?.schema !== GOAL_HANDOFF_SCHEMA) return [{ code: "UNSUPPORTED_GOAL_HANDOFF_CONTRACT" }];
  const problems = validateLocalSchema(value, GOAL_HANDOFF_SCHEMA_PATH, { root: ROOT }).problems;
  if (value?.planDigest !== undefined && value?.releasePlan !== undefined
    && value.planDigest !== releasePlanDigest(value.releasePlan)) problems.push({ code: "GOAL_HANDOFF_PLAN_DIGEST_MISMATCH" });
  if (value?.releasePlan && (value.releaseId !== value.releasePlan.id || value.repo !== value.releasePlan.repo
    || value.baseSha !== value.releasePlan.baseSha)) problems.push({ code: "GOAL_HANDOFF_PLAN_BINDING_MISMATCH" });
  return problems;
}

export function validateGoalReleaseResult(value) {
  if (value?.schema !== GOAL_RELEASE_RESULT_SCHEMA) return [{ code: "UNSUPPORTED_GOAL_RELEASE_RESULT_CONTRACT" }];
  const problems = validateLocalSchema(value, GOAL_RESULT_SCHEMA_PATH, { root: ROOT }).problems;
  if (!canonicalTime(value?.completedAt)) problems.push({ code: "RELEASE_RESULT_COMPLETED_AT_INVALID" });
  return problems;
}

export function validateGoalResultAcceptance(value) {
  if (value?.schema !== GOAL_RESULT_ACCEPTANCE_SCHEMA) return [{ code: "UNSUPPORTED_GOAL_RESULT_ACCEPTANCE_CONTRACT" }];
  const problems = validateLocalSchema(value, GOAL_RESULT_ACCEPTANCE_SCHEMA_PATH, { root: ROOT }).problems;
  const { digest, ...body } = value ?? {};
  if (digest !== fingerprint(body)) problems.push({ code: "GOAL_RESULT_ACCEPTANCE_DIGEST_MISMATCH" });
  if (!canonicalTime(value?.acceptedAt)) problems.push({ code: "GOAL_RESULT_ACCEPTED_AT_INVALID" });
  problems.push(...validateGoalReleaseResult(value?.result));
  if (value?.result && (value.handoff?.digest !== value.result.handoffDigest
    || value.handoff?.channel !== value.result.channel || value.handoff?.runnerRef !== value.result.runnerRef)) {
    problems.push({ code: "GOAL_RESULT_ACCEPTANCE_BINDING_MISMATCH" });
  }
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
