import { compileExecutionPlan } from "./compiler.mjs";
import { fingerprint, handoffProjection } from "./domain.mjs";

export function verifyExecutionPlan(plan, input, adapter, { doctor = true } = {}) {
  if (!plan || fingerprint(handoffProjection(plan)) !== plan.planFingerprint) return { status: "CONFLICT", problems: [{ code: "PLAN_FINGERPRINT_MISMATCH" }] };
  try {
    const config = adapter.config();
    const draft = compileExecutionPlan(input, { controller: config });
    const validated = adapter.validatePlan(draft.releasePlan);
    const candidate = compileExecutionPlan(input, { controller: { ...config, planDigest: validated.planDigest } });
    if (candidate.planFingerprint !== plan.planFingerprint || JSON.stringify(candidate.releasePlan) !== JSON.stringify(plan.releasePlan)) return { status: "CONFLICT", problems: [{ code: "SOURCE_OR_PLAN_DRIFT" }] };
    if (validated.planDigest !== plan.controllerPlanDigest || config.configDigest !== plan.controller.configDigest) return { status: "CONFLICT", problems: [{ code: "CONTROLLER_DIGEST_DRIFT" }] };
    if (doctor) adapter.doctor();
    return { status: "READY", planFingerprint: plan.planFingerprint, controllerPlanDigest: validated.planDigest, controllerConfigDigest: config.configDigest, checkedAt: new Date().toISOString(), problems: [] };
  } catch (error) {
    return { status: /^CONTROLLER_/.test(error.message) ? "BLOCKED" : "CONFLICT", planFingerprint: plan?.planFingerprint, problems: [{ code: error.message }] };
  }
}
