import { reviewBindingForAdmission } from "../admission/review-transport.mjs";
import { buildReviewerDispatchBinding } from "../extensions/reviewer-one-shot-gate.mjs";
import { fingerprint } from "../admission/domain.mjs";

export function attachReviewBinding(input) {
  const binding = reviewBindingForAdmission(input);
  input.reviewBinding = structuredClone(binding);
  input.review.inputBinding = structuredClone(binding);
  input.reviewDispatchBinding = buildReviewerDispatchBinding({
    parentSessionId: "test-parent-session",
    childRunId: "test-child-run",
    childSessionId: "test-child-session",
    childFileDigest: fingerprint("test-child-file"),
    inputDigest: binding.inputDigest,
    outputDigest: fingerprint(input.review),
    dispatchOrdinal: 1,
    totalDispatches: 1,
  });
  return input;
}
