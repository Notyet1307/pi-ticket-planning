import { createFactAttestation, evaluateMutation } from "../protocol/kernel.mjs";
import { fingerprint, issue, safeError } from "./domain.mjs";
import { validateAdmissionPlan } from "./validate.mjs";
import { immutableStateProblems, preActivationProblems, operationState, resourceStateProblems, stateIssue } from "./recovery.mjs";

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

const PRODUCER_DIGEST = fingerprint({ component: "admission/apply.mjs", protocol: "v1" });

function checkpointSubject(plan) {
  return {
    target: `github:${plan.repo}`,
    kind: "ticket",
    id: plan.target,
    revision: plan.reviewed.source.revision,
    digest: plan.reviewedFingerprint,
  };
}

function approvalSubject(plan) {
  return {
    target: `github:${plan.repo}`,
    kind: "admission-plan",
    id: plan.planFingerprint,
    revision: plan.reviewed.source.revision,
    digest: plan.planFingerprint,
  };
}

function fact(plan, name, subject, sourceKind, evidence, now) {
  return createFactAttestation({
    id: `F-${name.replaceAll(".", "-")}-${plan.planFingerprint.slice(-12)}`,
    fact: name,
    value: true,
    subject,
    source: {
      kind: sourceKind,
      producer: sourceKind,
      producerVersion: "0.5.0-alpha.0",
      producerDigest: PRODUCER_DIGEST,
    },
    observedAt: now,
    expiresAt: null,
    evidence,
  });
}

function mutationFacts(plan, approval, now) {
  const subject = checkpointSubject(plan);
  const facts = [
    fact(plan, "source.unchanged", subject, plan.kind === "DELIVERY_GRAPH" ? "check-admission-state" : "admission-cli", {
      kind: "tracker",
      ref: `github:${plan.repo}#${plan.target}@${plan.reviewed.source.revision}`,
      digest: fingerprint(plan.reviewed.source),
    }, now),
    fact(plan, "policy.accepted", subject, "git-policy-check", {
      kind: "artifact",
      ref: plan.reviewed.policy.identity,
      digest: plan.reviewed.policy.digest,
    }, now),
    fact(plan, "review.ready", subject, "ticket-readiness-reviewer", {
      kind: "artifact",
      ref: plan.reviewed.reviewBinding.schema,
      digest: plan.reviewed.reviewBinding.inputDigest,
    }, now),
    approval,
  ];
  if (plan.kind === "DELIVERY_GRAPH") {
    facts.splice(2, 0, fact(plan, "graph.passed", subject, "check-admission-state", {
      kind: "artifact",
      ref: `github:${plan.repo}#${plan.target}:delivery-graph`,
      digest: plan.graphFingerprint,
    }, now));
  }
  return facts;
}

function readApproval(plan, options) {
  if (!options.planningCaseStore?.get || !options.planningCaseStore?.consumeApproval
    || typeof options.caseId !== "string" || typeof options.approvalId !== "string") {
    return { problems: [issue("PLANNING_CASE_APPROVAL_REQUIRED")] };
  }
  try {
    const snapshot = options.planningCaseStore.get({
      caseId: options.caseId,
      target: `github:${plan.repo}`,
    });
    const approvals = [...snapshot.approvals.pending, ...snapshot.approvals.consumed];
    const approval = approvals.find(({ id }) => id === options.approvalId);
    if (!approval) return { problems: [issue("APPROVAL_NOT_FOUND", options.approvalId)] };
    return {
      approval,
      consumedApprovalIds: snapshot.approvals.consumed.map(({ id }) => id),
      problems: [],
    };
  } catch (error) {
    const code = /^[A-Z][A-Z0-9_]{0,127}$/.test(error?.code ?? "") ? error.code : "PLANNING_CASE_READ_FAILED";
    return { problems: [issue(code)] };
  }
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
    return applyResult("CONFLICT", plan, [], [], [issue("READ_FAILED", safeError(error instanceof Error ? error.message : error))]);
  }
  const initialProblems = immutableStateProblems(plan, current);
  if (initialProblems.length > 0) return applyResult("CONFLICT", plan, [], [], initialProblems);

  const approvalState = readApproval(plan, options);
  if (approvalState.problems.length > 0) return applyResult("CONFLICT", plan, [], [], approvalState.problems);
  const now = options.now ?? new Date().toISOString();
  const subject = checkpointSubject(plan);
  const transition = {
    current: {
      schema: "pi-ticket-planning:checkpoint:v2",
      lane: plan.reviewed.currentCheckpoint.lane,
      stage: "ADMISSION",
      verdict: "ACTIVATION_AWAITING_CONFIRMATION",
      subject,
    },
    proposed: {
      schema: "pi-ticket-planning:checkpoint:v2",
      lane: plan.reviewed.currentCheckpoint.lane,
      stage: "ADMISSION",
      verdict: "ADMITTED",
      subject,
    },
    approvalSubject: approvalSubject(plan),
  };
  const authorization = evaluateMutation({
    mutation: plan.kind === "DELIVERY_GRAPH" ? "admission.apply" : "admission.applyStandalone",
    actor: "admission-cli",
    transition,
    facts: mutationFacts(plan, approvalState.approval, now),
    consumedApprovalIds: approvalState.consumedApprovalIds,
    now,
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
          issue("READ_FAILED", `activation:${safeError(error instanceof Error ? error.message : error)}`),
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
        issue("READ_FAILED", `${operation.issue}:${safeError(error instanceof Error ? error.message : error)}`),
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
        issue("READ_FAILED", `claims:${safeError(error instanceof Error ? error.message : error)}`),
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
        issue("READ_AFTER_WRITE_FAILED", `${operation.issue}:${safeError(error instanceof Error ? error.message : error)}`),
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
      issue("WRITE_NOT_COMPLETED", `${operation.kind}:${operation.issue}${writeError ? `:${safeError(writeError.message)}` : ""}`),
    ]);
  }

  try {
    current = adapter.read();
  } catch (error) {
    return applyResult(changed.length + recovered.length > 0 ? "PARTIAL" : "CONFLICT", plan, changed, recovered, [
      issue("FINAL_READ_FAILED", safeError(error instanceof Error ? error.message : error)),
    ]);
  }
  const finalProblems = immutableStateProblems(plan, current);
  for (const operation of plan.operations) {
    const status = operationState(operation, stateIssue(plan, current, operation.issue));
    if (status.status !== "after") finalProblems.push(status.problem ?? issue("INCOMPLETE_PLAN_OPERATION", `${operation.kind}:${operation.issue}`));
  }
  if (finalProblems.length > 0) return applyResult("CONFLICT", plan, changed, recovered, finalProblems);

  try {
    options.planningCaseStore.consumeApproval({
      caseId: options.caseId,
      target: `github:${plan.repo}`,
      approvalId: options.approvalId,
    });
  } catch (error) {
    const code = /^[A-Z][A-Z0-9_]{0,127}$/.test(error?.code ?? "") ? error.code : "APPROVAL_CONSUME_FAILED";
    return applyResult(changed.length + recovered.length > 0 ? "PARTIAL" : "CONFLICT", plan, changed, recovered, [issue(code)]);
  }
  return applyResult("COMPLETE", plan, changed, recovered);
}
