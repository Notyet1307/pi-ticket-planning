import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { verifyContext } from "../scripts/verify-context.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

test("route Context Manifests stay bounded and keep Reviewer input isolated", () => {
  const result = verifyContext({ root: ROOT });
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  assert.equal(result.manifests >= 4, true);
  assert.deepEqual(result.problems, []);
  const activation = JSON.parse(fs.readFileSync(path.join(ROOT, "context", "manifests", "admission-activation.json"), "utf8"));
  assert.deepEqual(activation.required, ["skills/prepare-codex-release/SKILL.md", "execution-plan/contract.md"]);
  assert.equal(activation.required.some((file) => /admit-ticket|live-adapter|admission\/apply/.test(file)), false);
  const routes = JSON.parse(fs.readFileSync(path.join(ROOT, "context", "routes.json"), "utf8"));
  assert.equal(routes.rules.some((rule) => rule.manifest === "admission-activation.json"
    && rule.stages?.includes("ADMISSION") && rule.verdicts?.includes("ACTIVATION_AWAITING_CONFIRMATION")), true);
  assert.equal(routes.rules.some((rule) => rule.manifest === "handoff-ready.json"
    && rule.stages?.includes("EXECUTION") && rule.verdicts?.includes("HANDOFF_READY")), true);
  assert.equal(routes.rules.some((rule) => rule.stages?.includes("EXECUTION") && !rule.verdicts), false);
  const handoffReady = JSON.parse(fs.readFileSync(path.join(ROOT, "context", "manifests", "handoff-ready.json"), "utf8"));
  assert.equal(handoffReady.required.includes("skills/ask-yet/references/handoff-ready.md"), true);
  const handoffContract = fs.readFileSync(path.join(ROOT, "skills", "ask-yet", "references", "handoff-ready.md"), "utf8");
  assert.match(handoffContract, /source\.kind == execution-plan-apply/);
  assert.match(handoffContract, /source\.kind == goal-handoff-apply/);
  assert.match(handoffContract, /source\.kind == admission-cli/);
  assert.match(handoffContract, /status --config <controller-config> --job <release-id> --public --json/);
  assert.match(handoffContract, /`id`, `repo`, `planDigest`, and `baseSha` match the approved Plan/);
  for (const route of ["job_not_found", "running", "blocked / recoverable", "blocked / manual", "blocked / replan_required", "completed", "failed", "legacy=true", "STATUS_UNAVAILABLE"]) {
    assert.match(handoffContract, new RegExp(route.replaceAll("/", "\\/")));
  }
  assert.match(handoffContract, /Never copy the public JSON into the Planning Case/);
  assert.match(handoffContract, /do not poll, start, retry, abort, or write state/);
  assert.match(handoffContract, /Keep the Planning Case at `HANDOFF_READY`.*`release-result:v1`/);
  const statusCases = JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures", "controller-public-status-cases.json"), "utf8"));
  assert.deepEqual(statusCases.cases.map(({ id }) => id), [
    "controller-job-not-started",
    "controller-running",
    "controller-id-mismatch",
    "controller-binding-mismatch",
    "controller-repo-mismatch",
    "controller-base-mismatch",
    "controller-malformed-blocked",
    "controller-blocked-recoverable",
    "controller-legacy-normalized-recoverable",
    "controller-blocked-manual",
    "controller-blocked-replan",
    "controller-unknown-block-kind",
    "controller-completed",
    "controller-failed",
    "controller-unknown-status",
    "controller-status-unavailable",
  ]);
  for (const fixture of statusCases.cases) {
    assert.equal(fixture.expected.planningHandoff, "HANDOFF_READY");
    assert.equal(fixture.expected.plannerMutations, 0);
    assert.equal(fixture.expected.privateJobReads, 0);
    assert.equal(fixture.expected.polls, 0);
  }
});

test("Context verifier rejects missing, over-budget, and author-reasoning inputs", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-context-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "context", "manifests"), { recursive: true });
  fs.mkdirSync(path.join(root, "skills", "admit-ticket"), { recursive: true });
  fs.writeFileSync(path.join(root, "skills", "admit-ticket", "SKILL.md"), "author reasoning\n");
  fs.writeFileSync(path.join(root, "large.md"), "x".repeat(100));
  fs.writeFileSync(path.join(root, "context", "manifests", "bad.json"), JSON.stringify({
    schema: "pi-ticket-planning:context-manifest:v1",
    route: "DELIVERY/ADMISSION/REVIEW_IN_PROGRESS",
    required: ["skills/admit-ticket/SKILL.md", "large.md", "missing.md"],
    optional: [],
    maxBytes: 10,
    maxEstimatedTokens: 10,
    maxDocuments: 3,
  }));
  const codes = verifyContext({ root }).problems.map(({ code }) => code);
  assert.equal(codes.includes("CONTEXT_FILE_MISSING"), true);
  assert.equal(codes.includes("CONTEXT_BYTE_BUDGET_EXCEEDED"), true);
  assert.equal(codes.includes("REVIEWER_AUTHOR_REASONING_INCLUDED"), true);
});

test("Context verifier detects local Markdown reference cycles", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-context-cycle-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "context", "manifests"), { recursive: true });
  fs.writeFileSync(path.join(root, "a.md"), "[b](b.md)\n");
  fs.writeFileSync(path.join(root, "b.md"), "[a](a.md)\n");
  fs.writeFileSync(path.join(root, "context", "manifests", "cycle.json"), JSON.stringify({
    schema: "pi-ticket-planning:context-manifest:v1",
    route: "PRODUCT/FRAME/FRAME_CANDIDATE",
    required: ["a.md", "b.md"],
    optional: [],
    maxBytes: 1000,
    maxEstimatedTokens: 1000,
    maxDocuments: 2,
  }));
  assert.equal(verifyContext({ root }).problems.some(({ code }) => code === "CONTEXT_REFERENCE_CYCLE"), true);
});
