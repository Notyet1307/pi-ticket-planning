import { reviewBindingForAdmission } from "../admission/review-transport.mjs";

export function attachReviewBinding(input) {
  const binding = reviewBindingForAdmission(input);
  input.reviewBinding = structuredClone(binding);
  input.review.inputBinding = structuredClone(binding);
  return input;
}
