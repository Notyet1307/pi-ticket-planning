import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  applyAdmissionPlan,
  buildAdmissionPlan,
  buildStandaloneAdmissionPlan,
} from "../scripts/admit.mjs";
import {
  DELIVERY_GRAPH_MARKER,
  hashText,
} from "../scripts/check-delivery-graph.mjs";
import {
  buildTicketContextResult,
  checkTicketContext,
} from "../scripts/check-ticket-context.mjs";
import { harnessReadiness } from "./readiness-fixture.mjs";
import { attachReviewBinding } from "./review-binding-fixture.mjs";
import { createPlanningCaseStore } from "../planning-case/store.mjs";
import { createFactAttestation } from "../protocol/kernel.mjs";

const repositoryPath = fileURLToPath(new URL("..", import.meta.url));
const baseSha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repositoryPath, encoding: "utf8" }).stdout.trim();

function input() {
  const specBody = "# Spec\n\n## Behavioral scenarios\n### S1: First\nFirst.\n\n### S2: Second\nSecond.";
  const children = [
    { id: "11", title: "First", body: "# First\n\nBody one.", blockedBy: [], labels: ["needs-triage", "bug"], state: "open", updatedAt: "t1", assignees: [], comments: [] },
    { id: "12", title: "Second", body: "# Second\n\nBody two.", blockedBy: ["11"], labels: ["needs-triage"], state: "open", updatedAt: "t2", assignees: [], comments: [] },
  ];
  const source = {
    identity: "R001",
    revision: "r2",
    baseSha,
    specContentHash: hashText(specBody),
  };
  const graph = {
    version: 2,
    source,
    scenarios: [
      { id: "S1", behavior: "First.", entry: "external:input", exit: "first", releaseSignal: "First.", smallestLoop: true },
      { id: "S2", behavior: "Second.", entry: "first", exit: "second", releaseSignal: "Second.", smallestLoop: true },
    ],
    children: [
      { id: "11", title: "First", coverageRole: "DIRECT", sourceScenarios: ["S1"], blockedBy: [], externalBlockers: [], bodyHash: hashText(children[0].body), startingState: "Input exists.", primaryVerification: "Verify first.", executionLane: "AGENT" },
      { id: "12", title: "Second", coverageRole: "DIRECT", sourceScenarios: ["S2"], blockedBy: ["11"], externalBlockers: [], bodyHash: hashText(children[1].body), startingState: "First exists.", primaryVerification: "Verify second.", executionLane: "HUMAN" },
    ],
    walkingSkeleton: ["11", "12"],
  };
  const parentBody = `${specBody}\n\n## Ticket coverage\n\n${DELIVERY_GRAPH_MARKER}\n\n\`\`\`json\n${JSON.stringify(graph)}\n\`\`\``;
  return attachReviewBinding({
    repo: "acme/product",
    repositoryPath,
    parent: { id: "10", title: "Delivery parent", body: parentBody, labels: ["needs-triage", "release"], state: "open", updatedAt: "tp", assignees: [], comments: [] },
    source,
    children,
    contextChecks: children.map((child) => ({
      candidateId: child.id,
      result: checkTicketContext({ repo: repositoryPath, base: source.baseSha, body: child.body }),
    })),
    policy: { identity: "AGENTS.md@abc", digest: `sha256:${"b".repeat(64)}`, accepted: true },
    harness: harnessReadiness("acme/product", baseSha),
    review: {
      schema: "pi-ticket-planning:admission-review:v1",
      reviewer: "ticket-readiness-reviewer",
      reviewedAt: "2026-08-16T12:00:00Z",
      graphVerdict: "READY",
      candidates: [
        { id: "11", verdict: "READY", executionLane: "AGENT" },
        { id: "12", verdict: "READY", executionLane: "HUMAN" },
      ],
    },
    currentCheckpoint: { lane: "DELIVERY", stage: "ADMISSION", identity: "10@r2", verdict: "ACTIVATION_AWAITING_CONFIRMATION" },
  });
}

