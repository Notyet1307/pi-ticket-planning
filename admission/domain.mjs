import { hashText } from "../scripts/check-delivery-graph.mjs";
import { evaluateTransition } from "../scripts/workflow-contract.mjs";
import { MAX_RECEIPT_AGE_MS, stableHarnessReadiness } from "../scripts/readiness-receipt.mjs";

export const PLAN_SCHEMA = "pi-ticket-planning:admission-plan:v1";
export const REVIEW_SCHEMA = "pi-ticket-planning:admission-review:v1";
export const PLAN_KINDS = ["DELIVERY_GRAPH", "STANDALONE"];
export const CONTROLLED_LABELS = ["needs-triage", "needs-info", "ready-for-agent", "ready-for-human"];
export const SHA256 = /^sha256:[a-f0-9]{64}$/;

export function issue(code, subject) {
  return subject ? { code, subject } : { code };
}

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

export function fingerprint(value) {
  return hashText(JSON.stringify(canonical(value)));
}

export function sortedUnique(values) {
  return [...new Set(values ?? [])].sort();
}

export function sameValues(left, right) {
  return sortedUnique(left).join("\n") === sortedUnique(right).join("\n");
}

export function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function planError(message, problems = []) {
  const suffix = problems.length > 0 ? `: ${problems.map(({ code, subject }) => `${code}${subject ? `(${subject})` : ""}`).join(", ")}` : "";
  const error = new Error(`${message}${suffix}`);
  error.problems = problems;
  return error;
}

export function buildResource({ issue: issueId, title, bodyHash, blockedBy = [], labels, state, executionLane, parent = false }) {
  const observedLabels = sortedUnique(labels);
  const controlledLabelsBefore = observedLabels.filter((label) => CONTROLLED_LABELS.includes(label));
  const controlledLabelsAfter = [parent || executionLane === "AGENT" ? "ready-for-agent" : "ready-for-human"];
  return {
    issue: String(issueId),
    parent,
    executionLane: parent ? "PARENT" : executionLane,
    title,
    bodyHash,
    blockedBy: blockedBy.map(String),
    state,
    observedLabels,
    controlledLabelsBefore,
    controlledLabelsAfter,
    addLabels: controlledLabelsAfter.filter((label) => !controlledLabelsBefore.includes(label)),
    removeLabels: controlledLabelsBefore.filter((label) => !controlledLabelsAfter.includes(label)),
  };
}

export function reviewComment(resource, reviewed, reviewedFingerprint, planFingerprint) {
  const marker = `<!-- pi-ticket-planning:admission:v1:${planFingerprint.slice("sha256:".length)}:${resource.issue} -->`;
  const lines = resource.parent
    ? [
        "Admission graph: READY",
        `Reviewer: ${reviewed.review.reviewer}`,
        `Reviewed at: ${reviewed.review.reviewedAt}`,
        `Source: ${reviewed.source.identity}/${reviewed.source.revision} @ ${reviewed.source.baseSha}`,
        `Plan fingerprint: ${planFingerprint}`,
        `Reviewed fingerprint: ${reviewedFingerprint}`,
      ]
    : [
        "Admission verdict: READY",
        `Execution lane: ${resource.executionLane}`,
        `Reviewer: ${reviewed.review.reviewer}`,
        `Reviewed at: ${reviewed.review.reviewedAt}`,
        `Source: ${reviewed.source.identity}/${reviewed.source.revision} @ ${reviewed.source.baseSha}`,
        `Plan fingerprint: ${planFingerprint}`,
        `Reviewed fingerprint: ${reviewedFingerprint}`,
      ];
  return { marker, body: `${lines.join("\n")}\n\n${marker}` };
}

export function validatePolicy(policy) {
  return policy?.accepted === true && nonEmpty(policy.identity) && SHA256.test(policy.digest ?? "");
}

export function validateReview(review) {
  return review?.schema === REVIEW_SCHEMA
    && review.reviewer === "ticket-readiness-reviewer"
    && nonEmpty(review.reviewedAt)
    && review.graphVerdict === "READY";
}

export function requireHarnessReadiness(harness, repo, baseSha, { fresh = false, now = Date.now() } = {}) {
  let stable;
  try {
    stable = stableHarnessReadiness(harness);
  } catch (error) {
    throw planError(`executed Harness readiness receipt is required: ${error.message}`);
  }
  if (stable.projection.repo !== repo || stable.projection.baseSha !== baseSha) {
    throw planError("executed Harness readiness target differs from the Admission source");
  }
  if (fresh) {
    const age = Number(now) - Date.parse(harness.readiness.observedAt);
    if (!Number.isFinite(age) || age < -60_000 || age > MAX_RECEIPT_AGE_MS) throw planError("executed Harness readiness receipt is outside the freshness window");
  }
  return stable;
}

export function harnessStateProblems(expected, current, repo, baseSha) {
  const problems = [];
  let expectedStable;
  let currentStable;
  try {
    expectedStable = requireHarnessReadiness(expected, repo, baseSha);
  } catch {
    problems.push(issue("HARNESS_READINESS_PLAN_INVALID"));
    return problems;
  }
  try {
    currentStable = requireHarnessReadiness(current, repo, baseSha);
  } catch {
    problems.push(issue("HARNESS_READINESS_UNAVAILABLE"));
    return problems;
  }
  if (fingerprint(currentStable) !== fingerprint(expectedStable)) problems.push(issue("HARNESS_READINESS_DRIFT"));
  return problems;
}

export function validateActivationCheckpoint(checkpoint, target, revision, facts) {
  const problems = [];
  if (checkpoint?.stage !== "ADMISSION" || checkpoint?.verdict !== "ACTIVATION_AWAITING_CONFIRMATION") {
    problems.push(issue("EXPECTED_ACTIVATION_AWAITING_CONFIRMATION"));
  }
  if (checkpoint?.identity !== `${target}@${revision}`) problems.push(issue("CHECKPOINT_IDENTITY_MISMATCH"));
  const checked = evaluateTransition({ current: null, proposed: checkpoint, facts });
  problems.push(...checked.problems);
  return problems;
}

export function approvalProjection(plan) {
  return {
    schema: plan.schema,
    kind: plan.kind,
    repo: plan.repo,
    target: plan.target,
    parent: plan.parent,
    graphFingerprint: plan.graphFingerprint,
    reviewedFingerprint: plan.reviewedFingerprint,
    resources: plan.resources,
  };
}

export function finalizePlan(plan) {
  const planFingerprint = fingerprint(approvalProjection(plan));
  const operations = [];
  for (const resource of plan.resources) {
    operations.push({
      kind: "comment",
      issue: resource.issue,
      ...reviewComment(resource, plan.reviewed, plan.reviewedFingerprint, planFingerprint),
    });
    operations.push({
      kind: "labels",
      issue: resource.issue,
      before: resource.controlledLabelsBefore,
      after: resource.controlledLabelsAfter,
      add: resource.addLabels,
      remove: resource.removeLabels,
    });
  }
  return { ...plan, operations, planFingerprint };
}
