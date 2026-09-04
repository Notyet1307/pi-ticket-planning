import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertCanonicalAbsentChildPath, assertCanonicalPrivateExistingFile, assertCanonicalPublicExistingFile } from "./private-paths.mjs";
import {
  GOAL_RESULT_ACCEPTANCE_SCHEMA,
  assertReleasePlan,
  validateGoalHandoff,
  validateGoalReleaseResult,
  validateGoalResultAcceptance,
  validateReleaseResult,
} from "./release-contract.mjs";
import { fingerprint, releasePlanDigest } from "./domain.mjs";

function problem(code) { return { code }; }

export function validateControllerResult(value, expected = {}) {
  const problems = validateReleaseResult(value);
  if (expected.releaseId !== undefined && value?.releaseId !== expected.releaseId) problems.push(problem("RELEASE_RESULT_RELEASE_MISMATCH"));
  if (expected.planDigest !== undefined && value?.planDigest !== expected.planDigest) problems.push(problem("RELEASE_RESULT_PLAN_MISMATCH"));
  if (expected.baseSha !== undefined && value?.baseSha !== expected.baseSha) problems.push(problem("RELEASE_RESULT_BASE_MISMATCH"));
  return problems;
}

export function ingestControllerResult(value, expected = {}) {
  if (!expected.releaseId || !expected.planDigest || !expected.baseSha) throw new Error("RELEASE_RESULT_BINDING_REQUIRED");
  const problems = validateControllerResult(value, expected);
  if (problems.length > 0) throw new Error(problems[0].code);
  return structuredClone(value);
}

export function validateGoalResult(value, expected = {}) {
  const problems = validateGoalReleaseResult(value);
  if (expected.releaseId !== undefined && value?.releaseId !== expected.releaseId) problems.push(problem("RELEASE_RESULT_RELEASE_MISMATCH"));
  if (expected.planDigest !== undefined && value?.planDigest !== expected.planDigest) problems.push(problem("RELEASE_RESULT_PLAN_MISMATCH"));
  if (expected.baseSha !== undefined && value?.baseSha !== expected.baseSha) problems.push(problem("RELEASE_RESULT_BASE_MISMATCH"));
  if (expected.channel !== undefined && value?.channel !== expected.channel) problems.push(problem("GOAL_RESULT_CHANNEL_MISMATCH"));
  if (expected.runnerRef !== undefined && value?.runnerRef !== expected.runnerRef) problems.push(problem("GOAL_RESULT_RUNNER_MISMATCH"));
  if (expected.handoffDigest !== undefined && value?.handoffDigest !== expected.handoffDigest) problems.push(problem("GOAL_RESULT_HANDOFF_MISMATCH"));
  return problems;
}

export function validateExecutionResult(value, expected = {}) {
  if (value?.schema === "herdr-codex-controller:release-result:v1") return validateControllerResult(value, expected);
  if (value?.schema === "pi-ticket-planning:goal-release-result:v1") return validateGoalResult(value, expected);
  return [problem("UNSUPPORTED_RELEASE_RESULT_CONTRACT")];
}

export function ingestExecutionResult(value, expected = {}) {
  if (!expected.releaseId || !expected.planDigest || !expected.baseSha) throw new Error("RELEASE_RESULT_BINDING_REQUIRED");
  if (value?.schema === "pi-ticket-planning:goal-release-result:v1"
    && (!expected.channel || !expected.runnerRef || !expected.handoffDigest)) throw new Error("GOAL_RESULT_HANDOFF_BINDING_REQUIRED");
  const problems = validateExecutionResult(value, expected);
  if (problems.length > 0) throw new Error(problems[0].code);
  return structuredClone(value);
}

export function buildGoalResultAcceptance(result, handoff, { acceptedAt = new Date().toISOString() } = {}) {
  const handoffProblems = validateGoalHandoff(handoff);
  if (handoffProblems.length) throw new Error(handoffProblems[0].code);
  const acceptedResult = ingestExecutionResult(result, {
    releaseId: handoff.releaseId,
    planDigest: handoff.planDigest,
    baseSha: handoff.baseSha,
    channel: handoff.channel,
    runnerRef: handoff.runnerRef,
    handoffDigest: fingerprint(handoff),
  });
  const body = {
    schema: GOAL_RESULT_ACCEPTANCE_SCHEMA,
    result: acceptedResult,
    handoff: { digest: fingerprint(handoff), channel: handoff.channel, runnerRef: handoff.runnerRef },
    acceptedAt,
  };
  const acceptance = { ...body, digest: fingerprint(body) };
  const problems = validateGoalResultAcceptance(acceptance);
  if (problems.length) throw new Error(problems[0].code);
  return acceptance;
}

