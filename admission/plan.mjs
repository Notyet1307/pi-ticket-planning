import { validateAdmissionState } from "../scripts/check-admission-state.mjs";
import { hashText, parseDeliveryGraph } from "../scripts/check-delivery-graph.mjs";
import { verifyCandidateContextChecks } from "../scripts/check-ticket-context.mjs";
import { issue, nonEmpty, planError, validatePolicy, requireHarnessReadiness, validateReview, validateActivationCheckpoint, fingerprint, sameValues, buildResource, finalizePlan, PLAN_SCHEMA } from "./domain.mjs";

export function buildAdmissionPlan(input, { clock = Date.now } = {}) {
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
    repositoryPath: input.repositoryPath,
    source: input.source,
    parentBody: input.parent.body,
    children: input.children,
    contextChecks: input.contextChecks,
  });
  if (!admissionState.ok) throw planError("Admission state is not READY", admissionState.problems);

  if (!validatePolicy(input.policy)) {
    throw planError("accepted policy identity and sha256 digest are required");
  }
  requireHarnessReadiness(input.harness, input.repo, input.source?.baseSha, { fresh: true, now: clock() });
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
    contextChecks: input.contextChecks,
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

export function buildStandaloneAdmissionPlan(input, { clock = Date.now } = {}) {
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
  const contextCheckProblems = verifyCandidateContextChecks({
    repositoryPath: input.repositoryPath,
    candidates: [candidate],
    baseSha: input.source.baseSha,
    contextChecks: input.contextChecks,
  });
  if (contextCheckProblems.length > 0) throw planError("Ticket context check is not PASS", contextCheckProblems);
  if (!validatePolicy(input.policy)) throw planError("accepted policy identity and sha256 digest are required");
  if (!validateReview(input.review)) throw planError("review is not READY or does not use the fresh reviewer contract");
  const candidates = input.review.candidates ?? [];
  const reviewedCandidate = candidates.length === 1 && String(candidates[0].id) === String(candidate.id) ? candidates[0] : null;
  if (reviewedCandidate?.verdict !== "READY" || !["AGENT", "HUMAN"].includes(reviewedCandidate.executionLane)) {
    throw planError("standalone review must contain one exact READY candidate");
  }
  if (reviewedCandidate.executionLane === "AGENT") requireHarnessReadiness(input.harness, input.repo, input.source.baseSha, { fresh: true, now: clock() });

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
    contextChecks: input.contextChecks,
    policy: input.policy,
    harness: reviewedCandidate.executionLane === "AGENT" ? input.harness : null,
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
