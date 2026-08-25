import { createFactAttestation, evaluateMutation, producerAttestationSource } from "../protocol/kernel.mjs";
import { requireAdmissionCapabilities } from "../capabilities/admission.mjs";
import { fingerprint, issue, safeError } from "./domain.mjs";
import { validateAdmissionPlan } from "./validate.mjs";
import { immutableStateProblems, preActivationProblems, operationState, resourceStateProblems, stateIssue } from "./recovery.mjs";
import {
  verifyApprovalSingleConsumed,
  verifyCommentsExactReadback,
  verifyLabelsExactControlledState,
  verifyNoHarnessClaim,
  verifyParentLast,
  verifyTrackerMatchesPlan,
  verifyTransactionCommitted,
} from "./postconditions.mjs";

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

const TRANSACTION_ORDER = [
  "ADMISSION_PLANNED",
  "ADMISSION_AUTHORIZED",
  "ADMISSION_APPLYING",
  "ADMISSION_EXTERNAL_COMPLETE",
  "ADMISSION_APPROVAL_CONSUMED",
  "ADMISSION_COMMITTED",
];

function transactionBinding(plan, options, now) {
  return {
    schema: "pi-ticket-planning:admission-transaction:v1",
    caseId: options.caseId,
    target: `github:${plan.repo}`,
    planFingerprint: plan.planFingerprint,
    reviewedFingerprint: plan.reviewedFingerprint,
    graphFingerprint: plan.graphFingerprint ?? null,
    sourceRevision: plan.reviewed.source.revision,
    approvalId: options.approvalId,
    mutationId: `admission:${plan.planFingerprint}`,
    state: "ADMISSION_PLANNED",
    startedAt: now,
    updatedAt: now,
    externalProjectionDigest: null,
    completedOperations: [],
  };
}

function sameTransaction(left, right) {
  return ["caseId", "target", "planFingerprint", "reviewedFingerprint", "graphFingerprint", "sourceRevision", "approvalId", "mutationId"]
    .every((field) => left?.[field] === right[field]);
}

function ensureTransaction(plan, options, now) {
  if (!options.planningCaseStore?.get || !options.planningCaseStore?.changeAdmissionTransaction
    || typeof options.caseId !== "string" || typeof options.approvalId !== "string") {
    return { problem: issue("PLANNING_CASE_TRANSACTION_REQUIRED") };
  }
  const expected = transactionBinding(plan, options, now);
  try {
    const snapshot = options.planningCaseStore.get({ caseId: options.caseId, target: expected.target });
    if (!snapshot.admissionTransaction) {
      options.planningCaseStore.changeAdmissionTransaction({ caseId: options.caseId, target: expected.target, transaction: expected });
      return { transaction: expected };
    }
    if (!sameTransaction(snapshot.admissionTransaction, expected)) return { problem: issue("ADMISSION_TRANSACTION_BINDING_DRIFT") };
    if (snapshot.admissionTransaction.state === "ADMISSION_CONFLICT") return { problem: issue("ADMISSION_TRANSACTION_CONFLICT") };
    return { transaction: snapshot.admissionTransaction };
  } catch (error) {
    return { problem: issue(/^[A-Z][A-Z0-9_]{0,127}$/.test(error?.code ?? "") ? error.code : "ADMISSION_TRANSACTION_FAILED") };
  }
}

function advanceTransaction(options, transaction, state, now, updates = {}) {
  if (transaction.state === state && Object.keys(updates).every((key) => JSON.stringify(transaction[key]) === JSON.stringify(updates[key]))) return transaction;
  if (TRANSACTION_ORDER.indexOf(transaction.state) > TRANSACTION_ORDER.indexOf(state)) return transaction;
  const next = { ...transaction, ...updates, state, updatedAt: now };
  options.planningCaseStore.changeAdmissionTransaction({ caseId: transaction.caseId, target: transaction.target, transaction: next });
  return next;
}

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

function agentPlan(plan) {
  return plan.kind === "DELIVERY_GRAPH" || plan.reviewed.review.candidates[0]?.executionLane === "AGENT";
}

