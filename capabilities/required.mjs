export const REQUIRED_ADMISSION_CAPABILITIES = [
  "runtime.pi",
  "pi.session",
  "pi.exact-id-file-resume",
  "subagent.final-result",
  "reviewer.one-shot-dispatch",
  "reviewer.fresh-context",
  "reviewer.schema",
  "tool-calling",
  "timeout-cancellation",
  "harness.readiness",
  "provider.reviewer",
];

export const SESSION_RESUME_CAPABILITIES = ["pi.named-session", "pi.exact-id-file-resume"];

export function supportsSessionResume(capabilities) {
  const byName = capabilities instanceof Map ? capabilities : new Map((capabilities ?? []).map((item) => [item.name, item]));
  return SESSION_RESUME_CAPABILITIES.some((name) => byName.get(name)?.status === "SUPPORTED");
}
