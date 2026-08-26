import { issue, PLAN_SCHEMA, PLAN_KINDS, SHA256, fingerprint, approvalProjection, harnessStateProblems, sameValues, reviewComment } from "./domain.mjs";
import { controlledLabels } from "./recovery.mjs";
import { validateAdmissionReviewBinding } from "./review-transport.mjs";
import { validateReviewerDispatchBinding } from "../extensions/reviewer-one-shot-gate.mjs";
import { validateArtifact } from "../protocol/kernel.mjs";

export function validateAdmissionPlan(plan) {
  const problems = [];
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return { ok: false, problems: [issue("INVALID_ADMISSION_PLAN")] };
  try {
    problems.push(...validateArtifact(plan).problems);
  } catch {
    problems.push(issue("INVALID_ADMISSION_PLAN"));
  }
  if (plan.schema !== PLAN_SCHEMA) problems.push(issue("UNSUPPORTED_ADMISSION_PLAN"));
  if (!PLAN_KINDS.includes(plan.kind)) problems.push(issue("INVALID_ADMISSION_PLAN_KIND", plan.kind));
  if (!SHA256.test(plan.planFingerprint ?? "") || fingerprint(approvalProjection(plan)) !== plan.planFingerprint) {
    problems.push(issue("PLAN_FINGERPRINT_MISMATCH"));
  }
  if (fingerprint(plan.reviewed) !== plan.reviewedFingerprint) problems.push(issue("REVIEWED_FINGERPRINT_MISMATCH"));
  try {
    validateAdmissionReviewBinding(plan.reviewed?.reviewBinding);
    validateReviewerDispatchBinding(plan.reviewed?.reviewDispatchBinding);
    validateAdmissionReviewBinding(plan.reviewed?.review?.inputBinding);
    if (fingerprint(plan.reviewed.reviewBinding) !== fingerprint(plan.reviewed.review.inputBinding)) {
      problems.push(issue("REVIEW_INPUT_BINDING_MISMATCH"));
    }
    if (plan.reviewed.reviewBinding.subject.target !== `github:${plan.repo}`
      || plan.reviewed.reviewBinding.subject.id !== plan.target
      || plan.reviewed.reviewBinding.subject.revision !== plan.reviewed.source?.revision) {
      problems.push(issue("REVIEW_INPUT_SUBJECT_MISMATCH"));
    }
  } catch {
    problems.push(issue("INVALID_REVIEW_INPUT_BINDING"));
  }
  if (plan.kind === "DELIVERY_GRAPH" && fingerprint(plan.reviewed?.graph) !== plan.graphFingerprint) {
    problems.push(issue("GRAPH_FINGERPRINT_MISMATCH"));
  }
  const plannedAgentExecution = plan.kind === "DELIVERY_GRAPH"
    || plan.reviewed?.review?.candidates?.[0]?.executionLane === "AGENT";
  if (plannedAgentExecution) problems.push(...harnessStateProblems(
    plan.reviewed?.harness,
    plan.reviewed?.harness,
    plan.repo,
    plan.reviewed?.source?.baseSha,
  ));
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