class MemoryAdapter {
  constructor(admissionInput, failure) {
    this.state = structuredClone({
      repositoryPath: admissionInput.repositoryPath,
      source: admissionInput.source,
      policy: admissionInput.policy,
      harness: admissionInput.harness,
      currentCheckpoint: admissionInput.currentCheckpoint,
      contextChecks: admissionInput.contextChecks,
      parent: admissionInput.parent,
      children: admissionInput.children,
    });
    this.failure = failure;
    this.mutations = [];
  }

  read() {
    return structuredClone(this.state);
  }

  readIssue(issue) {
    return structuredClone(this.#issue(issue));
  }

  readClaims() {
    return this.state.children.filter(({ assignees }) => assignees.length > 0).map(({ id }) => id);
  }

  addComment(issue, body) {
    this.#fail("comment", issue, "before");
    this.#issue(issue).comments.push({ body, authorVerified: true });
    this.mutations.push(`comment:${issue}`);
    this.#fail("comment", issue, "after");
  }

  setControlledLabels(issue, controlledLabels) {
    this.#fail("labels", issue, "before");
    const item = this.#issue(issue);
    const controlled = new Set(["needs-triage", "needs-info", "ready-for-agent", "ready-for-human"]);
    item.labels = [...item.labels.filter((label) => !controlled.has(label)), ...controlledLabels];
    this.mutations.push(`labels:${issue}`);
    if (this.failure?.claimAfter === issue) item.assignees = ["harness"];
    this.#fail("labels", issue, "after");
  }

  #issue(issue) {
    if (String(this.state.parent.id) === String(issue)) return this.state.parent;
    const child = this.state.children.find(({ id }) => String(id) === String(issue));
    if (!child) throw new Error(`missing issue ${issue}`);
    return child;
  }

  #fail(kind, issue, timing) {
    if (!this.failure || this.failure.used) return;
    if (this.failure.kind === kind && String(this.failure.issue) === String(issue) && this.failure.timing === timing) {
      this.failure.used = true;
      throw new Error("injected failure");
    }
  }
}

const NOW = "2026-08-16T12:01:00.000Z";

function approval(plan, id = "F-human-activation") {
  return createFactAttestation({
    id,
    fact: "human.activation",
    value: true,
    subject: {
      target: `github:${plan.repo}`,
      kind: "admission-plan",
      id: plan.planFingerprint,
      revision: plan.reviewed.source.revision,
      digest: plan.planFingerprint,
    },
    source: {
      kind: "operator-asserted",
      producer: "operator",
      producerVersion: "human",
      producerDigest: `sha256:${"e".repeat(64)}`,
    },
    observedAt: "2026-08-16T12:00:00.000Z",
    expiresAt: "2026-08-16T13:00:00.000Z",
    evidence: { kind: "operator", ref: "exact-plan-confirmation", digest: plan.planFingerprint },
  });
}

function memoryCaseStore(plan, value = approval(plan)) {
  const snapshot = { target: `github:${plan.repo}`, approvals: { pending: [value], consumed: [] } };
  return {
    get({ target }) {
      assert.equal(target, snapshot.target);
      return structuredClone(snapshot);
    },
    consumeApproval({ approvalId }) {
      const index = snapshot.approvals.pending.findIndex(({ id }) => id === approvalId);
      if (index === -1) throw new Error("APPROVAL_ALREADY_CONSUMED");
      snapshot.approvals.consumed.push(snapshot.approvals.pending.splice(index, 1)[0]);
    },
    snapshot,
  };
}

function apply(plan, adapter) {
  adapter.caseStore ??= memoryCaseStore(plan);
  return applyAdmissionPlan(plan, adapter, {
    expectedFingerprint: plan.planFingerprint,
    planningCaseStore: adapter.caseStore,
    caseId: "PC-admission",
    approvalId: "F-human-activation",
    now: NOW,
  });
}

