import { compileExecutionPlan } from "./compiler.mjs";
import { canonical, releasePlanDigest } from "./domain.mjs";
import { assertFreshExecutionInput } from "./freshness.mjs";
import { validateReleasePlan } from "./release-contract.mjs";

function same(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

export function verifyExecutionPlan(plan, input, { readFresh = assertFreshExecutionInput, reloadInput = () => input } = {}) {
  const schemaProblems = validateReleasePlan(plan);
  if (schemaProblems.length > 0) return { status: "CONFLICT", problems: schemaProblems };
  try {
    let current = reloadInput();
    readFresh(current);
    if (!same(compileExecutionPlan(current), plan)) throw new Error("SOURCE_OR_PLAN_DRIFT");
    current = reloadInput();
    readFresh(current);
    if (!same(compileExecutionPlan(current), plan)) throw new Error("SOURCE_OR_PLAN_DRIFT");
    return { status: "READY", planDigest: releasePlanDigest(plan), checkedAt: new Date().toISOString(), problems: [] };
  } catch (error) {
    return { status: "CONFLICT", planDigest: releasePlanDigest(plan), problems: [{ code: error.message }] };
  }
}
