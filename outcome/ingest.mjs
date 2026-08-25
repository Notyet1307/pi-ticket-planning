import { createHash } from "node:crypto";

import { validateFactAttestation } from "../protocol/kernel.mjs";

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const STATUSES = new Set(["ACHIEVED", "PARTIAL", "NOT_ACHIEVED", "UNEVALUABLE"]);
const LEARNING = new Set(["PROMOTE", "REVISE", "REJECT", "NO_CHANGE"]);
const PRODUCERS = {
  harness: new Set(["herdr-harness"]),
  tracker: new Set(["github", "gitlab", "local-tracker"]),
  git: new Set(["git"]),
};

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function hash(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical(value)), "utf8").digest("hex")}`;
}

function same(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function projection(receipt) {
  const { digest, ...value } = receipt;
  return value;
}

function problem(code) { return { code }; }

export function buildOutcomeReceipt(value) {
  const receipt = {
    schema: "pi-ticket-planning:outcome-receipt:v1",
    id: value.id,
    subject: structuredClone(value.subject),
    source: structuredClone(value.source),
    observedAt: value.observedAt,
    status: value.status,
    evidence: structuredClone(value.evidence),
  };
  return { ...receipt, digest: hash(receipt) };
}

export function validateOutcomeReceipt(receipt, { expectedSubject } = {}) {
  const problems = [];
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return { ok: false, problems: [problem("INVALID_OUTCOME_RECEIPT")] };
  if (receipt.schema !== "pi-ticket-planning:outcome-receipt:v1" || !/^OR-[A-Za-z0-9._:-]{1,125}$/.test(receipt.id ?? "")
    || !STATUSES.has(receipt.status) || !Number.isFinite(Date.parse(receipt.observedAt))) problems.push(problem("INVALID_OUTCOME_RECEIPT"));
  if (expectedSubject && !same(receipt.subject, expectedSubject)) problems.push(problem("OUTCOME_SUBJECT_MISMATCH"));
  if (!receipt.subject?.target || !DIGEST.test(receipt.subject?.digest ?? "")) problems.push(problem("INVALID_OUTCOME_SUBJECT"));
  const allowed = PRODUCERS[receipt.source?.kind];
  if (!allowed?.has(receipt.source?.producer)) problems.push(problem("OUTCOME_PRODUCER_NOT_ALLOWED"));
  if (!DIGEST.test(receipt.source?.producerDigest ?? "") || typeof receipt.source?.producerVersion !== "string") problems.push(problem("INVALID_OUTCOME_SOURCE"));
  if (!Array.isArray(receipt.evidence) || receipt.evidence.length === 0
    || receipt.evidence.some((item) => typeof item?.kind !== "string" || typeof item?.ref !== "string" || !DIGEST.test(item?.digest ?? ""))) {
    problems.push(problem("INVALID_OUTCOME_EVIDENCE"));
  }
  if (!DIGEST.test(receipt.digest ?? "") || receipt.digest !== hash(projection(receipt))) problems.push(problem("OUTCOME_DIGEST_MISMATCH"));
  return { ok: problems.length === 0, problems };
}

export function ingestOutcomeReceipt(receipt, { expectedSubject, store, caseId } = {}) {
  const checked = validateOutcomeReceipt(receipt, { expectedSubject });
  if (!checked.ok) throw new Error(checked.problems.map(({ code }) => code).join(","));
  if (store) store.bind({ caseId, name: "outcome", binding: receipt });
  return {
    status: "COMPLETE",
    allowedLearning: [...LEARNING],
    kernelMutation: false,
  };
}

export function confirmOutcomeLearning(receipt, decisionAttestation, { store, caseId } = {}) {
  const outcome = validateOutcomeReceipt(receipt);
  if (!outcome.ok) throw new Error(outcome.problems.map(({ code }) => code).join(","));
  const checked = validateFactAttestation(decisionAttestation, { expectedSubject: receipt.subject, now: decisionAttestation?.observedAt });
  if (!checked.ok || decisionAttestation.fact !== "human.outcomeLearningDecision"
    || !LEARNING.has(decisionAttestation.value)
    || decisionAttestation.evidence?.digest !== receipt.digest) throw new Error("INVALID_OUTCOME_LEARNING_DECISION");
  if (store) {
    store.addApproval({ caseId, approval: decisionAttestation });
    store.consumeApproval({ caseId, approvalId: decisionAttestation.id });
  }
  return { status: "COMPLETE", decision: decisionAttestation.value, kernelMutation: false };
}
