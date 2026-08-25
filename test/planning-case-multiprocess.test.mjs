import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createFactAttestation, loadProtocol, producerAttestationSource } from "../protocol/kernel.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TARGET = "github:acme/product";
const NOW = new Date().toISOString();
const subject = { target: TARGET, kind: "release", id: "R1", revision: "r1", digest: `sha256:${createHash("sha256").update("R1").digest("hex")}` };

function run(stateDir, args) {
  const result = spawnSync(process.execPath, ["scripts/planctl.mjs", ...args], {
    cwd: ROOT,
    env: { ...process.env, PI_TICKET_PLAN_STATE_DIR: stateDir },
    encoding: "utf8",
  });
  return { ...result, json: result.stdout.trim() ? JSON.parse(result.stdout) : null };
}

function write(directory, name, value) {
  const file = path.join(directory, name);
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  return file;
}

function factBuilder() {
  const protocol = loadProtocol();
  let factId = 0;
  return (names, mutationId) => names.map((name) => {
    const rule = { ...protocol.authority.factDefaults, ...protocol.authority.facts[name] };
    const sourceKind = rule.sources[0];
    const producer = protocol.producers.sources[sourceKind].producers[0];
    factId += 1;
    return createFactAttestation({
      id: `F-flow-${factId}`,
      fact: name,
      value: true,
      subject,
      source: producerAttestationSource(sourceKind, producer, { protocol, producerVersion: "test" }),
      observedAt: NOW,
      expiresAt: rule.freshness?.mode === "max-age" ? new Date(Date.parse(NOW) + rule.freshness.maxAgeMs).toISOString() : null,
      ...(rule.freshness?.mode === "same-mutation" ? { mutationId } : {}),
      evidence: { kind: rule.owner === "human" ? "operator" : "artifact", ref: `flow:${name}:${factId}`, digest: `sha256:${createHash("sha256").update(`${name}:${factId}`).digest("hex")}` },
    });
  });
}

test("every core stage resumes in a new process without chat history", (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-multiprocess-flow-"));
  const stateDir = path.join(parent, "state");
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const buildFacts = factBuilder();

  const created = run(stateDir, ["case", "create", "--target", TARGET, "--case-id", "PC-flow", "--json"]);
  assert.equal(created.status, 0, created.stderr);
  const steps = [
    ["PRODUCT", "FRAME", "FRAME_CANDIDATE", ["human.targetSelected"], null, true],
    ["PRODUCT", "EVIDENCE", "EVIDENCE_RECORDED", ["evidence.persisted"]],
    ["PRODUCT", "COMMIT", "READY_TO_COMMIT", ["release.readinessPassed"]],
    ["PRODUCT", "COMMIT", "COMMITTED", ["release.readinessPassed", "human.commitment", "release.persisted"]],
    ["DELIVERY", "SPEC", "SPEC_IN_PROGRESS", ["human.commitment", "release.persisted", "release.accepted", "git.deliveryBase"]],
    ["DELIVERY", "SPEC", "SPEC_ACCEPTED", ["human.commitment", "release.persisted", "release.accepted", "git.deliveryBase", "spec.persisted"]],
    ["DELIVERY", "TICKETS", "TICKET_GRAPH_CANDIDATE", []],
    ["DELIVERY", "TICKETS", "TICKETS_ACCEPTED", ["spec.persisted", "tickets.persisted", "graph.passed", "human.graphApproval"], "M-tickets"],
    ["DELIVERY", "ADMISSION", "REVIEW_IN_PROGRESS", ["tickets.persisted", "graph.passed"], "M-review"],
    ["DELIVERY", "ADMISSION", "ACTIVATION_AWAITING_CONFIRMATION", ["source.unchanged", "policy.accepted", "review.ready"], "M-activation"],
    ["DELIVERY", "ADMISSION", "ADMITTED", ["source.unchanged", "policy.accepted", "review.ready", "human.activation", "tracker.ready"], "M-admitted"],
    ["DELIVERY", "EXECUTION", "HANDOFF_READY", ["tracker.ready"]],
    ["DELIVERY", "EXECUTION", "IN_PROGRESS", ["harness.active"]],
    ["DELIVERY", "EXECUTION", "DELIVERED", ["harness.terminalSuccess", "git.acceptedSource"]],
    ["PRODUCT", "OUTCOME", "AWAITING_EVIDENCE", ["release.recorded", "release.enabled", "release.smokePassed"]],
    ["PRODUCT", "OUTCOME", "ACHIEVED", ["outcome.windowElapsed", "outcome.evidence"]],
  ];

  for (const [lane, stage, verdict, factNames, mutationId = null, rebind = false] of steps) {
    const route = `${lane}/${stage}/${verdict}`;
    const checkpoint = write(parent, "checkpoint.json", { schema: "pi-ticket-planning:checkpoint:v2", lane, stage, verdict, subject });
    const facts = write(parent, "facts.json", buildFacts(factNames, mutationId));
    const nextAction = write(parent, "next-action.json", verdict === "ACHIEVED"
      ? { kind: "NONE", command: null, skill: null, requiredInputs: [], blockingFacts: [], contextRoute: null, reasonCode: "OUTCOME_RECORDED" }
      : { kind: "SKILL", command: null, skill: "ask-yet", requiredInputs: [], blockingFacts: [], contextRoute: route, reasonCode: "FLOW_CONTINUES" });
    const args = ["case", "transition", "PC-flow", "--checkpoint", checkpoint, "--facts", facts, "--next-action", nextAction];
    if (mutationId) args.push("--mutation-id", mutationId);
    if (rebind) args.push("--rebind");
    args.push("--json");
    const transitioned = run(stateDir, args);
    assert.equal(transitioned.status, 0, `${route}: ${transitioned.stderr}\n${transitioned.stdout}`);
    const resumed = run(stateDir, ["case", "resume", "PC-flow", "--json"]);
    assert.equal(resumed.status, 0, `${route}: ${resumed.stderr}`);
    assert.equal(resumed.json.data.currentState.stage, stage);
    assert.equal(resumed.json.data.currentState.verdict, verdict);
  }
});

