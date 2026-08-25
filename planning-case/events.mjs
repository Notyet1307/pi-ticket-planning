import {
  evaluateTransition,
  validateArtifact,
  validateFactAttestation,
} from "../protocol/kernel.mjs";

const ADMISSION_TRANSITIONS = {
  ADMISSION_PLANNED: ["ADMISSION_AUTHORIZED", "ADMISSION_CONFLICT"],
  ADMISSION_AUTHORIZED: ["ADMISSION_APPLYING", "ADMISSION_CONFLICT"],
  ADMISSION_APPLYING: ["ADMISSION_APPLYING", "ADMISSION_EXTERNAL_COMPLETE", "ADMISSION_CONFLICT"],
  ADMISSION_EXTERNAL_COMPLETE: ["ADMISSION_APPROVAL_CONSUMED", "ADMISSION_CONFLICT"],
  ADMISSION_APPROVAL_CONSUMED: ["ADMISSION_COMMITTED", "ADMISSION_CONFLICT"],
  ADMISSION_COMMITTED: [],
  ADMISSION_CONFLICT: [],
};

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function clone(value) {
  return structuredClone(value);
}

function addUnique(items, value, code = "DUPLICATE_CASE_RECORD") {
  if (items.some(({ id }) => id === value.id)) fail(code);
  items.push(clone(value));
}

function immutableAdmissionFields(transaction) {
  return [
    transaction.caseId,
    transaction.target,
    transaction.planFingerprint,
    transaction.reviewedFingerprint,
    transaction.graphFingerprint,
    transaction.sourceRevision,
    transaction.approvalId,
    transaction.mutationId,
    transaction.startedAt,
  ];
}

export function noNextAction(reasonCode = "TERMINAL_STATE") {
  return {
    kind: "NONE",
    command: null,
    skill: null,
    requiredInputs: [],
    blockingFacts: [],
    contextRoute: null,
    reasonCode,
  };
}