test("Admission apply converges once and rejects replay of its consumed approval", () => {
  const plan = buildAdmissionPlan(input());
  const adapter = new MemoryAdapter(input());
  const first = apply(plan, adapter);
  assert.equal(first.status, "COMPLETE");
  assert.deepEqual(adapter.mutations.filter((item) => item.startsWith("labels:")), ["labels:11", "labels:12", "labels:10"]);
  assert.deepEqual(adapter.state.children[0].labels.sort(), ["bug", "ready-for-agent"]);
  assert.deepEqual(adapter.state.children[1].labels, ["ready-for-human"]);
  assert.deepEqual(adapter.state.parent.labels.sort(), ["ready-for-agent", "release"]);

  const mutationCount = adapter.mutations.length;
  const second = apply(plan, adapter);
  assert.equal(second.status, "CONFLICT");
  assert.equal(second.problems.some(({ code }) => code === "APPROVAL_ALREADY_CONSUMED"), true);
  assert.equal(adapter.mutations.length, mutationCount);
});

test("Admission apply authorizes and consumes an exact approval in a persistent Planning Case", (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-admission-case-"));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const plan = buildAdmissionPlan(input());
  const store = createPlanningCaseStore({
    stateDir: path.join(parent, "state"),
    clock: () => NOW,
    idGenerator: () => "PC-admission",
  });
  store.create({ target: `github:${plan.repo}`, caseId: "PC-admission" });
  store.addApproval({ caseId: "PC-admission", approval: approval(plan) });
  const adapter = new MemoryAdapter(input());

  const result = applyAdmissionPlan(plan, adapter, {
    expectedFingerprint: plan.planFingerprint,
    planningCaseStore: store,
    caseId: "PC-admission",
    approvalId: "F-human-activation",
    now: NOW,
  });

  assert.equal(result.status, "COMPLETE");
  assert.deepEqual(store.get({ caseId: "PC-admission" }).approvals.pending, []);
  assert.deepEqual(store.get({ caseId: "PC-admission" }).approvals.consumed.map(({ id }) => id), ["F-human-activation"]);
  assert.equal(applyAdmissionPlan(plan, adapter, {
    expectedFingerprint: plan.planFingerprint,
    planningCaseStore: store,
    caseId: "PC-admission",
    approvalId: "F-human-activation",
    now: NOW,
  }).problems.some(({ code }) => code === "APPROVAL_ALREADY_CONSUMED"), true);
});

test("Admission apply rejects an approval for another exact Plan before any write", () => {
  const plan = buildAdmissionPlan(input());
  const foreign = approval(plan);
  foreign.subject.id = `sha256:${"f".repeat(64)}`;
  foreign.subject.digest = foreign.subject.id;
  const adapter = new MemoryAdapter(input());
  adapter.caseStore = memoryCaseStore(plan, foreign);

  const result = apply(plan, adapter);

  assert.equal(result.status, "CONFLICT");
  assert.equal(result.problems.some(({ code }) => code === "FACT_SUBJECT_MISMATCH"), true);
  assert.deepEqual(adapter.mutations, []);
});

test("Admission apply recovers a lost response after the server completed the write", () => {
  const plan = buildAdmissionPlan(input());
  const adapter = new MemoryAdapter(input(), { kind: "labels", issue: "11", timing: "after" });
  const result = apply(plan, adapter);
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.recovered.includes("labels:11"), true);
  assert.equal(adapter.state.parent.labels.includes("ready-for-agent"), true);
});

test("Admission apply stops on an uncompleted write and resumes safely", () => {
  const plan = buildAdmissionPlan(input());
  const adapter = new MemoryAdapter(input(), { kind: "labels", issue: "12", timing: "before" });
  const partial = apply(plan, adapter);
  assert.equal(partial.status, "PARTIAL");
  assert.equal(adapter.state.children[0].labels.includes("ready-for-agent"), true);
  assert.equal(adapter.state.children[1].labels.includes("needs-triage"), true);
  assert.equal(adapter.state.parent.labels.includes("needs-triage"), true);

  const resumed = apply(plan, adapter);
  assert.equal(resumed.status, "COMPLETE");
  assert.equal(adapter.state.parent.labels.includes("ready-for-agent"), true);
});

