import assert from "node:assert/strict";
import test from "node:test";

import reviewerOneShotGate, {
  buildReviewerDispatchBinding,
  createReviewerOneShotGate,
  validateReviewerDispatchBinding,
} from "../extensions/reviewer-one-shot-gate.mjs";

const DIGEST = `sha256:${"a".repeat(64)}`;
const invocation = {
  agent: "ticket-readiness-reviewer",
  task: "Review the exact held input.",
  async: false,
  context: "fresh",
  artifacts: false,
  mission: false,
};

test("Reviewer one-shot gate blocks the second invocation before launch", () => {
  const gate = createReviewerOneShotGate();
  let launches = 0;
  const dispatch = (input) => {
    const decision = gate.beforeToolCall({ toolName: "subagent", input });
    if (!decision) launches += 1;
    return decision;
  };

  assert.equal(dispatch(invocation), undefined);
  assert.deepEqual(dispatch(invocation), { block: true, reason: "REVIEWER_DISPATCH_LIMIT_EXCEEDED" });
  assert.equal(launches, 1);
  assert.deepEqual(gate.snapshot(), { totalDispatches: 1 });
});

test("Reviewer one-shot gate rejects any non-contract child", () => {
  const gate = createReviewerOneShotGate();
  assert.deepEqual(gate.beforeToolCall({ toolName: "subagent", input: { ...invocation, agent: "scout" } }), {
    block: true,
    reason: "REVIEWER_DISPATCH_CONTRACT_INVALID",
  });
  assert.deepEqual(gate.snapshot(), { totalDispatches: 0 });
});

test("extension registration and final dispatch Binding are exact", () => {
  let listener;
  reviewerOneShotGate({ on(name, handler) { assert.equal(name, "tool_call"); listener = handler; } });
  assert.equal(listener({ toolName: "read", input: {} }), undefined);
  assert.equal(listener({ toolName: "subagent", input: invocation }), undefined);
  assert.equal(listener({ toolName: "subagent", input: invocation }).reason, "REVIEWER_DISPATCH_LIMIT_EXCEEDED");

  const binding = buildReviewerDispatchBinding({
    parentSessionId: "parent-1",
    childRunId: "run-1",
    childSessionId: "child-1",
    childFileDigest: DIGEST,
    inputDigest: DIGEST,
    outputDigest: DIGEST,
    dispatchOrdinal: 1,
    totalDispatches: 1,
  });
  assert.equal(validateReviewerDispatchBinding(binding).ok, true);
  assert.equal(binding.dispatchOrdinal, 1);
  assert.equal(binding.totalDispatches, 1);
  assert.throws(() => buildReviewerDispatchBinding({ ...binding, totalDispatches: 2 }), /REVIEWER_DISPATCH_BINDING_INVALID/);
});
