import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { compatibilityFor } from "../capabilities/compatibility.mjs";
import { validateCapabilityReceipt } from "../capabilities/doctor.mjs";
import { loadContextManifest } from "../context/manifest.mjs";
import { loadProtocol, validateArtifact, validateFactAttestation } from "../protocol/kernel.mjs";
import { reducePlanningCaseEvent } from "./events.mjs";
import { validatePlanningCaseBinding, verifyPlanningCaseBindings } from "./bindings.mjs";

const CASE_ID = /^PC-[A-Za-z0-9._-]{1,96}$/;
const TARGET = /^[a-z][a-z0-9+.-]*:[^\u0000\r\n]+$/;
const TARGET_HASH = /^[a-f0-9]{64}$/;
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const DEFAULT_STALE_LOCK_MS = 5 * 60 * 1000;

export class PlanningCaseError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "PlanningCaseError";
    this.code = code;
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical(value)), "utf8").digest("hex")}`;
}

function clone(value) {
  return structuredClone(value);
}

function defaultProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function normalizeTime(value) {
  const text = value instanceof Date ? value.toISOString() : String(value);
  if (!Number.isFinite(Date.parse(text))) throw new PlanningCaseError("INVALID_CLOCK");
  return text;
}

class PlanningCaseStore {
  constructor({
    stateDir = process.env.PI_TICKET_PLAN_STATE_DIR ?? path.join(os.homedir(), ".local", "state", "pi-ticket-planning"),
    clock = () => new Date().toISOString(),
    idGenerator = () => randomUUID(),
    nonceGenerator = () => randomUUID(),
    processAlive = defaultProcessAlive,
    staleLockMs = DEFAULT_STALE_LOCK_MS,
    pid = process.pid,
    io = fs,
    failpoint = () => {},
    bindingVerifier = verifyPlanningCaseBindings,
    contextManifestLoader = loadContextManifest,
  } = {}) {
    this.io = io;
    this.clock = () => normalizeTime(clock());
    this.idGenerator = idGenerator;
    this.nonceGenerator = nonceGenerator;
    this.processAlive = processAlive;
    this.staleLockMs = staleLockMs;
    this.pid = pid;
    this.failpoint = failpoint;
    this.bindingVerifier = bindingVerifier;
    this.contextManifestLoader = contextManifestLoader;
    this.protocol = loadProtocol();
    this.stateDir = this.#initializeStateRoot(path.resolve(stateDir));
    this.casesDir = path.join(this.stateDir, "cases");
    this.#ensurePrivateDirectory(this.casesDir, this.stateDir);
  }

  create({ target, caseId } = {}) {
    this.#assertTarget(target);
    const generated = caseId ?? this.idGenerator();
    const id = generated.startsWith("PC-") ? generated : `PC-${generated}`;
    this.#assertCaseId(id);
    const targetDir = path.join(this.casesDir, this.#targetHash(target));
    this.#ensurePrivateDirectory(targetDir, this.casesDir);
    const directory = path.join(targetDir, id);
    if (this.#lstat(directory)) throw new PlanningCaseError("CASE_ALREADY_EXISTS", id);
    this.io.mkdirSync(directory, { mode: PRIVATE_DIRECTORY_MODE });
    this.#ensurePrivateDirectory(directory, targetDir);
    this.#ensurePrivateDirectory(path.join(directory, "transactions"), directory);
    this.#ensurePrivateDirectory(path.join(directory, "receipts"), directory);
    this.#createPrivateFile(path.join(directory, "events.jsonl"), "");

    const now = this.clock();
    const initial = this.#initialSnapshot(target, id, now);
    const event = this.#event({
      caseId: id,
      target,
      type: "CASE_CREATED",
      data: { snapshot: initial },
      at: now,
      sequence: 1,
      previousDigest: null,
      transactionId: `TX-${this.nonceGenerator()}`,
    });
    const next = { ...initial, lastEvent: event.digest };
    this.#withLock(directory, () => this.#commitTransaction(directory, null, next, event));
    return clone(next);
  }

  get({ caseId, target } = {}) {
    const directory = this.#resolveCaseDirectory(caseId, target);
    return clone(this.#readSnapshot(directory, target));
  }

  list({ target } = {}) {
    if (target !== undefined) this.#assertTarget(target);
    const directories = target === undefined
      ? this.#allCaseDirectories()
      : this.#caseDirectoriesForTarget(target);
    return directories.map((directory) => {
      const snapshot = this.#readSnapshot(directory, target);
      return {
        caseId: snapshot.caseId,
        target: snapshot.target,
        checkpoint: snapshot.checkpoint,
        blocker: snapshot.blocker,
        nextAction: snapshot.nextAction,
        updatedAt: snapshot.updatedAt,
      };
    }).sort((left, right) => left.caseId.localeCompare(right.caseId));
  }

  resume({ caseId, target, offline = false } = {}) {
    const verified = this.verify({ caseId, target, offline });
    if (verified.status !== "COMPLETE") throw new PlanningCaseError(verified.problems[0]?.code ?? "RECOVERY_REQUIRED");
    const snapshot = this.get({ caseId, target });
    const capability = snapshot.bindings.capability
      ? compatibilityFor(snapshot.bindings.capability)
      : { status: "UNTESTED", reasonCode: "CAPABILITY_RECEIPT_MISSING", evidence: [] };
    const planningPublication = {
      allowed: !offline,
      reasonCode: offline ? "OFFLINE_DIAGNOSTIC_ONLY" : "ONLINE_PLANNING",
    };
    const legacyAdmission = {
      allowed: !offline && capability.status === "SUPPORTED",
      reasonCode: offline ? "OFFLINE_DIAGNOSTIC_ONLY" : capability.reasonCode,
    };
    return {
      currentState: snapshot.checkpoint,
      blocker: snapshot.blocker,
      nextAction: snapshot.nextAction,
      contextManifest: this.contextManifestLoader(`${snapshot.checkpoint.lane}/${snapshot.checkpoint.stage}/${snapshot.checkpoint.verdict}`),
      bindings: clone(snapshot.bindings),
      compatibility: { scope: "LEGACY_ADMISSION", protocol: offline ? "DEGRADED" : "SUPPORTED", capabilities: capability.status, capabilityReason: capability.reasonCode },
      mutationScopes: { planningPublication, legacyAdmission },
      mutationAllowed: legacyAdmission.allowed,
      mode: offline ? "DEGRADED" : "ONLINE",
      recoveryCommand: `pi-ticket-planctl case recover ${snapshot.caseId} --dry-run --json`,
    };
  }

  abandon({ caseId, target, reason } = {}) {
    if (typeof reason !== "string" || reason.trim().length === 0 || reason.length > 4096 || /[\u0000\r\n]/u.test(reason)) {
      throw new PlanningCaseError("INVALID_ABANDON_REASON");
    }
    return this.#mutate({
      caseId,
      target,
      type: "CASE_ABANDONED",
      data: { reason },
    });
  }

  addApproval({ caseId, target, approval } = {}) {
    const snapshot = this.get({ caseId, target });
    const checked = validateFactAttestation(approval, { protocol: this.protocol, now: this.clock() });
    const rule = this.protocol.authority.facts?.[approval?.fact];
    if (!checked.ok || rule?.kind !== "HUMAN_APPROVAL" || approval.subject?.target !== snapshot.target) {
      throw new PlanningCaseError("INVALID_APPROVAL", checked.problems.map(({ code }) => code).join(","));
    }
    return this.#mutate({
      caseId,
      target,
      type: "APPROVAL_ADDED",
      data: { approval: clone(approval) },
    });
  }

  consumeApproval({ caseId, target, approvalId } = {}) {
    if (typeof approvalId !== "string" || approvalId.length === 0) throw new PlanningCaseError("INVALID_APPROVAL_ID");
    return this.#mutate({
      caseId,
      target,
      type: "APPROVAL_CONSUMED",
      data: { id: approvalId },
    });
  }

  bind({ caseId, target, name, binding } = {}) {
    if (!["source", "release", "spec", "graph", "policy", "harness", "capability", "outcome", "session", "reviewer"].includes(name)) {
      throw new PlanningCaseError("INVALID_BINDING_NAME");
    }
    const snapshot = this.get({ caseId, target });
    const problems = validatePlanningCaseBinding(name, binding, snapshot.target, { now: this.clock() });
    problems.push(...verifyPlanningCaseBindings({ ...snapshot.bindings, [name]: binding }, snapshot, { offline: true, now: this.clock() }));
    if (problems.length > 0) throw new PlanningCaseError(problems[0].code);
    return this.#mutate({
      caseId,
      target,
      type: "BINDING_SET",
      data: { name, binding: clone(binding) },
    });
  }

  clearBinding({ caseId, target, name } = {}) {
    if (!["source", "release", "spec", "graph", "policy", "harness", "capability", "outcome", "session", "reviewer"].includes(name)) throw new PlanningCaseError("INVALID_BINDING_NAME");
    return this.#mutate({ caseId, target, type: "BINDING_CLEARED", data: { name } });
  }

  transition({ caseId, target, checkpoint, facts = [], rebind = false, mutationId = null, nextAction } = {}) {
    return this.#mutate({
      caseId,
      target,
      type: "CHECKPOINT_TRANSITIONED",
      data: { checkpoint: clone(checkpoint), facts: clone(facts), rebind, mutationId, nextAction: clone(nextAction) },
    });
  }

  record({ caseId, target, type, data } = {}) {
    const allowed = new Set([
      "CANDIDATE_SELECTED", "CANDIDATE_EXCLUDED", "DECISION_RECORDED", "UNKNOWN_RECORDED", "UNKNOWN_RESOLVED",
      "ASSUMPTION_RECORDED", "ASSUMPTION_REVISED", "EVIDENCE_METHOD_SET", "EVIDENCE_RECORDED", "FACT_ATTACHED",
      "FACT_CONSUMED", "BLOCKER_SET", "BLOCKER_CLEARED", "NEXT_ACTION_SET", "LEARNING_DECISION_RECORDED",
    ]);
    if (!allowed.has(type)) throw new PlanningCaseError("INVALID_CASE_EVENT_TYPE");
    return this.#mutate({ caseId, target, type, data: clone(data) });
  }

  changeAdmissionTransaction({ caseId, target, transaction } = {}) {
    return this.#mutate({ caseId, target, type: "ADMISSION_TRANSACTION_CHANGED", data: { transaction: clone(transaction) } });
  }

  ingestOutcome({ caseId, target, receipt } = {}) {
    return this.#mutate({ caseId, target, type: "OUTCOME_INGESTED", data: { receipt: clone(receipt) } });
  }

  verify({ caseId, target, offline = false } = {}) {
    try {
      const directory = this.#resolveCaseDirectory(caseId, target);
      const snapshot = this.#readSnapshot(directory, target);
      const events = this.#readEvents(directory, snapshot.caseId, snapshot.target);
      const pending = this.#readTransactions(directory).filter((transaction) => transaction.status === "INTENT");
      const problems = [];
      const last = events.at(-1);
      if (!last || snapshot.lastEvent !== last.digest) problems.push({ code: "SNAPSHOT_EVENT_MISMATCH" });
      if (last) {
        const rebuilt = this.#rebuildFromEvents(events);
        if (digest(snapshot) !== digest(rebuilt)) problems.push({ code: "SNAPSHOT_REBUILD_MISMATCH" });
      }
      if (pending.length > 0) problems.push({ code: "PENDING_TRANSACTION" });
      if (this.#orphanTemporaryFiles(directory).length > 0) problems.push({ code: "ORPHAN_TEMPORARY_FILE" });
      const bindingProblems = this.bindingVerifier(clone(snapshot.bindings), clone(snapshot), { offline, now: this.clock() });
      if (!Array.isArray(bindingProblems)) throw new PlanningCaseError("BINDING_VERIFY_FAILED");
      for (const item of bindingProblems) {
        if (!item || !/^[A-Z][A-Z0-9_]{0,127}$/.test(item.code ?? "")) throw new PlanningCaseError("BINDING_VERIFY_FAILED");
        problems.push({ code: item.code });
      }
      if (snapshot.bindings.capability) {
        const checked = validateCapabilityReceipt(snapshot.bindings.capability, { now: this.clock() });
        problems.push(...checked.problems.map(({ code }) => ({ code })));
        if (snapshot.bindings.capability.subject?.target !== snapshot.target) problems.push({ code: "CAPABILITY_TARGET_MISMATCH" });
      }
      return { status: problems.length === 0 ? "COMPLETE" : "RECOVERY_REQUIRED", problems };
    } catch (error) {
      return {
        status: "RECOVERY_REQUIRED",
        problems: [{ code: error instanceof PlanningCaseError ? error.code : "STATE_VERIFY_FAILED" }],
      };
    }
  }

  recover({ caseId, target, dryRun = false } = {}) {
    const directory = this.#resolveCaseDirectory(caseId, target);
    const lock = this.#readLock(directory);
    const actions = [];
    if (lock) {
      if (!this.#staleLock(lock)) return { status: "BLOCKED", actions: [], problems: [{ code: "CASE_LOCKED" }] };
      actions.push("REMOVE_STALE_LOCK");
    }
    const pending = this.#readTransactions(directory).filter((transaction) => transaction.status === "INTENT");
    if (pending.length > 0) actions.push("ROLL_FORWARD_TRANSACTION");
    let rebuild = null;
    if (pending.length === 0) {
      try {
        const snapshot = this.#readSnapshot(directory, target);
        const events = this.#readEvents(directory, snapshot.caseId, snapshot.target);
        const candidate = this.#rebuildFromEvents(events);
        if (digest(snapshot) !== digest(candidate)) {
          actions.push("REBUILD_SNAPSHOT_FROM_EVENTS");
          rebuild = candidate;
        }
      } catch {
        // Corruption without a trustworthy event sequence remains fail closed.
      }
    }
    if (actions.length === 0) {
      const verified = this.verify({ caseId, target });
      return { status: verified.status, actions: [], problems: verified.problems };
    }
    if (dryRun) return { status: "RECOVERY_REQUIRED", actions, problems: [] };

    if (lock) this.io.unlinkSync(path.join(directory, "lock"));
    this.#withLock(directory, () => {
      for (const transaction of pending.sort((left, right) => left.event.sequence - right.event.sequence)) {
        this.#rollForward(directory, transaction);
      }
      if (rebuild) this.#atomicWrite(path.join(directory, "case.json"), rebuild);
      for (const file of this.#orphanTemporaryFiles(directory)) this.io.unlinkSync(file);
    });
    const verified = this.verify({ caseId, target });
    return { status: verified.status, actions, problems: verified.problems };
  }

  #initializeStateRoot(requested) {
    const existing = this.#lstat(requested);
    if (existing?.isSymbolicLink()) throw new PlanningCaseError("UNSAFE_STATE_DIRECTORY", requested);
    if (!existing) this.io.mkdirSync(requested, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
    const metadata = this.io.lstatSync(requested);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new PlanningCaseError("UNSAFE_STATE_DIRECTORY", requested);
    this.io.chmodSync(requested, PRIVATE_DIRECTORY_MODE);
    return this.io.realpathSync(requested);
  }

  #ensurePrivateDirectory(directory, parent) {
    const resolved = path.resolve(directory);
    if (!this.#within(parent, resolved)) throw new PlanningCaseError("STATE_PATH_ESCAPE", resolved);
    const existing = this.#lstat(resolved);
    if (!existing) this.io.mkdirSync(resolved, { mode: PRIVATE_DIRECTORY_MODE });
    const metadata = this.io.lstatSync(resolved);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new PlanningCaseError("UNSAFE_STATE_DIRECTORY", resolved);
    this.io.chmodSync(resolved, PRIVATE_DIRECTORY_MODE);
    if (!this.#within(this.stateDir ?? parent, this.io.realpathSync(resolved))) throw new PlanningCaseError("STATE_PATH_ESCAPE", resolved);
  }

  #within(root, target) {
    const relative = path.relative(path.resolve(root), path.resolve(target));
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  }

  #lstat(file) {
    try {
      return this.io.lstatSync(file);
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  #assertTarget(target) {
    if (typeof target !== "string" || target.length > 512 || !TARGET.test(target)) throw new PlanningCaseError("INVALID_TARGET");
  }

  #assertCaseId(caseId) {
    if (typeof caseId !== "string" || !CASE_ID.test(caseId)) throw new PlanningCaseError("INVALID_CASE_ID");
  }

  #targetHash(target) {
    return createHash("sha256").update(target, "utf8").digest("hex");
  }

  #caseDirectoriesForTarget(target) {
    const parent = path.join(this.casesDir, this.#targetHash(target));
    const metadata = this.#lstat(parent);
    if (!metadata) return [];
    this.#assertPrivateDirectory(parent);
    return this.io.readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.name.startsWith("PC-"))
      .map((entry) => {
        if (!entry.isDirectory() || entry.isSymbolicLink()) throw new PlanningCaseError("UNSAFE_STATE_DIRECTORY", entry.name);
        return path.join(parent, entry.name);
      });
  }

  #allCaseDirectories() {
    const directories = [];
    for (const entry of this.io.readdirSync(this.casesDir, { withFileTypes: true })) {
      if (!TARGET_HASH.test(entry.name)) throw new PlanningCaseError("UNEXPECTED_TARGET_DIRECTORY", entry.name);
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw new PlanningCaseError("UNSAFE_STATE_DIRECTORY", entry.name);
      const targetDir = path.join(this.casesDir, entry.name);
      this.#assertPrivateDirectory(targetDir);
      for (const child of this.io.readdirSync(targetDir, { withFileTypes: true })) {
        if (!child.name.startsWith("PC-")) throw new PlanningCaseError("UNEXPECTED_CASE_DIRECTORY", child.name);
        if (!child.isDirectory() || child.isSymbolicLink()) throw new PlanningCaseError("UNSAFE_STATE_DIRECTORY", child.name);
        directories.push(path.join(targetDir, child.name));
      }
    }
    return directories;
  }

  #resolveCaseDirectory(caseId, target) {
    this.#assertCaseId(caseId);
    if (target !== undefined) {
      this.#assertTarget(target);
      const directory = path.join(this.casesDir, this.#targetHash(target), caseId);
      if (!this.#lstat(directory)) throw new PlanningCaseError("CASE_NOT_FOUND", caseId);
      this.#assertPrivateDirectory(directory);
      return directory;
    }
    const matches = this.#allCaseDirectories().filter((directory) => path.basename(directory) === caseId);
    if (matches.length === 0) throw new PlanningCaseError("CASE_NOT_FOUND", caseId);
    if (matches.length > 1) throw new PlanningCaseError("AMBIGUOUS_CASE_ID", caseId);
    this.#assertPrivateDirectory(matches[0]);
    return matches[0];
  }

  #assertPrivateDirectory(directory) {
    const metadata = this.io.lstatSync(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
      throw new PlanningCaseError("UNSAFE_STATE_DIRECTORY", directory);
    }
    if (!this.#within(this.stateDir, this.io.realpathSync(directory))) throw new PlanningCaseError("STATE_PATH_ESCAPE", directory);
  }

  #readPrivateText(file) {
    const metadata = this.io.lstatSync(file);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || (metadata.mode & 0o077) !== 0) {
      throw new PlanningCaseError("UNSAFE_STATE_FILE", file);
    }
    const flags = this.io.constants.O_RDONLY | (this.io.constants.O_NOFOLLOW ?? 0);
    const descriptor = this.io.openSync(file, flags);
    try {
      const opened = this.io.fstatSync(descriptor);
      if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== metadata.dev || opened.ino !== metadata.ino) {
        throw new PlanningCaseError("STATE_FILE_CHANGED", file);
      }
      return this.io.readFileSync(descriptor, "utf8");
    } finally {
      this.io.closeSync(descriptor);
    }
  }

  #readJson(file, code = "CORRUPT_STATE_FILE") {
    try {
      return JSON.parse(this.#readPrivateText(file));
    } catch (error) {
      if (error instanceof PlanningCaseError && error.code !== "CORRUPT_STATE_FILE") throw error;
      throw new PlanningCaseError(code, file);
    }
  }

  #createPrivateFile(file, text) {
    const flags = this.io.constants.O_WRONLY | this.io.constants.O_CREAT | this.io.constants.O_EXCL | (this.io.constants.O_NOFOLLOW ?? 0);
    const descriptor = this.io.openSync(file, flags, PRIVATE_FILE_MODE);
    try {
      if (text.length > 0) this.io.writeFileSync(descriptor, text, "utf8");
      this.io.fsyncSync(descriptor);
    } finally {
      this.io.closeSync(descriptor);
    }
    this.io.chmodSync(file, PRIVATE_FILE_MODE);
  }

  #atomicWrite(file, value, beforeRename = () => {}) {
    const parent = path.dirname(file);
    this.#assertPrivateDirectory(parent);
    const temporary = path.join(parent, `${path.basename(file)}.tmp-${this.pid}-${this.nonceGenerator()}`);
    this.#createPrivateFile(temporary, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
    beforeRename();
    this.io.renameSync(temporary, file);
    this.io.chmodSync(file, PRIVATE_FILE_MODE);
    this.#syncDirectory(parent);
  }

  #syncDirectory(directory) {
    const descriptor = this.io.openSync(directory, this.io.constants.O_RDONLY);
    try {
      this.io.fsyncSync(descriptor);
    } catch (error) {
      if (!(["EINVAL", "ENOTSUP"].includes(error?.code))) throw error;
    } finally {
      this.io.closeSync(descriptor);
    }
  }

  #readSnapshot(directory, expectedTarget) {
    const snapshot = this.#readJson(path.join(directory, "case.json"));
    const structural = snapshot?.schema === "pi-ticket-planning:planning-case:v2" ? validateArtifact(snapshot) : { ok: false };
    if (!structural.ok || !CASE_ID.test(snapshot.caseId ?? "") || !TARGET.test(snapshot.target ?? "")) {
      throw new PlanningCaseError("INVALID_CASE_SNAPSHOT");
    }
    const parentHash = path.basename(path.dirname(directory));
    if (parentHash !== this.#targetHash(snapshot.target) || (expectedTarget !== undefined && snapshot.target !== expectedTarget)) {
      throw new PlanningCaseError("CASE_TARGET_MISMATCH");
    }
    if (snapshot.caseId !== path.basename(directory)) throw new PlanningCaseError("CASE_ID_MISMATCH");
    return snapshot;
  }

  #initialSnapshot(target, caseId, now) {
    const subject = {
      target,
      kind: "none",
      id: "NONE",
      revision: "0",
      digest: digest({ target, caseId, state: "NONE" }),
    };
    const checkpoint = {
      schema: "pi-ticket-planning:checkpoint:v2",
      lane: "PRODUCT",
      stage: "ORIENT",
      verdict: "NEEDS_TARGET",
      subject,
    };
    return {
      schema: "pi-ticket-planning:planning-case:v2",
      target,
      caseId,
      checkpoint,
      blocker: null,
      nextAction: {
        kind: "COMMAND",
        command: `pi-ticket-planctl case resume ${caseId} --json`,
        skill: null,
        requiredInputs: [],
        blockingFacts: [],
        contextRoute: "PRODUCT/ORIENT/NEEDS_TARGET",
        reasonCode: "CASE_CREATED",
      },
      selectedCandidate: null,
      excludedCandidates: [],
      facts: [],
      consumedFactIds: [],
      decisions: [],
      unknowns: [],
      assumptions: [],
      evidenceMethod: null,
      evidence: [],
      bindings: { source: null, release: null, spec: null, graph: null, policy: null, harness: null, capability: null, outcome: null, session: null, reviewer: null },
      approvals: { pending: [], consumed: [] },
      admissionTransaction: null,
      learningDecisions: [],
      lastCheckpoint: clone(checkpoint),
      lastEvent: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  #event({ caseId, target, type, data, at, sequence, previousDigest, transactionId }) {
    const event = {
      schema: "pi-ticket-planning:planning-case-event:v2",
      id: `E-${this.nonceGenerator()}`,
      sequence,
      caseId,
      target,
      type,
      at,
      data: clone(data),
      transactionId,
      previousDigest,
    };
    const complete = { ...event, digest: digest(event) };
    const checked = validateArtifact(complete);
    if (!checked.ok) throw new PlanningCaseError("INVALID_CASE_EVENT", checked.problems[0]?.code);
    return complete;
  }

  #readEvents(directory, caseId, target) {
    const text = this.#readPrivateText(path.join(directory, "events.jsonl"));
    if (text.length === 0) return [];
    if (!text.endsWith("\n")) throw new PlanningCaseError("EVENT_LOG_CORRUPT");
    const events = [];
    for (const [index, line] of text.slice(0, -1).split("\n").entries()) {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        throw new PlanningCaseError("EVENT_LOG_CORRUPT", String(index + 1));
      }
      const { digest: recordedDigest, ...projection } = event;
      const previous = events.at(-1)?.digest ?? null;
      const structural = event.schema === "pi-ticket-planning:planning-case-event:v2" ? validateArtifact(event) : { ok: false };
      if (!structural.ok
        || event.sequence !== index + 1
        || event.caseId !== caseId
        || event.target !== target
        || event.previousDigest !== previous
        || recordedDigest !== digest(projection)) {
        throw new PlanningCaseError("EVENT_LOG_CORRUPT", String(index + 1));
      }
      events.push(event);
    }
    return events;
  }

  #rebuildFromEvents(events) {
    let snapshot = null;
    for (const event of events) {
      try {
        snapshot = reducePlanningCaseEvent(snapshot, event, { protocol: this.protocol, now: event.at });
      } catch (error) {
        throw new PlanningCaseError(error?.code ?? "INVALID_CASE_EVENT", event.id);
      }
      snapshot.updatedAt = event.at;
      snapshot.lastEvent = event.digest;
    }
    if (!snapshot) throw new PlanningCaseError("EVENT_LOG_EMPTY");
    return snapshot;
  }

  #appendEvent(directory, event) {
    const file = path.join(directory, "events.jsonl");
    this.#readPrivateText(file);
    const flags = this.io.constants.O_WRONLY | this.io.constants.O_APPEND | (this.io.constants.O_NOFOLLOW ?? 0);
    const descriptor = this.io.openSync(file, flags);
    try {
      this.io.writeFileSync(descriptor, `${JSON.stringify(event)}\n`, "utf8");
      this.io.fsyncSync(descriptor);
    } finally {
      this.io.closeSync(descriptor);
    }
  }

  #readTransactions(directory) {
    const transactionDir = path.join(directory, "transactions");
    this.#assertPrivateDirectory(transactionDir);
    const transactions = [];
    for (const entry of this.io.readdirSync(transactionDir, { withFileTypes: true })) {
      if (entry.name.includes(".tmp-")) continue;
      if (!entry.isFile() || entry.isSymbolicLink() || !/^TX-[A-Za-z0-9._:-]+\.json$/.test(entry.name)) {
        throw new PlanningCaseError("UNEXPECTED_TRANSACTION_FILE", entry.name);
      }
      const transaction = this.#readJson(path.join(transactionDir, entry.name), "CORRUPT_TRANSACTION");
      const structural = transaction?.schema === "pi-ticket-planning:case-transaction:v2" ? validateArtifact(transaction) : { ok: false };
      if (!structural.ok
        || transaction.id !== entry.name.slice(0, -5)
        || !["INTENT", "COMMITTED"].includes(transaction.status)) {
        throw new PlanningCaseError("CORRUPT_TRANSACTION", entry.name);
      }
      transactions.push(transaction);
    }
    return transactions;
  }

  #orphanTemporaryFiles(directory) {
    const files = [];
    for (const parent of [directory, path.join(directory, "transactions")]) {
      for (const entry of this.io.readdirSync(parent, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.includes(".tmp-")) files.push(path.join(parent, entry.name));
      }
    }
    return files;
  }

  #commitTransaction(directory, beforeSnapshot, nextSnapshot, event) {
    const transaction = {
      schema: "pi-ticket-planning:case-transaction:v2",
      id: event.transactionId,
      caseId: nextSnapshot.caseId,
      target: nextSnapshot.target,
      createdAt: event.at,
      beforeEvent: beforeSnapshot?.lastEvent ?? null,
      event,
      nextSnapshot,
      status: "INTENT",
    };
    const transactionFile = path.join(directory, "transactions", `${transaction.id}.json`);
    this.#atomicWrite(transactionFile, transaction);
    this.failpoint("after_intent");
    this.#appendEvent(directory, event);
    this.failpoint("after_event");
    this.#atomicWrite(path.join(directory, "case.json"), nextSnapshot, () => this.failpoint("after_snapshot_temp"));
    this.failpoint("after_snapshot_rename");
    this.#atomicWrite(transactionFile, { ...transaction, status: "COMMITTED", committedAt: this.clock() });
    this.failpoint("after_commit");
    return nextSnapshot;
  }

  #mutate({ caseId, target, type, data }) {
    const directory = this.#resolveCaseDirectory(caseId, target);
    return this.#withLock(directory, () => {
      const snapshot = this.#readSnapshot(directory, target);
      const events = this.#readEvents(directory, snapshot.caseId, snapshot.target);
      if (this.#readTransactions(directory).some(({ status }) => status === "INTENT")) throw new PlanningCaseError("RECOVERY_REQUIRED");
      const last = events.at(-1);
      if (!last || snapshot.lastEvent !== last.digest) throw new PlanningCaseError("RECOVERY_REQUIRED");
      const updatedAt = this.clock();
      const transactionId = `TX-${this.nonceGenerator()}`;
      const event = this.#event({
        caseId: snapshot.caseId,
        target: snapshot.target,
        type,
        data,
        at: updatedAt,
        sequence: last.sequence + 1,
        previousDigest: last.digest,
        transactionId,
      });
      let next;
      try {
        next = reducePlanningCaseEvent(snapshot, event, { protocol: this.protocol, now: updatedAt });
      } catch (error) {
        throw new PlanningCaseError(error?.code ?? "INVALID_CASE_EVENT");
      }
      next.updatedAt = updatedAt;
      next.lastEvent = event.digest;
      return clone(this.#commitTransaction(directory, snapshot, next, event));
    });
  }

  #acquireLock(directory) {
    const lockFile = path.join(directory, "lock");
    const existing = this.#readLock(directory);
    if (existing) throw new PlanningCaseError(this.#staleLock(existing) ? "STALE_LOCK" : "CASE_LOCKED");
    const lock = { pid: this.pid, createdAt: this.clock(), nonce: this.nonceGenerator() };
    this.#createPrivateFile(lockFile, `${JSON.stringify(lock)}\n`);
    return lock;
  }

  #readLock(directory) {
    const file = path.join(directory, "lock");
    if (!this.#lstat(file)) return null;
    const lock = this.#readJson(file, "CORRUPT_LOCK");
    if (!Number.isInteger(lock.pid) || lock.pid < 1 || !Number.isFinite(Date.parse(lock.createdAt)) || typeof lock.nonce !== "string") {
      throw new PlanningCaseError("CORRUPT_LOCK");
    }
    return lock;
  }

  #staleLock(lock) {
    return Date.parse(this.clock()) - Date.parse(lock.createdAt) > this.staleLockMs && !this.processAlive(lock.pid);
  }

  #releaseLock(directory, held) {
    const current = this.#readLock(directory);
    if (!current || current.nonce !== held.nonce) throw new PlanningCaseError("LOCK_OWNERSHIP_LOST");
    this.io.unlinkSync(path.join(directory, "lock"));
    this.#syncDirectory(directory);
  }

  #withLock(directory, callback) {
    const held = this.#acquireLock(directory);
    let preserve = false;
    try {
      return callback();
    } catch (error) {
      preserve = error?.simulatedCrash === true;
      throw error;
    } finally {
      if (!preserve) this.#releaseLock(directory, held);
    }
  }

  #rollForward(directory, transaction) {
    const events = this.#readEvents(directory, transaction.caseId, transaction.target);
    const last = events.at(-1);
    if ((last?.digest ?? null) === transaction.beforeEvent) {
      this.#appendEvent(directory, transaction.event);
    } else if (last?.digest !== transaction.event.digest) {
      throw new PlanningCaseError("TRANSACTION_EVENT_CONFLICT", transaction.id);
    }
    if (transaction.nextSnapshot?.lastEvent !== transaction.event.digest
      || transaction.nextSnapshot.caseId !== transaction.caseId
      || transaction.nextSnapshot.target !== transaction.target) {
      throw new PlanningCaseError("CORRUPT_TRANSACTION", transaction.id);
    }
    this.#atomicWrite(path.join(directory, "case.json"), transaction.nextSnapshot);
    this.#atomicWrite(
      path.join(directory, "transactions", `${transaction.id}.json`),
      { ...transaction, status: "COMMITTED", committedAt: this.clock() },
    );
  }
}

export function createPlanningCaseStore(options) {
  return new PlanningCaseStore(options);
}
