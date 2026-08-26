import { createHash } from "node:crypto";

const DIGEST = /^sha256:[a-f0-9]{64}$/;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical(value)), "utf8").digest("hex")}`;
}

function validDispatch(input) {
  return input?.agent === "ticket-readiness-reviewer"
    && input.async === false
    && input.context === "fresh"
    && input.artifacts === false
    && input.mission === false
    && input.acceptance === undefined
    && typeof input.task === "string" && input.task.length > 0;
}

export function createReviewerOneShotGate() {
  let totalDispatches = 0;
  return {
    beforeToolCall(event) {
      if (event?.toolName !== "subagent") return undefined;
      if (totalDispatches === 1) return { block: true, reason: "REVIEWER_DISPATCH_LIMIT_EXCEEDED" };
      if (!validDispatch(event.input)) return { block: true, reason: "REVIEWER_DISPATCH_CONTRACT_INVALID" };
      totalDispatches = 1;
      return undefined;
    },
    snapshot() { return { totalDispatches }; },
  };
}

export function buildReviewerDispatchBinding(value) {
  const binding = {
    schema: "pi-ticket-planning:reviewer-dispatch-binding:v1",
    parentSessionId: value.parentSessionId,
    childRunId: value.childRunId,
    childSessionId: value.childSessionId,
    childFileDigest: value.childFileDigest,
    inputDigest: value.inputDigest,
    outputDigest: value.outputDigest,
    dispatchOrdinal: value.dispatchOrdinal,
    totalDispatches: value.totalDispatches,
  };
  validateReviewerDispatchBinding(binding);
  return { ...binding, digest: digest(binding) };
}

export function validateReviewerDispatchBinding(binding) {
  const keys = ["schema", "parentSessionId", "childRunId", "childSessionId", "childFileDigest", "inputDigest", "outputDigest", "dispatchOrdinal", "totalDispatches"];
  const body = binding?.digest === undefined ? binding : Object.fromEntries(Object.entries(binding).filter(([key]) => key !== "digest"));
  if (!body || Object.keys(body).sort().join("\n") !== keys.sort().join("\n")
    || body.schema !== "pi-ticket-planning:reviewer-dispatch-binding:v1"
    || [body.parentSessionId, body.childRunId, body.childSessionId].some((value) => typeof value !== "string" || value.length === 0 || /[\0\r\n]/u.test(value))
    || ![body.childFileDigest, body.inputDigest, body.outputDigest].every((value) => DIGEST.test(value ?? ""))
    || body.dispatchOrdinal !== 1 || body.totalDispatches !== 1
    || binding.digest !== undefined && binding.digest !== digest(body)) throw new Error("REVIEWER_DISPATCH_BINDING_INVALID");
  return { ok: true, problems: [] };
}

export default function reviewerOneShotGate(pi) {
  const gate = createReviewerOneShotGate();
  pi.on("tool_call", (event) => gate.beforeToolCall(event));
}
