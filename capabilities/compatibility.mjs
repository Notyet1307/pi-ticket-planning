import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadCompatibilityMatrix({ root = ROOT } = {}) {
  const matrix = JSON.parse(fs.readFileSync(path.join(root, "compatibility", "matrix.json"), "utf8"));
  if (!validateCompatibilityMatrix(matrix).ok) throw new Error("INVALID_COMPATIBILITY_MATRIX");
  return matrix;
}

export function validateCompatibilityMatrix(matrix) {
  const problems = [];
  if (matrix?.schema !== "pi-ticket-planning:compatibility-matrix:v1"
    || matrix.defaultStatus !== "UNTESTED"
    || !Array.isArray(matrix.entries)) return { ok: false, problems: [{ code: "INVALID_COMPATIBILITY_MATRIX" }] };
  const tuples = new Set();
  for (const entry of matrix.entries) {
    const tuple = [entry.piVersion, entry.subagentVersion, entry.provider, entry.model, entry.profileDigest, entry.harnessDigest].join("\n");
    if (tuples.has(tuple)) problems.push({ code: "DUPLICATE_COMPATIBILITY_TUPLE" });
    tuples.add(tuple);
    if (!["SUPPORTED", "DEGRADED", "BLOCKED", "UNTESTED"].includes(entry.status)
      || !/^[A-Z][A-Z0-9_]{0,127}$/.test(entry.reasonCode ?? "")
      || !Array.isArray(entry.evidence)) problems.push({ code: "INVALID_COMPATIBILITY_ENTRY" });
    if (["SUPPORTED", "DEGRADED"].includes(entry.status)) {
      const kinds = new Set(entry.evidence.map(({ kind }) => kind));
      if (!kinds.has("active-probe") || !kinds.has("release-qualification")) {
        problems.push({ code: "QUALIFIED_COMPATIBILITY_EVIDENCE_MISSING" });
      }
    }
  }
  return { ok: problems.length === 0, problems };
}

export function compatibilityFor(receipt, { matrix = loadCompatibilityMatrix() } = {}) {
  if (!validateCompatibilityMatrix(matrix).ok) throw new Error("INVALID_COMPATIBILITY_MATRIX");
  const match = matrix.entries.find((entry) => entry.piVersion === receipt.pi.version
    && entry.subagentVersion === receipt.subagent.version
    && entry.provider === receipt.provider.name
    && entry.model === receipt.provider.model
    && entry.profileDigest === receipt.profileDigest
    && entry.harnessDigest === (receipt.harness?.configDigest ?? null));
  return match
    ? { status: match.status, reasonCode: match.reasonCode, evidence: structuredClone(match.evidence) }
    : { status: matrix.defaultStatus, reasonCode: "NO_EXACT_QUALIFIED_TUPLE", evidence: [] };
}
