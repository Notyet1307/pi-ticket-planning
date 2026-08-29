import { REQUIRED_ADMISSION_CAPABILITIES } from "../capabilities/admission.mjs";
import { buildCapabilityReceipt } from "../capabilities/doctor.mjs";

const digest = (character) => `sha256:${character.repeat(64)}`;

export function qualifiedCapability(repo, baseSha, harness, observedAt = "2026-08-16T12:00:00.000Z") {
  const rawHarnessDigest = harness.readiness.projection.configDigest;
  const harnessDigest = rawHarnessDigest.startsWith("sha256:") ? rawHarnessDigest : `sha256:${rawHarnessDigest}`;
  const receipt = buildCapabilityReceipt({
    subject: { target: `github:${repo}`, kind: "capability", id: "openai-codex/test", revision: baseSha, digest: digest("1") },
    observedAt,
    expiresAt: new Date(Date.parse(observedAt) + 60 * 60 * 1000).toISOString(),
    pi: { path: "/test/pi", version: "0.84.2", digest: digest("2") },
    subagent: { version: "pi-interactive-subagents@c3e8b53c0754ae5ccc19fdab5a7481ec039bc2f7" },
    provider: { name: "openai-codex", model: "test", thinking: "high" },
    profileDigest: digest("3"),
    harness: { version: "1.0.0", configDigest: harnessDigest },
    repo: { target: `github:${repo}`, baseSha },
    capabilities: REQUIRED_ADMISSION_CAPABILITIES.map((name) => ({
      name,
      status: "SUPPORTED",
      reasonCode: "TEST_ACTIVE_PROBE_PASS",
      evidence: [{ kind: "active-probe", digest: digest("4") }],
    })),
  });
  const matrix = {
    schema: "pi-ticket-planning:compatibility-matrix:v2",
    defaultStatus: "UNTESTED",
    entries: [{
      piVersion: receipt.pi.version,
      piDigest: receipt.pi.digest,
      subagentVersion: receipt.subagent.version,
      provider: receipt.provider.name,
      model: receipt.provider.model,
      thinking: receipt.provider.thinking,
      profileDigest: receipt.profileDigest,
      harnessVersion: receipt.harness.version,
      harnessDigest: receipt.harness.configDigest,
      packageCommit: receipt.subject.revision,
      observedAt: receipt.observedAt,
      expiresAt: receipt.expiresAt,
      status: "SUPPORTED",
      reasonCode: "TEST_QUALIFIED_TUPLE",
      evidence: ["active-capability", "l2-model", "l3-e2e", "l4-qualification"].map((kind) => ({ kind, digest: digest("5") })),
    }],
  };
  return { receipt, matrix };
}
