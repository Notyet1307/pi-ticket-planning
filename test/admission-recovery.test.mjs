import assert from "node:assert/strict";
import test from "node:test";

import {
  controlledLabels,
  immutableStateProblems,
  operationState,
  preActivationProblems,
  resourceStateProblems,
  stateIssue,
} from "../admission/recovery.mjs";
import { fingerprint } from "../execution-plan/domain.mjs";
import { executionInput } from "./execution-plan-fixture.mjs";

test("operation readback distinguishes before, partial, after, and conflict", () => {
  const comment = { kind: "comment", issue: "1", marker: "<!-- m -->", body: "exact\n<!-- m -->" };
  assert.equal(operationState(comment, undefined).status, "conflict");
  assert.equal(operationState(comment, { comments: [] }).status, "before");
  assert.equal(operationState(comment, { comments: [{ body: comment.body, authorVerified: true }] }).status, "after");
  assert.equal(operationState(comment, { comments: [comment.body] }).status, "conflict");
  assert.equal(operationState(comment, { comments: [{ body: comment.body, authorVerified: true }, { body: comment.body, authorVerified: true }] }).status, "conflict");

  const labels = { kind: "labels", issue: "1", before: ["needs-triage"], after: ["ready-for-agent"] };
  assert.equal(operationState(labels, { labels: ["ready-for-agent", "other"] }).status, "after");
  assert.equal(operationState(labels, { labels: ["needs-triage"] }).status, "before");
  assert.equal(operationState(labels, { labels: [] }).status, "partial");
  assert.equal(operationState(labels, { labels: ["needs-info"] }).status, "conflict");
  assert.equal(operationState({ kind: "unknown", issue: "1" }, { labels: [] }).status, "conflict");
  assert.deepEqual(controlledLabels(["other", "ready-for-human", "needs-triage", "ready-for-human"]), ["needs-triage", "ready-for-human"]);
  assert.deepEqual(controlledLabels(null), []);
  assert.equal(operationState(comment, { comments: [null, { body: 1 }] }).status, "before");
  assert.equal(operationState(labels, { }).status, "partial");
});

test("resource readback reports every immutable resource drift", () => {
  const resource = {
    issue: "1",
    parent: false,
    title: "Expected",
    state: "open",
    bodyHash: "sha256:expected",
    blockedBy: ["0"],
    controlledLabelsBefore: ["needs-triage"],
    controlledLabelsAfter: ["ready-for-agent"],
  };
  assert.equal(resourceStateProblems(resource, undefined)[0].code, "MISSING_PLAN_RESOURCE");
  const current = { title: "Changed", state: "closed", body: "body", blockedBy: null, labels: ["needs-info"] };
  const codes = new Set(resourceStateProblems(resource, current).map(({ code }) => code));
  for (const code of ["TITLE_MISMATCH", "ISSUE_NOT_OPEN", "BODY_HASH_MISMATCH", "INVALID_LIVE_BLOCKERS", "CONTROLLED_LABEL_DRIFT"]) {
    assert.equal(codes.has(code), true, code);
  }
  const blockerMismatch = resourceStateProblems(resource, { ...current, title: "Expected", state: "open", blockedBy: ["2"], labels: ["needs-triage"] });
  assert.equal(blockerMismatch.some(({ code }) => code === "NATIVE_GRAPH_MISMATCH"), true);
  const parent = { ...resource, parent: true, blockedBy: [] };
  assert.equal(resourceStateProblems(parent, { title: "Expected", state: "open", body: "body", labels: ["needs-triage"] }).some(({ code }) => code === "INVALID_LIVE_BLOCKERS"), false);
  assert.equal(resourceStateProblems(resource, { title: "Expected", state: "open", body: "body", blockedBy: ["0"], labels: ["ready-for-agent"] }).some(({ code }) => code === "CONTROLLED_LABEL_DRIFT"), false);
});

