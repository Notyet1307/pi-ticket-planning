import fs from "node:fs";
import path from "node:path";
import {
  createFactAttestation,
  evaluateMutation,
  producerAttestationSource,
  validateFactAttestation,
} from "../protocol/kernel.mjs";
import { fingerprint, releasePlanDigest } from "./domain.mjs";
import {
  assertCanonicalAbsentChildPath,
  assertCanonicalPrivateExistingDirectory,
  assertCanonicalPrivateExistingFile,
  assertCanonicalPrivateOutputParent,
  assertSameFileSystem,
} from "./private-paths.mjs";
import { verifyExecutionPlan } from "./validate.mjs";
import { assertFreshExecutionInput } from "./freshness.mjs";
import { GOAL_HANDOFF_SCHEMA, validateGoalHandoff } from "./release-contract.mjs";

export function buildGoalHandoff({ plan, channel, runnerRef, runnerDigest, runnerHost }) {
  const handoff = {
    schema: GOAL_HANDOFF_SCHEMA,
    releaseId: plan?.id,
    repo: plan?.repo,
    baseSha: plan?.baseSha,
    planDigest: releasePlanDigest(plan),
    channel,
    runnerRef,
    runnerDigest,
    runnerHost,
    releasePlan: structuredClone(plan),
  };
  const problems = validateGoalHandoff(handoff);
  if (problems.length) throw new Error(problems[0].code);
  return handoff;
}

export function goalHandoffFingerprint(handoff) {
  const problems = validateGoalHandoff(handoff);
  if (problems.length) throw new Error(problems[0].code);
  return fingerprint(handoff);
}

function outputDirectory(value) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw new Error("OUTPUT_DIR_MUST_BE_ABSOLUTE");
  const parent = assertCanonicalPrivateOutputParent(path.dirname(value), "OUTPUT_PARENT");
  const target = path.join(parent, path.basename(value));
  return fs.lstatSync(target, { throwIfNoEntry: false })
    ? assertCanonicalPrivateExistingDirectory(target, "OUTPUT_DIR")
    : assertCanonicalAbsentChildPath(value, "OUTPUT_DIR", "OUTPUT_PARENT");
}

