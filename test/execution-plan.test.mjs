import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseChildTicket, parseControlledLines, parseParentDeliverySpec } from "../execution-plan/markdown.mjs";
import { createControllerAdapter } from "../execution-plan/controller-adapter.mjs";
import { fingerprint, releasePlanDigest } from "../execution-plan/domain.mjs";
import { verifyExecutionPlan } from "../execution-plan/validate.mjs";
import { validateArtifact } from "../protocol/kernel.mjs";
import { compileExecutionPlan } from "../execution-plan/compiler.mjs";
import { DELIVERY_GRAPH_MARKER, computeSpecContentHash, hashText, parseDeliveryGraph } from "../scripts/check-delivery-graph.mjs";
import { checkTicketContext } from "../scripts/check-ticket-context.mjs";
import {
  BASE_SHA as baseSha,
  CONTROLLER_IDENTITY,
  PARENT_SPEC as parent,
  ROOT as root,
  controllerBinding,
  controllerProvenance,
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

function mixedLaneInput({ agentBlockedByHuman = false, humanVerdict = "READY", humanReviewLane = "HUMAN" } = {}) {
  const input = executionInput();
  const human = {
    id: "102",
    title: "Run human acceptance",
    state: "open",
    labels: ["needs-triage"],
    executionLane: "HUMAN",
    blockedBy: agentBlockedByHuman ? [] : ["101"],
    updatedAt: "2026-08-20T00:01:00Z",
    body: `## What to build
Run the human-controlled acceptance check.
## Primary verification
Complete the exact human acceptance checklist.
## Acceptance criteria
- [ ] The accepted build is exercised.
- [ ] The human decision is recorded.
- [ ] The evidence is retained.
## Invariants and guardrails
No Agent performs the human decision.
## Out of scope
No implementation work.`,
  };
  if (agentBlockedByHuman) {
    input.children[0].blockedBy = [human.id];
    input.children.unshift(human);
  } else {
    input.children.push(human);
  }
  input.review.candidates.push({ id: human.id, verdict: humanVerdict, executionLane: humanReviewLane });
  return rewriteGraph(input, (graph) => {
    const humanGraph = {
      id: human.id,
      title: human.title,
      coverageRole: agentBlockedByHuman ? "ENABLER" : "DIRECT",
      sourceScenarios: ["S1"],
      blockedBy: human.blockedBy,
      externalBlockers: [],
      ...(agentBlockedByHuman ? { downstreamConsumers: ["101"], exitCondition: "Human acceptance produces the Agent starting state." } : {}),
      bodyHash: hashText(human.body),
      startingState: "accepted build",
      primaryVerification: "Complete the exact human acceptance checklist.",
      executionLane: "HUMAN",
    };
    if (agentBlockedByHuman) {
      graph.children[0].blockedBy = [human.id];
      graph.children.unshift(humanGraph);
      graph.walkingSkeleton = [human.id, "101"];
    } else {
      graph.children.push(humanGraph);
    }
  });
}

test("execution-plan parser preserves only controlled parent fields", () => {
  const parsed = parseParentDeliverySpec(parent);
  assert.equal(parsed.objective, "Release a safe change");
  assert.deepEqual(parsed.scenarios.map(({ id }) => id), ["S1"]);
  assert.throws(() => parseParentDeliverySpec(parent.replace("## Out of scope", "## Decisions")), /DUPLICATE_SECTION/);
  assert.deepEqual(parseControlledLines("First paragraph\ncontinues here.\n\n- First item\n2. Second item"), ["First paragraph\ncontinues here.", "First item", "Second item"]);
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
  fs.writeFileSync(cli, `import fs from 'node:fs'; import {createHash} from 'node:crypto';
const args=process.argv.slice(2); const controller=${JSON.stringify(CONTROLLER_IDENTITY)};
const canonical=(value)=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map((key)=>[key,canonical(value[key])])):value;
const digest=(value)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const config={repo:'acme/product',baseRef:'main',executionMode:'release-plan-v2-direct',policy:{maxIssues:2},review:{enabled:true}};
fs.appendFileSync(process.env.TEST_CONTROLLER_RECORD, JSON.stringify(args)+'\\n');
if(args[0]==='config') console.log(JSON.stringify({ok:true,config,configDigest:'${"a".repeat(64)}',controller}));
else if(args[0]==='plan'){const plan=JSON.parse(fs.readFileSync(args[args.indexOf('--plan')+1],'utf8'));const planDigest=digest(plan);const body={version:1,controller,executionMode:config.executionMode,configDigest:'${"a".repeat(64)}',releasePlan:{version:2,digest:planDigest}};console.log(JSON.stringify({ok:true,plan,planDigest,provenance:{...body,digest:digest(body)}}));}
else if(args[0]==='doctor') console.log(JSON.stringify({ok:true,configDigest:'${"a".repeat(64)}',controller})); else process.exit(9);`, { mode: 0o700 });
  fs.writeFileSync(config, "{}", { mode: 0o600 });
  const prior = process.env.TEST_CONTROLLER_RECORD; process.env.TEST_CONTROLLER_RECORD = record;
  try {
    const adapter = createControllerAdapter({ cli, config });
    const binding = adapter.config();
    assert.equal(binding.configDigest, "a".repeat(64));
    assert.equal(adapter.validatePlan({ version: 2 }, binding.configDigest, binding.configIdentity).planDigest, releasePlanDigest({ version: 2 }));
    assert.equal(adapter.doctor(binding.configDigest, binding.configIdentity, binding.controllerIdentity).ok, true);
  } finally { if (prior === undefined) delete process.env.TEST_CONTROLLER_RECORD; else process.env.TEST_CONTROLLER_RECORD = prior; }
  const calls = fs.readFileSync(record, "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(calls.map(([name, subcommand]) => `${name}:${subcommand}`), ["config:validate", "plan:validate", "config:validate", "doctor:--config"]);
  assert.equal(calls.flat().some((value) => /^(start|run|step)$/.test(value)), false);
});

test("controller adapter rejects doctor config digest drift", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "execution-plan-doctor-drift-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const cli = path.join(directory, "cli.mjs");
  const config = path.join(directory, "config.json");
  fs.writeFileSync(cli, `const args=process.argv.slice(2);const controller=${JSON.stringify(CONTROLLER_IDENTITY)};const config={repo:'acme/product',baseRef:'main',executionMode:'release-plan-v2-direct',policy:{maxIssues:2},review:{enabled:true}};console.log(JSON.stringify({ok:true,config,...(args[0]==='config'?{config}:{}),configDigest:args[0]==='doctor'?'${"b".repeat(64)}':'${"a".repeat(64)}',controller}));`, { mode: 0o700 });
  fs.writeFileSync(config, "{}", { mode: 0o600 });
  const adapter = createControllerAdapter({ cli, config });
  const binding = adapter.config();
  assert.throws(() => adapter.doctor(binding.configDigest, binding.configIdentity, binding.controllerIdentity), /CONTROLLER_DOCTOR_CONFIG_DRIFT/);
});

test("controller adapter rejects an A-to-B-to-A config change during plan validation", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "execution-plan-config-aba-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const cli = path.join(directory, "cli.mjs");
  const config = path.join(directory, "config.json");
  fs.writeFileSync(cli, `import fs from 'node:fs';const a=process.argv.slice(2);const digest='${"a".repeat(64)}';const controller=${JSON.stringify(CONTROLLER_IDENTITY)};if(a[0]==='config')console.log(JSON.stringify({ok:true,config:{repo:'acme/product',baseRef:'main',executionMode:'release-plan-v2-direct',policy:{maxIssues:2},review:{enabled:true}},configDigest:digest,controller}));else if(a[0]==='plan'){const c=a[a.indexOf('--config')+1];const before=fs.readFileSync(c);fs.writeFileSync(c,'{"changed":true}');fs.writeFileSync(c,before);const plan=JSON.parse(fs.readFileSync(a[a.indexOf('--plan')+1]));console.log(JSON.stringify({ok:true,plan,planDigest:'${"c".repeat(64)}'}));}`, { mode: 0o700 });
  fs.writeFileSync(config, "{}", { mode: 0o600 });
  const adapter = createControllerAdapter({ cli, config });
  const binding = adapter.config();
  assert.throws(() => adapter.validatePlan({ version: 2 }, binding.configDigest, binding.configIdentity), /CONTROLLER_CONFIG_DRIFT/);
});

