import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createPlanningCaseStore, PlanningCaseError } from "./store.mjs";
import { resultEnvelope } from "./result.mjs";
import { approvalProjection, fingerprint } from "../admission/domain.mjs";
import { createFactAttestation, producerAttestationSource, validateFactAttestation } from "../protocol/kernel.mjs";
import { runtimeMetadata } from "../installation/build-metadata.mjs";
import { validateGoalHandoff, validateReleasePlan } from "../execution-plan/release-contract.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SAFE_CASE_ID = /^PC-[A-Za-z0-9._-]{1,96}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;

export function controlMetadata({ clock, correlationId }) {
  const metadata = runtimeMetadata({ root: ROOT });
  return {
    producer: "pi-ticket-planning",
    producerVersion: metadata.packageVersion,
    commit: metadata.sourceCommit,
    observedAt: clock(),
    correlationId,
  };
}

function parse(argv) {
  const [scope, command, ...rest] = argv;
  if (!["case", "outcome"].includes(scope) || !command) throw new PlanningCaseError("INVALID_COMMAND");
  const options = new Map();
  const positionals = [];
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const name = token.slice(2);
    if (options.has(name)) throw new PlanningCaseError("DUPLICATE_OPTION");
    if (["json", "dry-run", "offline", "rebind"].includes(name)) options.set(name, true);
    else {
      const value = rest[index + 1];
      if (value === undefined || value.startsWith("--")) throw new PlanningCaseError("MISSING_OPTION_VALUE");
      options.set(name, value);
      index += 1;
    }
  }
  return { scope, command, options, positionals };
}

function requireShape(parsed, { allowed = [], required = [], positionals = 0 }) {
  const allowedSet = new Set([...allowed, "json"]);
  for (const option of parsed.options.keys()) if (!allowedSet.has(option)) throw new PlanningCaseError("UNKNOWN_OPTION");
  for (const option of required) if (!parsed.options.has(option)) throw new PlanningCaseError("MISSING_REQUIRED_OPTION");
  if (parsed.positionals.length !== positionals) throw new PlanningCaseError("INVALID_POSITIONAL_ARGUMENTS");
}

function recoveryFor(caseId) {
  return SAFE_CASE_ID.test(caseId ?? "") ? { command: `pi-ticket-planctl case recover ${caseId} --dry-run --json` } : null;
}

function errorStatus(code) {
  if (["CASE_LOCKED", "STALE_LOCK", "RECOVERY_REQUIRED"].includes(code)) return "BLOCKED";
  if (code.startsWith("UNSAFE_") || code.includes("CORRUPT") || code.includes("MISMATCH") || code.includes("CONFLICT") || code.includes("DRIFT")) return "CONFLICT";
  if (code === "SOURCE_COMMIT_UNAVAILABLE") return "DEGRADED";
  return "INVALID";
}

function readAdmissionPlan(file) {
  try {
    const plan = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
    if (plan?.schema !== "pi-ticket-planning:admission-plan:v1"
      || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(plan.repo ?? "")
      || !SHA256.test(plan.planFingerprint ?? "")
      || typeof plan.reviewed?.source?.revision !== "string"
      || plan.reviewed.source.revision.length === 0
      || fingerprint(approvalProjection(plan)) !== plan.planFingerprint) {
      throw new Error("invalid");
    }
    return plan;
  } catch {
    throw new PlanningCaseError("INVALID_ADMISSION_PLAN");
  }
}

function readReleasePlan(file) {
  const plan = readJsonInput(file, "INVALID_RELEASE_PLAN");
  if (validateReleasePlan(plan).length > 0) throw new PlanningCaseError("INVALID_RELEASE_PLAN");
  return plan;
}

function readGoalHandoff(file) {
  const handoff = readJsonInput(file, "INVALID_GOAL_HANDOFF");
  if (validateGoalHandoff(handoff).length > 0) throw new PlanningCaseError("INVALID_GOAL_HANDOFF");
  return handoff;
}

function readJsonInput(file, code = "INVALID_INPUT") {
  try {
    const value = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid");
    return value;
  } catch {
    throw new PlanningCaseError(code);
  }
}