function bytes(value) { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"); }

function exactCaseSubject(subject, { target, digest, revision }) {
  return subject?.target === target && subject.kind === "release"
    && typeof subject.id === "string" && subject.id.length > 0
    && typeof subject.revision === "string" && subject.revision.length > 0
    && subject.digest === digest && (revision === undefined || subject.revision === revision);
}

function exactExisting(outputDir, handoff) {
  outputDir = outputDirectory(outputDir);
  if (!fs.lstatSync(outputDir, { throwIfNoEntry: false })) return false;
  if (fs.readdirSync(outputDir).join("\n") !== "goal-handoff.json") throw new Error("GOAL_HANDOFF_OUTPUT_CONFLICT");
  const file = path.join(outputDir, "goal-handoff.json");
  try { assertCanonicalPrivateExistingFile(file, "GOAL_HANDOFF_OUTPUT", { mode: 0o600 }); }
  catch { throw new Error("GOAL_HANDOFF_OUTPUT_CONFLICT"); }
  if (!fs.readFileSync(file).equals(bytes(handoff))) throw new Error("GOAL_HANDOFF_OUTPUT_CONFLICT");
  return true;
}

export function verifyGoalHandoffExactReadback({ outputDir, handoff }) {
  try { return exactExisting(outputDir, handoff) ? [] : [{ code: "GOAL_HANDOFF_OUTPUT_MISSING" }]; }
  catch (error) { return [{ code: error.message }]; }
}

export function verifyGoalHandoffApprovalPendingExact({ snapshot, handoff, approvalId, revision }) {
  const digest = goalHandoffFingerprint(handoff);
  const pending = snapshot?.approvals?.pending?.filter(({ id }) => id === approvalId) ?? [];
  const consumed = snapshot?.approvals?.consumed?.some(({ id }) => id === approvalId) ?? false;
  const approval = pending[0];
  const approved = snapshot?.checkpoint?.stage === "ADMISSION" && snapshot.checkpoint.verdict === "HANDOFF_APPROVED";
  return pending.length === 1 && !consumed && approval?.fact === "human.goalHandoff"
    && approval.subject?.kind === "goal-handoff" && approval.subject?.digest === digest
    && approval.subject?.revision === revision && approved
    ? []
    : [{ code: "GOAL_HANDOFF_APPROVAL_NOT_EXACT_PENDING" }];
}

function materialize(outputDir, handoff) {
  outputDir = assertCanonicalAbsentChildPath(outputDir, "OUTPUT_DIR", "OUTPUT_PARENT");
  const parent = assertCanonicalPrivateOutputParent(path.dirname(outputDir), "OUTPUT_PARENT");
  const staging = fs.mkdtempSync(path.join(path.dirname(outputDir), ".goal-handoff-"), { encoding: "utf8" });
  try {
    fs.chmodSync(staging, 0o700);
    assertSameFileSystem(parent, staging);
    const file = path.join(staging, "goal-handoff.json");
    fs.writeFileSync(file, bytes(handoff), { mode: 0o600, flag: "wx" });
    fs.chmodSync(file, 0o600);
    const descriptor = fs.openSync(file, "r"); try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    const stagingDescriptor = fs.openSync(staging, "r"); try { fs.fsyncSync(stagingDescriptor); } finally { fs.closeSync(stagingDescriptor); }
    fs.renameSync(staging, outputDir);
    const parentDescriptor = fs.openSync(path.dirname(outputDir), "r"); try { fs.fsyncSync(parentDescriptor); } finally { fs.closeSync(parentDescriptor); }
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  if (!exactExisting(outputDir, handoff)) throw new Error("GOAL_HANDOFF_OUTPUT_MISSING");
}

function facts(plan, input, approval, mutationId, now, subject) {
  const suffix = fingerprint(mutationId).slice(-12);
  const create = (fact, source, digest) => createFactAttestation({
    id: `F-${fact.replaceAll(".", "-")}-${suffix}`,
    fact,
    value: true,
    subject,
    source: producerAttestationSource(source, source),
    observedAt: now,
    expiresAt: null,
    mutationId,
    evidence: { kind: "artifact", ref: fingerprint(plan), digest },
  });
  const graphDigest = fingerprint(input.deliveryGraph);
  const reviewDigest = fingerprint(input.review);
  return [
    create("source.unchanged", "execution-plan-compiler", graphDigest),
    create("policy.accepted", "git-policy-check", input.policy.digest),
    create("graph.passed", "execution-plan-compiler", graphDigest),
    create("oracles.bound", "execution-plan-compiler", reviewDigest),
    create("review.ready", "ticket-readiness-reviewer", reviewDigest),
    create("executionPlan.validated", "execution-plan-compiler", fingerprint(plan)),
    approval,
  ];
}

export function applyGoalHandoff({
  handoff,
  input,
  store,
  caseId,
  approvalId,
  expectedFingerprint,
  outputDir,
  nextCommand,
  clock = () => new Date().toISOString(),
  readFresh = assertFreshExecutionInput,
  reloadInput = () => input,
}) {
  outputDir = outputDirectory(outputDir);
  const problems = validateGoalHandoff(handoff);
  if (problems.length) throw new Error(problems[0].code);
  const digest = goalHandoffFingerprint(handoff);
  if (expectedFingerprint !== digest) throw new Error("EXPECTED_GOAL_HANDOFF_FINGERPRINT_MISMATCH");
  if (typeof nextCommand !== "string" || !nextCommand.trim()) throw new Error("GOAL_RUNNER_COMMAND_REQUIRED");
  const plan = handoff.releasePlan;
  const planFingerprint = fingerprint(plan);
  const target = `github:${plan.repo}`;
  let snapshot = store.get({ caseId, target });
  const approvals = [...snapshot.approvals.pending, ...snapshot.approvals.consumed];
  const approval = approvals.find(({ id }) => id === approvalId);
  const matchingApprovals = approvals.filter((item) => item.fact === "human.goalHandoff" && item.subject?.digest === digest);
  const stableRevision = snapshot.checkpoint.subject?.revision;
  const approvalSubject = { target, kind: "goal-handoff", id: digest, revision: stableRevision, digest };
  const approvalSubjectMatches = approval && Object.entries(approvalSubject).every(([key, value]) => approval.subject?.[key] === value);
  if (!approval || matchingApprovals.length !== 1 || approval.fact !== "human.goalHandoff" || !approvalSubjectMatches
    || !validateFactAttestation(approval).ok) throw new Error("INVALID_GOAL_HANDOFF_APPROVAL");
  const existing = exactExisting(outputDir, handoff);
  const handoffReady = snapshot.checkpoint.stage === "EXECUTION" && snapshot.checkpoint.verdict === "HANDOFF_READY"
    && exactCaseSubject(snapshot.checkpoint.subject, { target, digest: planFingerprint, revision: approval.subject.revision });
  const consumed = snapshot.approvals.consumed.some(({ id }) => id === approvalId);
  if (consumed && (!existing || !handoffReady)) throw new Error("GOAL_HANDOFF_OUTPUT_CONFLICT");
  const verified = verifyExecutionPlan(plan, input, { readFresh, reloadInput });
  if (verified.status !== "READY") return verified;
  if (consumed) return { status: "COMPLETE", planDigest: releasePlanDigest(plan), handoffFingerprint: digest, nextCommand };
  if (existing && handoffReady) {
    store.consumeApproval({ caseId, target, approvalId });
    const final = store.get({ caseId, target });
    if (final.approvals.pending.some(({ id }) => id === approvalId) || !final.approvals.consumed.some(({ id }) => id === approvalId)) throw new Error("APPROVAL_NOT_SINGLE_CONSUMED");
    return { status: "COMPLETE", planDigest: releasePlanDigest(plan), handoffFingerprint: digest, nextCommand };
  }
  const now = clock();
  const checkpointMatches = () => snapshot.checkpoint.stage === "ADMISSION"
    && ["ACTIVATION_AWAITING_CONFIRMATION", "HANDOFF_APPROVED"].includes(snapshot.checkpoint.verdict)
    && exactCaseSubject(snapshot.checkpoint.subject, { target, digest: planFingerprint, revision: approval.subject.revision });
  if (!checkpointMatches()) throw new Error("INVALID_GOAL_HANDOFF_CHECKPOINT");
  if (snapshot.checkpoint.verdict === "ACTIVATION_AWAITING_CONFIRMATION") {
    const mutationId = `goal-handoff-approve:${digest}`;
    const approvalFacts = facts(plan, input, approval, mutationId, now, snapshot.checkpoint.subject);
    const approved = { schema: "pi-ticket-planning:checkpoint:v2", lane: snapshot.checkpoint.lane, stage: "ADMISSION", verdict: "HANDOFF_APPROVED", subject: snapshot.checkpoint.subject };
    const evaluated = evaluateMutation({ mutation: "goalHandoff.approve", actor: "goal-handoff-apply", transition: { current: snapshot.checkpoint, proposed: approved, approvalSubject }, facts: approvalFacts, consumedApprovalIds: snapshot.approvals.consumed.map(({ id }) => id), consumedFactIds: snapshot.consumedFactIds, mutationId, now });
    if (!evaluated.allowed) throw new Error(evaluated.problems[0]?.code ?? "GOAL_HANDOFF_APPROVAL_NOT_ALLOWED");
    const approvedFact = createFactAttestation({ id: `F-goal-handoff-approved-${fingerprint(mutationId).slice(-12)}`, fact: "handoff.approved", value: true, subject: approved.subject, source: producerAttestationSource("goal-handoff-apply", "goal-handoff-apply"), observedAt: now, expiresAt: null, evidence: { kind: "operator", ref: approval.id, digest } });
    store.transition({ caseId, target, checkpoint: approved, facts: [...approvalFacts.filter((fact) => fact.id !== approval.id), approvedFact], mutationId, nextAction: { kind: "NONE", command: null, skill: null, requiredInputs: [], blockingFacts: [], contextRoute: null, reasonCode: "GOAL_HANDOFF_MATERIALIZATION_PENDING" } });
    snapshot = store.get({ caseId, target });
  }
  const pending = verifyGoalHandoffApprovalPendingExact({ snapshot, handoff, approvalId, revision: snapshot.checkpoint.subject.revision });
  if (pending.length) throw new Error(pending[0].code);
  const mutationId = `goal-handoff-apply:${digest}`;
  const approvedFact = snapshot.facts.find((fact) => fact.fact === "handoff.approved" && fact.source?.kind === "goal-handoff-apply"
    && fact.subject?.digest === snapshot.checkpoint.subject?.digest);
  if (!approvedFact) throw new Error("GOAL_HANDOFF_APPROVAL_FACT_MISSING");
  const allFacts = [...facts(plan, input, approval, mutationId, now, snapshot.checkpoint.subject), approvedFact];
  const proposed = { schema: "pi-ticket-planning:checkpoint:v2", lane: snapshot.checkpoint.lane, stage: "EXECUTION", verdict: "HANDOFF_READY", subject: snapshot.checkpoint.subject };
  const evaluated = evaluateMutation({ mutation: "goalHandoff.apply", actor: "goal-handoff-apply", transition: { current: snapshot.checkpoint, proposed, approvalSubject }, facts: allFacts, consumedApprovalIds: snapshot.approvals.consumed.map(({ id }) => id), consumedFactIds: snapshot.consumedFactIds, mutationId, now });
  if (!evaluated.allowed) throw new Error(evaluated.problems[0]?.code ?? "GOAL_HANDOFF_NOT_ALLOWED");
  if (!existing) materialize(outputDir, handoff);
  const ready = createFactAttestation({ id: `F-goal-handoff-ready-${fingerprint(mutationId).slice(-12)}`, fact: "execution.handoffReady", value: true, subject: proposed.subject, source: producerAttestationSource("goal-handoff-apply", "goal-handoff-apply"), observedAt: now, expiresAt: null, evidence: { kind: "artifact", ref: "goal-handoff.json", digest } });
  store.transition({ caseId, target, checkpoint: proposed, facts: [...allFacts.filter((fact) => fact.id !== approval.id), ready], mutationId, nextAction: { kind: "COMMAND", command: nextCommand, skill: null, requiredInputs: [], blockingFacts: [], contextRoute: null, reasonCode: handoff.channel === "GOAL_LOCAL" ? "GOAL_LOCAL_START_REQUIRED" : "GOAL_REMOTE_START_REQUIRED" } });
  store.consumeApproval({ caseId, target, approvalId });
  const final = store.get({ caseId, target });
  const postconditions = [
    ...verifyGoalHandoffExactReadback({ outputDir, handoff }),
    final.approvals.consumed.filter(({ id }) => id === approvalId).length === 1 && !final.approvals.pending.some(({ id }) => id === approvalId) ? null : { code: "APPROVAL_NOT_SINGLE_CONSUMED" },
  ].filter(Boolean);
  if (postconditions.length) throw new Error(postconditions[0].code);
  return { status: "COMPLETE", planDigest: releasePlanDigest(plan), handoffFingerprint: digest, nextCommand };
}