test("HOLD, REWORK, and DROP recovery decisions survive process boundaries", (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-multiprocess-recovery-"));
  const stateDir = path.join(parent, "state");
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const buildFacts = factBuilder();
  assert.equal(run(stateDir, ["case", "create", "--target", TARGET, "--case-id", "PC-recovery", "--json"]).status, 0);

  const transition = (lane, stage, verdict, names, { rebind = false } = {}) => {
    const route = `${lane}/${stage}/${verdict}`;
    const checkpoint = write(parent, "recovery-checkpoint.json", { schema: "pi-ticket-planning:checkpoint:v2", lane, stage, verdict, subject });
    const facts = write(parent, "recovery-facts.json", buildFacts(names));
    const nextAction = write(parent, "recovery-next.json", verdict === "DROP"
      ? { kind: "NONE", command: null, skill: null, requiredInputs: [], blockingFacts: [], contextRoute: null, reasonCode: "RELEASE_DROPPED" }
      : { kind: "SKILL", command: null, skill: "ask-yet", requiredInputs: [], blockingFacts: [], contextRoute: route, reasonCode: "RECOVERY_CONTINUES" });
    const args = ["case", "transition", "PC-recovery", "--checkpoint", checkpoint, "--facts", facts, "--next-action", nextAction];
    if (rebind) args.push("--rebind");
    args.push("--json");
    const result = run(stateDir, args);
    assert.equal(result.status, 0, `${route}: ${result.stderr}\n${result.stdout}`);
    const resumed = run(stateDir, ["case", "resume", "PC-recovery", "--json"]);
    assert.equal(resumed.status, 0, resumed.stderr);
    assert.equal(resumed.json.data.currentState.verdict, verdict);
  };

  transition("PRODUCT", "FRAME", "FRAME_CANDIDATE", ["human.targetSelected"], { rebind: true });
  transition("PRODUCT", "EVIDENCE", "NEEDS_RESEARCH", []);
  transition("PRODUCT", "COMMIT", "HOLD", ["human.releaseDecision", "release.persisted"]);
  transition("PRODUCT", "EVIDENCE", "NEEDS_RESEARCH", ["release.reopenConditionMet", "human.releaseReopened"]);
  transition("PRODUCT", "COMMIT", "REWORK", ["human.releaseDecision", "release.persisted"]);
  transition("PRODUCT", "EVIDENCE", "NEEDS_RESEARCH", ["release.reworkActionRecorded"]);
  transition("PRODUCT", "COMMIT", "DROP", ["human.releaseDecision", "release.persisted"]);
});
