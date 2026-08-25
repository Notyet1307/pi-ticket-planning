import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createFactAttestation, producerAttestationSource } from "../protocol/kernel.mjs";
import { buildCapabilityReceipt } from "../capabilities/doctor.mjs";
import { createPlanningCaseStore, PlanningCaseError } from "../planning-case/store.mjs";

const TARGET = "github:Notyet1307/example";
const NOW = "2026-08-25T01:00:00.000Z";
const later = (milliseconds) => new Date(Date.parse(NOW) + milliseconds).toISOString();

function targetHash(target = TARGET) {
  return createHash("sha256").update(target, "utf8").digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function eventDigest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`;
}

function caseDirectory(root, caseId, target = TARGET) {
  return path.join(root, "cases", targetHash(target), caseId);
}

function temporaryState(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-state-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function approval(id = "F-human-activation") {
  const fingerprint = `sha256:${"a".repeat(64)}`;
  return createFactAttestation({
    id,
    fact: "human.activation",
    value: true,
    subject: {
      target: TARGET,
      kind: "admission-plan",
      id: fingerprint,
      revision: "v1",
      digest: fingerprint,
    },
    source: producerAttestationSource("operator-asserted", "operator", { producerVersion: "human" }),
    observedAt: NOW,
    expiresAt: null,
    evidence: {
      kind: "operator",
      ref: `operator:${fingerprint}`,
      digest: `sha256:${"c".repeat(64)}`,
    },
  });
}

test("a new process resumes one private Planning Case without chat history", (t) => {
  const stateDir = temporaryState(t);
  const first = createPlanningCaseStore({ stateDir, clock: () => NOW, idGenerator: () => "PC-resume" });
  const created = first.create({ target: TARGET });
  assert.equal(created.caseId, "PC-resume");

  const second = createPlanningCaseStore({ stateDir, clock: () => later(1000) });
  const resumed = second.resume({ caseId: created.caseId });
  assert.equal(resumed.currentState.stage, "ORIENT");
  assert.equal(resumed.blocker, null);
  assert.equal(resumed.nextAction.kind, "ROUTE");
  assert.equal(resumed.bindings.source, null);
  assert.equal(resumed.compatibility.protocol, "SUPPORTED");
  assert.equal(resumed.compatibility.capabilities, "UNTESTED");
  assert.equal(resumed.contextManifest.route, "PRODUCT/ORIENT/NEEDS_TARGET");
  assert.deepEqual(resumed.contextManifest.required, ["skills/ask-yet/SKILL.md"]);
  assert.match(resumed.recoveryCommand, /case recover PC-resume --dry-run --json$/);

  const directory = caseDirectory(stateDir, created.caseId);
  assert.equal(fs.statSync(stateDir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(directory, "case.json")).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.join(directory, "events.jsonl")).mode & 0o777, 0o600);
  assert.deepEqual(second.verify({ caseId: created.caseId }), { status: "COMPLETE", problems: [] });
});

test("an event/snapshot crash requires explicit dry-run then rolls forward", (t) => {
  const stateDir = temporaryState(t);
  const base = createPlanningCaseStore({ stateDir, clock: () => NOW, idGenerator: () => "PC-crash" });
  base.create({ target: TARGET });

  const crashing = createPlanningCaseStore({
    stateDir,
    clock: () => later(1000),
    processAlive: () => false,
    failpoint(name) {
      if (name === "after_event") {
        const error = new PlanningCaseError("SIMULATED_CRASH");
        error.simulatedCrash = true;
        throw error;
      }
    },
  });
  assert.throws(
    () => crashing.abandon({ caseId: "PC-crash", reason: "superseded" }),
    (error) => error.code === "SIMULATED_CRASH",
  );
  assert.throws(
    () => activeMutation(stateDir).abandon({ caseId: "PC-crash", reason: "racing write" }),
    (error) => error.code === "CASE_LOCKED",
  );

  const active = createPlanningCaseStore({ stateDir, clock: () => later(2000), processAlive: () => true });
  assert.deepEqual(active.recover({ caseId: "PC-crash", dryRun: true }), {
    status: "BLOCKED",
    actions: [],
    problems: [{ code: "CASE_LOCKED" }],
  });

  const recovery = createPlanningCaseStore({ stateDir, clock: () => later(10 * 60 * 1000), processAlive: () => false });
  const dryRun = recovery.recover({ caseId: "PC-crash", dryRun: true });
  assert.equal(dryRun.status, "RECOVERY_REQUIRED");
  assert.deepEqual(dryRun.actions, ["REMOVE_STALE_LOCK", "ROLL_FORWARD_TRANSACTION"]);

  const recovered = recovery.recover({ caseId: "PC-crash" });
  assert.equal(recovered.status, "COMPLETE");
  assert.equal(recovery.get({ caseId: "PC-crash" }).blocker.code, "CASE_ABANDONED");
  assert.deepEqual(recovery.verify({ caseId: "PC-crash" }), { status: "COMPLETE", problems: [] });
});

function activeMutation(stateDir) {
  return createPlanningCaseStore({ stateDir, clock: () => later(2000), processAlive: () => true });
}

for (const failpoint of ["after_intent", "after_event", "after_snapshot_temp", "after_snapshot_rename", "after_commit"]) {
  test(`recovery is idempotent after ${failpoint}`, (t) => {
    const stateDir = temporaryState(t);
    createPlanningCaseStore({ stateDir, clock: () => NOW, idGenerator: () => `PC-${failpoint}` }).create({ target: TARGET });
    const crashing = createPlanningCaseStore({
      stateDir,
      clock: () => later(1000),
      processAlive: () => false,
      failpoint(name) {
        if (name === failpoint) {
          const error = new PlanningCaseError("SIMULATED_CRASH");
          error.simulatedCrash = true;
          throw error;
        }
      },
    });
    assert.throws(
      () => crashing.abandon({ caseId: `PC-${failpoint}`, reason: failpoint }),
      (error) => error.code === "SIMULATED_CRASH",
    );
    const recovery = createPlanningCaseStore({ stateDir, clock: () => later(10 * 60 * 1000), processAlive: () => false });
    assert.equal(recovery.verify({ caseId: `PC-${failpoint}` }).status, failpoint === "after_commit" ? "COMPLETE" : "RECOVERY_REQUIRED");
    assert.equal(recovery.recover({ caseId: `PC-${failpoint}` }).status, "COMPLETE");
    assert.equal(recovery.recover({ caseId: `PC-${failpoint}` }).status, "COMPLETE");
    assert.equal(recovery.get({ caseId: `PC-${failpoint}` }).blocker.reason, failpoint);
  });
}

test("Approval is consumed once and remains consumed after restart", (t) => {
  const stateDir = temporaryState(t);
  const store = createPlanningCaseStore({ stateDir, clock: () => NOW, idGenerator: () => "PC-approval" });
  store.create({ target: TARGET });
  store.addApproval({ caseId: "PC-approval", approval: approval() });
  store.consumeApproval({ caseId: "PC-approval", approvalId: "F-human-activation" });
  assert.equal(store.verify({ caseId: "PC-approval" }).status, "COMPLETE");
  assert.throws(
    () => store.consumeApproval({ caseId: "PC-approval", approvalId: "F-human-activation" }),
    (error) => error.code === "APPROVAL_ALREADY_CONSUMED",
  );

  const restarted = createPlanningCaseStore({ stateDir, clock: () => later(1000) });
  const current = restarted.get({ caseId: "PC-approval" });
  assert.equal(current.approvals.pending.length, 0);
  assert.deepEqual(current.approvals.consumed.map(({ id }) => id), ["F-human-activation"]);
});

test("corruption, symlinks, and target substitution fail closed", (t) => {
  const stateDir = temporaryState(t);
  const store = createPlanningCaseStore({ stateDir, clock: () => NOW, idGenerator: () => "PC-secure" });
  store.create({ target: TARGET });
  const directory = caseDirectory(stateDir, "PC-secure");
  const snapshot = path.join(directory, "case.json");
  const held = `${snapshot}.held`;
  fs.renameSync(snapshot, held);
  fs.symlinkSync(held, snapshot);
  assert.throws(() => store.get({ caseId: "PC-secure" }), (error) => error.code === "UNSAFE_STATE_FILE");

  fs.unlinkSync(snapshot);
  fs.renameSync(held, snapshot);
  fs.appendFileSync(path.join(directory, "events.jsonl"), "{broken\n");
  assert.equal(store.verify({ caseId: "PC-secure" }).status, "RECOVERY_REQUIRED");

  const otherTarget = "github:Other/repo";
  const otherParent = path.join(stateDir, "cases", targetHash(otherTarget));
  fs.mkdirSync(otherParent, { recursive: true, mode: 0o700 });
  fs.renameSync(directory, path.join(otherParent, "PC-secure"));
  assert.throws(
    () => store.get({ caseId: "PC-secure", target: otherTarget }),
    (error) => error.code === "CASE_TARGET_MISMATCH",
  );
});

test("event replay repairs a drifted snapshot and source drift blocks resume", (t) => {
  const stateDir = temporaryState(t);
  const store = createPlanningCaseStore({ stateDir, clock: () => NOW, idGenerator: () => "PC-replay" });
  store.create({ target: TARGET });
  store.abandon({ caseId: "PC-replay", reason: "original" });
  const snapshotFile = path.join(caseDirectory(stateDir, "PC-replay"), "case.json");
  const snapshot = JSON.parse(fs.readFileSync(snapshotFile, "utf8"));
  snapshot.blocker.reason = "tampered";
  fs.writeFileSync(snapshotFile, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
  assert.equal(store.verify({ caseId: "PC-replay" }).problems.some(({ code }) => code === "SNAPSHOT_REBUILD_MISMATCH"), true);
  assert.deepEqual(store.recover({ caseId: "PC-replay", dryRun: true }).actions, ["REBUILD_SNAPSHOT_FROM_EVENTS"]);
  assert.equal(store.recover({ caseId: "PC-replay" }).status, "COMPLETE");
  assert.equal(store.get({ caseId: "PC-replay" }).blocker.reason, "original");

  store.bind({
    caseId: "PC-replay",
    name: "source",
    binding: { target: TARGET, kind: "git", revision: "main", digest: `sha256:${"d".repeat(64)}` },
  });
  const drifted = createPlanningCaseStore({
    stateDir,
    clock: () => later(1000),
    bindingVerifier: () => [{ code: "SOURCE_DRIFT" }],
  });
  assert.throws(() => drifted.resume({ caseId: "PC-replay" }), (error) => error.code === "SOURCE_DRIFT");
});

test("unsafe state roots and relaxed file permissions are rejected", (t) => {
  const parent = temporaryState(t);
  const real = path.join(parent, "real");
  fs.mkdirSync(real, { mode: 0o700 });
  const linked = path.join(parent, "linked");
  fs.symlinkSync(real, linked);
  assert.throws(() => createPlanningCaseStore({ stateDir: linked }), (error) => error.code === "UNSAFE_STATE_DIRECTORY");

  const stateDir = path.join(parent, "state");
  const store = createPlanningCaseStore({ stateDir, clock: () => NOW, idGenerator: () => "PC-mode" });
  store.create({ target: TARGET });
  const snapshot = path.join(caseDirectory(stateDir, "PC-mode"), "case.json");
  fs.chmodSync(snapshot, 0o644);
  assert.throws(() => store.get({ caseId: "PC-mode" }), (error) => error.code === "UNSAFE_STATE_FILE");
});

test("Planning Case public guards reject invalid identities, approvals, bindings, and ambiguity", (t) => {
  const stateDir = temporaryState(t);
  const store = createPlanningCaseStore({ stateDir, clock: () => NOW, idGenerator: () => "PC-guards" });
  assert.throws(() => store.create({ target: "bad" }), (error) => error.code === "INVALID_TARGET");
  assert.throws(() => store.create({ target: TARGET, caseId: "../bad" }), (error) => error.code === "INVALID_CASE_ID");
  store.create({ target: TARGET });
  assert.throws(() => store.create({ target: TARGET, caseId: "PC-guards" }), (error) => error.code === "CASE_ALREADY_EXISTS");
  assert.throws(() => store.abandon({ caseId: "PC-guards", reason: "bad\nreason" }), (error) => error.code === "INVALID_ABANDON_REASON");
  assert.throws(() => store.addApproval({ caseId: "PC-guards", approval: { bad: true } }), (error) => error.code === "INVALID_APPROVAL");
  store.addApproval({ caseId: "PC-guards", approval: approval("F-duplicate") });
  assert.throws(() => store.addApproval({ caseId: "PC-guards", approval: approval("F-duplicate") }), (error) => error.code === "DUPLICATE_APPROVAL");
  assert.throws(() => store.consumeApproval({ caseId: "PC-guards", approvalId: "" }), (error) => error.code === "INVALID_APPROVAL_ID");
  assert.throws(() => store.consumeApproval({ caseId: "PC-guards", approvalId: "F-missing" }), (error) => error.code === "APPROVAL_NOT_FOUND");
  assert.throws(() => store.bind({ caseId: "PC-guards", name: "unknown", binding: {} }), (error) => error.code === "INVALID_BINDING_NAME");
  assert.throws(() => store.bind({ caseId: "PC-guards", name: "source", binding: { target: TARGET, digest: "bad" } }), (error) => error.code === "INVALID_BINDING");
  assert.deepEqual(store.list({ target: "github:missing/repo" }), []);

  store.create({ target: "github:Other/repo", caseId: "PC-guards" });
  assert.throws(() => store.get({ caseId: "PC-guards" }), (error) => error.code === "AMBIGUOUS_CASE_ID");
  assert.equal(store.list({ target: TARGET }).length, 1);
});

test("Planning Case verification rejects malformed verifier, snapshot, transaction, and lock state", (t) => {
  const stateDir = temporaryState(t);
  const base = createPlanningCaseStore({ stateDir, clock: () => NOW, idGenerator: () => "PC-malformed" });
  base.create({ target: TARGET });
  const invalidVerifier = createPlanningCaseStore({ stateDir, clock: () => NOW, bindingVerifier: () => "bad" });
  assert.equal(invalidVerifier.verify({ caseId: "PC-malformed" }).problems[0].code, "BINDING_VERIFY_FAILED");
  const invalidProblem = createPlanningCaseStore({ stateDir, clock: () => NOW, bindingVerifier: () => [{}] });
  assert.equal(invalidProblem.verify({ caseId: "PC-malformed" }).problems[0].code, "BINDING_VERIFY_FAILED");

  const directory = caseDirectory(stateDir, "PC-malformed");
  const snapshotFile = path.join(directory, "case.json");
  const snapshot = JSON.parse(fs.readFileSync(snapshotFile, "utf8"));
  snapshot.schema = "unknown";
  fs.writeFileSync(snapshotFile, `${JSON.stringify(snapshot)}\n`, { mode: 0o600 });
  assert.equal(base.verify({ caseId: "PC-malformed" }).problems[0].code, "INVALID_CASE_SNAPSHOT");

  const recoveryDir = temporaryState(t);
  createPlanningCaseStore({ stateDir: recoveryDir, clock: () => NOW, idGenerator: () => "PC-transaction" }).create({ target: TARGET });
  const crashing = createPlanningCaseStore({
    stateDir: recoveryDir,
    clock: () => later(1000),
    processAlive: () => false,
    failpoint(name) {
      if (name === "after_intent") {
        const error = new PlanningCaseError("SIMULATED_CRASH");
        error.simulatedCrash = true;
        throw error;
      }
    },
  });
  assert.throws(() => crashing.abandon({ caseId: "PC-transaction", reason: "crash" }), (error) => error.code === "SIMULATED_CRASH");
  const transactionDirectory = path.join(caseDirectory(recoveryDir, "PC-transaction"), "transactions");
  const transactionFile = path.join(transactionDirectory, fs.readdirSync(transactionDirectory).find((name) => name.endsWith(".json") && JSON.parse(fs.readFileSync(path.join(transactionDirectory, name), "utf8")).status === "INTENT"));
  const transaction = JSON.parse(fs.readFileSync(transactionFile, "utf8"));
  transaction.beforeEvent = `sha256:${"0".repeat(64)}`;
  transaction.event.digest = `sha256:${"1".repeat(64)}`;
  fs.writeFileSync(transactionFile, `${JSON.stringify(transaction)}\n`, { mode: 0o600 });
  const recovery = createPlanningCaseStore({ stateDir: recoveryDir, clock: () => later(10 * 60 * 1000), processAlive: () => false });
  assert.throws(() => recovery.recover({ caseId: "PC-transaction" }), (error) => error.code === "TRANSACTION_EVENT_CONFLICT");

  createPlanningCaseStore({ stateDir: recoveryDir, clock: () => NOW, idGenerator: () => "PC-lock" }).create({ target: TARGET });
  fs.writeFileSync(path.join(caseDirectory(recoveryDir, "PC-lock"), "lock"), "{\"pid\":\"bad\"}\n", { mode: 0o600 });
  assert.throws(() => recovery.recover({ caseId: "PC-lock" }), (error) => error.code === "CORRUPT_LOCK");
});

test("Planning Case detects capability, directory, descriptor, event, and transaction corruption", (t) => {
  const stateDir = temporaryState(t);
  const store = createPlanningCaseStore({ stateDir, clock: () => NOW, idGenerator: () => "PC-deep-guards" });
  store.create({ target: TARGET });
  store.bind({
    caseId: "PC-deep-guards",
    name: "capability",
    binding: { schema: "bad", subject: { target: TARGET }, digest: `sha256:${"a".repeat(64)}` },
  });
  assert.equal(store.verify({ caseId: "PC-deep-guards" }).problems.some(({ code }) => code === "INVALID_CAPABILITY_RECEIPT_SCHEMA"), true);

  const directory = caseDirectory(stateDir, "PC-deep-guards");
  fs.chmodSync(directory, 0o755);
  assert.throws(() => store.get({ caseId: "PC-deep-guards" }), (error) => error.code === "UNSAFE_STATE_DIRECTORY");
  fs.chmodSync(directory, 0o700);

  const changedIo = { ...fs, fstatSync(descriptor) { const value = fs.fstatSync(descriptor); return { ...value, isFile: () => true, ino: value.ino + 1 }; } };
  const changed = createPlanningCaseStore({ stateDir, clock: () => NOW, io: changedIo });
  assert.throws(() => changed.get({ caseId: "PC-deep-guards" }), (error) => error.code === "STATE_FILE_CHANGED");
  const portableIo = { ...fs, constants: { ...fs.constants, O_NOFOLLOW: undefined } };
  assert.equal(createPlanningCaseStore({ stateDir, clock: () => NOW, io: portableIo }).get({ caseId: "PC-deep-guards" }).caseId, "PC-deep-guards");

  const eventFile = path.join(directory, "events.jsonl");
  const events = fs.readFileSync(eventFile, "utf8").trimEnd().split("\n").map(JSON.parse);
  const last = events.at(-1);
  const { digest: _old, ...projection } = last;
  projection.type = "UNKNOWN_EVENT";
  const replacement = { ...projection, digest: eventDigest(projection) };
  events[events.length - 1] = replacement;
  fs.writeFileSync(eventFile, `${events.map(JSON.stringify).join("\n")}\n`, { mode: 0o600 });
  const snapshotFile = path.join(directory, "case.json");
  const snapshot = JSON.parse(fs.readFileSync(snapshotFile, "utf8"));
  snapshot.lastEvent = replacement.digest;
  fs.writeFileSync(snapshotFile, `${JSON.stringify(snapshot)}\n`, { mode: 0o600 });
  assert.equal(store.verify({ caseId: "PC-deep-guards" }).problems[0].code, "UNKNOWN_CASE_EVENT");

  const corruptDir = temporaryState(t);
  const clean = createPlanningCaseStore({ stateDir: corruptDir, clock: () => NOW, idGenerator: () => "PC-files" });
  clean.create({ target: TARGET });
  const transactions = path.join(caseDirectory(corruptDir, "PC-files"), "transactions");
  fs.writeFileSync(path.join(transactions, "unexpected"), "x", { mode: 0o600 });
  assert.equal(clean.verify({ caseId: "PC-files" }).problems[0].code, "UNEXPECTED_TRANSACTION_FILE");
});

test("Planning Case rejects a corrupt roll-forward snapshot", (t) => {
  const stateDir = temporaryState(t);
  createPlanningCaseStore({ stateDir, clock: () => NOW, idGenerator: () => "PC-corrupt-roll" }).create({ target: TARGET });
  const crashing = createPlanningCaseStore({
    stateDir,
    clock: () => later(1000),
    processAlive: () => false,
    failpoint(name) {
      if (name === "after_intent") {
        const error = new PlanningCaseError("SIMULATED_CRASH");
        error.simulatedCrash = true;
        throw error;
      }
    },
  });
  assert.throws(() => crashing.abandon({ caseId: "PC-corrupt-roll", reason: "x" }), /SIMULATED_CRASH/);
  const transactionDir = path.join(caseDirectory(stateDir, "PC-corrupt-roll"), "transactions");
  const file = fs.readdirSync(transactionDir)
    .map((name) => path.join(transactionDir, name))
    .find((candidate) => JSON.parse(fs.readFileSync(candidate, "utf8")).status === "INTENT");
  const transaction = JSON.parse(fs.readFileSync(file, "utf8"));
  transaction.nextSnapshot.target = "github:other/repo";
  fs.writeFileSync(file, `${JSON.stringify(transaction)}\n`, { mode: 0o600 });
  const recovery = createPlanningCaseStore({ stateDir, clock: () => later(10 * 60 * 1000), processAlive: () => false });
  assert.throws(() => recovery.recover({ caseId: "PC-corrupt-roll" }), (error) => error.code === "CORRUPT_TRANSACTION");
});

test("Planning Case exercises default liveness, recovery catch, fsync, and structural corruption", (t) => {
  const stateDir = temporaryState(t);
  const store = createPlanningCaseStore({ stateDir, clock: () => NOW, idGenerator: () => "PC-branches" });
  store.create({ target: TARGET });
  const directory = caseDirectory(stateDir, "PC-branches");
  fs.writeFileSync(path.join(directory, "lock"), JSON.stringify({ pid: process.pid, createdAt: NOW, nonce: "live" }), { mode: 0o600 });
  const alive = createPlanningCaseStore({ stateDir, clock: () => later(10 * 60 * 1000) });
  assert.equal(alive.recover({ caseId: "PC-branches", dryRun: true }).status, "BLOCKED");
  fs.writeFileSync(path.join(directory, "lock"), JSON.stringify({ pid: 99999999, createdAt: NOW, nonce: "dead" }), { mode: 0o600 });
  assert.equal(alive.recover({ caseId: "PC-branches" }).status, "COMPLETE");

  const eventFile = path.join(directory, "events.jsonl");
  const events = fs.readFileSync(eventFile, "utf8").trimEnd().split("\n").map(JSON.parse);
  events[0].sequence = 2;
  fs.writeFileSync(eventFile, `${events.map(JSON.stringify).join("\n")}\n`, { mode: 0o600 });
  assert.equal(store.verify({ caseId: "PC-branches" }).problems[0].code, "EVENT_LOG_CORRUPT");
  assert.equal(store.recover({ caseId: "PC-branches", dryRun: true }).status, "RECOVERY_REQUIRED");

  const deniedIo = { ...fs, lstatSync() { const error = new Error("denied"); error.code = "EACCES"; throw error; } };
  assert.throws(() => createPlanningCaseStore({ stateDir: path.join(stateDir, "denied"), io: deniedIo }), /denied/);

  const fsyncDir = temporaryState(t);
  const tolerantIo = {
    ...fs,
    fsyncSync(descriptor) {
      if (fs.fstatSync(descriptor).isDirectory()) { const error = new Error("unsupported"); error.code = "EINVAL"; throw error; }
      return fs.fsyncSync(descriptor);
    },
  };
  assert.doesNotThrow(() => createPlanningCaseStore({ stateDir: fsyncDir, io: tolerantIo, idGenerator: () => "PC-fsync" }).create({ target: TARGET }));
});

test("Planning Case rejects invalid consumed events and transaction records", (t) => {
  const stateDir = temporaryState(t);
  const store = createPlanningCaseStore({ stateDir, clock: () => NOW, idGenerator: () => "PC-event-records" });
  store.create({ target: TARGET });
  store.addApproval({ caseId: "PC-event-records", approval: approval("F-event") });
  store.consumeApproval({ caseId: "PC-event-records", approvalId: "F-event" });
  const directory = caseDirectory(stateDir, "PC-event-records");
  const eventFile = path.join(directory, "events.jsonl");
  const events = fs.readFileSync(eventFile, "utf8").trimEnd().split("\n").map(JSON.parse);
  const last = events.at(-1);
  const { digest: _digest, ...projection } = last;
  projection.data.id = "F-missing";
  last.data.id = "F-missing";
  last.digest = eventDigest(projection);
  fs.writeFileSync(eventFile, `${events.map(JSON.stringify).join("\n")}\n`, { mode: 0o600 });
  const snapshotFile = path.join(directory, "case.json");
  const snapshot = JSON.parse(fs.readFileSync(snapshotFile, "utf8"));
  snapshot.lastEvent = last.digest;
  fs.writeFileSync(snapshotFile, `${JSON.stringify(snapshot)}\n`, { mode: 0o600 });
  assert.equal(store.verify({ caseId: "PC-event-records" }).problems[0].code, "INVALID_CASE_EVENT");

  const transactionDirectory = path.join(directory, "transactions");
  fs.writeFileSync(path.join(transactionDirectory, "TX-invalid.json"), JSON.stringify({ schema: "bad", id: "TX-invalid", status: "NOPE" }), { mode: 0o600 });
  assert.equal(store.verify({ caseId: "PC-event-records" }).problems[0].code, "CORRUPT_TRANSACTION");
});

test("Planning Case covers default IDs, Date clocks, valid capabilities, and generic verifier failures", (t) => {
  const stateDir = temporaryState(t);
  const dated = createPlanningCaseStore({ stateDir, clock: () => new Date(NOW) });
  const created = dated.create({ target: TARGET });
  assert.match(created.caseId, /^PC-/);
  const receipt = buildCapabilityReceipt({
    subject: { target: TARGET, kind: "capability", id: "provider/model", revision: "a".repeat(40), digest: `sha256:${"1".repeat(64)}` },
    observedAt: NOW,
    expiresAt: later(60 * 60 * 1000),
    pi: { path: "/bin/pi", version: "1", digest: `sha256:${"2".repeat(64)}` },
    subagent: { version: "1" },
    provider: { name: "provider", model: "model" },
    profileDigest: `sha256:${"3".repeat(64)}`,
    harness: null,
    repo: { target: TARGET, baseSha: "a".repeat(40) },
    capabilities: [{ name: "provider.reviewer", status: "UNTESTED", reasonCode: "NOT_RUN", evidence: [] }],
  });
  dated.bind({ caseId: created.caseId, name: "capability", binding: receipt });
  assert.equal(dated.resume({ caseId: created.caseId }).compatibility.capabilities, "UNTESTED");

  const throwing = createPlanningCaseStore({ stateDir, clock: () => NOW, bindingVerifier() { throw new Error("boom"); } });
  assert.equal(throwing.verify({ caseId: created.caseId }).problems[0].code, "STATE_VERIFY_FAILED");
  const invalidClockDir = temporaryState(t);
  const invalidClock = createPlanningCaseStore({ stateDir: invalidClockDir, clock: () => "bad" });
  assert.throws(() => invalidClock.create({ target: TARGET }), (error) => error.code === "INVALID_CLOCK");
});

test("Planning Case rejects empty logs, unexpected target entries, mismatched IDs, and fsync errors", (t) => {
  const stateDir = temporaryState(t);
  const store = createPlanningCaseStore({ stateDir, clock: () => NOW, idGenerator: () => "PC-structural" });
  store.create({ target: TARGET });
  const directory = caseDirectory(stateDir, "PC-structural");
  fs.writeFileSync(path.join(directory, "events.jsonl"), "", { mode: 0o600 });
  assert.equal(store.verify({ caseId: "PC-structural" }).problems.some(({ code }) => code === "SNAPSHOT_EVENT_MISMATCH"), true);
  const snapshotFile = path.join(directory, "case.json");
  const snapshot = JSON.parse(fs.readFileSync(snapshotFile, "utf8"));
  snapshot.caseId = "PC-other";
  fs.writeFileSync(snapshotFile, `${JSON.stringify(snapshot)}\n`, { mode: 0o600 });
  assert.throws(() => store.get({ caseId: "PC-structural" }), (error) => error.code === "CASE_ID_MISMATCH");
  fs.mkdirSync(path.join(stateDir, "cases", "not-a-target"), { mode: 0o700 });
  assert.throws(() => store.list(), (error) => error.code === "UNEXPECTED_TARGET_DIRECTORY");

  const errorDir = temporaryState(t);
  const errorIo = {
    ...fs,
    fsyncSync(descriptor) {
      if (fs.fstatSync(descriptor).isDirectory()) { const error = new Error("io"); error.code = "EIO"; throw error; }
      return fs.fsyncSync(descriptor);
    },
  };
  assert.throws(() => createPlanningCaseStore({ stateDir: errorDir, io: errorIo }).create({ target: TARGET }), /io/);
});
