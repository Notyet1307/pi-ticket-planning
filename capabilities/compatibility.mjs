import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runtimeMetadata } from "../installation/build-metadata.mjs";
import { validateArtifact } from "../protocol/kernel.mjs";
import { validateQualificationSemantics, validateReportEnvelope } from "../integration/report.mjs";
import { validateCapabilityReceipt } from "./doctor.mjs";
import { REQUIRED_ADMISSION_CAPABILITIES } from "./required.mjs";
import { assertProvenanceAuthorization } from "../integration/provenance.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical(value)), "utf8").digest("hex")}`;
}

export function loadCompatibilityMatrix({ root = ROOT } = {}) {
  const matrix = JSON.parse(fs.readFileSync(path.join(root, "compatibility", "matrix.json"), "utf8"));
  if (!validateCompatibilityMatrix(matrix).ok) throw new Error("INVALID_COMPATIBILITY_MATRIX");
  return matrix;
}

export function validateCompatibilityMatrix(matrix) {
  const problems = [];
  if (matrix?.schema !== "pi-ticket-planning:compatibility-matrix:v2"
    || matrix.defaultStatus !== "UNTESTED"
    || !Array.isArray(matrix.entries)) return { ok: false, problems: [{ code: "INVALID_COMPATIBILITY_MATRIX" }] };
  const tuples = new Set();
  for (const entry of matrix.entries) {
    const tuple = [entry.piVersion, entry.piDigest, entry.subagentVersion, entry.provider, entry.model, entry.thinking, entry.profileDigest, entry.harnessVersion, entry.harnessDigest, entry.packageCommit].join("\n");
    if (tuples.has(tuple)) problems.push({ code: "DUPLICATE_COMPATIBILITY_TUPLE" });
    tuples.add(tuple);
    if (!["SUPPORTED", "DEGRADED", "BLOCKED", "UNTESTED"].includes(entry.status)
      || !/^[A-Z][A-Z0-9_]{0,127}$/.test(entry.reasonCode ?? "")
      || !Number.isFinite(Date.parse(entry.observedAt)) || !Number.isFinite(Date.parse(entry.expiresAt))
      || Date.parse(entry.expiresAt) <= Date.parse(entry.observedAt)
      || !Array.isArray(entry.evidence)) problems.push({ code: "INVALID_COMPATIBILITY_ENTRY" });
    if (["SUPPORTED", "DEGRADED"].includes(entry.status)) {
      const kinds = new Set(entry.evidence.map(({ kind }) => kind));
      if (!["active-capability", "l2-model", "l3-e2e", "l4-qualification"].every((kind) => kinds.has(kind))) {
        problems.push({ code: "QUALIFIED_COMPATIBILITY_EVIDENCE_MISSING" });
      }
    }
  }
  return { ok: problems.length === 0, problems };
}

export function compatibilityFor(receipt, {
  matrix = loadCompatibilityMatrix(),
  thinking = receipt.provider.thinking ?? "UNTESTED",
  packageCommit = receipt.subject.revision,
  now = new Date().toISOString(),
} = {}) {
  if (!validateCompatibilityMatrix(matrix).ok) throw new Error("INVALID_COMPATIBILITY_MATRIX");
  const match = matrix.entries.find((entry) => entry.piVersion === receipt.pi.version
    && entry.piDigest === receipt.pi.digest
    && entry.subagentVersion === receipt.subagent.version
    && entry.provider === receipt.provider.name
    && entry.model === receipt.provider.model
    && entry.thinking === thinking
    && entry.profileDigest === receipt.profileDigest
    && entry.harnessVersion === (receipt.harness?.version ?? "UNTESTED")
    && entry.harnessDigest === (receipt.harness?.configDigest ?? null)
    && entry.packageCommit === packageCommit);
  return match
    ? Date.parse(now) > Date.parse(match.expiresAt)
      ? { status: "BLOCKED", reasonCode: "QUALIFIED_TUPLE_EXPIRED", evidence: structuredClone(match.evidence) }
      : { status: match.status, reasonCode: match.reasonCode, evidence: structuredClone(match.evidence) }
    : { status: matrix.defaultStatus, reasonCode: "NO_EXACT_QUALIFIED_TUPLE", evidence: [] };
}

function sameProvenance(provenance, qualification) {
  return provenance?.repository === qualification.repository
    && provenance.workflowRunId === qualification.workflowRunId
    && provenance.workflowRunAttempt === qualification.workflowRunAttempt
    && provenance.workflowRunUrl === qualification.workflowRunUrl
    && provenance.signerWorkflow === `github.com/${qualification.repository}/.github/workflows/release-qualification.yml`
    && provenance.sourceDigest === qualification.headSha;
}

