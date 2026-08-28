import { compileExecutionPlan } from "./compiler.mjs";
import { fingerprint, handoffProjection } from "./domain.mjs";

export function verifyExecutionPlan(plan, input, adapter, { doctor = true } = {}) {
  if (!plan || fingerprint(handoffProjection(plan)) !== plan.planFingerprint) return { status: "CONFLICT", problems: [{ code: "PLAN_FINGERPRINT_MISMATCH" }] };
  try {
    const config = adapter.config();
    const draft = compileExecutionPlan(input, { controller: config });
    const validated = adapter.validatePlan(draft.releasePlan, config.configDigest, config.configIdentity);
    const candidate = compileExecutionPlan(input, { controller: { ...config, planDigest: validated.planDigest, provenance: validated.provenance } });
    if (candidate.planFingerprint !== plan.planFingerprint || JSON.stringify(candidate.releasePlan) !== JSON.stringify(plan.releasePlan)) return { status: "CONFLICT", problems: [{ code: "SOURCE_OR_PLAN_DRIFT" }] };
    if (validated.planDigest !== plan.controllerPlanDigest || config.configDigest !== plan.controller.configDigest
      || validated.provenance.digest !== plan.controller.provenance.digest) return { status: "CONFLICT", problems: [{ code: "CONTROLLER_DIGEST_DRIFT" }] };
    if (doctor) adapter.doctor(config.configDigest, config.configIdentity, validated.provenance.controller);
    return { status: "READY", planFingerprint: plan.planFingerprint, controllerPlanDigest: validated.planDigest, controllerConfigDigest: config.configDigest, controllerRevision: validated.provenance.controller.sourceRevision, controllerSourceManifestDigest: validated.provenance.controller.sourceManifestDigest, controllerBuildDigest: validated.provenance.controller.buildDigest, controllerIdentityDigest: validated.provenance.controller.digest, controllerProvenanceDigest: validated.provenance.digest, checkedAt: new Date().toISOString(), problems: [] };
  } catch (error) {
    const conflict = ["CONTROLLER_CONFIG_DRIFT", "CONTROLLER_DOCTOR_CONFIG_DRIFT", "CONTROLLER_IDENTITY_DRIFT", "CONTROLLER_PROVENANCE_DRIFT", "CONTROLLER_PROVENANCE_MISMATCH"].includes(error.message);
    return { status: conflict || !/^CONTROLLER_/.test(error.message) ? "CONFLICT" : "BLOCKED", planFingerprint: plan?.planFingerprint, problems: [{ code: error.message }] };
  }
}
