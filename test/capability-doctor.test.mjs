import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildCapabilityReceipt,
  inspectCapabilities,
  validateCapabilityReceipt,
} from "../capabilities/doctor.mjs";
import { compatibilityFor, loadCompatibilityMatrix, validateCompatibilityMatrix } from "../capabilities/compatibility.mjs";

const DIGEST = `sha256:${"a".repeat(64)}`;
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SUBJECT = {
  target: "github:Notyet1307/example",
  kind: "capability",
  id: "openai-codex/gpt-5.6-sol",
  revision: "a".repeat(40),
  digest: DIGEST,
};

function input(capabilities) {
  return {
    subject: SUBJECT,
    observedAt: "2026-08-25T01:00:00.000Z",
    expiresAt: "2026-08-25T02:00:00.000Z",
    pi: { path: "/usr/local/bin/pi", version: "0.84.2", digest: DIGEST },
    subagent: { version: "0.42.1" },
    provider: { name: "openai-codex", model: "gpt-5.6-sol" },
    profileDigest: DIGEST,
    harness: null,
    repo: { target: SUBJECT.target, baseSha: SUBJECT.revision },
    capabilities,
  };
}

test("Capability Receipt is deterministic and requires evidence per status", () => {
  const receipt = buildCapabilityReceipt(input([
    {
      name: "runtime.node",
      status: "SUPPORTED",
      reasonCode: "STATIC_VERSION_OK",
      evidence: [{ kind: "static-check", digest: DIGEST }],
    },
    {
      name: "provider.reviewer",
      status: "UNTESTED",
      reasonCode: "ACTIVE_PROBE_NOT_RUN",
      evidence: [{ kind: "configuration", digest: DIGEST }],
    },
  ]));
  assert.equal(receipt.schema, "pi-ticket-planning:capability-receipt:v1");
  assert.match(receipt.digest, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(buildCapabilityReceipt(input(receipt.capabilities)), receipt);
  assert.deepEqual(validateCapabilityReceipt(receipt), { ok: true, problems: [] });
});

test("configuration alone cannot claim runtime support", () => {
  const forged = buildCapabilityReceipt(input([
    {
      name: "provider.reviewer",
      status: "SUPPORTED",
      reasonCode: "CONFIG_PRESENT",
      evidence: [{ kind: "configuration", digest: DIGEST }],
    },
  ]));
  assert.equal(
    validateCapabilityReceipt(forged).problems.some(({ code }) => code === "CAPABILITY_SUPPORT_UNPROVEN"),
    true,
  );
});

test("receipt expiry and digest drift fail closed", () => {
  const receipt = buildCapabilityReceipt(input([
    {
      name: "reviewer.fresh-context",
      status: "UNTESTED",
      reasonCode: "ACTIVE_PROBE_NOT_RUN",
      evidence: [],
    },
  ]));
  assert.equal(validateCapabilityReceipt(receipt, { now: "2026-08-25T03:00:00.000Z" }).problems[0].code, "CAPABILITY_RECEIPT_EXPIRED");
  receipt.provider.model = "drifted";
  assert.equal(validateCapabilityReceipt(receipt).problems.some(({ code }) => code === "CAPABILITY_RECEIPT_DIGEST_MISMATCH"), true);
});

test("static Doctor leaves runtime capabilities UNTESTED until active evidence exists", async () => {
  const executable = { available: true, path: "/bin/tool", version: "1.0.0", digest: DIGEST };
  const observation = {
    target: SUBJECT.target,
    baseSha: SUBJECT.revision,
    provider: "openai-codex",
    model: "gpt-5.6-sol",
    node: executable,
    pi: executable,
    git: executable,
    gh: executable,
    docker: executable,
    profile: { available: true, digest: DIGEST, subagentVersion: "0.42.1" },
    protocolOk: true,
    harness: null,
  };
  const receipt = await inspectCapabilities({
    observer: () => observation,
    clock: () => "2026-08-25T01:00:00.000Z",
  });
  assert.equal(receipt.capabilities.find(({ name }) => name === "provider.reviewer").status, "UNTESTED");

  const probed = await inspectCapabilities({
    activeProbe: true,
    observer: () => observation,
    activeProbeRunner: async () => [{
      name: "provider.reviewer",
      status: "SUPPORTED",
      reasonCode: "ACTIVE_REVIEWER_RETURNED",
      evidence: [{ kind: "active-probe", digest: DIGEST }],
    }],
    clock: () => "2026-08-25T01:00:00.000Z",
  });
  assert.equal(probed.capabilities.find(({ name }) => name === "provider.reviewer").status, "SUPPORTED");
});

test("pi-ticket-planctl doctor returns a truthful Result Envelope", () => {
  const run = spawnSync(process.execPath, ["scripts/planctl.mjs", "doctor", "--capabilities", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const envelope = JSON.parse(run.stdout);
  assert.equal(envelope.schema, "pi-ticket-planning:result-envelope:v1");
  assert.equal(envelope.command, "doctor.capabilities");
  assert.equal(envelope.data.receipt.schema, "pi-ticket-planning:capability-receipt:v1");
  assert.equal(envelope.data.receipt.capabilities.find(({ name }) => name === "provider.reviewer").status, "UNTESTED");
  assert.equal(envelope.data.compatibility.status, "UNTESTED");
  assert.notEqual(envelope.status, "COMPLETE");
});

test("compatibility requires one exact qualified tuple", () => {
  const receipt = buildCapabilityReceipt(input([{
    name: "provider.reviewer",
    status: "UNTESTED",
    reasonCode: "ACTIVE_PROBE_NOT_RUN",
    evidence: [],
  }]));
  assert.deepEqual(compatibilityFor(receipt), {
    status: "UNTESTED",
    reasonCode: "NO_EXACT_QUALIFIED_TUPLE",
    evidence: [],
  });
  assert.deepEqual(validateCompatibilityMatrix(loadCompatibilityMatrix()), { ok: true, problems: [] });
  const invalid = {
    schema: "pi-ticket-planning:compatibility-matrix:v1",
    defaultStatus: "UNTESTED",
    entries: [{
      piVersion: receipt.pi.version,
      subagentVersion: receipt.subagent.version,
      provider: receipt.provider.name,
      model: receipt.provider.model,
      profileDigest: receipt.profileDigest,
      harnessDigest: null,
      status: "SUPPORTED",
      reasonCode: "CONFIG_PRESENT",
      evidence: [],
    }],
  };
  assert.equal(validateCompatibilityMatrix(invalid).problems[0].code, "QUALIFIED_COMPATIBILITY_EVIDENCE_MISSING");
});