test("Admission apply rejects foreign drift before any write", () => {
  const plan = buildAdmissionPlan(input());
  const adapter = new MemoryAdapter(input());
  adapter.state.children[0].body += " foreign drift";
  const result = apply(plan, adapter);
  assert.equal(result.status, "CONFLICT");
  assert.equal(result.problems.some(({ code }) => code === "BODY_HASH_MISMATCH"), true);
  assert.deepEqual(adapter.mutations, []);
});

test("Admission apply rejects a changed Context check before any write", () => {
  const admissionInput = input();
  const plan = buildAdmissionPlan(admissionInput);
  const adapter = new MemoryAdapter(admissionInput);
  adapter.state.contextChecks[0].result = buildTicketContextResult({
    baseSha: admissionInput.source.baseSha,
    body: admissionInput.children[0].body,
    problems: [{ code: "CONTEXT_ANCHOR_NOT_FOUND" }],
  });

  const result = apply(plan, adapter);
  assert.equal(result.status, "CONFLICT");
  assert.equal(result.problems.some(({ code }) => code === "CONTEXT_CHECK_DRIFT"), true);
  assert.deepEqual(adapter.mutations, []);
});

test("Admission apply re-runs Context checks against the accepted-base checkout", () => {
  const admissionInput = input();
  const plan = buildAdmissionPlan(admissionInput);
  const adapter = new MemoryAdapter(admissionInput);
  adapter.state.repositoryPath = "/definitely/not/a/repository";

  const result = apply(plan, adapter);
  assert.equal(result.status, "CONFLICT");
  assert.equal(result.problems.some(({ code }) => code === "CONTEXT_CHECK_RECHECK_FAILED"), true);
  assert.deepEqual(adapter.mutations, []);
});

test("Admission apply binds a fresh stable Harness readiness projection", () => {
  const plan = buildAdmissionPlan(input());
  const drifted = new MemoryAdapter(input());
  drifted.state.harness.readiness.projection.configDigest = "e".repeat(64);
  const driftResult = apply(plan, drifted);
  assert.equal(driftResult.status, "CONFLICT");
  assert.equal(driftResult.problems.some(({ code }) => code === "HARNESS_READINESS_DRIFT"), true);
  assert.deepEqual(drifted.mutations, []);

  const missing = new MemoryAdapter(input());
  delete missing.state.harness.readiness;
  const missingResult = apply(plan, missing);
  assert.equal(missingResult.status, "CONFLICT");
  assert.equal(missingResult.problems.some(({ code }) => code === "HARNESS_READINESS_UNAVAILABLE"), true);
  assert.deepEqual(missing.mutations, []);
});

test("Admission apply accepts a new receipt instance with the same stable readiness facts", () => {
  const plan = buildAdmissionPlan(input());
  const adapter = new MemoryAdapter(input());
  adapter.state.harness.readiness.observedAt = new Date(Date.parse(adapter.state.harness.readiness.observedAt) + 1_000).toISOString();
  adapter.state.harness.readiness.receiptDigest = `sha256:${"9".repeat(64)}`;

  const result = apply(plan, adapter);
  assert.equal(result.status, "COMPLETE");
  assert.equal(adapter.state.parent.labels.includes("ready-for-agent"), true);
});

test("Admission apply never rolls labels back after a Harness claim", () => {
  const plan = buildAdmissionPlan(input());
  const adapter = new MemoryAdapter(input(), { claimAfter: "11" });
  const result = apply(plan, adapter);
  assert.equal(result.status, "CONFLICT");
  assert.equal(result.problems.some(({ code }) => code === "HARNESS_CLAIM_DETECTED"), true);
  assert.equal(adapter.state.children[0].labels.includes("ready-for-agent"), true);
  assert.equal(adapter.state.parent.labels.includes("needs-triage"), true);
});

