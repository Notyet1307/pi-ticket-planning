import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateAdmissionState } from "./check-admission-state.mjs";
import {
  hashText,
  parseDeliveryGraph,
} from "./check-delivery-graph.mjs";
import {
  evaluateMutation,
  evaluateTransition,
} from "./workflow-contract.mjs";

const PLAN_SCHEMA = "pi-ticket-planning:admission-plan:v1";
const REVIEW_SCHEMA = "pi-ticket-planning:admission-review:v1";
const PLAN_KINDS = ["DELIVERY_GRAPH", "STANDALONE"];
const CONTROLLED_LABELS = ["needs-triage", "needs-info", "ready-for-agent", "ready-for-human"];
const SHA256 = /^sha256:[a-f0-9]{64}$/;

function issue(code, subject) {
  return subject ? { code, subject } : { code };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

export function fingerprint(value) {
  return hashText(JSON.stringify(canonical(value)));
}

function sortedUnique(values) {
  return [...new Set(values ?? [])].sort();
}

function sameValues(left, right) {
  return sortedUnique(left).join("\n") === sortedUnique(right).join("\n");
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function planError(message, problems = []) {
  const suffix = problems.length > 0 ? `: ${problems.map(({ code, subject }) => `${code}${subject ? `(${subject})` : ""}`).join(", ")}` : "";
  const error = new Error(`${message}${suffix}`);
  error.problems = problems;
  return error;
}

function buildResource({ issue: issueId, title, bodyHash, blockedBy = [], labels, state, executionLane, parent = false }) {
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

function reviewComment(resource, reviewed, reviewedFingerprint, planFingerprint) {
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

function validatePolicy(policy) {
  return policy?.accepted === true && nonEmpty(policy.identity) && SHA256.test(policy.digest ?? "");
}

function validateReview(review) {
  return review?.schema === REVIEW_SCHEMA
    && review.reviewer === "ticket-readiness-reviewer"
    && nonEmpty(review.reviewedAt)
    && review.graphVerdict === "READY";
}

function validateActivationCheckpoint(checkpoint, target, revision, facts) {
  const problems = [];
  if (checkpoint?.stage !== "ADMISSION" || checkpoint?.verdict !== "ACTIVATION_AWAITING_CONFIRMATION") {
    problems.push(issue("EXPECTED_ACTIVATION_AWAITING_CONFIRMATION"));
  }
  if (checkpoint?.identity !== `${target}@${revision}`) problems.push(issue("CHECKPOINT_IDENTITY_MISMATCH"));
  const checked = evaluateTransition({ current: null, proposed: checkpoint, facts });
  problems.push(...checked.problems);
  return problems;
}

function approvalProjection(plan) {
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

function finalizePlan(plan) {
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

export function buildAdmissionPlan(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw planError("invalid Admission input");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.repo ?? "")) throw planError("repo must be OWNER/REPO");
  if (!input.parent?.id || !nonEmpty(input.parent.title) || typeof input.parent.body !== "string") {
    throw planError("parent identity, title, and body are required");
  }
  if (!Array.isArray(input.parent.labels) || !input.children?.every((child) => Array.isArray(child.labels))) {
    throw planError("parent and child label snapshots are required");
  }
  if (input.parent.state !== "open") throw planError("parent must be open", [issue("ISSUE_NOT_OPEN", input.parent.id)]);

  const admissionState = validateAdmissionState({
    source: input.source,
    parentBody: input.parent.body,
    children: input.children,
  });
  if (!admissionState.ok) throw planError("Admission state is not READY", admissionState.problems);

  if (!validatePolicy(input.policy)) {
    throw planError("accepted policy identity and sha256 digest are required");
  }
  if (
    input.harness?.parentReadyFence !== true
    || typeof input.harness.identity !== "string"
    || !SHA256.test(input.harness.digest ?? "")
  ) {
    throw planError("operator-provided Harness compatibility assertion (parentReadyFence: true), identity, and sha256 digest are required");
  }
  if (!validateReview(input.review)) {
    throw planError("review is not READY or does not use the fresh reviewer contract");
  }

  const snapshot = parseDeliveryGraph(input.parent.body);
  const reviewById = new Map((input.review.candidates ?? []).map((candidate) => [String(candidate.id), candidate]));
  const snapshotIds = snapshot.children.map(({ id }) => String(id));
  if (reviewById.size !== (input.review.candidates ?? []).length) throw planError("review contains duplicate candidate identities");
  if (!sameValues(reviewById.keys(), snapshotIds)) throw planError("review candidate set does not match the Delivery Graph");
  const childById = new Map(input.children.map((child) => [String(child.id), child]));
  for (const child of snapshot.children) {
    const live = childById.get(String(child.id));
    const reviewed = reviewById.get(String(child.id));
    if (reviewed?.verdict !== "READY") throw planError(`review is not READY for ${child.id}`);
    if (!['AGENT', 'HUMAN'].includes(reviewed.executionLane) || reviewed.executionLane !== child.executionLane) {
      throw planError(`review execution lane drifted for ${child.id}`);
    }
    if (live?.title !== child.title) throw planError("candidate title drifted", [issue("TITLE_MISMATCH", child.id)]);
    if (live?.state !== "open") throw planError("candidate must be open", [issue("ISSUE_NOT_OPEN", child.id)]);
  }
  const checkpointFacts = {
    "source.unchanged": { value: true, source: "check-admission-state" },
    "policy.accepted": { value: true, source: "git-policy-check" },
    "review.ready": { value: true, source: "ticket-readiness-reviewer" },
  };
  const checkpointProblems = validateActivationCheckpoint(
    input.currentCheckpoint,
    String(input.parent.id),
    input.source?.revision,
    checkpointFacts,
  );
  if (checkpointProblems.length > 0) {
    throw planError("current Checkpoint must be exact ACTIVATION_AWAITING_CONFIRMATION", checkpointProblems);
  }

  const graphFingerprint = fingerprint(snapshot);
  const reviewed = {
    schema: "pi-ticket-planning:reviewed-admission-state:v1",
    kind: "DELIVERY_GRAPH",
    repo: input.repo,
    target: String(input.parent.id),
    source: input.source,
    graph: snapshot,
    parentTitle: input.parent.title,
    parentBodyHash: hashText(input.parent.body),
    parentState: input.parent.state,
    children: snapshot.children.map((child) => ({
      issue: String(child.id),
      title: child.title,
      bodyHash: child.bodyHash,
      blockedBy: child.blockedBy.map(String),
      state: childById.get(String(child.id))?.state,
    })),
    policy: input.policy,
    harness: input.harness,
    review: input.review,
    currentCheckpoint: input.currentCheckpoint,
  };
  const reviewedFingerprint = fingerprint(reviewed);
  const resources = snapshot.children.map((child) => {
    const live = childById.get(String(child.id));
    return buildResource({
      issue: child.id,
      title: child.title,
      bodyHash: child.bodyHash,
      blockedBy: child.blockedBy,
      labels: live.labels,
      state: live.state,
      executionLane: child.executionLane,
    });
  });
  resources.push(buildResource({
    issue: input.parent.id,
    title: input.parent.title,
    bodyHash: hashText(input.parent.body),
    labels: input.parent.labels,
    state: input.parent.state,
    parent: true,
  }));

  return finalizePlan({
    schema: PLAN_SCHEMA,
    kind: "DELIVERY_GRAPH",
    repo: input.repo,
    target: String(input.parent.id),
    parent: String(input.parent.id),
    graphFingerprint,
    reviewed,
    reviewedFingerprint,
    resources,
    recovery: {
      strategy: "roll-forward",
      rollback: "Only before a Harness claim and only when the current controlled labels still match this plan.",
      conflict: "Stop on body, source, policy, graph, or foreign controlled-label drift.",
    },
  });
}

export function buildStandaloneAdmissionPlan(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw planError("invalid standalone Admission input");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.repo ?? "")) throw planError("repo must be OWNER/REPO");
  const candidate = input.candidate;
  if (!candidate?.id || !nonEmpty(candidate.title) || typeof candidate.body !== "string" || !Array.isArray(candidate.labels)) {
    throw planError("candidate identity, title, body, and labels are required");
  }
  if (candidate.state !== "open") throw planError("candidate must be open", [issue("ISSUE_NOT_OPEN", candidate.id)]);
  if (!Array.isArray(candidate.blockedBy) || candidate.blockedBy.length > 0) {
    throw planError("standalone candidate must have no open blocker", [issue("OPEN_STANDALONE_BLOCKER", candidate.id)]);
  }
  if (!nonEmpty(input.source?.identity) || !nonEmpty(input.source?.revision) || !nonEmpty(input.source?.baseSha)) {
    throw planError("trusted standalone source identity, revision, and base are required");
  }
  if (!validatePolicy(input.policy)) throw planError("accepted policy identity and sha256 digest are required");
  if (!validateReview(input.review)) throw planError("review is not READY or does not use the fresh reviewer contract");
  const candidates = input.review.candidates ?? [];
  const reviewedCandidate = candidates.length === 1 && String(candidates[0].id) === String(candidate.id) ? candidates[0] : null;
  if (reviewedCandidate?.verdict !== "READY" || !["AGENT", "HUMAN"].includes(reviewedCandidate.executionLane)) {
    throw planError("standalone review must contain one exact READY candidate");
  }

  const checkpointFacts = {
    "source.unchanged": { value: true, source: "admission-cli" },
    "policy.accepted": { value: true, source: "git-policy-check" },
    "review.ready": { value: true, source: "ticket-readiness-reviewer" },
  };
  const checkpointProblems = validateActivationCheckpoint(
    input.currentCheckpoint,
    String(candidate.id),
    input.source.revision,
    checkpointFacts,
  );
  if (checkpointProblems.length > 0) {
    throw planError("current Checkpoint must be exact ACTIVATION_AWAITING_CONFIRMATION", checkpointProblems);
  }

  const reviewed = {
    schema: "pi-ticket-planning:reviewed-admission-state:v1",
    kind: "STANDALONE",
    repo: input.repo,
    target: String(candidate.id),
    source: input.source,
    candidate: {
      issue: String(candidate.id),
      title: candidate.title,
      bodyHash: hashText(candidate.body),
      blockedBy: [],
      state: candidate.state,
    },
    policy: input.policy,
    review: input.review,
    currentCheckpoint: input.currentCheckpoint,
  };
  const reviewedFingerprint = fingerprint(reviewed);
  const resources = [buildResource({
    issue: candidate.id,
    title: candidate.title,
    bodyHash: hashText(candidate.body),
    blockedBy: [],
    labels: candidate.labels,
    state: candidate.state,
    executionLane: reviewedCandidate.executionLane,
  })];

  return finalizePlan({
    schema: PLAN_SCHEMA,
    kind: "STANDALONE",
    repo: input.repo,
    target: String(candidate.id),
    reviewed,
    reviewedFingerprint,
    resources,
    recovery: {
      strategy: "roll-forward",
      rollback: "Only before a Harness claim and only when the current controlled labels still match this plan.",
      conflict: "Stop on body, title, state, source, policy, blocker, or foreign controlled-label drift.",
    },
  });
}

export function validateAdmissionPlan(plan) {
  const problems = [];
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return { ok: false, problems: [issue("INVALID_ADMISSION_PLAN")] };
  if (plan.schema !== PLAN_SCHEMA) problems.push(issue("UNSUPPORTED_ADMISSION_PLAN"));
  if (!PLAN_KINDS.includes(plan.kind)) problems.push(issue("INVALID_ADMISSION_PLAN_KIND", plan.kind));
  if (!SHA256.test(plan.planFingerprint ?? "") || fingerprint(approvalProjection(plan)) !== plan.planFingerprint) {
    problems.push(issue("PLAN_FINGERPRINT_MISMATCH"));
  }
  if (fingerprint(plan.reviewed) !== plan.reviewedFingerprint) problems.push(issue("REVIEWED_FINGERPRINT_MISMATCH"));
  if (plan.kind === "DELIVERY_GRAPH" && fingerprint(plan.reviewed?.graph) !== plan.graphFingerprint) {
    problems.push(issue("GRAPH_FINGERPRINT_MISMATCH"));
  }
  const resourceIds = (plan.resources ?? []).map(({ issue: issueId }) => issueId);
  if (new Set(resourceIds).size !== resourceIds.length) problems.push(issue("DUPLICATE_PLAN_RESOURCE"));
  const expectedResourceIds = plan.kind === "DELIVERY_GRAPH"
    ? [...(plan.reviewed?.graph?.children ?? []).map(({ id }) => String(id)), plan.parent]
    : [plan.target];
  if (resourceIds.join("\n") !== expectedResourceIds.join("\n")) problems.push(issue("INVALID_PLAN_RESOURCE_ORDER"));
  for (let index = 0; index < (plan.resources ?? []).length; index += 1) {
    const resource = plan.resources[index];
    const graphChild = plan.kind === "DELIVERY_GRAPH" ? plan.reviewed?.graph?.children?.[index] : null;
    const isParent = plan.kind === "DELIVERY_GRAPH" && index === (plan.resources ?? []).length - 1;
    if (resource.parent !== isParent) problems.push(issue("INVALID_PLAN_RESOURCE_ROLE", resource.issue));
    const reviewedResource = plan.kind === "STANDALONE"
      ? plan.reviewed?.candidate
      : isParent
        ? { title: plan.reviewed?.parentTitle, bodyHash: plan.reviewed?.parentBodyHash, state: plan.reviewed?.parentState }
        : graphChild;
    if (resource.title !== reviewedResource?.title) problems.push(issue("INVALID_PLAN_RESOURCE_TITLE", resource.issue));
    if (resource.bodyHash !== reviewedResource?.bodyHash) {
      problems.push(issue("INVALID_PLAN_RESOURCE_BODY_HASH", resource.issue));
    }
    if (resource.state !== "open" || (reviewedResource?.state !== undefined && resource.state !== reviewedResource.state)) {
      problems.push(issue("INVALID_PLAN_RESOURCE_STATE", resource.issue));
    }
    const expectedLane = plan.kind === "STANDALONE"
      ? plan.reviewed?.review?.candidates?.[0]?.executionLane
      : graphChild?.executionLane;
    if (!isParent && (!sameValues(resource.blockedBy, reviewedResource?.blockedBy) || resource.executionLane !== expectedLane)) {
      problems.push(issue("INVALID_PLAN_RESOURCE_GRAPH", resource.issue));
    }
    if (!sameValues(resource.controlledLabelsBefore, controlledLabels(resource.observedLabels))) {
      problems.push(issue("INVALID_PLAN_LABEL_SNAPSHOT", resource.issue));
    }
    const expectedAfter = [resource.parent || expectedLane === "AGENT" ? "ready-for-agent" : "ready-for-human"];
    if (!sameValues(resource.controlledLabelsAfter, expectedAfter)) problems.push(issue("INVALID_PLAN_LABEL_TARGET", resource.issue));
    if (!sameValues(resource.addLabels, expectedAfter.filter((label) => !resource.controlledLabelsBefore?.includes(label)))) {
      problems.push(issue("INVALID_PLAN_LABEL_ADDITION", resource.issue));
    }
    if (!sameValues(resource.removeLabels, (resource.controlledLabelsBefore ?? []).filter((label) => !expectedAfter.includes(label)))) {
      problems.push(issue("INVALID_PLAN_LABEL_REMOVAL", resource.issue));
    }
  }
  if ((plan.operations ?? []).length !== (plan.resources ?? []).length * 2) problems.push(issue("INVALID_PLAN_OPERATION_COUNT"));
  for (let index = 0; index < (plan.resources ?? []).length; index += 1) {
    const resource = plan.resources[index];
    const comment = plan.operations?.[index * 2];
    const labels = plan.operations?.[index * 2 + 1];
    const expectedComment = reviewComment(resource, plan.reviewed, plan.reviewedFingerprint, plan.planFingerprint);
    if (
      comment?.kind !== "comment"
      || comment.issue !== resource.issue
      || comment.marker !== expectedComment.marker
      || comment.body !== expectedComment.body
    ) {
      problems.push(issue("INVALID_PLAN_COMMENT_OPERATION", resource.issue));
    }
    if (
      labels?.kind !== "labels"
      || labels.issue !== resource.issue
      || !sameValues(labels.before, resource.controlledLabelsBefore)
      || !sameValues(labels.after, resource.controlledLabelsAfter)
      || !sameValues(labels.add, resource.addLabels)
      || !sameValues(labels.remove, resource.removeLabels)
    ) {
      problems.push(issue("INVALID_PLAN_LABEL_OPERATION", resource.issue));
    }
  }
  const lastOperation = plan.operations?.at(-1);
  if (lastOperation?.kind !== "labels" || lastOperation.issue !== plan.target) {
    problems.push(issue("ACTIVATION_TARGET_NOT_LAST"));
  }
  if (plan.kind === "DELIVERY_GRAPH" && !lastOperation?.after?.includes("ready-for-agent")) {
    problems.push(issue("PARENT_NOT_ACTIVATED_FOR_AGENT"));
  }
  return { ok: problems.length === 0, problems };
}

function controlledLabels(labels) {
  return sortedUnique((labels ?? []).filter((label) => CONTROLLED_LABELS.includes(label)));
}

function stateIssue(plan, state, issueId) {
  if (plan.kind === "STANDALONE") return String(state.candidate?.id) === String(issueId) ? state.candidate : undefined;
  if (String(state.parent?.id) === String(issueId)) return state.parent;
  return state.children?.find(({ id }) => String(id) === String(issueId));
}

function commentBodies(issueState) {
  return (issueState?.comments ?? []).map((comment) => typeof comment === "string" ? comment : comment.body);
}

function operationState(operation, issueState) {
  if (!issueState) return { status: "conflict", problem: issue("MISSING_PLAN_RESOURCE", operation.issue) };
  if (operation.kind === "comment") {
    const matches = commentBodies(issueState).filter((body) => typeof body === "string" && body.includes(operation.marker));
    if (matches.length === 0) return { status: "before" };
    if (matches.length === 1 && matches[0] === operation.body) return { status: "after" };
    return { status: "conflict", problem: issue("ADMISSION_COMMENT_MISMATCH", operation.issue) };
  }
  if (operation.kind === "labels") {
    const current = controlledLabels(issueState.labels);
    if (sameValues(current, operation.after)) return { status: "after" };
    if (sameValues(current, operation.before)) return { status: "before" };
    const allowed = new Set([...(operation.before ?? []), ...(operation.after ?? [])]);
    if (current.every((label) => allowed.has(label))) return { status: "partial" };
    return { status: "conflict", problem: issue("CONTROLLED_LABEL_DRIFT", `${operation.issue}:${current.join(",")}`) };
  }
  return { status: "conflict", problem: issue("UNKNOWN_PLAN_OPERATION", operation.kind) };
}

function resourceStateProblems(resource, current) {
  const problems = [];
  if (!current) return [issue("MISSING_PLAN_RESOURCE", resource.issue)];
  if (current.title !== resource.title) problems.push(issue("TITLE_MISMATCH", resource.issue));
  if (current.state !== "open") problems.push(issue("ISSUE_NOT_OPEN", resource.issue));
  if (hashText(current.body ?? "") !== resource.bodyHash) problems.push(issue("BODY_HASH_MISMATCH", resource.issue));
  if (!resource.parent) {
    if (!Array.isArray(current.blockedBy)) problems.push(issue("INVALID_LIVE_BLOCKERS", resource.issue));
    else if (!sameValues(current.blockedBy.map(String), resource.blockedBy)) problems.push(issue("NATIVE_GRAPH_MISMATCH", resource.issue));
  }
  const labelStatus = operationState({
    kind: "labels",
    issue: resource.issue,
    before: resource.controlledLabelsBefore,
    after: resource.controlledLabelsAfter,
  }, current);
  if (labelStatus.status === "conflict") problems.push(labelStatus.problem);
  return problems;
}

function immutableStateProblems(plan, state) {
  const problems = [];
  if (fingerprint(state.source) !== fingerprint(plan.reviewed.source)) problems.push(issue("SOURCE_DRIFT"));
  if (fingerprint(state.policy) !== fingerprint(plan.reviewed.policy)) problems.push(issue("POLICY_DRIFT"));
  if (fingerprint(state.currentCheckpoint) !== fingerprint(plan.reviewed.currentCheckpoint)) problems.push(issue("CHECKPOINT_DRIFT"));

  if (plan.kind === "DELIVERY_GRAPH") {
    const checked = validateAdmissionState({
      source: state.source,
      parentBody: state.parent?.body,
      children: state.children,
    });
    problems.push(...checked.problems);
    if (String(state.parent?.id) !== plan.parent) problems.push(issue("PARENT_IDENTITY_DRIFT"));
    if (fingerprint(state.harness) !== fingerprint(plan.reviewed.harness)) {
      problems.push(issue("HARNESS_CONTRACT_DRIFT", "operator-provided compatibility assertion changed"));
    }
    if (state.harness?.parentReadyFence !== true) {
      problems.push(issue("HARNESS_PARENT_FENCE_UNVERIFIED", "operator-provided compatibility assertion missing"));
    }
    try {
      if (fingerprint(parseDeliveryGraph(state.parent.body)) !== plan.graphFingerprint) problems.push(issue("GRAPH_FINGERPRINT_MISMATCH"));
    } catch (error) {
      problems.push(issue("INVALID_DELIVERY_GRAPH", error instanceof Error ? error.message : String(error)));
    }
  } else if (String(state.candidate?.id) !== plan.target) {
    problems.push(issue("CANDIDATE_IDENTITY_DRIFT"));
  }

  for (const resource of plan.resources ?? []) {
    problems.push(...resourceStateProblems(resource, stateIssue(plan, state, resource.issue)));
  }
  return problems;
}

function preActivationProblems(plan, state) {
  const problems = immutableStateProblems(plan, state);
  for (const operation of plan.operations.slice(0, -1)) {
    const status = operationState(operation, stateIssue(plan, state, operation.issue));
    if (status.status !== "after") problems.push(status.problem ?? issue("INCOMPLETE_PLAN_OPERATION", `${operation.kind}:${operation.issue}`));
  }
  return problems;
}

function applyResult(status, plan, changed, recovered, problems = []) {
  return {
    schema: "pi-ticket-planning:admission-result:v1",
    status,
    planFingerprint: plan?.planFingerprint,
    reviewedFingerprint: plan?.reviewedFingerprint,
    graphFingerprint: plan?.graphFingerprint,
    changed,
    recovered,
    problems,
  };
}

export function applyAdmissionPlan(plan, adapter, options = {}) {
  const planCheck = validateAdmissionPlan(plan);
  if (!planCheck.ok) return applyResult("CONFLICT", plan, [], [], planCheck.problems);
  if (options.expectedFingerprint !== plan.planFingerprint) {
    return applyResult("CONFLICT", plan, [], [], [issue("EXPECTED_FINGERPRINT_MISMATCH")]);
  }

  let current;
  try {
    current = adapter.read();
  } catch (error) {
    return applyResult("CONFLICT", plan, [], [], [issue("READ_FAILED", error instanceof Error ? error.message : String(error))]);
  }
  const initialProblems = immutableStateProblems(plan, current);
  if (initialProblems.length > 0) return applyResult("CONFLICT", plan, [], [], initialProblems);

  const facts = {
    "source.unchanged": { value: true, source: plan.kind === "DELIVERY_GRAPH" ? "check-admission-state" : "admission-cli" },
    "policy.accepted": { value: true, source: "git-policy-check" },
    "review.ready": { value: true, source: "ticket-readiness-reviewer" },
    "human.activation": { value: true, source: "operator-asserted", subject: options.expectedFingerprint },
  };
  if (plan.kind === "DELIVERY_GRAPH") facts["graph.passed"] = { value: true, source: "check-admission-state" };
  const transition = {
    current: plan.reviewed.currentCheckpoint,
    proposed: {
      ...plan.reviewed.currentCheckpoint,
      stage: "ADMISSION",
      verdict: "ADMITTED",
    },
    approvalSubject: options.expectedFingerprint,
  };
  const authorization = evaluateMutation({
    mutation: plan.kind === "DELIVERY_GRAPH" ? "admission.apply" : "admission.applyStandalone",
    actor: "admission-cli",
    transition,
    facts,
  });
  if (!authorization.allowed) return applyResult("CONFLICT", plan, [], [], authorization.problems);

  const changed = [];
  const recovered = [];
  for (const operation of plan.operations) {
    if (operation === plan.operations.at(-1)) {
      try {
        current = adapter.read();
      } catch (error) {
        return applyResult(changed.length + recovered.length > 0 ? "PARTIAL" : "CONFLICT", plan, changed, recovered, [
          issue("READ_FAILED", `activation:${error instanceof Error ? error.message : String(error)}`),
        ]);
      }
      const activationProblems = preActivationProblems(plan, current);
      if (activationProblems.length > 0) return applyResult("CONFLICT", plan, changed, recovered, activationProblems);
    }

    let issueState;
    try {
      issueState = adapter.readIssue(operation.issue);
    } catch (error) {
      return applyResult(changed.length + recovered.length > 0 ? "PARTIAL" : "CONFLICT", plan, changed, recovered, [
        issue("READ_FAILED", `${operation.issue}:${error instanceof Error ? error.message : String(error)}`),
      ]);
    }
    const resource = plan.resources.find(({ issue: issueId }) => issueId === operation.issue);
    const resourceProblems = resourceStateProblems(resource, issueState);
    if (resourceProblems.length > 0) return applyResult("CONFLICT", plan, changed, recovered, resourceProblems);
    let status = operationState(operation, issueState);
    if (status.status === "after") continue;
    if (status.status === "conflict") return applyResult("CONFLICT", plan, changed, recovered, [status.problem]);

    let claims;
    try {
      claims = adapter.readClaims();
    } catch (error) {
      return applyResult(changed.length + recovered.length > 0 ? "PARTIAL" : "CONFLICT", plan, changed, recovered, [
        issue("READ_FAILED", `claims:${error instanceof Error ? error.message : String(error)}`),
      ]);
    }
    if (claims.length > 0) {
      return applyResult("CONFLICT", plan, changed, recovered, [issue("HARNESS_CLAIM_DETECTED", claims.join(","))]);
    }

    let writeError;
    try {
      if (operation.kind === "comment") adapter.addComment(operation.issue, operation.body);
      else adapter.setControlledLabels(operation.issue, operation.after, operation.before);
    } catch (error) {
      writeError = error;
    }
    try {
      issueState = adapter.readIssue(operation.issue);
    } catch (error) {
      return applyResult("PARTIAL", plan, changed, recovered, [
        issue("READ_AFTER_WRITE_FAILED", `${operation.issue}:${error instanceof Error ? error.message : String(error)}`),
      ]);
    }
    const afterWriteProblems = resourceStateProblems(resource, issueState);
    if (afterWriteProblems.length > 0) return applyResult("CONFLICT", plan, changed, recovered, afterWriteProblems);
    status = operationState(operation, issueState);
    if (status.status === "after") {
      const identity = `${operation.kind}:${operation.issue}`;
      if (writeError) recovered.push(identity);
      else changed.push(identity);
      continue;
    }
    if (status.status === "conflict") return applyResult("CONFLICT", plan, changed, recovered, [status.problem]);
    return applyResult("PARTIAL", plan, changed, recovered, [
      issue("WRITE_NOT_COMPLETED", `${operation.kind}:${operation.issue}${writeError ? `:${writeError.message}` : ""}`),
    ]);
  }

  try {
    current = adapter.read();
  } catch (error) {
    return applyResult(changed.length + recovered.length > 0 ? "PARTIAL" : "CONFLICT", plan, changed, recovered, [
      issue("FINAL_READ_FAILED", error instanceof Error ? error.message : String(error)),
    ]);
  }
  const finalProblems = immutableStateProblems(plan, current);
  for (const operation of plan.operations) {
    const status = operationState(operation, stateIssue(plan, current, operation.issue));
    if (status.status !== "after") finalProblems.push(status.problem ?? issue("INCOMPLETE_PLAN_OPERATION", `${operation.kind}:${operation.issue}`));
  }
  if (finalProblems.length > 0) return applyResult("CONFLICT", plan, changed, recovered, finalProblems);

  const completed = evaluateTransition({
    current: transition.current,
    proposed: transition.proposed,
    facts: {
      ...facts,
      "tracker.ready": { value: true, source: "admission-cli" },
    },
  });
  if (!completed.allowed) return applyResult("CONFLICT", plan, changed, recovered, completed.problems);
  return applyResult("COMPLETE", plan, changed, recovered);
}

function runGhJson(args, input) {
  const run = spawnSync("gh", args, {
    encoding: "utf8",
    input: input === undefined ? undefined : JSON.stringify(input),
    maxBuffer: 32 * 1024 * 1024,
  });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(run.stderr.trim() || `gh exited ${run.status}`);
  return run.stdout.trim() ? JSON.parse(run.stdout) : undefined;
}

function readPages(endpoint) {
  const pages = runGhJson(["api", "--paginate", "--slurp", endpoint]);
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) throw new Error(`unexpected GitHub response for ${endpoint}`);
  return pages.flat();
}

export function createGitHubAdapter({ repo, kind = "DELIVERY_GRAPH", target, context }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo ?? "")) throw new Error("repo must be OWNER/REPO");
  if (!PLAN_KINDS.includes(kind)) throw new Error(`unsupported Admission kind ${kind}`);
  const targetId = String(target);
  if (!/^[1-9][0-9]*$/.test(targetId)) throw new Error("target must be a positive GitHub Issue number");

  function blockers(issueId) {
    return readPages(`repos/${repo}/issues/${issueId}/dependencies/blocked_by?per_page=100`)
      .map(({ number }) => String(number));
  }

  function readIssue(issueId, { includeComments = true, includeBlockers = false } = {}) {
    const data = runGhJson(["api", `repos/${repo}/issues/${issueId}`]);
    return {
      id: String(data.number),
      title: data.title ?? "",
      body: data.body ?? "",
      labels: (data.labels ?? []).map((label) => typeof label === "string" ? label : label.name),
      state: data.state,
      updatedAt: data.updated_at,
      blockedBy: includeBlockers ? blockers(issueId) : [],
      assignees: (data.assignees ?? []).map(({ login }) => login),
      comments: includeComments
        ? readPages(`repos/${repo}/issues/${issueId}/comments?per_page=100`).map(({ body }) => ({ body }))
        : [],
    };
  }

  function childRefs() {
    return readPages(`repos/${repo}/issues/${targetId}/sub_issues?per_page=100`);
  }

  return {
    read() {
      if (kind === "STANDALONE") {
        return structuredClone({ ...context, candidate: readIssue(targetId, { includeBlockers: true }) });
      }
      const parent = readIssue(targetId);
      const children = childRefs().map((reference) => readIssue(reference.number, { includeBlockers: true }));
      return structuredClone({ ...context, parent, children });
    },
    readIssue(issueId) {
      return readIssue(issueId, { includeBlockers: kind === "STANDALONE" || String(issueId) !== targetId });
    },
    readClaims() {
      if (kind === "STANDALONE") {
        return readIssue(targetId, { includeComments: false }).assignees.length > 0 ? [targetId] : [];
      }
      return childRefs()
        .filter((reference) => (reference.assignees ?? []).length > 0)
        .map((reference) => String(reference.number));
    },
    addComment(issueId, body) {
      runGhJson(["api", "--method", "POST", `repos/${repo}/issues/${issueId}/comments`, "--input", "-"], { body });
    },
    setControlledLabels(issueId, desiredControlled, expectedControlled) {
      const currentIssue = readIssue(issueId, { includeComments: false });
      const currentControlled = controlledLabels(currentIssue.labels);
      if (sameValues(currentControlled, desiredControlled)) return;
      const allowed = new Set([...expectedControlled, ...desiredControlled]);
      if (!currentControlled.every((label) => allowed.has(label))) throw new Error(`controlled labels changed for #${issueId}`);
      for (const label of currentControlled.filter((value) => !desiredControlled.includes(value))) {
        runGhJson(["api", "--method", "DELETE", `repos/${repo}/issues/${issueId}/labels/${encodeURIComponent(label)}`]);
      }
      const latest = controlledLabels(readIssue(issueId, { includeComments: false }).labels);
      const additions = desiredControlled.filter((label) => !latest.includes(label));
      if (additions.length > 0) {
        runGhJson(["api", "--method", "POST", `repos/${repo}/issues/${issueId}/labels`, "--input", "-"], { labels: additions });
      }
    },
  };
}

