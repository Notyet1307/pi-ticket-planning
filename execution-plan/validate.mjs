import { compileExecutionPlan } from "./compiler.mjs";
import { HANDOFF_PLAN_SCHEMA, fingerprint, handoffProjection } from "./domain.mjs";
import { assertFreshExecutionInput, freshnessDriftCode } from "./freshness.mjs";

function requireFreshness(plan, freshness) {
  const code = freshnessDriftCode(plan.freshness, freshness);
  if (code) throw new Error(code);
}

export function verifyExecutionPlan(plan, input, adapter, { doctor = true, readFresh = assertFreshExecutionInput, reloadInput = () => input } = {}) {
  if (plan?.schema !== HANDOFF_PLAN_SCHEMA) return { status: "CONFLICT", problems: [{ code: plan?.schema === "pi-ticket-planning:execution-handoff-plan:v1" ? "NEEDS_MIGRATION" : "INVALID_EXECUTION_HANDOFF_PLAN" }] };
  if (!plan || fingerprint(handoffProjection(plan)) !== plan.planFingerprint) return { status: "CONFLICT", problems: [{ code: "PLAN_FINGERPRINT_MISMATCH" }] };
  try {
    let currentInput = reloadInput();
    requireFreshness(plan, readFresh(currentInput));
    const config = adapter.config();
    const draft = compileExecutionPlan(currentInput, { controller: config, draft: true });
    const validated = adapter.validatePlan(draft.releasePlan, config.configDigest, config.configIdentity);
    const candidate = compileExecutionPlan(currentInput, { controller: { ...config, planDigest: validated.planDigest, provenance: validated.provenance } });
    if (candidate.planFingerprint !== plan.planFingerprint || JSON.stringify(candidate.releasePlan) !== JSON.stringify(plan.releasePlan)) return { status: "CONFLICT", problems: [{ code: "SOURCE_OR_PLAN_DRIFT" }] };
    if (validated.planDigest !== plan.controllerPlanDigest || config.configDigest !== plan.controller.configDigest
      || validated.provenance.digest !== plan.controller.provenance.digest) return { status: "CONFLICT", problems: [{ code: "CONTROLLER_DIGEST_DRIFT" }] };
    if (doctor) adapter.doctor(config.configDigest, config.configIdentity, validated.provenance.controller, validated.provenance);
    currentInput = reloadInput();
    requireFreshness(plan, readFresh(currentInput));
    const finalCandidate = compileExecutionPlan(currentInput, { controller: { ...config, planDigest: validated.planDigest, provenance: validated.provenance } });
    if (finalCandidate.planFingerprint !== plan.planFingerprint) throw new Error("SOURCE_OR_PLAN_DRIFT");
    return { status: "READY", planFingerprint: plan.planFingerprint, controllerPlanDigest: validated.planDigest, controllerConfigDigest: config.configDigest, controllerRevision: validated.provenance.controller.sourceRevision, controllerSourceManifestDigest: validated.provenance.controller.sourceManifestDigest, controllerBuildDigest: validated.provenance.controller.buildDigest, controllerIdentityDigest: validated.provenance.controller.digest, controllerProvenanceDigest: validated.provenance.digest, checkedAt: new Date().toISOString(), problems: [] };
  } catch (error) {
    const conflict = ["CONTROLLER_CONFIG_DRIFT", "CONTROLLER_DOCTOR_CONFIG_DRIFT", "CONTROLLER_IDENTITY_DRIFT", "CONTROLLER_PROVENANCE_DRIFT", "CONTROLLER_PROVENANCE_MISMATCH"].includes(error.message);
    const code = ["CONTROLLER_IDENTITY_DRIFT", "CONTROLLER_PROVENANCE_MISMATCH"].includes(error.message) ? "CONTROLLER_PROVENANCE_DRIFT" : error.message;
    return { status: conflict || !/^CONTROLLER_/.test(error.message) ? "CONFLICT" : "BLOCKED", planFingerprint: plan?.planFingerprint, problems: [{ code }] };
  }
}
