import assert from "node:assert/strict";
import test from "node:test";

import {
  verifyApprovalSingleConsumed,
  verifyCommentsExactReadback,
  verifyLabelsExactControlledState,
  verifyNoHarnessClaim,
  verifyParentLast,
  verifyTrackerMatchesPlan,
  verifyTransactionCommitted,
} from "../admission/postconditions.mjs";

const plan = {
  kind: "DELIVERY_GRAPH",
  parent: "2",
  operations: [
    { kind: "comment", issue: "1", body: "reviewed\nmarker", marker: "marker" },
    { kind: "labels", issue: "1", before: ["needs-triage"], after: ["ready-for-agent"] },
    { kind: "labels", issue: "2", before: ["needs-triage"], after: ["ready-for-agent"] },
  ],
};
const state = {
  children: [{ id: "1", comments: [{ body: "reviewed\nmarker", authorVerified: true }], labels: ["ready-for-agent"] }],
  parent: { id: "2", comments: [], labels: ["ready-for-agent"] },
};

test("Admission postcondition registry functions fail closed", () => {
  assert.deepEqual(verifyCommentsExactReadback({ plan, state }), []);
  assert.deepEqual(verifyLabelsExactControlledState({ plan, state }), []);
  assert.deepEqual(verifyParentLast({ plan }), []);
  assert.deepEqual(verifyNoHarnessClaim({ claims: [] }), []);
  assert.deepEqual(verifyTrackerMatchesPlan({ plan, state }), []);
  assert.equal(verifyCommentsExactReadback({ plan, state: { ...state, children: [{ ...state.children[0], comments: [] }] } }).length, 1);
  assert.equal(verifyLabelsExactControlledState({ plan, state: { ...state, parent: { ...state.parent, labels: ["needs-triage"] } } }).length, 1);
  assert.equal(verifyParentLast({ plan: { ...plan, parent: "1" } })[0].code, "PARENT_NOT_ACTIVATED_LAST");
  assert.equal(verifyNoHarnessClaim({ claims: ["1"] })[0].code, "HARNESS_CLAIM_DETECTED");
  assert.equal(verifyTrackerMatchesPlan({ plan, state: { ...state, children: [{ ...state.children[0], comments: [] }] } }).length, 1);
  assert.deepEqual(verifyApprovalSingleConsumed({ approvalId: "F-1", snapshot: { approvals: { pending: [], consumed: [{ id: "F-1" }] } } }), []);
  assert.equal(verifyApprovalSingleConsumed({ approvalId: "F-1", snapshot: { approvals: { pending: [{ id: "F-1" }], consumed: [] } } }).length, 1);
  assert.deepEqual(verifyTransactionCommitted({ transaction: { state: "ADMISSION_COMMITTED" } }), []);
  assert.equal(verifyTransactionCommitted({ transaction: { state: "ADMISSION_APPLYING" } })[0].code, "ADMISSION_TRANSACTION_NOT_COMMITTED");
});