export function reducePlanningCaseEvent(snapshot, event, { protocol, now = event.at } = {}) {
  if (event.type === "CASE_CREATED") {
    if (snapshot !== null) fail("INVALID_CASE_EVENT");
    return clone(event.data.snapshot);
  }
  if (!snapshot) fail("INVALID_CASE_EVENT");
  const next = clone(snapshot);
  const data = event.data;

  if (event.type === "CHECKPOINT_TRANSITIONED") {
    const checked = evaluateTransition({
      current: next.checkpoint,
      proposed: data.checkpoint,
      facts: data.facts,
      consumedFactIds: next.consumedFactIds,
      mutationId: data.mutationId ?? undefined,
      now,
      rebind: data.rebind,
    }, { protocol });
    if (!checked.allowed) fail(checked.problems[0]?.code ?? "CHECKPOINT_TRANSITION_REJECTED");
    for (const fact of data.facts) if (!next.facts.some(({ id }) => id === fact.id)) next.facts.push(clone(fact));
    next.lastCheckpoint = clone(next.checkpoint);
    next.checkpoint = clone(data.checkpoint);
    next.nextAction = clone(data.nextAction);
  } else if (event.type === "CANDIDATE_SELECTED") {
    if (next.selectedCandidate && next.selectedCandidate.id !== data.candidate.id) fail("CANDIDATE_ALREADY_SELECTED");
    next.selectedCandidate = clone(data.candidate);
  } else if (event.type === "CANDIDATE_EXCLUDED") {
    if (next.selectedCandidate?.id === data.candidate.id) fail("SELECTED_CANDIDATE_CANNOT_BE_EXCLUDED");
    addUnique(next.excludedCandidates, data.candidate, "DUPLICATE_EXCLUDED_CANDIDATE");
  } else if (event.type === "DECISION_RECORDED") {
    addUnique(next.decisions, data.decision, "DUPLICATE_DECISION");
  } else if (event.type === "UNKNOWN_RECORDED") {
    if (data.unknown.status !== "OPEN" || data.unknown.resolution !== null || data.unknown.evidenceDigest !== null) fail("INVALID_OPEN_UNKNOWN");
    addUnique(next.unknowns, data.unknown, "DUPLICATE_UNKNOWN");
  } else if (event.type === "UNKNOWN_RESOLVED") {
    const unknown = next.unknowns.find(({ id }) => id === data.unknownId);
    if (!unknown || unknown.status !== "OPEN") fail("UNKNOWN_NOT_OPEN");
    Object.assign(unknown, { status: "RESOLVED", resolution: data.resolution, evidenceDigest: data.evidenceDigest });
  } else if (event.type === "ASSUMPTION_RECORDED") {
    if (data.assumption.status !== "ACTIVE") fail("INVALID_ACTIVE_ASSUMPTION");
    addUnique(next.assumptions, data.assumption, "DUPLICATE_ASSUMPTION");
  } else if (event.type === "ASSUMPTION_REVISED") {
    const assumption = next.assumptions.find(({ id }) => id === data.assumptionId);
    if (!assumption || assumption.status !== "ACTIVE") fail("ASSUMPTION_NOT_ACTIVE");
    Object.assign(assumption, { status: "REVISED", statement: data.statement, evidenceDigest: data.evidenceDigest });
  } else if (event.type === "EVIDENCE_METHOD_SET") {
    next.evidenceMethod = clone(data.method);
  } else if (event.type === "EVIDENCE_RECORDED") {
    addUnique(next.evidence, data.evidence, "DUPLICATE_EVIDENCE");
  } else if (event.type === "FACT_ATTACHED") {
    const checked = validateFactAttestation(data.fact, { protocol, now, consumedFactIds: next.consumedFactIds });
    if (!checked.ok || data.fact.subject.target !== next.target) fail(checked.problems[0]?.code ?? "FACT_TARGET_MISMATCH");
    addUnique(next.facts, data.fact, "DUPLICATE_FACT");
  } else if (event.type === "FACT_CONSUMED") {
    if (!next.facts.some(({ id }) => id === data.factId) || next.consumedFactIds.includes(data.factId)) fail("FACT_NOT_CONSUMABLE");
    next.consumedFactIds.push(data.factId);
  } else if (event.type === "BLOCKER_SET") {
    next.blocker = clone(data.blocker);
  } else if (event.type === "BLOCKER_CLEARED") {
    if (next.blocker?.id !== data.id) fail("BLOCKER_NOT_FOUND");
    next.blocker = null;
  } else if (event.type === "NEXT_ACTION_SET") {
    next.nextAction = clone(data.nextAction);
  } else if (event.type === "BINDING_SET") {
    next.bindings[data.name] = clone(data.binding);
  } else if (event.type === "BINDING_CLEARED") {
    next.bindings[data.name] = null;
  } else if (event.type === "APPROVAL_ADDED") {
    if ([...next.approvals.pending, ...next.approvals.consumed].some(({ id }) => id === data.approval.id)) fail("DUPLICATE_APPROVAL");
    next.approvals.pending.push(clone(data.approval));
  } else if (event.type === "APPROVAL_CONSUMED") {
    if (next.approvals.consumed.some(({ id }) => id === data.id)) fail("APPROVAL_ALREADY_CONSUMED");
    const index = next.approvals.pending.findIndex(({ id }) => id === data.id);
    if (index === -1) fail("APPROVAL_NOT_FOUND");
    next.approvals.consumed.push(next.approvals.pending.splice(index, 1)[0]);
  } else if (event.type === "ADMISSION_TRANSACTION_CHANGED") {
    const current = next.admissionTransaction;
    const transaction = data.transaction;
    if (transaction.caseId !== next.caseId || transaction.target !== next.target) fail("ADMISSION_TRANSACTION_SUBJECT_MISMATCH");
    if (current) {
      if (JSON.stringify(immutableAdmissionFields(current)) !== JSON.stringify(immutableAdmissionFields(transaction))) fail("ADMISSION_TRANSACTION_BINDING_DRIFT");
      if (!ADMISSION_TRANSITIONS[current.state]?.includes(transaction.state)) fail("ILLEGAL_ADMISSION_TRANSACTION_TRANSITION");
      if (!current.completedOperations.every((operation) => transaction.completedOperations.includes(operation))) fail("ADMISSION_TRANSACTION_PROGRESS_DRIFT");
    } else if (transaction.state !== "ADMISSION_PLANNED") fail("ADMISSION_TRANSACTION_NOT_PLANNED");
    if (["ADMISSION_EXTERNAL_COMPLETE", "ADMISSION_APPROVAL_CONSUMED", "ADMISSION_COMMITTED"].includes(transaction.state)
      && transaction.externalProjectionDigest === null) fail("ADMISSION_EXTERNAL_PROJECTION_MISSING");
    if (["ADMISSION_APPROVAL_CONSUMED", "ADMISSION_COMMITTED"].includes(transaction.state)
      && !next.approvals.consumed.some(({ id }) => id === transaction.approvalId)) fail("ADMISSION_APPROVAL_NOT_CONSUMED");
    next.admissionTransaction = clone(transaction);
  } else if (event.type === "OUTCOME_INGESTED") {
    if (data.receipt.subject.target !== next.target) fail("OUTCOME_SUBJECT_MISMATCH");
    next.bindings.outcome = clone(data.receipt);
  } else if (event.type === "LEARNING_DECISION_RECORDED") {
    if (!next.approvals.consumed.some(({ id }) => id === data.learning.operatorApproval)
      || next.bindings.outcome?.digest !== data.learning.outcomeReceiptDigest
      || data.learning.subject.target !== next.target) fail("INVALID_LEARNING_DECISION");
    next.learningDecisions.push(clone(data.learning));
  } else if (event.type === "CASE_ABANDONED") {
    next.blocker = { id: "case-abandoned", code: "CASE_ABANDONED", reason: data.reason, requiredFacts: [] };
    next.nextAction = noNextAction("CASE_ABANDONED");
  } else fail("UNKNOWN_CASE_EVENT");

  const checked = validateArtifact(next);
  if (!checked.ok) fail(checked.problems[0]?.code ?? "INVALID_CASE_SNAPSHOT");
  return next;
}
