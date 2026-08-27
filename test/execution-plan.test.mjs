import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseChildTicket, parseParentDeliverySpec } from "../execution-plan/markdown.mjs";
import { createControllerAdapter } from "../execution-plan/controller-adapter.mjs";
import { verifyExecutionPlan } from "../execution-plan/validate.mjs";
import { validateArtifact } from "../protocol/kernel.mjs";
import { compileExecutionPlan } from "../execution-plan/compiler.mjs";
import { DELIVERY_GRAPH_MARKER, computeSpecContentHash, hashText, parseDeliveryGraph } from "../scripts/check-delivery-graph.mjs";
import { checkTicketContext } from "../scripts/check-ticket-context.mjs";
import {
  BASE_SHA as baseSha,
  PARENT_SPEC as parent,
  ROOT as root,
  digest,
  executionInput,
} from "./execution-plan-fixture.mjs";
import { attachReviewBinding } from "./review-binding-fixture.mjs";

function rebind(input) {
  const reviewSource = (({ identity, revision, baseSha, specContentHash }) => ({ identity, revision, baseSha, ...(specContentHash ? { specContentHash } : {}) }))(input.source);
  input.review.source = reviewSource;
  input.contextChecks = input.children.map((child) => ({ candidateId: child.id, result: checkTicketContext({ repo: root, base: input.source.baseSha, body: child.body }) }));
  return attachReviewBinding(input);
}

function rewriteGraph(input, mutate) {
  const graph = parseDeliveryGraph(input.parent.body);
  mutate(graph);
  for (const graphChild of graph.children) {
    const child = input.children.find((item) => String(item.id) === String(graphChild.id));
    if (child) graphChild.bodyHash = hashText(child.body);
  }
  const before = input.parent.body.slice(0, input.parent.body.indexOf("## Ticket coverage")).trimEnd();
  graph.source.specContentHash = computeSpecContentHash(`${before}\n\n## Ticket coverage\n`);
  input.parent.body = `${before}\n\n## Ticket coverage\n\n${DELIVERY_GRAPH_MARKER}\n\n\`\`\`json\n${JSON.stringify(graph)}\n\`\`\``;
  input.source = { ...graph.source, baseRef: input.source.baseRef };
  return rebind(input);
}

test("execution-plan parser preserves only controlled parent fields", () => {
  const parsed = parseParentDeliverySpec(parent);
  assert.equal(parsed.objective, "Release a safe change");
  assert.deepEqual(parsed.scenarios.map(({ id }) => id), ["S1"]);
  assert.throws(() => parseParentDeliverySpec(parent.replace("## Out of scope", "## Decisions")), /DUPLICATE_SECTION/);
});

test("execution-plan child parser requires 3-8 pure checklist assertions", () => {
  const child = `## What to build\nImplement the bounded change.\n## Primary verification\nRun the exact scenario.\n## Acceptance criteria\n- [ ] One result holds.\n- [ ] Two result holds.\n- [ ] Three result holds.\n## Invariants and guardrails\nNo partial writes.\n## Out of scope\nNothing.`;
  assert.equal(parseChildTicket(child).acceptanceCriteria.length, 3);
  assert.throws(() => parseChildTicket(child.replace("- [ ] Two result holds.", "Narrative")), /INVALID_ACCEPTANCE_CRITERIA_CONTENT/);
});

test("execution-plan controlled markdown rejects missing, duplicate, and malformed sections", () => {
  for (const [text, pattern] of [
    [parent.replace("## Decisions", "## Missing decisions"), /MISSING_SECTION:Decisions/],
    [parent.replace("## Out of scope", "## Decisions"), /DUPLICATE_SECTION:Decisions/],
    ["## What to build\nA\n## Primary verification\nB\n## Acceptance criteria\n- [ ] A\n- [ ] B\n## Invariants and guardrails\nC\n## Out of scope\nD", /INVALID_ACCEPTANCE_CRITERIA_COUNT/],
    ["## What to build\nA\n## Primary verification\nB\n## Acceptance criteria\n- [ ] A\n- [ ] B\n- [ ] C\n- [ ] D\n- [ ] E\n- [ ] F\n- [ ] G\n- [ ] H\n- [ ] I\n## Invariants and guardrails\nC\n## Out of scope\nD", /INVALID_ACCEPTANCE_CRITERIA_COUNT/],
  ]) assert.throws(() => text.includes("Delivery outcome") ? parseParentDeliverySpec(text) : parseChildTicket(text), pattern);
});

test("controller adapter rejects non-private config before any command", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "execution-plan-adapter-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const cli = path.join(directory, "cli.js"); const config = path.join(directory, "config.json");
  fs.writeFileSync(cli, "", { mode: 0o700 }); fs.writeFileSync(config, "{}", { mode: 0o644 });
  assert.throws(() => createControllerAdapter({ cli, config }), /CONTROLLER_CONFIG_MUST_BE_PRIVATE/);
});

