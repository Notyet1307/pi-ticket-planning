import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  DELIVERY_GRAPH_MARKER,
  hashText,
} from "../scripts/check-delivery-graph.mjs";
import {
  buildAdmissionPlan,
  buildStandaloneAdmissionPlan,
  createGitHubAdapter,
  fingerprint,
  validateAdmissionPlan,
} from "../scripts/admit.mjs";
import {
  buildTicketContextResult,
  checkTicketContext,
} from "../scripts/check-ticket-context.mjs";
import { harnessReadiness } from "./readiness-fixture.mjs";
import { attachReviewBinding } from "./review-binding-fixture.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseSha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
const READY_AXES = Object.fromEntries(["candidateReadiness", "contextQuality", "deliveryGraph", "scenarioCoverage", "walkingSkeleton", "strictFrontier", "executionLane", "inputBinding"].map((name) => [name, "PASS"]));
const graphFixture = JSON.parse(fs.readFileSync(path.join(root, "fixtures", "admission-cases.json"), "utf8"))
  .graphCases.find(({ expectedGraphVerdict }) => expectedGraphVerdict === "READY");

function checkpoint(lane, id, revision) {
  return {
    schema: "pi-ticket-planning:checkpoint:v2",
    lane,
    stage: "ADMISSION",
    verdict: "ACTIVATION_AWAITING_CONFIRMATION",
    subject: { target: "github:acme/product", kind: "ticket", id, revision, digest: `sha256:${"d".repeat(64)}` },
  };
}

function readyInput() {
  const { id: _id, expectedGraphVerdict: _verdict, expectedProblemCodes: _codes, ...snapshot } = structuredClone(graphFixture);
  for (const child of snapshot.children) child.externalBlockers ??= [];
  snapshot.source.baseSha = baseSha;
  snapshot.children[0].id = "101";
  snapshot.children[1].id = "102";
  snapshot.children[1].blockedBy = ["101"];
  snapshot.children[1].executionLane = "HUMAN";
  snapshot.walkingSkeleton = ["101", "102"];
  const specBody = [
    "# Delivery Spec",
    "",
    "## Behavioral scenarios",
    "### S1: Accept inputs",
    "Accepted behavior.",
    "",
    "### S2: Return result",
    "Accepted behavior.",
  ].join("\n");
  const children = [
    {
      id: "101",
      title: "Accept comparison inputs",
      body: "# Accept comparison inputs\n\nExact reviewed body.",
      blockedBy: [],
      labels: ["needs-triage", "product"],
      state: "open",
      updatedAt: "2026-08-16T10:00:00Z",
    },
    {
      id: "102",
      title: "Return an explainable result",
      body: "# Return an explainable result\n\nExact reviewed body.",
      blockedBy: ["101"],
      labels: ["needs-triage"],
      state: "open",
      updatedAt: "2026-08-16T10:01:00Z",
    },
  ];
  snapshot.source.specContentHash = hashText(specBody);
  snapshot.children[0].bodyHash = hashText(children[0].body);
  snapshot.children[1].bodyHash = hashText(children[1].body);
  const parentBody = `${specBody}\n\n## Ticket coverage\n\n${DELIVERY_GRAPH_MARKER}\n\n\`\`\`json\n${JSON.stringify(snapshot)}\n\`\`\``;
  return attachReviewBinding({
    repo: "acme/product",
    repositoryPath: root,
    parent: {
      id: "100",
      title: "Deliver comparison behavior",
      body: parentBody,
      labels: ["needs-triage", "release"],
      state: "open",
      updatedAt: "2026-08-16T10:02:00Z",
    },
    source: structuredClone(snapshot.source),
    children,
    contextChecks: children.map((child) => ({
      candidateId: child.id,
      result: checkTicketContext({ repo: root, base: snapshot.source.baseSha, body: child.body }),
    })),
    policy: {
      identity: "AGENTS.md@1111111",
      digest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      accepted: true,
    },
    harness: harnessReadiness("acme/product", baseSha),
    review: {
      schema: "pi-ticket-planning:admission-review:v1",
      reviewer: "ticket-readiness-reviewer",
      reviewedAt: "2026-08-16T10:03:00Z",
      source: structuredClone(snapshot.source),
      axes: READY_AXES,
      graphVerdict: "READY",
      candidates: [
        { id: "101", verdict: "READY", executionLane: "AGENT" },
        { id: "102", verdict: "READY", executionLane: "HUMAN" },
      ],
    },
    currentCheckpoint: checkpoint("DELIVERY", "100", snapshot.source.revision),
  });
}

