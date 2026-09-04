import assert from "node:assert/strict";
import test from "node:test";

import { compileExecutionPlan, reviewFocusForSpec } from "../execution-plan/compiler.mjs";
import { releasePlanDigest } from "../execution-plan/domain.mjs";
import { parseParentDeliverySpec } from "../execution-plan/markdown.mjs";
import { verifyExecutionPlan } from "../execution-plan/validate.mjs";
import { executionFreshnessProjection } from "../execution-plan/freshness.mjs";
import { validateReleasePlan } from "../execution-plan/release-contract.mjs";
import { executionInput } from "./execution-plan-fixture.mjs";

test("Planner compiles one deterministic semantic Release Plan", () => {
  const input = executionInput();
  const plan = compileExecutionPlan(input);
  assert.deepEqual(validateReleasePlan(plan), []);
  assert.deepEqual(plan, compileExecutionPlan(input));
  assert.match(releasePlanDigest(plan), /^[a-f0-9]{64}$/u);
  assert.deepEqual(Object.keys(plan).sort(), [
    "baseRef", "baseSha", "controllerContractVersion", "id", "issues", "objective",
    "parentIssue", "releaseAcceptanceCriteria", "repo", "reviewFocus", "title",
  ]);
  assert.deepEqual(Object.keys(plan.issues[0]).sort(), [
    "acceptanceCriteria", "dependsOn", "expectedPaths", "number", "objective", "oracleCommands", "order", "risk", "scopeBudget",
  ]);
  assert.equal(plan.controllerContractVersion, 2);
  assert.equal(plan.id, "r001-c1-r1");
  assert.equal(plan.repo, input.repo);
  assert.equal(plan.baseRef, input.source.baseRef);
  assert.equal(plan.baseSha, input.deliveryGraph.executionBaseSha);
  assert.equal(plan.parentIssue, Number(input.parent.id));
  assert.equal(plan.issues[0].risk, "normal");
  assert.deepEqual(plan.issues[0].oracleCommands, []);
  assert.deepEqual(plan.issues[0].scopeBudget, { maxFiles: 8, maxChangedLines: 1500 });
  for (const removed of ["source", "controller", "decisionManifestDigest", "deliveryGraphDigest", "predecessorReceipt", "protectedPaths", "replanTriggers", "waiverDigests"]) {
    assert.equal(JSON.stringify(plan).includes(`\"${removed}\"`), false, removed);
  }
});

test("Plan v2 requires bounded paths and risk-appropriate Oracle commands", () => {
  const plan = compileExecutionPlan(executionInput());
  assert.equal(validateReleasePlan({ ...plan, issues: [{ ...plan.issues[0], expectedPaths: [] }] })[0].code, "ARTIFACT_SCHEMA_INVALID");
  assert.equal(validateReleasePlan({ ...plan, issues: [{ ...plan.issues[0], scopeBudget: { maxFiles: 1001, maxChangedLines: 1500 } }] })[0].code, "ARTIFACT_SCHEMA_INVALID");
  assert.equal(validateReleasePlan({ ...plan, issues: [{ ...plan.issues[0], risk: "high", oracleCommands: [] }] })[0].code, "ARTIFACT_SCHEMA_INVALID");
  assert.equal(validateReleasePlan({ ...plan, issues: [{ ...plan.issues[0], oracleCommands: ["npm test"] }] })[0].code, "ARTIFACT_SCHEMA_INVALID");
});

test("high-risk internal tickets expose only the trusted Oracle command", () => {
  const plan = compileExecutionPlan(executionInput({ riskClasses: ["AUTHORITY_BOUNDARY"] }));
  assert.equal(plan.issues[0].risk, "high");
  assert.deepEqual(plan.issues[0].oracleCommands, ["npm run verify:protocol"]);
});

test("normal work compiles without Oracle while high-risk work requires one", () => {
  const normal = compileExecutionPlan(executionInput({ includeOracle: false }));
  assert.equal(normal.issues[0].risk, "normal");
  assert.deepEqual(normal.issues[0].oracleCommands, []);
  assert.throws(
    () => compileExecutionPlan(executionInput({ riskClasses: ["AUTHORITY_BOUNDARY"], includeOracle: false })),
    /MISSING_ORACLE_BINDING/,
  );
});

test("semantic verification recompiles fresh Planner facts and detects drift", () => {
  const input = executionInput();
  const plan = compileExecutionPlan(input);
  assert.equal(verifyExecutionPlan(plan, input, { readFresh: executionFreshnessProjection }).status, "READY");
  assert.deepEqual(
    verifyExecutionPlan({ ...plan, controllerContractVersion: 1 }, input).problems,
    [{ code: "UNSUPPORTED_CONTROLLER_CONTRACT_VERSION" }],
  );
  let reads = 0;
  const result = verifyExecutionPlan(plan, input, {
    readFresh: executionFreshnessProjection,
    reloadInput() {
      reads += 1;
      if (reads === 1) return input;
      const changed = structuredClone(input);
      changed.children[0].body += "\nsource drift";
      return changed;
    },
  });
  assert.equal(result.status, "CONFLICT");
  assert.equal(result.problems[0].code, "CHILD_DRIFT:101");
});

test("compiler preserves internal admission gates without exporting their machinery", () => {
  const closed = executionInput();
  closed.children[0].state = "closed";
  assert.throws(() => compileExecutionPlan(closed), /ISSUE_NOT_OPEN/);

  const early = executionInput();
  early.deliveryGraph.readinessState = "ORACLES_BOUND";
  assert.throws(() => compileExecutionPlan(early), /RELEASE_NOT_GRAPH_REVIEWED/);

  const roadmap = executionInput();
  roadmap.deliveryGraph = { schema: "pi-ticket-planning:roadmap-graph:v1", kind: "ROADMAP" };
  assert.throws(() => compileExecutionPlan(roadmap), /ROADMAP_NOT_EXECUTABLE/);

});

test("review focus keeps only decision-changing Delivery Spec content", () => {
  const input = executionInput();
  input.parent.body = input.parent.body
    .replace("A failed write leaves no partial state.", "写入失败时不留下部分状态。")
    .replace("- Preserve a compatibility guardrail.", "- 保留兼容边界。\n- Keep the English release signal.")
    .replace("- Preserve compatibility for legacy input.", "- 保留旧输入兼容性。")
    .replace("- No partial writes.", "- 不允许部分写入。\n- 不允许部分写入。")
    .replace("## Out of scope\nNone.", "## Out of scope\nDepth, Locality, Real seam, Deletion test, Interface as verification surface, and src/cache.js are not Release constraints.");
  const focus = reviewFocusForSpec(parseParentDeliverySpec(input.parent.body));
  assert.deepEqual(focus, [
    "S1 failure path: 写入失败时不留下部分状态。",
    "Walking skeleton handoff: The first path produces the release artifact.",
    "Constraint: 不允许部分写入。",
    "Release signal: 保留兼容边界。",
    "Release signal: Keep the English release signal.",
    "Decision: 保留旧输入兼容性。",
  ]);
});
