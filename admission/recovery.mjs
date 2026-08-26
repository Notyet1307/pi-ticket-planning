import { hashText, parseDeliveryGraph } from "../scripts/check-delivery-graph.mjs";
import { verifyCandidateContextChecks } from "../scripts/check-ticket-context.mjs";
import { validateAdmissionState } from "../scripts/check-admission-state.mjs";
import { issue, CONTROLLED_LABELS, sortedUnique, sameValues, fingerprint, harnessStateProblems } from "./domain.mjs";

export function controlledLabels(labels) {
  return sortedUnique((labels ?? []).filter((label) => CONTROLLED_LABELS.includes(label)));
}

export function stateIssue(plan, state, issueId) {
  if (plan.kind === "STANDALONE") return String(state.candidate?.id) === String(issueId) ? state.candidate : undefined;
  if (String(state.parent?.id) === String(issueId)) return state.parent;
  return state.children?.find(({ id }) => String(id) === String(issueId));
}

function comments(issueState) {
  return (issueState?.comments ?? []).map((comment) => {
    if (typeof comment === "string") return { body: comment, authorVerified: false };
    if (comment && typeof comment === "object") return comment;
    return { body: undefined, authorVerified: false };
  });
}

export function operationState(operation, issueState) {
  if (!issueState) return { status: "conflict", problem: issue("MISSING_PLAN_RESOURCE", operation.issue) };
  if (operation.kind === "comment") {
    const matches = comments(issueState).filter(({ body }) => typeof body === "string" && body.includes(operation.marker));
    if (matches.length === 0) return { status: "before" };
    if (matches.length === 1 && matches[0].body === operation.body && matches[0].authorVerified === true) return { status: "after" };
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

export function resourceStateProblems(resource, current) {
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

export function immutableStateProblems(plan, state) {
  const problems = [];
  if (fingerprint(state.source) !== fingerprint(plan.reviewed.source)) problems.push(issue("SOURCE_DRIFT"));
  if (fingerprint(state.policy) !== fingerprint(plan.reviewed.policy)) problems.push(issue("POLICY_DRIFT"));
  if (fingerprint(state.currentCheckpoint) !== fingerprint(plan.reviewed.currentCheckpoint)) problems.push(issue("CHECKPOINT_DRIFT"));
  if (fingerprint(state.contextChecks) !== fingerprint(plan.reviewed.contextChecks)) {
    problems.push(issue("CONTEXT_CHECK_DRIFT"));
  }
  if (plan.reviewed.capabilityReceipt
    && (!state.capabilityReceipt || fingerprint(state.capabilityReceipt) !== fingerprint(plan.reviewed.capabilityReceipt))) {
    problems.push(issue("CAPABILITY_RECEIPT_DRIFT"));
  }

  if (plan.kind === "DELIVERY_GRAPH") {
    const checked = validateAdmissionState({
      repositoryPath: state.repositoryPath,
      source: state.source,
      parentBody: state.parent?.body,
      children: state.children,
      contextChecks: state.contextChecks,
    });
    problems.push(...checked.problems);
    if (String(state.parent?.id) !== plan.parent) problems.push(issue("PARENT_IDENTITY_DRIFT"));
    problems.push(...harnessStateProblems(plan.reviewed.harness, state.harness, plan.repo, plan.reviewed.source?.baseSha));
    try {
      if (fingerprint(parseDeliveryGraph(state.parent.body)) !== plan.graphFingerprint) problems.push(issue("GRAPH_FINGERPRINT_MISMATCH"));
    } catch (error) {
      problems.push(issue("INVALID_DELIVERY_GRAPH", error instanceof Error ? error.message : String(error)));
    }
  } else {
    if (String(state.candidate?.id) !== plan.target) problems.push(issue("CANDIDATE_IDENTITY_DRIFT"));
    problems.push(...verifyCandidateContextChecks({
      repositoryPath: state.repositoryPath,
      candidates: state.candidate ? [state.candidate] : [],
      baseSha: state.source?.baseSha,
      contextChecks: state.contextChecks,
    }));
    if (plan.reviewed?.review?.candidates?.[0]?.executionLane === "AGENT") {
      problems.push(...harnessStateProblems(plan.reviewed.harness, state.harness, plan.repo, plan.reviewed.source?.baseSha));
    }
  }

  for (const resource of plan.resources ?? []) {
    problems.push(...resourceStateProblems(resource, stateIssue(plan, state, resource.issue)));
  }
  return problems;
}

export function preActivationProblems(plan, state) {
  const problems = immutableStateProblems(plan, state);
  for (const operation of plan.operations.slice(0, -1)) {
    const status = operationState(operation, stateIssue(plan, state, operation.issue));
    if (status.status !== "after") problems.push(status.problem ?? issue("INCOMPLETE_PLAN_OPERATION", `${operation.kind}:${operation.issue}`));
  }
  return problems;
}
