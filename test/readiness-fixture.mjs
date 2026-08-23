import {
  ADMISSION_READINESS_SCHEMA,
  HARNESS_READINESS_SCHEMA,
  HARNESS_READINESS_SCHEMA_SHA256,
} from "../scripts/readiness-receipt.mjs";

const observedAt = new Date().toISOString();

export function harnessReadiness(repo, baseSha, overrides = {}) {
  return {
    identity: `HerdrHarness ${HARNESS_READINESS_SCHEMA}`,
    digest: `sha256:${HARNESS_READINESS_SCHEMA_SHA256}`,
    readiness: {
      schema: ADMISSION_READINESS_SCHEMA,
      observedAt,
      receiptDigest: `sha256:${"f".repeat(64)}`,
      projection: {
        schema: HARNESS_READINESS_SCHEMA,
        repo,
        baseRef: "main",
        baseSha,
        configDigest: "b".repeat(64),
        providers: { status: "passed", lanes: ["worker", "reviewer"] },
        docker: { required: true, status: "passed" },
        validation: {
          status: "passed",
          validationArgvDigest: "c".repeat(64),
          sourceSnapshotDigest: "d".repeat(64),
        },
        delivery: {
          status: "passed",
          autoMergeRequested: true,
          inspection: {
            baseRefIsDefault: true,
            repositoryAutoMerge: true,
            pullRequestRequired: true,
            strictRequiredStatusChecks: true,
            requiredStatusChecks: ["herdr-delivery-gate"],
            statusCheckSourcesPinned: true,
            bypassActorsPresent: false,
            humanApprovalRequired: false,
            mergeCommitAllowed: true,
            mergeMethodAllowed: true,
          },
        },
        ...overrides,
      },
    },
  };
}