function options(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--json") {
      if (values.has("json")) throw new Error("INVALID_OPTIONS");
      values.set("json", true); continue;
    }
    if (!key?.startsWith("--") || values.has(key.slice(2))) throw new Error("INVALID_OPTIONS");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error("INVALID_OPTIONS");
    values.set(key.slice(2), value); index += 1;
  }
  for (const key of values.keys()) if (!["result", "plan", "handoff", "out", "json"].includes(key)) throw new Error(`UNKNOWN_OPTION:${key}`);
  if (!values.has("result")) throw new Error("MISSING_OPTION:result");
  if (!values.has("plan")) throw new Error("MISSING_OPTION:plan");
  return values;
}

export function runControllerResultIngestion(argv = process.argv.slice(2)) {
  try {
    const values = options(argv);
    let input;
    try { input = assertCanonicalPublicExistingFile(path.resolve(values.get("result")), "CONTROLLER_RESULT"); }
    catch { throw new Error("CONTROLLER_RESULT_INPUT_NOT_PUBLIC"); }
    let planPath;
    try { planPath = assertCanonicalPrivateExistingFile(path.resolve(values.get("plan")), "RELEASE_PLAN", { mode: 0o600 }); }
    catch { throw new Error("RELEASE_PLAN_INPUT_NOT_PRIVATE"); }
    const plan = assertReleasePlan(JSON.parse(fs.readFileSync(planPath, "utf8")));
    const rawResult = JSON.parse(fs.readFileSync(input, "utf8"));
    const expected = {
      releaseId: plan.id,
      planDigest: releasePlanDigest(plan),
      baseSha: plan.baseSha,
    };
    let goalHandoff = null;
    if (rawResult?.schema === "pi-ticket-planning:goal-release-result:v1") {
      if (!values.has("handoff")) throw new Error("GOAL_RESULT_HANDOFF_BINDING_REQUIRED");
      let handoffPath;
      try { handoffPath = assertCanonicalPrivateExistingFile(path.resolve(values.get("handoff")), "GOAL_HANDOFF", { mode: 0o600 }); }
      catch { throw new Error("GOAL_HANDOFF_INPUT_NOT_PRIVATE"); }
      const handoff = JSON.parse(fs.readFileSync(handoffPath, "utf8"));
      const handoffProblems = validateGoalHandoff(handoff);
      if (handoffProblems.length > 0) throw new Error(handoffProblems[0].code);
      if (handoff.releaseId !== plan.id || handoff.planDigest !== releasePlanDigest(plan) || handoff.baseSha !== plan.baseSha) {
        throw new Error("GOAL_HANDOFF_PLAN_BINDING_MISMATCH");
      }
      Object.assign(expected, { channel: handoff.channel, runnerRef: handoff.runnerRef, handoffDigest: fingerprint(handoff) });
      goalHandoff = handoff;
    } else if (values.has("handoff")) throw new Error("UNEXPECTED_GOAL_HANDOFF_BINDING");
    const result = ingestExecutionResult(rawResult, expected);
    const accepted = goalHandoff ? buildGoalResultAcceptance(result, goalHandoff) : result;
    const output = `${JSON.stringify(accepted, null, 2)}\n`;
    if (!values.has("out") || values.get("out") === "-") process.stdout.write(output);
    else {
      const target = assertCanonicalAbsentChildPath(path.resolve(values.get("out")), "OUTPUT", "OUTPUT_PARENT");
      fs.writeFileSync(target, output, { encoding: "utf8", mode: 0o600, flag: "wx" });
      fs.chmodSync(target, 0o600);
      assertCanonicalPrivateExistingFile(target, "OUTPUT", { mode: 0o600 });
      if (values.has("json")) process.stdout.write(`${JSON.stringify(accepted)}\n`);
    }
    return 0;
  } catch (error) {
    process.stderr.write(`ERROR ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runControllerResultIngestion();
}
