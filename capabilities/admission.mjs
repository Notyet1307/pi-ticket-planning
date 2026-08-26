import { compatibilityFor } from "./compatibility.mjs";
import { validateCapabilityReceipt } from "./doctor.mjs";
export { REQUIRED_ADMISSION_CAPABILITIES, SESSION_RESUME_CAPABILITIES, supportsSessionResume } from "./required.mjs";
import { REQUIRED_ADMISSION_CAPABILITIES, supportsSessionResume } from "./required.mjs";

export function requireSupportedCapabilities(receipt, { repo, baseSha, now = new Date().toISOString() } = {}) {
  if (!receipt) throw new Error("CAPABILITY_RECEIPT_REQUIRED");
  const checked = validateCapabilityReceipt(receipt, { now });
  if (!checked.ok) throw new Error(checked.problems[0]?.code ?? "INVALID_CAPABILITY_RECEIPT");
  if (receipt.subject.target !== `github:${repo}` || receipt.repo?.target !== `github:${repo}` || receipt.repo?.baseSha !== baseSha) {
    throw new Error("CAPABILITY_SUBJECT_MISMATCH");
  }
  const byName = new Map(receipt.capabilities.map((capability) => [capability.name, capability]));
  if (!supportsSessionResume(byName)) throw new Error("CAPABILITY_BLOCKED_SESSION_RESUME");
  const unavailable = REQUIRED_ADMISSION_CAPABILITIES.filter((name) => byName.get(name)?.status !== "SUPPORTED");
  if (unavailable.length > 0) throw new Error(`CAPABILITY_BLOCKED_${unavailable[0].replaceAll(/[.-]/g, "_").toUpperCase()}`);
  return receipt;
}

export function requireAdmissionCapabilities(receipt, { repo, baseSha, now = new Date().toISOString(), matrix } = {}) {
  requireSupportedCapabilities(receipt, { repo, baseSha, now });
  const compatibility = compatibilityFor(receipt, { ...(matrix ? { matrix } : {}), now });
  if (compatibility.status !== "SUPPORTED") throw new Error(`CAPABILITY_TUPLE_${compatibility.status}`);
  return { receipt, compatibility };
}