function parseOptions(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("options must be --name value pairs");
    values.set(key.slice(2), value);
  }
  return values;
}

function writeJson(target, value) {
  const output = `${JSON.stringify(value, null, 2)}\n`;
  if (!target || target === "-") process.stdout.write(output);
  else fs.writeFileSync(path.resolve(target), output, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

function preflightJsonTarget(target) {
  if (!target || target === "-") return;
  const resolved = path.resolve(target);
  if (fs.existsSync(resolved)) throw new Error(`output already exists: ${resolved}`);
  fs.accessSync(path.dirname(resolved), fs.constants.W_OK);
}

function writeApplyResult(target, result) {
  try {
    writeJson(target, result);
  } catch (error) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    console.error(`WARN Admission result file was not written: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readJson(target, name) {
  if (!target) throw new Error(`${name} is required`);
  const text = target === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(path.resolve(target), "utf8");
  return JSON.parse(text);
}

function planFromOptions(options) {
  if (options.has("input")) {
    const input = readJson(options.get("input"), "--input");
    return input.candidate ? buildStandaloneAdmissionPlan(input) : buildAdmissionPlan(input);
  }
  if (options.has("parent") === options.has("issue")) throw new Error("choose exactly one of --parent or --issue");
  const repo = options.get("repo");
  const kind = options.has("issue") ? "STANDALONE" : "DELIVERY_GRAPH";
  const target = options.get(kind === "STANDALONE" ? "issue" : "parent");
  const context = readJson(options.get("context"), "--context");
  const review = readJson(options.get("review"), "--review");
  const adapter = createGitHubAdapter({ repo, kind, target, context });
  const state = adapter.read();
  if (kind === "STANDALONE") {
    return buildStandaloneAdmissionPlan({
      repo,
      candidate: state.candidate,
      source: state.source,
      policy: state.policy,
      review,
      currentCheckpoint: state.currentCheckpoint,
    });
  }
  return buildAdmissionPlan({
    repo,
    parent: state.parent,
    source: state.source,
    children: state.children,
    policy: state.policy,
    harness: state.harness,
    review,
    currentCheckpoint: state.currentCheckpoint,
  });
}

const ownPath = fs.realpathSync(fileURLToPath(import.meta.url));
if (process.argv[1] && fs.realpathSync(process.argv[1]) === ownPath) {
  try {
    const [command, ...argv] = process.argv.slice(2);
    const options = parseOptions(argv);
    if (command === "plan") {
      preflightJsonTarget(options.get("out"));
      writeJson(options.get("out"), planFromOptions(options));
    } else if (command === "apply") {
      const plan = readJson(options.get("plan"), "--plan");
      const context = readJson(options.get("context"), "--context");
      preflightJsonTarget(options.get("out"));
      const adapter = createGitHubAdapter({ repo: plan.repo, kind: plan.kind, target: plan.target, context });
      const result = applyAdmissionPlan(plan, adapter, {
        expectedFingerprint: options.get("expected-fingerprint"),
      });
      writeApplyResult(options.get("out"), result);
      if (result.status !== "COMPLETE") process.exitCode = 1;
    } else {
      throw new Error("usage: plan (--input FILE | --repo OWNER/REPO (--parent NUMBER | --issue NUMBER) --review FILE --context FILE) [--out FILE]; apply --plan FILE --expected-fingerprint SHA256 --context FILE [--out FILE]");
    }
  } catch (error) {
    console.error(`ERROR ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