test("controller adapter classifies public command failures without leaking stderr", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "execution-plan-adapter-errors-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const config = path.join(directory, "config.json");
  fs.writeFileSync(config, "{}", { mode: 0o600 });
  const make = (name, source) => {
    const cli = path.join(directory, `${name}.mjs`);
    fs.writeFileSync(cli, source, { mode: 0o700 });
    return createControllerAdapter({ cli, config });
  };
  const digest = "a".repeat(64);
  const configResult = `JSON.stringify({ok:true,config:{repo:'acme/product',baseRef:'main',executionMode:'release-plan-v2-direct',policy:{maxIssues:2},review:{enabled:true}},configDigest:'${digest}',controller:${JSON.stringify(CONTROLLER_IDENTITY)}})`;
  assert.throws(() => make("config-failed", `console.error('secret-token');process.exit(1)`).config(), (error) => error.message === "CONTROLLER_CONFIG_INVALID" && !error.message.includes("secret-token"));
  assert.throws(() => make("invalid-json", `console.log('not-json')`).config(), /CONTROLLER_INVALID_JSON/);
  assert.throws(() => make("too-large", `process.stdout.write('x'.repeat(2*1024*1024))`).config(), /CONTROLLER_OUTPUT_TOO_LARGE/);
  const staged = make("staged", `const a=process.argv.slice(2);if(a[0]==='config')console.log(${configResult});else {console.error('secret-token');process.exit(1)}`);
  const binding = staged.config();
  assert.throws(() => staged.validatePlan({ version: 2 }, binding.configDigest, binding.configIdentity), /CONTROLLER_PLAN_INVALID/);
  assert.throws(() => staged.doctor(binding.configDigest, binding.configIdentity, binding.controllerIdentity), /CONTROLLER_DOCTOR_FAILED/);
});