export function createPlanningCaseApproval({ plan, caseId, correlationId, observedAt }) {
  const subject = {
    target: `github:${plan.repo}`,
    kind: "admission-plan",
    id: plan.planFingerprint,
    revision: plan.reviewed.source.revision,
    digest: plan.planFingerprint,
  };
  return createFactAttestation({
    id: `F-human-activation-${correlationId.slice(2)}`,
    fact: "human.activation",
    value: true,
    subject,
    source: producerAttestationSource("operator-asserted", "pi-ticket-planctl"),
    observedAt,
    expiresAt: new Date(Date.parse(observedAt) + 60 * 60 * 1000).toISOString(),
    evidence: { kind: "operator", ref: `case:${caseId}:admission.apply`, digest: plan.planFingerprint },
  });
}

export function createExecutionHandoffApproval({ plan, caseId, correlationId, observedAt, revision }) {
  const digest = fingerprint(plan);
  const subject = { target: `github:${plan.repo}`, kind: "release-plan", id: digest, revision, digest };
  return createFactAttestation({
    id: `F-human-execution-handoff-${correlationId.slice(2)}`,
    fact: "human.executionHandoff",
    value: true,
    subject,
    source: producerAttestationSource("operator-asserted", "pi-ticket-planctl"),
    observedAt,
    expiresAt: new Date(Date.parse(observedAt) + 60 * 60 * 1000).toISOString(),
    evidence: { kind: "operator", ref: `case:${caseId}:execution-plan.apply`, digest },
  });
}

export function createGoalHandoffApproval({ handoff, caseId, correlationId, observedAt, revision }) {
  const digest = fingerprint(handoff);
  const subject = { target: `github:${handoff.repo}`, kind: "goal-handoff", id: digest, revision, digest };
  return createFactAttestation({
    id: `F-human-goal-handoff-${correlationId.slice(2)}`,
    fact: "human.goalHandoff",
    value: true,
    subject,
    source: producerAttestationSource("operator-asserted", "pi-ticket-planctl"),
    observedAt,
    expiresAt: new Date(Date.parse(observedAt) + 60 * 60 * 1000).toISOString(),
    evidence: { kind: "operator", ref: `case:${caseId}:goal-handoff.apply`, digest },
  });
}

function hasCurrentApproval(snapshot, fact, digest, now) {
  const checkedAt = Date.parse(now);
  return !Number.isFinite(checkedAt)
    || snapshot.approvals.consumed.some((item) => item.fact === fact && item.subject?.digest === digest)
    || snapshot.approvals.pending.some((item) => {
      if (item.fact !== fact || item.subject?.digest !== digest) return false;
      const observedAt = Date.parse(item.observedAt);
      const expiresAt = Date.parse(item.expiresAt);
      const expired = validateFactAttestation(item, { producerDigestPolicy: "RECORDED" }).ok
        && typeof item.expiresAt === "string" && Number.isFinite(observedAt) && Number.isFinite(expiresAt)
        && observedAt <= expiresAt && expiresAt <= checkedAt;
      return !expired;
    });
}

const INPUT_EVENTS = {
  "select-candidate": ["CANDIDATE_SELECTED", "candidate"],
  "exclude-candidate": ["CANDIDATE_EXCLUDED", "candidate"],
  "record-decision": ["DECISION_RECORDED", "decision"],
  "record-unknown": ["UNKNOWN_RECORDED", "unknown"],
  "record-assumption": ["ASSUMPTION_RECORDED", "assumption"],
  "set-evidence-method": ["EVIDENCE_METHOD_SET", "method"],
  "record-evidence": ["EVIDENCE_RECORDED", "evidence"],
  "attach-fact": ["FACT_ATTACHED", "fact"],
  "set-blocker": ["BLOCKER_SET", "blocker"],
  "set-next-action": ["NEXT_ACTION_SET", "nextAction"],
};

