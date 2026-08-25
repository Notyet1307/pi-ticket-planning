import { createHash } from "node:crypto";

import { validateAdmissionPlan } from "../admission/validate.mjs";
import { validateReviewArtifact } from "../admission/domain.mjs";
import {
  validateAdmissionReviewBinding,
  validateAdmissionReviewInput,
} from "../admission/review-transport.mjs";
import { validateCapabilityReceipt } from "../capabilities/doctor.mjs";
import { validateCompatibilityMatrix } from "../capabilities/compatibility.mjs";
import { validateE2EReportSemantics, validateModelReportSemantics, validateQualificationSemantics } from "../integration/report.mjs";
import { validateE2EState } from "../integration/e2e-state.mjs";
import { validateOutcomeReceipt } from "../outcome/ingest.mjs";
import { validateDeliveryGraph } from "../scripts/check-delivery-graph.mjs";
import { validateDeliveryGatePlan } from "../scripts/delivery-gate.mjs";
import { stableHarnessReadiness } from "../scripts/readiness-receipt.mjs";
import { validateTicketContextResult } from "../scripts/check-ticket-context.mjs";

function problem(code, subject) {
  return subject === undefined ? { code } : { code, subject };
}

function hash(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function caught(operation, code) {
  try {
    const result = operation();
    return result?.problems ?? [];
  } catch {
    return [problem(code)];
  }
}

function simpleSemantics(value, name) {
  if (name === "result-envelope") return value.status === "COMPLETE" && value.problems.length > 0 ? [problem("COMPLETE_RESULT_HAS_PROBLEMS")] : [];
  if (name === "release-projection") {
    const { digest, ...projection } = value;
    return digest === hash(projection) ? [] : [problem("RELEASE_PROJECTION_DIGEST_MISMATCH")];
  }
  if (name === "spec-projection") return value.source.target === value.target ? [] : [problem("SPEC_SOURCE_TARGET_MISMATCH")];
  if (name === "planning-case") {
    return value.nextAction && typeof value.nextAction === "object" && !Array.isArray(value.nextAction)
      ? [] : [problem("PLANNING_CASE_NEXT_ACTION_MISSING")];
  }
  if (name === "reviewed-admission-state") {
    return value.currentCheckpoint?.subject?.target === `github:${value.repo}`
      && value.currentCheckpoint.subject.id === value.target ? [] : [problem("REVIEWED_CHECKPOINT_SUBJECT_MISMATCH")];
  }
  if (name === "admission-result") return value.status === "COMPLETE" && value.problems.length > 0 ? [problem("COMPLETE_ADMISSION_HAS_PROBLEMS")] : [];
  if (name === "delivery-gate-result") return value.status === "COMPLETE" && value.problems?.length > 0 ? [problem("COMPLETE_DELIVERY_GATE_HAS_PROBLEMS")] : [];
  if (name === "planning-case-event") return value.digest === hash(canonical(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "digest")))) ? [] : [problem("CASE_EVENT_DIGEST_MISMATCH")];
  if (name === "case-transaction") return value.status === "COMMITTED"
    && (!value.committedAt || value.event.digest !== value.nextSnapshot.lastEvent) ? [problem("COMMITTED_TRANSACTION_EVENT_MISMATCH")] : [];
  if (name === "installation-manifest") {
    const files = value.installedFiles.map((entry) => JSON.stringify(canonical(entry)));
    return new Set(files).size === files.length ? [] : [problem("DUPLICATE_INSTALLED_FILE")];
  }
  if (name === "benchmark-report") return value.metrics.p95DurationMs >= value.metrics.p50DurationMs ? [] : [problem("BENCHMARK_PERCENTILE_INVALID")];
  return [];
}

export async function validateRegisteredArtifactSemantics(value, identity) {
  const name = identity.name;
  if (name === "delivery-graph") return { problems: validateDeliveryGraph(value).problems };
  if (name === "ticket-context-check") return { problems: validateTicketContextResult(value) };
  if (name === "admission-review") return { problems: validateReviewArtifact(value) ? [] : [problem("ADMISSION_REVIEW_INVALID")] };
  if (name === "admission-plan") return { problems: caught(() => validateAdmissionPlan(value), "ADMISSION_PLAN_INVALID") };
  if (name === "harness-readiness") return { problems: caught(() => stableHarnessReadiness(value), "HARNESS_READINESS_INVALID") };
  if (name === "delivery-gate-plan") return { problems: validateDeliveryGatePlan(value).problems };
  if (name === "outcome-receipt") return { problems: validateOutcomeReceipt(value).problems };
  if (name === "capability-receipt") return { problems: validateCapabilityReceipt(value).problems };
  if (name === "admission-review-input") return { problems: caught(() => validateAdmissionReviewInput(value), "ADMISSION_REVIEW_INPUT_INVALID") };
  if (name === "admission-review-binding") return { problems: caught(() => validateAdmissionReviewBinding(value), "ADMISSION_REVIEW_BINDING_INVALID") };
  if (name === "compatibility-matrix") return { problems: validateCompatibilityMatrix(value).problems };
  if (name === "e2e-report") return { problems: validateE2EReportSemantics(value) };
  if (name === "e2e-state") return { problems: caught(() => validateE2EState(value), "E2E_STATE_INVALID") };
  if (name === "live-eval") return { problems: validateModelReportSemantics(value) };
  if (name === "release-qualification") return { problems: validateQualificationSemantics(value) };
  return { problems: simpleSemantics(value, name) };
}