test("execution compiler maps one exact accepted graph and rejects non-executable drift", () => {
  const input = executionInput();
  const controller = controllerBinding(input);
  const plan = compileExecutionPlan(input, { controller });
  assert.deepEqual(plan, compileExecutionPlan(executionInput(), { controller }));
  assert.equal(plan.releasePlan.id, "release-100-" + plan.source.deliveryGraphDigest.slice(7, 19));
  assert.deepEqual(plan.releasePlan.issues[0].suggestedValidation, []);
  assert.equal(plan.releasePlan.issues[0].allowNoop, false);
  assert.equal(plan.releasePlan.source.baseRef, "main");
  assert.equal(plan.releasePlan.releaseAcceptanceCriteria[0], "S1: A user sees the completed change.");
  assert.equal(plan.releasePlan.releaseAcceptanceCriteria.includes(plan.releasePlan.issues[0].acceptanceCriteria[0]), false);
  assert.match(plan.releasePlan.reviewFocus[1], /Walking skeleton handoff/);
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

test("execution compiler preserves multilingual accepted review focus and fails closed above 20 entries", () => {
  const input = executionInput();
  input.parent.body = input.parent.body
    .replace("Important failure behavior: A failed write leaves no partial state.", "Important failure behavior: 写入失败时不留下部分状态。")
    .replace("- Preserve a compatibility guardrail.", "- 保留兼容边界。\n2. Keep the English release signal.")
    .replace("- Preserve compatibility for legacy input.", "- 保留旧输入兼容性。")
    .replace("- No partial writes.", "- 不允许部分写入。\n- 不允许部分写入。")
    .replace("## Out of scope\nNone.", "## Out of scope\nDepth, Locality, Real seam, Deletion test, Interface as verification surface, and src/cache.js are not Release constraints.");
  rewriteGraph(input, () => {});
  const controller = controllerBinding(input);
  const reviewFocus = compileExecutionPlan(input, { controller }).releasePlan.reviewFocus;
  assert.deepEqual(reviewFocus, [
    "S1 failure path: 写入失败时不留下部分状态。",
    "Walking skeleton handoff: The first path produces the release artifact.",
    "Constraint: 不允许部分写入。",
    "Release signal: 保留兼容边界。",
    "Release signal: Keep the English release signal.",
    "Decision: 保留旧输入兼容性。",
  ]);
  assert.equal(reviewFocus.some((line) => /Depth|Locality|Real seam|Deletion test|Interface as verification surface|src\/cache/.test(line)), false);

  const tooMany = executionInput();
  tooMany.parent.body = tooMany.parent.body.replace("- No partial writes.", Array.from({ length: 17 }, (_, index) => `- Constraint ${index + 1}`).join("\n"));
  rewriteGraph(tooMany, () => {});
  assert.throws(() => compileExecutionPlan(tooMany, { controller: { ...controller, config: { ...controller.config, repo: tooMany.repo } } }), /REVIEW_FOCUS_TOO_LARGE/);

  const tooLarge = executionInput();
  tooLarge.parent.body = tooLarge.parent.body.replace("- No partial writes.", `- ${"界".repeat(700)}`);
  rewriteGraph(tooLarge, () => {});
  assert.throws(() => compileExecutionPlan(tooLarge, { controller: { ...controller, config: { ...controller.config, repo: tooLarge.repo } } }), /REVIEW_FOCUS_TOO_LARGE/);
});

test("execution verification binds doctor to the validated config digest", () => {
  const input = executionInput();
  const controller = controllerBinding(input);
  const plan = compileExecutionPlan(input, { controller });
  const adapter = {
    config: () => ({ config: structuredClone(controller.config), configDigest: controller.configDigest, configIdentity: "stable", controllerIdentity: structuredClone(controller.controllerIdentity) }),
    validatePlan: (releasePlan) => ({ plan: structuredClone(releasePlan), planDigest: controller.planDigest, provenance: controllerProvenance(controller.configDigest, controller.planDigest, controller.controllerIdentity) }),
    doctor(expectedConfigDigest, expectedConfigIdentity, expectedControllerIdentity) {
      assert.equal(expectedConfigDigest, controller.configDigest);
      assert.equal(expectedConfigIdentity, "stable");
      assert.deepEqual(expectedControllerIdentity, controller.controllerIdentity);
      return { ok: true, configDigest: controller.configDigest };
    },
  };
  assert.equal(verifyExecutionPlan(plan, input, adapter).status, "READY");

  let currentDigest = controller.configDigest;
  const changing = {
    ...adapter,
    validatePlan(releasePlan) {
      currentDigest = "d".repeat(64);
      return { plan: structuredClone(releasePlan), planDigest: controller.planDigest, provenance: controllerProvenance(controller.configDigest, controller.planDigest, controller.controllerIdentity) };
    },
    doctor(expectedConfigDigest) {
      if (expectedConfigDigest !== currentDigest) throw new Error("CONTROLLER_DOCTOR_CONFIG_DRIFT");
    },
  };
  const changed = verifyExecutionPlan(plan, input, changing);
  assert.equal(changed.status, "CONFLICT");
  assert.deepEqual(changed.problems, [{ code: "CONTROLLER_DOCTOR_CONFIG_DRIFT" }]);
});

test("PR #16 planning methodology remains navigation-only and trigger-aware", () => {
  const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
  assert.match(read("skills/setup-delivery-repository/domain.md"), /Resolve only decision-changing ambiguity/);
  assert.match(read("skills/ask-yet/references/solution-shaping.md"), /evaluation heuristics inside Solution Shaping, not additional gates, artifacts, fields, or required interfaces/);
  assert.match(read("skills/to-spec/SKILL.md"), /Leave cheap deterministic repository and environment facts in code, configuration, scripts, and tool output/);
  assert.match(read("skills/to-tickets/SKILL.md"), /one short trigger and purpose/);
  assert.match(read("skills/ticket-readiness/SKILL.md"), /branch of work that makes the file relevant and the first-action purpose/);
});

test("private path checks allow the explicit system temporary-directory alias", (t) => {
  const directory = fs.mkdtempSync("/tmp/execution-plan-system-alias-");
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.chmodSync(directory, 0o700);
  const cli = path.join(directory, "cli.mjs");
  const config = path.join(directory, "config.json");
  fs.writeFileSync(cli, "", { mode: 0o700 });
  fs.writeFileSync(config, "{}", { mode: 0o600 });
  assert.doesNotThrow(() => createControllerAdapter({ cli, config }));
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
  const controller = controllerBinding(input);
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
  const controller = controllerBinding(input);
  const plan = compileExecutionPlan(input, { controller });
  assert.equal(validateArtifact(plan).ok, true);
  assert.equal(validateArtifact({ ...plan, unexpected: true }).ok, false);
  assert.equal(validateArtifact({ ...plan.releasePlan, unexpected: true }, { identity: "herdr-codex-controller:release-plan:v2" }).ok, false);
});

test("execution compiler rejects policy and controller authority drift with stable codes", () => {
  const controllerFor = (input, overrides = {}) => controllerBinding(input, { config: overrides });
  for (const [mutate, code] of [
    [(input) => { input.policy.accepted = false; }, "POLICY_NOT_ACCEPTED"],
    [(input) => { input.policy.identity = ""; }, "POLICY_NOT_ACCEPTED"],
    [(input) => { input.policy.digest = "bad"; }, "POLICY_NOT_ACCEPTED"],
  ]) { const input = executionInput(); mutate(input); assert.throws(() => compileExecutionPlan(input, { controller: controllerFor(input) }), new RegExp(code)); }
  for (const [overrides, code] of [[{ repo: "other/repo" }, "CONTROLLER_CONFIG_MISMATCH"], [{ baseRef: "other" }, "CONTROLLER_CONFIG_MISMATCH"], [{ policy: { maxIssues: 0 } }, "CONTROLLER_CONFIG_MISMATCH"], [{ review: { enabled: false } }, "CONTROLLER_CONFIG_MISMATCH"]]) { const input = executionInput(); assert.throws(() => compileExecutionPlan(input, { controller: controllerFor(input, overrides) }), new RegExp(code)); }
});

test("execution compiler projects a reviewed trailing HUMAN obligation out of the Controller tranche", () => {
  const input = mixedLaneInput();
  const plan = compileExecutionPlan(input, { controller: controllerBinding(input) });
  const graph = parseDeliveryGraph(input.parent.body);
  assert.deepEqual(plan.children.map(({ issue }) => issue), ["101"]);
  assert.deepEqual(plan.releasePlan.issues.map(({ number, order }) => ({ number, order })), [{ number: 101, order: 1 }]);
  assert.equal(plan.source.deliveryGraphDigest, fingerprint(graph));
  assert.notEqual(plan.reviewedFingerprint, compileExecutionPlan(executionInput(), { controller: controllerBinding(executionInput()) }).reviewedFingerprint);
});

test("execution compiler keeps mixed-lane projection fail-closed", () => {
  {
    const input = mixedLaneInput({ agentBlockedByHuman: true });
    assert.throws(() => compileExecutionPlan(input, { controller: controllerBinding(input) }), /CODEX_RELEASE_AGENT_DEPENDS_ON_HUMAN:101:102/);
  }
  {
    const input = mixedLaneInput({ humanVerdict: "NEEDS_INFO" });
    assert.throws(() => compileExecutionPlan(input, { controller: controllerBinding(input) }), /REVIEW_NOT_READY/);
  }
  {
    const input = mixedLaneInput({ humanReviewLane: "AGENT" });
    assert.throws(() => compileExecutionPlan(input, { controller: controllerBinding(input) }), /CODEX_RELEASE_NOT_EXECUTABLE/);
  }
  {
    const input = mixedLaneInput();
    input.children.find(({ id }) => id === "102").body += "\ndrift";
    assert.throws(() => compileExecutionPlan(input, { controller: controllerBinding(input) }), /CHILD_DRIFT:102/);
  }
  {
    const input = mixedLaneInput();
    input.children.find(({ id }) => id === "101").executionLane = "HUMAN";
    input.review.candidates.find(({ id }) => id === "101").executionLane = "HUMAN";
    rewriteGraph(input, (graph) => { graph.children.find(({ id }) => id === "101").executionLane = "HUMAN"; });
    assert.throws(() => compileExecutionPlan(input, { controller: controllerBinding(input) }), /CODEX_RELEASE_NO_AGENT_TRANCHE/);
  }
  {
    const input = rewriteGraph(executionInput(), (graph) => { graph.children[0].externalBlockers = ["external"]; });
    assert.throws(() => compileExecutionPlan(input, { controller: controllerBinding(input) }), /CODEX_RELEASE_NOT_EXECUTABLE/);
  }
});

test("execution compiler rejects parent identity and state before review binding", () => {
  const controllerFor = (input) => controllerBinding(input);
  for (const mutate of [(input) => { input.parent.id = "0"; }, (input) => { input.parent.state = "closed"; }]) {
    const input = executionInput(); mutate(input); assert.throws(() => compileExecutionPlan(input, { controller: controllerFor(input) }), /PARENT_NOT_OPEN/);
  }
});

test("execution compiler returns stable live child drift codes before stale review bindings", () => {
  const controllerFor = (input) => controllerBinding(input);
  for (const [mutate, code] of [[(input) => { input.children[0].title = "drift"; }, "CHILD_DRIFT:101"], [(input) => { input.children[0].body = `${input.children[0].body}\nchanged`; }, "CHILD_DRIFT:101"], [(input) => { input.children[0].state = "closed"; }, "ISSUE_NOT_OPEN:101"]]) {
    const input = executionInput(); mutate(input); assert.throws(() => compileExecutionPlan(input, { controller: controllerFor(input) }), new RegExp(code));
  }
});

test("execution compiler reports source, native order, and Context drift before review binding", () => {
  const controllerFor = (input) => controllerBinding(input, { config: { baseRef: input.source.baseRef } });
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
  const controllerFor = (input) => controllerBinding(input);
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
