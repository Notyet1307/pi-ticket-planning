import { compatibilityFor } from "./compatibility.mjs";
import { validateCapabilityReceipt } from "./doctor.mjs";

export const REQUIRED_ADMISSION_CAPABILITIES = [
  "runtime.pi",
  "pi.session",
  "pi.named-session",
  "pi.persisted-session",
  "subagent.final-result",
  "reviewer.fresh-context",
  "reviewer.schema",
  "tool-calling",
  "timeout-cancellation",
  "harness.readiness",
  "provider.reviewer",
];

export function requireAdmissionCapabilities(receipt, { repo, baseSha, now = new Date().toISOString(), matrix } = {}) {
  if (!receipt) throw new Error("CAPABILITY_RECEIPT_REQUIRED");
  const checked = validateCapabilityReceipt(receipt, { now });
  if (!checked.ok) throw new Error(checked.problems[0]?.code ?? "INVALID_CAPABILITY_RECEIPT");
  if (receipt.subject.target !== `github:${repo}` || receipt.repo?.target !== `github:${repo}` || receipt.repo?.baseSha !== baseSha) {
    throw new Error("CAPABILITY_SUBJECT_MISMATCH");
  }
  const byName = new Map(receipt.capabilities.map((capability) => [capability.name, capability]));
  const unavailable = REQUIRED_ADMISSION_CAPABILITIES.filter((name) => byName.get(name)?.status !== "SUPPORTED");
  if (unavailable.length > 0) throw new Error(`CAPABILITY_BLOCKED_${unavailable[0].replaceAll(/[.-]/g, "_").toUpperCase()}`);
  const compatibility = compatibilityFor(receipt, matrix ? { matrix } : undefined);
  if (compatibility.status !== "SUPPORTED") throw new Error(`CAPABILITY_TUPLE_${compatibility.status}`);
  return { receipt, compatibility };
}
