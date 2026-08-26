import { finalizeReport } from "../integration/report.mjs";

function metadata(context, tier) {
  const required = ["reportId", "packageVersion", "headSha", "treeSha", "workflowName", "workflowRunId", "workflowRunAttempt", "workflowRunUrl", "repository", "actor", "runner", "provider", "model", "thinking", "piVersion", "piDigest", "subagentVersion", "profileDigest", "harnessVersion", "harnessDigest", "observedAt", "expiresAt", "evidenceDigests"];
  if (!context || required.some((field) => context[field] === undefined)) throw new Error("LEGACY_PROVENANCE_UNAVAILABLE");
  return Object.fromEntries([...required.map((field) => [field, context[field]]), ["tier", tier]]);
}

export function migrateE2EReportV1(value, context) {
  if (value?.schema !== "pi-ticket-planning:e2e-report:v1" || !Array.isArray(context?.scenarios)
    || !context.setup || !context.harnessEvidence || !context.providerEvidence || !context.githubAppEvidence || !context.cleanup) throw new Error("LEGACY_PROVENANCE_UNAVAILABLE");
  return finalizeReport({
    ...value,
    schema: "pi-ticket-planning:e2e-report:v2",
    ...metadata(context, "L3_REAL_DISPOSABLE_INTEGRATION"),
    scenarios: context.scenarios,
    setup: context.setup,
    harnessEvidence: context.harnessEvidence,
    providerEvidence: context.providerEvidence,
    githubAppEvidence: context.githubAppEvidence,
    cleanup: context.cleanup,
  });
}

export function migrateLiveEvalV3(value, context) {
  if (value?.schema !== "pi-ticket-planning:live-eval:v3") throw new Error("INVALID_LEGACY_ARTIFACT");
  return finalizeReport({ ...value, schema: "pi-ticket-planning:live-eval:v4", ...metadata(context, "L2_REAL_MODEL") });
}

export function migrateReleaseQualificationV1(value, context) {
  if (value?.schema !== "pi-ticket-planning:release-qualification:v1" || !Array.isArray(context?.tuples) || !Array.isArray(context?.evidenceRefs)) throw new Error("LEGACY_PROVENANCE_UNAVAILABLE");
  return finalizeReport({ ...value, schema: "pi-ticket-planning:release-qualification:v2", ...metadata(context, "L4_COMMIT_BOUND_QUALIFICATION"), tuples: context.tuples, evidenceRefs: context.evidenceRefs });
}

export function migrateCompatibilityMatrixV1(value, context) {
  if (value?.schema !== "pi-ticket-planning:compatibility-matrix:v1" || !Array.isArray(context?.entries)) throw new Error("LEGACY_PROVENANCE_UNAVAILABLE");
  return { schema: "pi-ticket-planning:compatibility-matrix:v2", defaultStatus: "UNTESTED", entries: context.entries };
}
