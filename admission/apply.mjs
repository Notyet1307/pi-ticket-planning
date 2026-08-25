import { evaluateMutation, evaluateTransition } from "../scripts/workflow-contract.mjs";
import { issue, safeError } from "./domain.mjs";
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