function fact(plan, name, subject, sourceKind, evidence, now, mutationId) {
  return createFactAttestation({
    id: `F-${name.replaceAll(".", "-")}-${plan.planFingerprint.slice(-12)}`,
    fact: name,
    value: true,
    subject,
    source: producerAttestationSource(sourceKind, sourceKind),
    observedAt: now,
    expiresAt: null,
    mutationId,
    evidence,
  });
}

function mutationFacts(plan, approval, now, mutationId) {
  const subject = checkpointSubject(plan);
  const facts = [
    fact(plan, "source.unchanged", subject, plan.kind === "DELIVERY_GRAPH" ? "check-admission-state" : "admission-cli", {
      kind: "tracker",
      ref: `github:${plan.repo}#${plan.target}@${plan.reviewed.source.revision}`,
      digest: fingerprint(plan.reviewed.source),
    }, now, mutationId),
    fact(plan, "policy.accepted", subject, "git-policy-check", {
      kind: "artifact",
      ref: plan.reviewed.policy.identity,
      digest: plan.reviewed.policy.digest,
    }, now, mutationId),
    fact(plan, "review.ready", subject, "ticket-readiness-reviewer", {
      kind: "artifact",
      ref: plan.reviewed.reviewBinding.schema,
      digest: plan.reviewed.reviewBinding.inputDigest,
    }, now, mutationId),
    approval,
  ];
  if (plan.kind === "DELIVERY_GRAPH") {
    facts.splice(2, 0, fact(plan, "graph.passed", subject, "check-admission-state", {
      kind: "artifact",
      ref: `github:${plan.repo}#${plan.target}:delivery-graph`,
      digest: plan.graphFingerprint,
    }, now, mutationId));
  }
  if (agentPlan(plan)) {
    const receipt = plan.reviewed.capabilityReceipt;
    facts.splice(-1, 0, createFactAttestation({
      id: `F-capability-admission-${plan.planFingerprint.slice(-12)}`,
      fact: "capability.admissionReady",
      value: true,
      subject,
      source: producerAttestationSource("capability-receipt", "doctor"),
      observedAt: receipt.observedAt,
      expiresAt: receipt.expiresAt,
      evidence: { kind: "capability", ref: receipt.schema, digest: receipt.digest },
    }));
    const harness = plan.reviewed.harness.readiness;
    facts.splice(-1, 0, createFactAttestation({
      id: `F-harness-readiness-${plan.planFingerprint.slice(-12)}`,
      fact: "harness.readinessPassed",
      value: true,
      subject,
      source: producerAttestationSource("harness-ledger", "herdr-harness"),
      observedAt: harness.observedAt,
      expiresAt: new Date(Date.parse(harness.observedAt) + 60 * 60 * 1000).toISOString(),
      evidence: { kind: "harness", ref: harness.schema, digest: harness.receiptDigest },
    }));
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
  const now = options.now ?? new Date().toISOString();
  const transactionState = ensureTransaction(plan, options, now);
  if (transactionState.problem) return applyResult("CONFLICT", plan, [], [], [transactionState.problem]);
  let transaction = transactionState.transaction;
  if (agentPlan(plan)) {
    try {
      requireAdmissionCapabilities(plan.reviewed.capabilityReceipt, {
        repo: plan.repo,
        baseSha: plan.reviewed.source.baseSha,
        now,
        matrix: options.compatibilityMatrix,
      });
    } catch (error) {
      return applyResult("CONFLICT", plan, [], [], [issue(error instanceof Error ? error.message : "CAPABILITY_RECEIPT_REQUIRED")]);
    }
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
  const mutationId = `admission:${plan.planFingerprint}`;
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
  if (transaction.state === "ADMISSION_PLANNED") {
    const authorization = evaluateMutation({
      mutation: plan.kind === "DELIVERY_GRAPH"
        ? "admission.apply"
        : agentPlan(plan) ? "admission.applyStandaloneAgent" : "admission.applyStandaloneHuman",
      actor: "admission-cli",
      transition,
      facts: mutationFacts(plan, approvalState.approval, now, mutationId),
      consumedApprovalIds: approvalState.consumedApprovalIds,
      mutationId,
      now,
    });
    if (!authorization.allowed) return applyResult("CONFLICT", plan, [], [], authorization.problems);
    try {
      transaction = advanceTransaction(options, transaction, "ADMISSION_AUTHORIZED", now);
    } catch (error) {
      return applyResult("CONFLICT", plan, [], [], [issue(error?.code ?? "ADMISSION_TRANSACTION_FAILED")]);
    }
  }
  try {
    if (transaction.state === "ADMISSION_AUTHORIZED") transaction = advanceTransaction(options, transaction, "ADMISSION_APPLYING", now);
  } catch (error) {
    return applyResult("CONFLICT", plan, [], [], [issue(error?.code ?? "ADMISSION_TRANSACTION_FAILED")]);
  }

  const changed = [];
  const recovered = [];
  const externalAlreadyComplete = ["ADMISSION_EXTERNAL_COMPLETE", "ADMISSION_APPROVAL_CONSUMED", "ADMISSION_COMMITTED"].includes(transaction.state);
  for (const operation of externalAlreadyComplete ? [] : plan.operations) {
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
    if (status.status === "after") {
      const identity = `${operation.kind}:${operation.issue}`;
      if (!transaction.completedOperations.includes(identity)) {
        try {
          transaction = advanceTransaction(options, transaction, "ADMISSION_APPLYING", now, { completedOperations: [...transaction.completedOperations, identity] });
        } catch (error) {
          return applyResult("PARTIAL", plan, changed, recovered, [issue(error?.code ?? "ADMISSION_TRANSACTION_FAILED")]);
        }
      }
      continue;
    }
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
      try {
        transaction = advanceTransaction(options, transaction, "ADMISSION_APPLYING", now, { completedOperations: [...transaction.completedOperations, identity] });
      } catch (error) {
        return applyResult("PARTIAL", plan, changed, recovered, [issue(error?.code ?? "ADMISSION_TRANSACTION_FAILED")]);
      }
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
    if (transaction.state === "ADMISSION_APPLYING") {
      transaction = advanceTransaction(options, transaction, "ADMISSION_EXTERNAL_COMPLETE", now, {
        externalProjectionDigest: fingerprint(current),
        completedOperations: plan.operations.map((operation) => `${operation.kind}:${operation.issue}`),
      });
    }
  } catch (error) {
    return applyResult("PARTIAL", plan, changed, recovered, [issue(error?.code ?? "ADMISSION_TRANSACTION_FAILED")]);
  }

  if (transaction.state === "ADMISSION_EXTERNAL_COMPLETE") {
    try {
      if (!approvalState.consumedApprovalIds.includes(options.approvalId)) {
        options.planningCaseStore.consumeApproval({
          caseId: options.caseId,
          target: `github:${plan.repo}`,
          approvalId: options.approvalId,
        });
      }
      transaction = advanceTransaction(options, transaction, "ADMISSION_APPROVAL_CONSUMED", now);
    } catch (error) {
      const code = /^[A-Z][A-Z0-9_]{0,127}$/.test(error?.code ?? "") ? error.code : "APPROVAL_CONSUME_FAILED";
      return applyResult("PARTIAL", plan, changed, recovered, [issue(code)]);
    }
  }
  try {
    if (transaction.state === "ADMISSION_APPROVAL_CONSUMED") transaction = advanceTransaction(options, transaction, "ADMISSION_COMMITTED", now);
  } catch (error) {
    return applyResult("PARTIAL", plan, changed, recovered, [issue(error?.code ?? "ADMISSION_TRANSACTION_FAILED")]);
  }
  try {
    const snapshot = options.planningCaseStore.get({ caseId: options.caseId, target: transaction.target });
    const postconditions = [
      ...verifyCommentsExactReadback({ plan, state: current }),
      ...verifyLabelsExactControlledState({ plan, state: current }),
      ...(plan.kind === "DELIVERY_GRAPH" ? verifyParentLast({ plan }) : []),
      ...verifyNoHarnessClaim({ claims: adapter.readClaims() }),
      ...verifyTrackerMatchesPlan({ plan, state: current }),
      ...verifyApprovalSingleConsumed({ approvalId: options.approvalId, snapshot }),
      ...verifyTransactionCommitted({ transaction }),
    ];
    if (postconditions.length > 0) return applyResult("CONFLICT", plan, changed, recovered, postconditions);
  } catch (error) {
    return applyResult("CONFLICT", plan, changed, recovered, [issue(error?.code ?? "POSTCONDITION_READBACK_FAILED")]);
  }
  return applyResult("COMPLETE", plan, changed, recovered);
}
