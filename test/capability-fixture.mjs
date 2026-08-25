import { REQUIRED_ADMISSION_CAPABILITIES } from "../capabilities/admission.mjs";
import { buildCapabilityReceipt } from "../capabilities/doctor.mjs";

const digest = (character) => `sha256:${character.repeat(64)}`;

export function qualifiedCapability(repo, baseSha, harness, observedAt = "2026-08-16T12:00:00.000Z") {
  const receipt = buildCapabilityReceipt({
    subject: { target: `github:${repo}`, kind: "capability", id: "openai-codex/test", revision: baseSha, digest: digest("1") },
    observedAt,
    expiresAt: new Date(Date.parse(observedAt) + 60 * 60 * 1000).toISOString(),
    pi: { path: "/test/pi", version: "0.84.2", digest: digest("2") },
    subagent: { version: "0.42.1" },
    provider: { name: "openai-codex", model: "test" },
    profileDigest: digest("3"),
    harness: { configDigest: harness.readiness.projection.configDigest },
    repo: { target: `github:${repo}`, baseSha },
    capabilities: REQUIRED_ADMISSION_CAPABILITIES.map((name) => ({
      name,
      status: "SUPPORTED",
      reasonCode: "TEST_ACTIVE_PROBE_PASS",
      evidence: [{ kind: "active-probe", digest: digest("4") }],
    })),
  });
  const matrix = {
    schema: "pi-ticket-planning:compatibility-matrix:v1",
    defaultStatus: "UNTESTED",
    entries: [{
      piVersion: receipt.pi.version,
      subagentVersion: receipt.subagent.version,
      provider: receipt.provider.name,
      model: receipt.provider.model,
      profileDigest: receipt.profileDigest,
      harnessDigest: receipt.harness.configDigest,
      status: "SUPPORTED",
      reasonCode: "TEST_QUALIFIED_TUPLE",
      evidence: [{ kind: "active-probe", digest: digest("4") }, { kind: "release-qualification", digest: digest("5") }],
    }],
  };
  return { receipt, matrix };
}