function standaloneInput() {
  const candidate = {
    id: "42",
    title: "Correct status output",
    body: "# Correct status output\n\n## Agent Brief\n\nReturn `Ready`.",
    blockedBy: [],
    labels: ["needs-triage", "copy"],
    state: "open",
  };
  const source = {
    identity: "accepted-status-behavior",
    revision: "r1",
    baseSha,
  };
  return attachReviewBinding({
    repo: "acme/product",
    repositoryPath: root,
    candidate,
    source,
    contextChecks: [{
      candidateId: candidate.id,
      result: checkTicketContext({ repo: root, base: source.baseSha, body: candidate.body }),
    }],
    policy: {
      identity: "AGENTS.md@1111111",
      digest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      accepted: true,
    },
    harness: harnessReadiness("acme/product", baseSha),
    review: {
      schema: "pi-ticket-planning:admission-review:v1",
      reviewer: "ticket-readiness-reviewer",
      reviewedAt: "2026-08-16T10:03:00Z",
      source,
      axes: READY_AXES,
      graphVerdict: "READY",
      candidates: [{ id: "42", verdict: "READY", executionLane: "AGENT" }],
    },
    currentCheckpoint: checkpoint("TRIAGE", "42", "r1"),
  });
}

test("Admission Plan is deterministic and activates children before the parent", () => {
  const first = buildAdmissionPlan(readyInput());
  const second = buildAdmissionPlan(readyInput());
  assert.equal(first.planFingerprint, second.planFingerprint);
  assert.equal(first.reviewedFingerprint, second.reviewedFingerprint);
  assert.equal(first.graphFingerprint, second.graphFingerprint);
  assert.equal(first.reviewedFingerprint, fingerprint(first.reviewed));
  const withoutContextChecks = structuredClone(first.reviewed);
  delete withoutContextChecks.contextChecks;
  assert.notEqual(first.reviewedFingerprint, fingerprint(withoutContextChecks));
  assert.deepEqual(validateAdmissionPlan(first), { ok: true, problems: [] });

  const labelOperations = first.operations.filter(({ kind }) => kind === "labels");
  assert.deepEqual(labelOperations.map(({ issue }) => issue), ["101", "102", "100"]);
  assert.deepEqual(labelOperations[0].after, ["ready-for-agent"]);
  assert.deepEqual(labelOperations[1].after, ["ready-for-human"]);
  assert.deepEqual(labelOperations[2].after, ["ready-for-agent"]);
  assert.equal(first.operations.at(-1).issue, "100");
  assert.match(first.operations[0].body, new RegExp(`Plan fingerprint: ${first.planFingerprint}`));
});

test("Admission Plan records exact additions/removals without controlling unrelated labels", () => {
  const plan = buildAdmissionPlan(readyInput());
  const firstChild = plan.resources.find(({ issue }) => issue === "101");
  assert.deepEqual(firstChild.observedLabels, ["needs-triage", "product"]);
  assert.deepEqual(firstChild.controlledLabelsBefore, ["needs-triage"]);
  assert.deepEqual(firstChild.controlledLabelsAfter, ["ready-for-agent"]);
  assert.deepEqual(firstChild.addLabels, ["ready-for-agent"]);
  assert.deepEqual(firstChild.removeLabels, ["needs-triage"]);
});

test("Admission Plan fails closed on reviewer or reviewed-body drift", () => {
  const rejectedReview = readyInput();
  rejectedReview.review.candidates[0].verdict = "NEEDS_INFO";
  assert.throws(() => buildAdmissionPlan(rejectedReview), /review is not READY/);

  const bodyDrift = readyInput();
  bodyDrift.children[0].body += " changed";
  assert.throws(() => buildAdmissionPlan(bodyDrift), /BODY_HASH_MISMATCH/);

  const titleDrift = readyInput();
  titleDrift.children[0].title = "Different scope";
  assert.throws(() => buildAdmissionPlan(titleDrift), /TITLE_MISMATCH/);

  const closed = readyInput();
  closed.children[0].state = "closed";
  assert.throws(() => buildAdmissionPlan(closed), /ISSUE_NOT_OPEN/);

  const missingHarnessReceipt = readyInput();
  delete missingHarnessReceipt.harness.readiness;
  assert.throws(() => buildAdmissionPlan(missingHarnessReceipt), /executed Harness readiness receipt is required/);

  const unsafeHarnessGate = readyInput();
  unsafeHarnessGate.harness.readiness.projection.delivery.inspection.bypassActorsPresent = true;
  assert.throws(() => buildAdmissionPlan(unsafeHarnessGate), /not Admission-safe/);
});

test("Admission Plan rejects a Reviewer bound to another exact input", () => {
  const forged = readyInput();
  forged.review.inputBinding.inputDigest = `sha256:${"f".repeat(64)}`;
  assert.throws(() => buildAdmissionPlan(forged), /exact review input/);

  const plan = buildAdmissionPlan(readyInput());
  plan.reviewed.reviewBinding.inputDigest = `sha256:${"e".repeat(64)}`;
  const checked = validateAdmissionPlan(plan);
  assert.equal(checked.ok, false);
  assert.equal(checked.problems.some(({ code }) => ["REVIEWED_FINGERPRINT_MISMATCH", "REVIEW_INPUT_BINDING_MISMATCH"].includes(code)), true);
});

test("Admission Plan requires the exact activation checkpoint", () => {
  const wrongVerdict = readyInput();
  wrongVerdict.currentCheckpoint.verdict = "BLOCKED";
  assert.throws(() => buildAdmissionPlan(wrongVerdict), /ACTIVATION_AWAITING_CONFIRMATION/);

  const wrongIdentity = readyInput();
  wrongIdentity.currentCheckpoint.subject.id = "999";
  assert.throws(() => buildAdmissionPlan(wrongIdentity), /CHECKPOINT_IDENTITY_MISMATCH/);
});

