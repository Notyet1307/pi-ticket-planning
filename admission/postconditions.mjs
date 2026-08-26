import { operationState, stateIssue } from "./recovery.mjs";

function problem(code, subject) {
  return subject === undefined ? { code } : { code, subject };
}

function operationProblems(plan, state, kind) {
  return plan.operations
    .filter((operation) => operation.kind === kind)
    .flatMap((operation) => {
      const status = operationState(operation, stateIssue(plan, state, operation.issue));
      return status.status === "after" ? [] : [status.problem ?? problem("POSTCONDITION_NOT_MET", `${kind}:${operation.issue}`)];
    });
}

export function verifyCommentsExactReadback({ plan, state }) {
  return operationProblems(plan, state, "comment");
}

export function verifyLabelsExactControlledState({ plan, state }) {
  return operationProblems(plan, state, "labels");
}

export function verifyParentLast({ plan }) {
  const labels = plan.operations.filter((operation) => operation.kind === "labels");
  return labels.at(-1)?.issue === plan.parent && labels.slice(0, -1).every((operation) => operation.issue !== plan.parent)
    ? []
    : [problem("PARENT_NOT_ACTIVATED_LAST")];
}

export function verifyNoHarnessClaim({ claims }) {
  return Array.isArray(claims) && claims.length === 0 ? [] : [problem("HARNESS_CLAIM_DETECTED")];
}

export function verifyTrackerMatchesPlan({ plan, state }) {
  return plan.operations.flatMap((operation) => {
    const status = operationState(operation, stateIssue(plan, state, operation.issue));
    return status.status === "after" ? [] : [status.problem ?? problem("TRACKER_PLAN_MISMATCH", `${operation.kind}:${operation.issue}`)];
  });
}

export function verifyApprovalSingleConsumed({ approvalId, snapshot }) {
  const consumed = snapshot?.approvals?.consumed?.filter(({ id }) => id === approvalId) ?? [];
  const pending = snapshot?.approvals?.pending?.filter(({ id }) => id === approvalId) ?? [];
  return consumed.length === 1 && pending.length === 0 ? [] : [problem("APPROVAL_NOT_SINGLE_CONSUMED", approvalId)];
}

export function verifyTransactionCommitted({ transaction }) {
  return transaction?.state === "ADMISSION_COMMITTED" ? [] : [problem("ADMISSION_TRANSACTION_NOT_COMMITTED")];
}