test("controller adapter rejects user-controlled ancestor symlinks", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "execution-plan-adapter-symlink-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const real = path.join(directory, "real");
  const link = path.join(directory, "link");
  fs.mkdirSync(real, { mode: 0o700 });
  fs.writeFileSync(path.join(real, "cli.mjs"), "", { mode: 0o700 });
  fs.writeFileSync(path.join(real, "config.json"), "{}", { mode: 0o600 });
  fs.symlinkSync(real, link);
  assert.throws(() => createControllerAdapter({
    cli: path.join(link, "cli.mjs"),
    config: path.join(link, "config.json"),
  }), /PATH_CONTAINS_SYMLINK/);
});

test("controller adapter uses only public validate and doctor argv", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "execution-plan-public-cli-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const cli = path.join(directory, "cli.js"); const config = path.join(directory, "config.json"); const record = path.join(directory, "argv.jsonl");
  fs.writeFileSync(cli, `import fs from 'node:fs'; const args=process.argv.slice(2); fs.appendFileSync(process.env.TEST_CONTROLLER_RECORD, JSON.stringify(args)+'\\n'); if(args[0]==='config') console.log(JSON.stringify({ok:true,config:{repo:'acme/product',baseRef:'main',policy:{maxIssues:2},review:{enabled:true}},configDigest:'${"a".repeat(64)}'})); else if(args[0]==='plan') console.log(JSON.stringify({ok:true,plan:JSON.parse(fs.readFileSync(args[args.indexOf('--plan')+1],'utf8')),planDigest:'${"c".repeat(64)}'})); else if(args[0]==='doctor') console.log(JSON.stringify({ok:true})); else process.exit(9);`, { mode: 0o700 });
  fs.writeFileSync(config, "{}", { mode: 0o600 });
  const prior = process.env.TEST_CONTROLLER_RECORD; process.env.TEST_CONTROLLER_RECORD = record;
  try {
    const adapter = createControllerAdapter({ cli, config });
    assert.equal(adapter.config().configDigest, "a".repeat(64));
    assert.equal(adapter.validatePlan({ version: 2 }).planDigest, "c".repeat(64));
    assert.equal(adapter.doctor().ok, true);
  } finally { if (prior === undefined) delete process.env.TEST_CONTROLLER_RECORD; else process.env.TEST_CONTROLLER_RECORD = prior; }
  const calls = fs.readFileSync(record, "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(calls.map(([name, subcommand]) => `${name}:${subcommand}`), ["config:validate", "plan:validate", "doctor:--config"]);
  assert.equal(calls.flat().some((value) => /^(start|run|step)$/.test(value)), false);
});

test("execution compiler maps one exact accepted graph and rejects non-executable drift", () => {
  const input = executionInput();
  const controller = { config: { repo: input.repo, baseRef: "main", policy: { maxIssues: 2 }, review: { enabled: true } }, configDigest: "a".repeat(64), planDigest: "c".repeat(64) };
  const plan = compileExecutionPlan(input, { controller });
  assert.deepEqual(plan, compileExecutionPlan(executionInput(), { controller }));
  assert.equal(plan.releasePlan.id, "release-100-" + plan.source.deliveryGraphDigest.slice(7, 19));
  assert.deepEqual(plan.releasePlan.issues[0].suggestedValidation, []);
  assert.equal(plan.releasePlan.issues[0].allowNoop, false);
  assert.equal(plan.releasePlan.source.baseRef, "main");
  assert.equal(plan.releasePlan.releaseAcceptanceCriteria[0], "S1: A user sees the completed change.");
  assert.equal(plan.releasePlan.releaseAcceptanceCriteria.includes(plan.releasePlan.issues[0].acceptanceCriteria[0]), false);
  assert.match(plan.releasePlan.reviewFocus[0], /Walking skeleton handoff/);
  assert.equal(plan.releasePlan.issues[0].order, 1);
  assert.deepEqual(plan.releasePlan.issues[0].dependsOn, []);
  const accepted = executionInput(); accepted.release = { accepted: true, id: "accepted-release_1" };
  assert.equal(compileExecutionPlan(accepted, { controller }).releasePlan.id, "accepted-release_1");
  const unaccepted = executionInput(); unaccepted.release = { accepted: false, id: "accepted-release_1" };
  assert.notEqual(compileExecutionPlan(unaccepted, { controller }).releasePlan.id, "accepted-release_1");
  assert.equal(plan.policy.accepted, undefined);
  assert.match(plan.children[0].bodyHash, /^sha256:/);
  for (const [mutate, code] of [[(value) => { value.children[0].executionLane = "HUMAN"; }, "CODEX_RELEASE_NOT_EXECUTABLE"], [(value) => { value.children[0].blockedBy = ["999"]; }, "CODEX_RELEASE_NOT_EXECUTABLE"], [(value) => { value.children[0].state = "closed"; }, "ISSUE_NOT_OPEN:101"]]) {
    const changed = executionInput(); mutate(changed); assert.throws(() => compileExecutionPlan(changed, { controller }), new RegExp(code));
  }
});