export function runPlanningCaseCli(argv, {
  env = process.env,
  clock = () => new Date().toISOString(),
  correlationId = `C-${randomUUID()}`,
  storeOptions = {},
} = {}) {
  let command = "case.invalid";
  let caseId = null;
  try {
    const parsed = parse(argv);
    command = `${parsed.scope}.${parsed.command}`;
    const store = createPlanningCaseStore({
      stateDir: env.PI_TICKET_PLAN_STATE_DIR,
      clock,
      ...storeOptions,
    });
    let status = "COMPLETE";
    let data;
    let problems = [];
    let recovery = null;

    if (parsed.scope === "outcome" && parsed.command === "ingest") {
      requireShape(parsed, { allowed: ["case-id", "receipt"], required: ["case-id", "receipt"] });
      caseId = parsed.options.get("case-id");
      const receipt = readJsonInput(parsed.options.get("receipt"), "INVALID_OUTCOME_RECEIPT");
      data = { case: store.ingestOutcome({ caseId, target: receipt.subject?.target, receipt }) };
    } else if (parsed.scope === "outcome" && parsed.command === "decide") {
      requireShape(parsed, { allowed: ["case-id", "receipt", "decision"], required: ["case-id", "receipt", "decision"] });
      caseId = parsed.options.get("case-id");
      const receipt = readJsonInput(parsed.options.get("receipt"), "INVALID_OUTCOME_RECEIPT");
      const decision = parsed.options.get("decision");
      if (!["PROMOTE", "REVISE", "REJECT", "NO_CHANGE"].includes(decision)) throw new PlanningCaseError("INVALID_OUTCOME_DECISION");
      const approval = createFactAttestation({
        id: `F-outcome-learning-${correlationId.slice(2)}`,
        fact: "human.outcomeLearningDecision",
        value: decision,
        subject: receipt.subject,
        source: producerAttestationSource("operator-asserted", "pi-ticket-planctl"),
        observedAt: clock(),
        expiresAt: null,
        evidence: { kind: "operator", ref: `case:${caseId}:outcome.decide`, digest: receipt.digest },
      });
      store.addApproval({ caseId, target: receipt.subject.target, approval });
      store.consumeApproval({ caseId, target: receipt.subject.target, approvalId: approval.id });
      const learning = {
        decision,
        subject: receipt.subject,
        outcomeReceiptDigest: receipt.digest,
        operatorApproval: approval.id,
        affectedRuleIds: [],
        rationaleRef: `operator:${correlationId}`,
        observedAt: approval.observedAt,
      };
      data = { case: store.record({ caseId, target: receipt.subject.target, type: "LEARNING_DECISION_RECORDED", data: { learning } }) };
    } else if (parsed.scope !== "case") {
      throw new PlanningCaseError("INVALID_COMMAND");
    } else if (parsed.command === "create") {
      requireShape(parsed, { allowed: ["target", "case-id"], required: ["target"] });
      const created = store.create({ target: parsed.options.get("target"), caseId: parsed.options.get("case-id") });
      caseId = created.caseId;
      data = { caseId: created.caseId, target: created.target, checkpoint: created.checkpoint };
    } else if (parsed.command === "list") {
      requireShape(parsed, { allowed: ["target"] });
      data = { cases: store.list({ target: parsed.options.get("target") }) };
    } else if (parsed.command === "status") {
      requireShape(parsed, { allowed: ["target"], positionals: 1 });
      [caseId] = parsed.positionals;
      data = { case: store.get({ caseId, target: parsed.options.get("target") }) };
    } else if (parsed.command === "approve") {
      requireShape(parsed, { allowed: ["plan", "expected-fingerprint"], required: ["plan", "expected-fingerprint"], positionals: 1 });
      [caseId] = parsed.positionals;
      const plan = readAdmissionPlan(parsed.options.get("plan"));
      if (parsed.options.get("expected-fingerprint") !== plan.planFingerprint) {
        throw new PlanningCaseError("EXPECTED_FINGERPRINT_MISMATCH");
      }
      const target = `github:${plan.repo}`;
      if (store.get({ caseId, target }).target !== target) throw new PlanningCaseError("APPROVAL_TARGET_MISMATCH");
      const approval = createPlanningCaseApproval({ plan, caseId, correlationId, observedAt: clock() });
      store.addApproval({ caseId, target, approval });
      data = { approval };
    } else if (parsed.command === "approve-handoff") {
      requireShape(parsed, { allowed: ["plan", "expected-fingerprint"], required: ["plan", "expected-fingerprint"], positionals: 1 });
      [caseId] = parsed.positionals;
      const plan = readReleasePlan(parsed.options.get("plan"));
      const planFingerprint = fingerprint(plan);
      if (parsed.options.get("expected-fingerprint") !== planFingerprint) throw new PlanningCaseError("EXPECTED_FINGERPRINT_MISMATCH");
      const target = `github:${plan.repo}`;
      const snapshot = store.get({ caseId, target });
      if (snapshot.target !== target) throw new PlanningCaseError("APPROVAL_TARGET_MISMATCH");
      const observedAt = clock();
      if (hasCurrentApproval(snapshot, "human.executionHandoff", planFingerprint, observedAt)) throw new PlanningCaseError("HANDOFF_APPROVAL_ALREADY_EXISTS");
      const approval = createExecutionHandoffApproval({ plan, caseId, correlationId, observedAt, revision: snapshot.checkpoint.subject?.revision });
      store.addApproval({ caseId, target, approval });
      data = { approval };
    } else if (parsed.command === "approve-goal-handoff") {
      requireShape(parsed, { allowed: ["handoff", "expected-fingerprint"], required: ["handoff", "expected-fingerprint"], positionals: 1 });
      [caseId] = parsed.positionals;
      const handoff = readGoalHandoff(parsed.options.get("handoff"));
      const handoffFingerprint = fingerprint(handoff);
      if (parsed.options.get("expected-fingerprint") !== handoffFingerprint) throw new PlanningCaseError("EXPECTED_FINGERPRINT_MISMATCH");
      const target = `github:${handoff.repo}`;
      const snapshot = store.get({ caseId, target });
      if (snapshot.target !== target) throw new PlanningCaseError("APPROVAL_TARGET_MISMATCH");
      const observedAt = clock();
      if (hasCurrentApproval(snapshot, "human.goalHandoff", handoffFingerprint, observedAt)) throw new PlanningCaseError("GOAL_HANDOFF_APPROVAL_ALREADY_EXISTS");
      const approval = createGoalHandoffApproval({ handoff, caseId, correlationId, observedAt, revision: snapshot.checkpoint.subject?.revision });
      store.addApproval({ caseId, target, approval });
      data = { approval };
    } else if (parsed.command === "resume") {
      requireShape(parsed, { allowed: ["target", "offline"], positionals: 1 });
      [caseId] = parsed.positionals;
      data = store.resume({ caseId, target: parsed.options.get("target"), offline: parsed.options.has("offline") });
      if (parsed.options.has("offline")) {
        status = "DEGRADED";
        problems = [{ code: "OFFLINE_BINDINGS_UNVERIFIED" }];
      }
    } else if (parsed.command === "abandon") {
      requireShape(parsed, { allowed: ["target", "reason"], required: ["reason"], positionals: 1 });
      [caseId] = parsed.positionals;
      data = { case: store.abandon({ caseId, target: parsed.options.get("target"), reason: parsed.options.get("reason") }) };
    } else if (parsed.command === "verify") {
      requireShape(parsed, { allowed: ["target", "offline"], positionals: 1 });
      [caseId] = parsed.positionals;
      const verification = store.verify({ caseId, target: parsed.options.get("target"), offline: parsed.options.has("offline") });
      data = { verification };
      if (verification.status !== "COMPLETE") {
        status = "CONFLICT";
        problems = verification.problems;
        recovery = recoveryFor(caseId);
      }
    } else if (parsed.command === "recover") {
      requireShape(parsed, { allowed: ["target", "dry-run"], positionals: 1 });
      [caseId] = parsed.positionals;
      const recovered = store.recover({
        caseId,
        target: parsed.options.get("target"),
        dryRun: parsed.options.has("dry-run"),
      });
      data = { recovery: recovered };
      if (recovered.status !== "COMPLETE") {
        status = recovered.status === "BLOCKED" ? "BLOCKED" : "CONFLICT";
        problems = recovered.problems;
        recovery = recoveryFor(caseId);
      }
    } else if (parsed.command === "transition") {
      requireShape(parsed, { allowed: ["target", "checkpoint", "facts", "next-action", "mutation-id", "rebind"], required: ["checkpoint", "facts", "next-action"], positionals: 1 });
      [caseId] = parsed.positionals;
      const facts = JSON.parse(fs.readFileSync(path.resolve(parsed.options.get("facts")), "utf8"));
      if (!Array.isArray(facts)) throw new PlanningCaseError("INVALID_FACTS_INPUT");
      data = { case: store.transition({
        caseId,
        target: parsed.options.get("target"),
        checkpoint: readJsonInput(parsed.options.get("checkpoint"), "INVALID_CHECKPOINT_INPUT"),
        facts,
        nextAction: readJsonInput(parsed.options.get("next-action"), "INVALID_NEXT_ACTION"),
        mutationId: parsed.options.get("mutation-id") ?? null,
        rebind: parsed.options.has("rebind"),
      }) };
    } else if (INPUT_EVENTS[parsed.command]) {
      requireShape(parsed, { allowed: ["target", "input"], required: ["input"], positionals: 1 });
      [caseId] = parsed.positionals;
      const [type, key] = INPUT_EVENTS[parsed.command];
      data = { case: store.record({ caseId, target: parsed.options.get("target"), type, data: { [key]: readJsonInput(parsed.options.get("input")) } }) };
    } else if (parsed.command === "resolve-unknown") {
      requireShape(parsed, { allowed: ["target", "unknown-id", "resolution"], required: ["unknown-id", "resolution"], positionals: 1 });
      [caseId] = parsed.positionals;
      const resolution = readJsonInput(parsed.options.get("resolution"));
      data = { case: store.record({ caseId, target: parsed.options.get("target"), type: "UNKNOWN_RESOLVED", data: { unknownId: parsed.options.get("unknown-id"), ...resolution } }) };
    } else if (parsed.command === "revise-assumption") {
      requireShape(parsed, { allowed: ["target", "assumption-id", "input"], required: ["assumption-id", "input"], positionals: 1 });
      [caseId] = parsed.positionals;
      data = { case: store.record({ caseId, target: parsed.options.get("target"), type: "ASSUMPTION_REVISED", data: { assumptionId: parsed.options.get("assumption-id"), ...readJsonInput(parsed.options.get("input")) } }) };
    } else if (parsed.command === "consume-fact") {
      requireShape(parsed, { allowed: ["target", "fact-id", "mutation-id"], required: ["fact-id", "mutation-id"], positionals: 1 });
      [caseId] = parsed.positionals;
      data = { case: store.record({ caseId, target: parsed.options.get("target"), type: "FACT_CONSUMED", data: { factId: parsed.options.get("fact-id"), mutationId: parsed.options.get("mutation-id") } }) };
    } else if (parsed.command === "clear-blocker") {
      requireShape(parsed, { allowed: ["target", "blocker-id"], required: ["blocker-id"], positionals: 1 });
      [caseId] = parsed.positionals;
      data = { case: store.record({ caseId, target: parsed.options.get("target"), type: "BLOCKER_CLEARED", data: { id: parsed.options.get("blocker-id") } }) };
    } else if (parsed.command === "bind") {
      requireShape(parsed, { allowed: ["target", "name", "input"], required: ["name", "input"], positionals: 1 });
      [caseId] = parsed.positionals;
      data = { case: store.bind({ caseId, target: parsed.options.get("target"), name: parsed.options.get("name"), binding: readJsonInput(parsed.options.get("input")) }) };
    } else if (parsed.command === "clear-binding") {
      requireShape(parsed, { allowed: ["target", "name"], required: ["name"], positionals: 1 });
      [caseId] = parsed.positionals;
      data = { case: store.clearBinding({ caseId, target: parsed.options.get("target"), name: parsed.options.get("name") }) };
    } else if (parsed.command === "migrate") {
      requireShape(parsed, { allowed: ["dry-run"] });
      data = { dryRun: parsed.options.has("dry-run"), migrations: [] };
    } else {
      throw new PlanningCaseError("INVALID_COMMAND");
    }

    return {
      exitCode: status === "COMPLETE" ? 0 : 1,
      envelope: resultEnvelope({
        command,
        status,
        data,
        problems,
        recovery,
        meta: controlMetadata({ clock, correlationId }),
      }),
    };
  } catch (error) {
    const code = error instanceof PlanningCaseError ? error.code : "UNCLASSIFIED_FAILURE";
    const status = errorStatus(code);
    return {
      exitCode: 1,
      envelope: resultEnvelope({
        command,
        status,
        data: {},
        problems: [{ code }],
        recovery: recoveryFor(caseId),
        meta: controlMetadata({ clock, correlationId }),
      }),
    };
  }
}