test("standalone QUICK produces one exact Admission Plan", () => {
  const plan = buildStandaloneAdmissionPlan(standaloneInput());
  assert.equal(plan.kind, "STANDALONE");
  assert.equal(plan.target, "42");
  assert.deepEqual(plan.resources.map(({ issue }) => issue), ["42"]);
  assert.deepEqual(plan.operations.map(({ kind }) => kind), ["comment", "labels"]);
  assert.deepEqual(plan.operations[1].after, ["ready-for-agent"]);
  assert.deepEqual(validateAdmissionPlan(plan), { ok: true, problems: [] });
  assert.match(plan.operations[0].body, new RegExp(`Plan fingerprint: ${plan.planFingerprint}`));
});

test("standalone HUMAN work does not require a Harness execution receipt", () => {
  const human = standaloneInput();
  human.review.candidates[0].executionLane = "HUMAN";
  delete human.harness;
  attachReviewBinding(human);
  const plan = buildStandaloneAdmissionPlan(human);

  assert.equal(plan.reviewed.harness, null);
  assert.deepEqual(plan.resources[0].controlledLabelsAfter, ["ready-for-human"]);
  assert.deepEqual(validateAdmissionPlan(plan), { ok: true, problems: [] });
});

test("standalone QUICK rejects a missing or failed Context check", () => {
  const missing = standaloneInput();
  delete missing.contextChecks;
  assert.throws(() => buildStandaloneAdmissionPlan(missing), /MISSING_CONTEXT_CHECKS/);

  const failed = standaloneInput();
  failed.contextChecks[0].result = buildTicketContextResult({
    baseSha: failed.source.baseSha,
    body: failed.candidate.body,
    problems: [{ code: "CONTEXT_ANCHOR_NOT_FOUND" }],
  });
  assert.throws(() => buildStandaloneAdmissionPlan(failed), /CONTEXT_CHECK_FAILED/);

  const forged = standaloneInput();
  forged.candidate.body += "\n\n## Context anchors\n\n- `src/missing-at-base.mjs` — Locate the behavior entry point.\n";
  forged.contextChecks[0].result = buildTicketContextResult({
    baseSha: forged.source.baseSha,
    body: forged.candidate.body,
    anchors: [{
      path: "src/missing-at-base.mjs",
      blobSha: "b".repeat(40),
      purpose: "Locate the behavior entry point.",
    }],
  });
  assert.throws(() => buildStandaloneAdmissionPlan(forged), /CONTEXT_CHECK_RECHECK_FAILED/);
});

test("Admission Plan validation detects any changed approved operation", () => {
  const plan = buildAdmissionPlan(readyInput());
  plan.operations.at(-1).after = ["ready-for-human"];
  const checked = validateAdmissionPlan(plan);
  assert.equal(checked.ok, false);
  assert.equal(checked.problems.some(({ code }) => code === "INVALID_PLAN_LABEL_OPERATION"), true);

  const structurallyInvalid = buildAdmissionPlan(readyInput());
  [structurallyInvalid.operations[0], structurallyInvalid.operations[2]] = [structurallyInvalid.operations[2], structurallyInvalid.operations[0]];
  const semanticCheck = validateAdmissionPlan(structurallyInvalid);
  assert.equal(semanticCheck.ok, false);
  assert.equal(semanticCheck.problems.some(({ code }) => code === "INVALID_PLAN_COMMENT_OPERATION"), true);
});

test("GitHub Admission rejects an ambiguous target before any API call", () => {
  assert.throws(
    () => createGitHubAdapter({ repo: "acme/product", kind: "STANDALONE", target: "undefined", context: {} }),
    /positive GitHub Issue number/,
  );
});

test("GitHub and Clock boundaries are injectable", () => {
  const calls = [];
  const adapter = createGitHubAdapter({
    repo: "acme/product",
    kind: "STANDALONE",
    target: "42",
    context: { source: { identity: "R1", revision: "r1", baseSha: "a".repeat(40) } },
    runJson(args) {
      calls.push(args);
      const endpoint = args.at(-1);
      if (args.includes("--paginate")) return [[]];
      if (endpoint === "repos/acme/product/issues/42") {
        return { number: 42, title: "Probe", body: "Body", labels: [], state: "open", updated_at: "2026-08-25T00:00:00Z", assignees: [] };
      }
      throw new Error(`unexpected fake endpoint ${endpoint}`);
    },
  });
  assert.equal(adapter.read().candidate.id, "42");
  assert.equal(calls.length, 3);

  const input = readyInput();
  input.harness.readiness.observedAt = "2026-08-25T00:00:00.000Z";
  assert.doesNotThrow(() => buildAdmissionPlan(input, { clock: () => Date.parse("2026-08-25T00:30:00.000Z") }));
  assert.throws(
    () => buildAdmissionPlan(input, { clock: () => Date.parse("2026-08-25T02:00:00.000Z") }),
    /freshness window/,
  );
});
