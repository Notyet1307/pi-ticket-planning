import assert from "node:assert/strict";
import test from "node:test";

import { assertFreshExecutionInput, executionFreshnessProjection, gitRemoteBase } from "../execution-plan/freshness.mjs";
import { advanceDependencyWithoutManifest, createFreshnessFixture, git, write } from "./execution-freshness-fixture.mjs";

const fresh = (input) => assertFreshExecutionInput(input, { resolveRemoteBase: gitRemoteBase });

test("fresh execution input binds remote base, decisions, receipts, handoffs, and Oracles", (t) => {
  for (const downstream of [false, true]) {
    const { input } = createFreshnessFixture(t, { downstream });
    assert.deepEqual(fresh(input), executionFreshnessProjection(input));
  }
});

test("fresh execution input returns each stable drift code", (t) => {
  const cases = [
    ["SPEC_ACCEPTANCE_DRIFT", false, (input) => { input.deliveryGraph.specAcceptanceBinding.sha256 = `sha256:${"0".repeat(64)}`; }],
    ["DECISION_MANIFEST_DRIFT", false, (input) => { input.deliveryGraph.decisionManifest.policy.sha256 = `sha256:${"0".repeat(64)}`; }],
    ["PREDECESSOR_RECEIPT_DRIFT", true, (input) => { input.deliveryGraph.predecessorReceiptBinding.sha256 = `sha256:${"0".repeat(64)}`; }],
    ["DEPENDENCY_HANDOFF_DRIFT", true, (input, repo) => { advanceDependencyWithoutManifest(input, repo); }],
    ["ORACLE_BINDING_DRIFT", false, (input) => { input.children[0].body = input.children[0].body.replace(/"sha256":"sha256:[a-f0-9]{64}"/u, `"sha256":"sha256:${"0".repeat(64)}"`); }],
  ];
  for (const [code, downstream, mutate] of cases) {
    const { input, repo } = createFreshnessFixture(t, { downstream });
    mutate(input, repo);
    assert.throws(() => fresh(input), new RegExp(code));
  }
});

test("remote base advancement invalidates the old execution snapshot", (t) => {
  const { input, repo } = createFreshnessFixture(t);
  write(repo, "after.txt", "new base\n");
  git(repo, ["add", "after.txt"]);
  git(repo, ["commit", "-m", "advance base"]);
  git(repo, ["push", "origin", "main"]);
  assert.throws(() => fresh(input), /EXECUTION_BASE_DRIFT/);
});

test("freshness ignores an unbound context remote and resolves the canonical repository identity", (t) => {
  const { input } = createFreshnessFixture(t);
  input.source.remote = "evil";
  let request;
  const projection = assertFreshExecutionInput(input, {
    resolveRemoteBase(value) { request = value; return gitRemoteBase(value); },
  });
  assert.equal(request.remote, undefined);
  assert.equal(request.repo, input.repo);
  assert.deepEqual(projection, executionFreshnessProjection(input));
});

test("Oracle protected-path overlap maps to ORACLE_BINDING_DRIFT", (t) => {
  const { input } = createFreshnessFixture(t);
  input.children[0].body = input.children[0].body.replace('"expectedPaths":["src/change.ts"]', '"expectedPaths":["fixtures/oracle.json"]');
  assert.throws(() => fresh(input), /ORACLE_BINDING_DRIFT/);
});