test("execution compiler preserves approved topological order, dependencies, and exact UTF-8 body identity", () => {
  const input = executionInput();
  const second = {
    id: "102",
    title: "Consume the durable artifact",
    state: "open",
    labels: ["needs-triage"],
    blockedBy: ["101"],
    updatedAt: "2026-08-20T00:01:00Z",
    body: `## What to build
Consume the durable artifact with stable UTF-8 output ✓.
## Primary verification
Run the artifact consumer scenario.
## Acceptance criteria
- [ ] The consumer reads the produced artifact.
- [ ] The UTF-8 result remains exact.
- [ ] A missing artifact fails without partial state.
## Invariants and guardrails
No partial writes survive.
## Out of scope
No UI work.`,
  };
  input.children.push(second);
  input.review.candidates.push({ id: second.id, verdict: "READY", executionLane: "AGENT" });
  rewriteGraph(input, (graph) => graph.children.push({
    id: second.id,
    title: second.title,
    coverageRole: "DIRECT",
    sourceScenarios: ["S1"],
    blockedBy: ["101"],
    externalBlockers: [],
    bodyHash: hashText(second.body),
    startingState: "artifact",
    primaryVerification: "Run the artifact consumer scenario.",
    executionLane: "AGENT",
  }));
  const controller = {
    config: { repo: input.repo, baseRef: "main", policy: { maxIssues: 2 }, review: { enabled: true } },
    configDigest: "a".repeat(64),
    planDigest: "c".repeat(64),
  };
  const plan = compileExecutionPlan(input, { controller });
  assert.deepEqual(plan.releasePlan.issues.map(({ number, order, dependsOn }) => ({ number, order, dependsOn })), [
    { number: 101, order: 1, dependsOn: [] },
    { number: 102, order: 2, dependsOn: [101] },
  ]);
  assert.equal(plan.releasePlan.issues[1].expectedBodyHash, hashText(second.body));
  assert.equal(plan.releasePlan.issues[1].objective, "Consume the durable artifact with stable UTF-8 output ✓.");
});

test("execution artifacts retain exact-key schemas", () => {
  const input = executionInput();
  const controller = { config: { repo: input.repo, baseRef: "main", policy: { maxIssues: 2 }, review: { enabled: true } }, configDigest: "a".repeat(64), planDigest: "c".repeat(64) };
  const plan = compileExecutionPlan(input, { controller });
  assert.equal(validateArtifact(plan).ok, true);
  assert.equal(validateArtifact({ ...plan, unexpected: true }).ok, false);
  assert.equal(validateArtifact({ ...plan.releasePlan, unexpected: true }, { identity: "herdr-codex-controller:release-plan:v2" }).ok, false);
});

test("execution compiler rejects policy and controller authority drift with stable codes", () => {
  const controllerFor = (input, overrides = {}) => ({ config: { repo: input.repo, baseRef: "main", policy: { maxIssues: 2 }, review: { enabled: true }, ...overrides }, configDigest: "a".repeat(64), planDigest: "c".repeat(64) });
  for (const [mutate, code] of [
    [(input) => { input.policy.accepted = false; }, "POLICY_NOT_ACCEPTED"],
    [(input) => { input.policy.identity = ""; }, "POLICY_NOT_ACCEPTED"],
    [(input) => { input.policy.digest = "bad"; }, "POLICY_NOT_ACCEPTED"],
  ]) { const input = executionInput(); mutate(input); assert.throws(() => compileExecutionPlan(input, { controller: controllerFor(input) }), new RegExp(code)); }
  for (const [overrides, code] of [[{ repo: "other/repo" }, "CONTROLLER_CONFIG_MISMATCH"], [{ baseRef: "other" }, "CONTROLLER_CONFIG_MISMATCH"], [{ policy: { maxIssues: 0 } }, "CONTROLLER_CONFIG_MISMATCH"], [{ review: { enabled: false } }, "CONTROLLER_CONFIG_MISMATCH"]]) { const input = executionInput(); assert.throws(() => compileExecutionPlan(input, { controller: controllerFor(input, overrides) }), new RegExp(code)); }
});

