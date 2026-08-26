import { spawnSync } from "node:child_process";

const WORKFLOW_FILES = {
  L2_REAL_MODEL: ".github/workflows/model-eval.yml",
  L3_REAL_DISPOSABLE_INTEGRATION: ".github/workflows/integration-e2e.yml",
  L4_COMMIT_BOUND_QUALIFICATION: ".github/workflows/release-qualification.yml",
};
const AUTHORIZATIONS = new WeakMap();

function strings(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, output);
  else if (value && typeof value === "object") for (const item of Object.values(value)) strings(item, output);
  return output;
}

export function verifyGitHubEvidence(file, report) {
  const workflowFile = WORKFLOW_FILES[report.tier];
  if (!workflowFile) return { provenanceVerified: false, workflowVerified: false, receipt: null };
  const signerWorkflow = `github.com/${report.repository}/${workflowFile}`;
  const attestation = spawnSync("gh", [
    "attestation", "verify", file,
    "-R", report.repository,
    "--signer-workflow", signerWorkflow,
    "--source-digest", report.headSha,
    "--format", "json",
  ], { encoding: "utf8", timeout: 60_000 });
  const run = spawnSync("gh", ["run", "view", report.workflowRunId, "--repo", report.repository, "--json", "conclusion,headSha,url,workflowName,attempt"], { encoding: "utf8", timeout: 30_000 });
  let runValue;
  let attestationValue;
  try { runValue = JSON.parse(run.stdout); } catch { runValue = null; }
  try { attestationValue = JSON.parse(attestation.stdout); } catch { attestationValue = null; }
  const invocation = `${report.workflowRunUrl}/attempts/${report.workflowRunAttempt}`;
  const certificateStrings = Array.isArray(attestationValue)
    ? attestationValue.flatMap((item) => strings(item?.verificationResult?.signature?.certificate))
    : [];
  const provenanceVerified = attestation.status === 0 && certificateStrings.includes(invocation);
  const workflowVerified = run.status === 0 && runValue?.conclusion === "success" && runValue.headSha === report.headSha
    && runValue.url === report.workflowRunUrl && runValue.workflowName === report.workflowName
    && runValue.attempt === report.workflowRunAttempt;
  const receipt = provenanceVerified && workflowVerified ? {
    repository: report.repository,
    workflowRunId: report.workflowRunId,
    workflowRunAttempt: report.workflowRunAttempt,
    workflowRunUrl: report.workflowRunUrl,
    signerWorkflow,
    sourceDigest: report.headSha,
  } : null;
  const authorization = receipt ? Object.freeze({}) : null;
  if (authorization) AUTHORIZATIONS.set(authorization, receipt);
  return {
    provenanceVerified,
    workflowVerified,
    receipt,
    authorization,
  };
}

export function assertProvenanceAuthorization(authorization, receipt) {
  const authorized = authorization && AUTHORIZATIONS.get(authorization);
  if (!authorized || JSON.stringify(authorized) !== JSON.stringify(receipt)) throw new Error("QUALIFICATION_PROVENANCE_INVALID");
}