test("Admission apply rechecks every child immediately before parent activation", () => {
  const plan = buildAdmissionPlan(input());
  const adapter = new MemoryAdapter(input());
  const originalSetLabels = adapter.setControlledLabels.bind(adapter);
  adapter.setControlledLabels = (issue, labels) => {
    originalSetLabels(issue, labels);
    if (String(issue) === "12") adapter.state.children[0].body += " concurrent drift";
  };

  const result = apply(plan, adapter);
  assert.equal(result.status, "CONFLICT");
  assert.equal(result.problems.some(({ code }) => code === "BODY_HASH_MISMATCH"), true);
  assert.equal(adapter.state.parent.labels.includes("needs-triage"), true);
  assert.equal(adapter.state.parent.labels.includes("ready-for-agent"), false);
});

test("Admission apply resumes a safe intermediate controlled-label state", () => {
  const plan = buildAdmissionPlan(input());
  const adapter = new MemoryAdapter(input());
  adapter.state.children[0].labels = ["bug"];

  const result = apply(plan, adapter);
  assert.equal(result.status, "COMPLETE");
  assert.deepEqual(adapter.state.children[0].labels.sort(), ["bug", "ready-for-agent"]);
});

test("standalone QUICK uses the same idempotent apply path", () => {
  const candidate = {
    id: "42",
    title: "Correct status output",
    body: "# Correct status output\n\n## Agent Brief\n\nReturn `Ready`.",
    blockedBy: [],
    labels: ["needs-triage", "copy"],
    state: "open",
    assignees: [],
    comments: [],
  };
  const standalone = {
    repo: "acme/product",
    repositoryPath,
    candidate,
    source: { identity: "accepted-status-behavior", revision: "r1", baseSha },
    policy: { identity: "AGENTS.md@abc", digest: `sha256:${"b".repeat(64)}`, accepted: true },
    harness: harnessReadiness("acme/product", baseSha),
    review: {
      schema: "pi-ticket-planning:admission-review:v1",
      reviewer: "ticket-readiness-reviewer",
      reviewedAt: "2026-08-16T12:00:00Z",
      graphVerdict: "READY",
      candidates: [{ id: "42", verdict: "READY", executionLane: "AGENT" }],
    },
    currentCheckpoint: { lane: "TRIAGE", stage: "ADMISSION", identity: "42@r1", verdict: "ACTIVATION_AWAITING_CONFIRMATION" },
  };
  standalone.contextChecks = [{
    candidateId: candidate.id,
    result: checkTicketContext({ repo: repositoryPath, base: standalone.source.baseSha, body: candidate.body }),
  }];
  attachReviewBinding(standalone);
  const plan = buildStandaloneAdmissionPlan(standalone);
  const adapter = {
    state: structuredClone({
      repositoryPath,
      source: standalone.source,
      policy: standalone.policy,
      harness: standalone.harness,
      currentCheckpoint: standalone.currentCheckpoint,
      contextChecks: standalone.contextChecks,
      candidate,
    }),
    mutations: [],
    read() { return structuredClone(this.state); },
    readIssue() { return structuredClone(this.state.candidate); },
    readClaims() { return []; },
    addComment(issue, body) { this.state.candidate.comments.push({ body, authorVerified: true }); this.mutations.push(`comment:${issue}`); },
    setControlledLabels(issue, labels) {
      this.state.candidate.labels = ["copy", ...labels];
      this.mutations.push(`labels:${issue}`);
    },
  };

  assert.equal(apply(plan, adapter).status, "COMPLETE");
  assert.equal(apply(plan, adapter).status, "CONFLICT");
  assert.deepEqual(adapter.mutations, ["comment:42", "labels:42"]);
  assert.deepEqual(adapter.state.candidate.labels.sort(), ["copy", "ready-for-agent"]);
});