test("execution compiler rejects rebuilt Graph HUMAN and external blockers before review binding", () => {
  const controllerFor = (input) => ({ config: { repo: input.repo, baseRef: "main", policy: { maxIssues: 2 }, review: { enabled: true } }, configDigest: "a".repeat(64), planDigest: "c".repeat(64) });
  for (const [mutate, code] of [[(graph) => { graph.children[0].executionLane = "HUMAN"; }, "CODEX_RELEASE_NOT_EXECUTABLE"], [(graph) => { graph.children[0].externalBlockers = ["external"]; }, "CODEX_RELEASE_NOT_EXECUTABLE"]]) { const input = rewriteGraph(executionInput(), mutate); assert.throws(() => compileExecutionPlan(input, { controller: controllerFor(input) }), new RegExp(code)); }
});

test("execution compiler rejects parent identity and state before review binding", () => {
  const controllerFor = (input) => ({ config: { repo: input.repo, baseRef: "main", policy: { maxIssues: 2 }, review: { enabled: true } }, configDigest: "a".repeat(64), planDigest: "c".repeat(64) });
  for (const mutate of [(input) => { input.parent.id = "0"; }, (input) => { input.parent.state = "closed"; }]) {
    const input = executionInput(); mutate(input); assert.throws(() => compileExecutionPlan(input, { controller: controllerFor(input) }), /PARENT_NOT_OPEN/);
  }
});

test("execution compiler returns stable live child drift codes before stale review bindings", () => {
  const controllerFor = (input) => ({ config: { repo: input.repo, baseRef: "main", policy: { maxIssues: 2 }, review: { enabled: true } }, configDigest: "a".repeat(64), planDigest: "c".repeat(64) });
  for (const [mutate, code] of [[(input) => { input.children[0].title = "drift"; }, "CHILD_DRIFT:101"], [(input) => { input.children[0].body = `${input.children[0].body}\nchanged`; }, "CHILD_DRIFT:101"], [(input) => { input.children[0].state = "closed"; }, "ISSUE_NOT_OPEN:101"]]) {
    const input = executionInput(); mutate(input); assert.throws(() => compileExecutionPlan(input, { controller: controllerFor(input) }), new RegExp(code));
  }
});

test("execution compiler reports source, native order, and Context drift before review binding", () => {
  const controllerFor = (input) => ({ config: { repo: input.repo, baseRef: input.source.baseRef, policy: { maxIssues: 2 }, review: { enabled: true } }, configDigest: "a".repeat(64), planDigest: "c".repeat(64) });
  for (const [mutate, code] of [
    [(input) => { input.source.identity = "other"; }, "ADMISSION_STATE_NOT_READY:SOURCE_IDENTITY_MISMATCH"],
    [(input) => { input.source.revision = "other"; }, "ADMISSION_STATE_NOT_READY:SOURCE_REVISION_MISMATCH"],
    [(input) => { input.source.baseSha = "f".repeat(40); }, "ADMISSION_STATE_NOT_READY:SOURCE_BASE_SHA_MISMATCH"],
    [(input) => { input.contextChecks[0].result = { ...input.contextChecks[0].result, verdict: "FAIL", ok: false }; }, "ADMISSION_STATE_NOT_READY:INVALID_CONTEXT_CHECK_VERDICT"],
    [(input) => { input.children[0].blockedBy = ["999"]; }, "CODEX_RELEASE_NOT_EXECUTABLE"],
  ]) { const input = executionInput(); mutate(input); assert.throws(() => compileExecutionPlan(input, { controller: controllerFor(input) }), new RegExp(code)); }
  const noBaseRef = executionInput(); noBaseRef.source.baseRef = "";
  assert.throws(() => compileExecutionPlan(noBaseRef, { controller: controllerFor(noBaseRef) }), /INVALID_DELIVERY_GRAPH_SOURCE/);
});

test("execution compiler rejects each freshly rebound review gate deterministically", () => {
  const controllerFor = (input) => ({ config: { repo: input.repo, baseRef: "main", policy: { maxIssues: 2 }, review: { enabled: true } }, configDigest: "a".repeat(64), planDigest: "c".repeat(64) });
  for (const axis of ["candidateReadiness", "contextQuality", "deliveryGraph", "scenarioCoverage", "walkingSkeleton", "strictFrontier", "executionLane", "inputBinding"]) {
    const input = executionInput(); input.review.axes[axis] = "FAIL"; rebind(input);
    assert.throws(() => compileExecutionPlan(input, { controller: controllerFor(input) }), /REVIEW_NOT_READY/);
  }
  for (const [mutate, code] of [
    [(input) => { input.review.graphVerdict = "NEEDS_INFO"; }, "REVIEW_NOT_READY"],
    [(input) => { input.review.candidates[0].verdict = "NEEDS_INFO"; }, "REVIEW_NOT_READY"],
    [(input) => { input.review.candidates = []; }, "REVIEW_CANDIDATE_SET_MISMATCH"],
  ]) { const input = executionInput(); mutate(input); rebind(input); assert.throws(() => compileExecutionPlan(input, { controller: controllerFor(input) }), new RegExp(code)); }
});
