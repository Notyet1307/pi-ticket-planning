import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

import { parseChildTicket } from "../execution-plan/markdown.mjs";
import {
  buildOracleVerifierManifest,
  oracleBindingDigest,
  REQUIRED_REPLAN_TRIGGERS,
  ticketReviewProjection,
} from "../scripts/check-ticket-contract.mjs";

export function oracleBinding({
  repo,
  baseSha,
  id = "O01",
  artifactPath = "fixtures/admission-cases.json",
  format = "application/json",
  ownerIdentity = "independent-oracle-owner",
  command = "npm run verify:protocol",
  verifierFiles = ["scripts/verify-protocol.mjs"],
} = {}) {
  const run = spawnSync("git", ["-C", repo, "show", `${baseSha}:${artifactPath}`], { encoding: null });
  if (run.status !== 0 || !Buffer.isBuffer(run.stdout)) throw new Error(`fixture Oracle is unavailable: ${artifactPath}`);
  const binding = {
    schema: "pi-ticket-planning:oracle-binding:v1",
    id,
    owner: { kind: "INDEPENDENT_VERIFICATION", identity: ownerIdentity },
    artifact: {
      path: artifactPath,
      format,
      baseSha,
      sha256: `sha256:${createHash("sha256").update(run.stdout).digest("hex")}`,
      byteCount: run.stdout.length,
    },
    execution: { command },
    workerMutationAllowed: false,
  };
  return {
    ...binding,
    verifier: buildOracleVerifierManifest({ repo, baseSha, oracleId: id, command, files: verifierFiles }),
  };
}

export function executionConstraints({
  implementationOwner = "implementation-worker",
  riskClasses = ["BOUNDED_BEHAVIOR_CHANGE"],
  scopeBudget = { maxFiles: 8, maxChangedLines: 1500 },
  expectedPaths = ["src/change.ts"],
  protectedPaths = ["fixtures/admission-cases.json"],
  replanTriggers = REQUIRED_REPLAN_TRIGGERS,
  primaryVerificationSeams = ["primary-scenario"],
  integrationOnly = null,
  waivers = [],
} = {}) {
  return {
    implementationOwner,
    riskClasses,
    scopeBudget,
    expectedPaths,
    protectedPaths,
    replanTriggers,
    primaryVerificationSeams,
    integrationOnly,
    waivers,
  };
}

export function ticketBody({
  objective = "Build the bounded change.",
  primaryVerification = "Run the exact primary scenario.",
  acceptanceCriteria = ["The outcome is produced.", "The outcome is durable.", "Failure leaves no partial state."],
  guardrails = "Preserve the accepted authority boundary.",
  outOfScope = "Adjacent behavior.",
  binding,
  constraints,
} = {}) {
  const oracleSection = binding ? `## Oracle binding
\`\`\`json
${JSON.stringify(binding)}
\`\`\`
` : "";
  return `## What to build
${objective}
## Primary verification
${primaryVerification}
## Acceptance criteria
${acceptanceCriteria.map((value) => `- [ ] ${value}`).join("\n")}
## Invariants and guardrails
${guardrails}
${oracleSection}## Execution constraints
\`\`\`json
${JSON.stringify(constraints)}
\`\`\`
## Out of scope
${outOfScope}`;
}

export function graphContractFields(body) {
  const parsed = parseChildTicket(body);
  const constraints = parsed.executionConstraints;
  return {
    primaryVerificationSeams: constraints.primaryVerificationSeams,
    implementationOwner: constraints.implementationOwner,
    riskClasses: constraints.riskClasses,
    scopeBudget: constraints.scopeBudget,
    expectedPaths: constraints.expectedPaths,
    protectedPaths: constraints.protectedPaths,
    replanTriggers: constraints.replanTriggers,
    oracleBindingDigest: oracleBindingDigest(parsed.oracleBinding),
    integrationOnly: constraints.integrationOnly,
    waiverDigests: constraints.waivers.map(({ digest }) => digest),
  };
}

export function reviewContractFields(body, graphChild = null, graphChildren = []) {
  return ticketReviewProjection({ parsed: parseChildTicket(body), graphChild, graphChildren });
}

export function humanReviewContractFields() {
  return {
    riskClasses: [],
    riskCount: 0,
    primaryVerificationSeams: [],
    scopeBudget: null,
    expectedPaths: [],
    protectedOraclePaths: [],
    oracleBindingDigest: null,
    oracleBindingVerdict: "NOT_APPLICABLE",
    replanTriggers: [],
    codeHotspotOverlap: [],
    integrationOnlyVerdict: "NOT_APPLICABLE",
    waiverDigests: [],
  };
}