export function proposeCompatibility({
  qualification,
  capabilityReceipt,
  qualificationProvenance,
  qualificationAuthorization,
  matrix = loadCompatibilityMatrix(),
  packageCommit = runtimeMetadata().sourceCommit,
  now = new Date().toISOString(),
} = {}) {
  assertProvenanceAuthorization(qualificationAuthorization, qualificationProvenance);
  if (!validateCompatibilityMatrix(matrix).ok) throw new Error("INVALID_COMPATIBILITY_MATRIX");
  if (qualification?.schema !== "pi-ticket-planning:release-qualification:v2" || qualification.status !== "COMPLETE"
    || !validateArtifact(qualification).ok || validateQualificationSemantics(qualification).length > 0
    || !validateReportEnvelope(qualification, { tier: "L4_COMMIT_BOUND_QUALIFICATION", headSha: packageCommit, now, requireActions: true }).ok
    || !sameProvenance(qualificationProvenance, qualification)) {
    throw new Error("QUALIFICATION_NOT_COMPLETE");
  }
  if (!validateCapabilityReceipt(capabilityReceipt, { now }).ok
    || capabilityReceipt.subject?.revision !== packageCommit
    || capabilityReceipt.subject?.target !== capabilityReceipt.repo?.target
    || !capabilityReceipt.subject?.target?.startsWith("github:")) throw new Error("CAPABILITY_RECEIPT_REQUIRED");
  const capabilities = new Map(capabilityReceipt.capabilities.map((item) => [item.name, item]));
  if (REQUIRED_ADMISSION_CAPABILITIES.some((name) => capabilities.get(name)?.status !== "SUPPORTED")) throw new Error("CAPABILITY_RECEIPT_NOT_SUPPORTED");
  if (!Array.isArray(qualification.tuples)) throw new Error("CAPABILITY_RECEIPT_REQUIRED");
  const match = qualification.tuples.find((entry) => entry.piVersion === capabilityReceipt.pi?.version
    && entry.piDigest === capabilityReceipt.pi?.digest
    && entry.subagentVersion === capabilityReceipt.subagent?.version
    && entry.provider === capabilityReceipt.provider?.name
    && entry.model === capabilityReceipt.provider?.model
    && entry.thinking === capabilityReceipt.provider?.thinking
    && entry.profileDigest === capabilityReceipt.profileDigest
    && entry.harnessVersion === capabilityReceipt.harness?.version
    && entry.harnessDigest === capabilityReceipt.harness?.configDigest);
  if (!match) throw new Error("CAPABILITY_TUPLE_MISMATCH");
  const evidenceByTier = new Map(qualification.evidenceRefs.map((item) => [item.tier, item.digest]));
  if (!qualification.evidenceRefs.some((item) => item.tier === "ACTIVE_CAPABILITY" && item.digest === capabilityReceipt.digest)) throw new Error("CAPABILITY_EVIDENCE_MISSING");
  const entry = {
    ...match,
    packageCommit: qualification.headSha,
    observedAt: qualification.observedAt,
    expiresAt: [qualification.expiresAt, capabilityReceipt.expiresAt].sort()[0],
    status: "SUPPORTED",
    reasonCode: "COMMIT_BOUND_QUALIFICATION_COMPLETE",
    evidence: [
      { kind: "active-capability", digest: capabilityReceipt.digest },
      { kind: "l2-model", digest: evidenceByTier.get("L2_REAL_MODEL") },
      { kind: "l3-e2e", digest: evidenceByTier.get("L3_REAL_DISPOSABLE_INTEGRATION") },
      { kind: "l4-qualification", digest: qualification.reportDigest },
    ],
  };
  if (entry.evidence.some(({ digest: value }) => !/^sha256:[a-f0-9]{64}$/.test(value ?? ""))) throw new Error("QUALIFICATION_EVIDENCE_INCOMPLETE");
  const proposal = {
    schema: "pi-ticket-planning:compatibility-proposal:v1",
    matrixDigest: digest(matrix),
    qualificationDigest: qualification.reportDigest,
    capabilityDigest: capabilityReceipt.digest,
    qualificationProvenance: structuredClone(qualificationProvenance),
    entry,
  };
  return { ...proposal, proposalDigest: digest(proposal) };
}

export function applyCompatibilityProposal(proposal, {
  expectedDigest,
  qualification,
  capabilityReceipt,
  qualificationProvenance,
  qualificationAuthorization,
  packageCommit = runtimeMetadata().sourceCommit,
  root = ROOT,
} = {}) {
  const file = path.join(path.resolve(root), "compatibility", "matrix.json");
  const matrix = JSON.parse(fs.readFileSync(file, "utf8"));
  const expected = proposeCompatibility({ qualification, capabilityReceipt, qualificationProvenance, qualificationAuthorization, matrix, packageCommit });
  if (proposal?.schema !== "pi-ticket-planning:compatibility-proposal:v1" || proposal.proposalDigest !== digest(Object.fromEntries(Object.entries(proposal).filter(([key]) => key !== "proposalDigest")))
    || JSON.stringify(canonical(proposal)) !== JSON.stringify(canonical(expected))) throw new Error("INVALID_COMPATIBILITY_PROPOSAL");
  if (expectedDigest !== proposal.proposalDigest) throw new Error("EXPECTED_PROPOSAL_DIGEST_MISMATCH");
  if (digest(matrix) !== proposal.matrixDigest) throw new Error("COMPATIBILITY_MATRIX_DRIFT");
  const next = { ...matrix, entries: [...matrix.entries, proposal.entry] };
  if (!validateCompatibilityMatrix(next).ok) throw new Error("INVALID_COMPATIBILITY_MATRIX");
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, file);
  return next;
}