test("stateIssue and pre-activation cover every resource role", () => {
  const state = { parent: { id: "10" }, children: [{ id: "11" }], candidate: { id: "42", body: "body" }, source: {}, policy: {}, currentCheckpoint: {} };
  assert.equal(stateIssue({ kind: "STANDALONE" }, state, "42").id, "42");
  assert.equal(stateIssue({ kind: "STANDALONE" }, state, "9"), undefined);
  assert.equal(stateIssue({ kind: "DELIVERY_GRAPH" }, state, "10").id, "10");
  assert.equal(stateIssue({ kind: "DELIVERY_GRAPH" }, state, "11").id, "11");
  assert.equal(stateIssue({ kind: "DELIVERY_GRAPH" }, state, "99"), undefined);

  const plan = {
    kind: "STANDALONE",
    repo: "acme/product",
    target: "42",
    reviewed: {
      source: state.source,
      policy: state.policy,
      currentCheckpoint: state.currentCheckpoint,
      contextChecks: [],
      harness: null,
      review: { candidates: [{ executionLane: "HUMAN" }] },
      candidate: { issue: "42" },
      capabilityReceipt: null,
    },
    resources: [],
    operations: [{ kind: "comment", issue: "42", marker: "m", body: "b" }, { kind: "labels", issue: "42", before: [], after: ["ready-for-human"] }],
  };
  const problems = preActivationProblems(plan, { ...state, contextChecks: [], repositoryPath: "." });
  assert.equal(problems.some(({ code }) => code === "INCOMPLETE_PLAN_OPERATION"), true);
});

test("immutable state reports source, policy, checkpoint, context, capability, and candidate drift", () => {
  const plan = {
    kind: "STANDALONE",
    repo: "acme/product",
    target: "42",
    reviewed: {
      source: { id: "source" },
      policy: { id: "policy" },
      currentCheckpoint: { id: "checkpoint" },
      contextChecks: [],
      capabilityReceipt: { digest: "planned" },
      review: { candidates: [{ executionLane: "HUMAN" }] },
    },
    resources: [],
  };
  const state = {
    source: { id: "changed" },
    policy: { id: "changed" },
    currentCheckpoint: { id: "changed" },
    contextChecks: [{ changed: true }],
    capabilityReceipt: { digest: "current" },
    candidate: { id: "99", body: "body" },
    repositoryPath: ".",
  };
  const codes = new Set(immutableStateProblems(plan, state).map(({ code }) => code));
  for (const code of ["SOURCE_DRIFT", "POLICY_DRIFT", "CHECKPOINT_DRIFT", "CONTEXT_CHECK_DRIFT", "CAPABILITY_RECEIPT_DRIFT", "CANDIDATE_IDENTITY_DRIFT"]) {
    assert.equal(codes.has(code), true, code);
  }
});

test("standalone recovery rejects drifted Oracle/risk review metadata", () => {
  const fixture = executionInput();
  const candidate = structuredClone(fixture.children[0]);
  const source = structuredClone(fixture.source);
  const policy = structuredClone(fixture.policy);
  const currentCheckpoint = { id: "checkpoint" };
  const reviewedCandidate = structuredClone(fixture.review.candidates[0]);
  reviewedCandidate.riskClasses = ["FORGED_RISK_CLASS"];
  const plan = {
    kind: "STANDALONE",
    repo: fixture.repo,
    target: candidate.id,
    reviewed: {
      source,
      policy,
      currentCheckpoint,
      contextChecks: fixture.contextChecks,
      capabilityReceipt: null,
      harness: null,
      review: { candidates: [reviewedCandidate] },
    },
    resources: [],
  };
  const state = {
    source,
    policy,
    currentCheckpoint,
    contextChecks: fixture.contextChecks,
    capabilityReceipt: null,
    candidate,
    repositoryPath: fixture.repositoryPath,
  };
  assert.equal(immutableStateProblems(plan, state).some(({ code }) => code === "REVIEW_TICKET_CONTRACT_MISMATCH"), true);
});

test("delivery recovery rechecks tracked acceptance bytes", () => {
  const fixture = executionInput();
  const currentCheckpoint = { id: "checkpoint" };
  const plan = {
    kind: "DELIVERY_GRAPH",
    repo: fixture.repo,
    parent: fixture.parent.id,
    graphFingerprint: fingerprint(fixture.deliveryGraph),
    reviewed: {
      source: fixture.source,
      policy: fixture.policy,
      currentCheckpoint,
      contextChecks: fixture.contextChecks,
      capabilityReceipt: null,
      harness: null,
      roadmap: null,
      roadmapParent: null,
    },
    resources: [],
  };
  const state = {
    repositoryPath: fixture.repositoryPath,
    source: structuredClone(fixture.source),
    policy: structuredClone(fixture.policy),
    currentCheckpoint,
    contextChecks: structuredClone(fixture.contextChecks),
    capabilityReceipt: null,
    harness: null,
    parent: structuredClone(fixture.parent),
    specAcceptance: structuredClone(fixture.specAcceptance),
    deliveryGraph: structuredClone(fixture.deliveryGraph),
    children: structuredClone(fixture.children),
  };
  state.deliveryGraph.specAcceptanceBinding.sha256 = `sha256:${"0".repeat(64)}`;
  assert.equal(immutableStateProblems(plan, state).some(({ code }) => code === "SPEC_ACCEPTANCE_DRIFT"), true);
});
