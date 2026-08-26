import fs from "node:fs";
import path from "node:path";
import {
  createFactAttestation,
  evaluateMutation,
  producerAttestationSource,
  validateArtifact,
  validateFactAttestation,
} from "../protocol/kernel.mjs";
import { HANDOFF_RECEIPT_SCHEMA, fingerprint, hashText } from "./domain.mjs";
import { verifyExecutionPlan } from "./validate.mjs";

function privateDirectory(directory) {
  if (!path.isAbsolute(directory)) throw new Error("OUTPUT_DIR_MUST_BE_ABSOLUTE");
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error("OUTPUT_DIR_MUST_BE_PRIVATE_DIRECTORY");
}

function bytes(value) { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"); }

function receiptFor(plan, approvalId, configDigest, planDigest, now) {
  const body = { schema: HANDOFF_RECEIPT_SCHEMA, status: "COMPLETE", repo: plan.repo, target: plan.target, planFingerprint: plan.planFingerprint, controllerPlanDigest: planDigest, controllerConfigDigest: configDigest, approvalId, verifiedAt: now };
  const complete = { ...body, releasePlanDigest: fingerprint(plan.releasePlan) };
  return { ...complete, digest: fingerprint(complete) };
}

function exactExisting(outputDir, plan, approvalId) {
  const names = ["execution-handoff-plan.json", "execution-handoff-receipt.json", "release-plan.json"];
  if (!fs.existsSync(outputDir)) return null;
  privateDirectory(outputDir);
  if (fs.readdirSync(outputDir).sort().join("\n") !== names.join("\n")) throw new Error("HANDOFF_OUTPUT_CONFLICT");
  const raw = Object.fromEntries(names.map((name) => {
    const file = path.join(outputDir, name); const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600) throw new Error("HANDOFF_OUTPUT_CONFLICT");
    return [name, fs.readFileSync(file)];
  }));
  const read = Object.fromEntries(names.map((name) => [name, JSON.parse(raw[name].toString("utf8"))]));
  const receipt = read["execution-handoff-receipt.json"];
  if (!raw["release-plan.json"].equals(bytes(plan.releasePlan))
    || !raw["execution-handoff-plan.json"].equals(bytes(plan))
    || !raw["execution-handoff-receipt.json"].equals(bytes(receipt))
    || !validateArtifact(receipt).ok
    || receipt.planFingerprint !== plan.planFingerprint
    || receipt.approvalId !== approvalId
    || receipt.repo !== plan.repo
    || receipt.target !== plan.target
    || receipt.status !== "COMPLETE"
    || receipt.controllerPlanDigest !== plan.controllerPlanDigest
    || receipt.controllerConfigDigest !== plan.controller.configDigest
    || receipt.releasePlanDigest !== fingerprint(plan.releasePlan)
    || receipt.digest !== fingerprint((({ digest, ...body }) => body)(receipt))) throw new Error("HANDOFF_OUTPUT_CONFLICT");
  return receipt;
}

export function verifyHandoffFilesExactReadback({ outputDir, plan, approvalId }) {
  try { return exactExisting(outputDir, plan, approvalId) ? [] : [{ code: "HANDOFF_OUTPUT_MISSING" }]; } catch (error) { return [{ code: error.message }]; }
}

export function verifyHandoffReceiptExact({ receipt, plan, approvalId }) {
  if (!receipt || !validateArtifact(receipt).ok || receipt.digest !== fingerprint((({ digest, ...body }) => body)(receipt))
    || plan && (receipt.repo !== plan.repo || receipt.target !== plan.target || receipt.planFingerprint !== plan.planFingerprint
      || receipt.controllerPlanDigest !== plan.controllerPlanDigest || receipt.controllerConfigDigest !== plan.controller.configDigest
      || receipt.releasePlanDigest !== fingerprint(plan.releasePlan))
    || approvalId && receipt.approvalId !== approvalId) return [{ code: "HANDOFF_RECEIPT_MISMATCH" }];
  return [];
}

function materialize(outputDir, plan, receipt) {
  privateDirectory(path.dirname(outputDir));
  const staging = fs.mkdtempSync(path.join(path.dirname(outputDir), ".execution-handoff-"), { encoding: "utf8" });
  try {
    fs.chmodSync(staging, 0o700);
    for (const [name, value] of [["release-plan.json", plan.releasePlan], ["execution-handoff-plan.json", plan], ["execution-handoff-receipt.json", receipt]]) {
      const file = path.join(staging, name);
      fs.writeFileSync(file, bytes(value), { mode: 0o600, flag: "wx" });
      fs.chmodSync(file, 0o600);
      const descriptor = fs.openSync(file, "r"); try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    }
    const stagingDescriptor = fs.openSync(staging, "r"); try { fs.fsyncSync(stagingDescriptor); } finally { fs.closeSync(stagingDescriptor); }
    fs.renameSync(staging, outputDir);
    const parentDescriptor = fs.openSync(path.dirname(outputDir), "r"); try { fs.fsyncSync(parentDescriptor); } finally { fs.closeSync(parentDescriptor); }
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
  return exactExisting(outputDir, plan, receipt.approvalId);
}

function facts(plan, approval, mutationId, now, subject) {
  const create = (fact, source, digest, sameMutation = true) => createFactAttestation({ id: `F-${fact.replaceAll(".", "-")}-${mutationId.slice(-12)}`, fact, value: true, subject, source: producerAttestationSource(source, source), observedAt: now, expiresAt: fact === "controller.readinessPassed" ? new Date(Date.parse(now) + 3600000).toISOString() : null, ...(sameMutation ? { mutationId } : {}), evidence: { kind: "artifact", ref: plan.planFingerprint, digest } });
  return [create("source.unchanged", "execution-plan-compiler", plan.source.deliveryGraphDigest), create("policy.accepted", "git-policy-check", plan.policy.digest), create("graph.passed", "execution-plan-compiler", plan.source.deliveryGraphDigest), create("review.ready", "ticket-readiness-reviewer", plan.reviewedFingerprint), create("executionPlan.validated", "execution-plan-compiler", plan.planFingerprint), create("controller.readinessPassed", "codex-controller-cli", hashText(plan.controller.configDigest)), approval];
}

export function applyExecutionPlan({
  plan,
  input,
  adapter,
  store,
  caseId,
  approvalId,
  expectedFingerprint,
  outputDir,
  clock = () => new Date().toISOString(),
  nextCommand = `node <controller-cli> start --config <controller-config> --plan ${path.join(outputDir, "release-plan.json")} --json`,
}) {
  if (expectedFingerprint !== plan?.planFingerprint) throw new Error("EXPECTED_FINGERPRINT_MISMATCH");
  const target = `github:${plan.repo}`;
  const snapshot = store.get({ caseId, target });
  const approvals = [...snapshot.approvals.pending, ...snapshot.approvals.consumed];
  const approval = approvals.find(({ id }) => id === approvalId);
  const matchingApprovals = approvals.filter((item) => item.fact === "human.executionHandoff" && item.subject?.digest === plan.planFingerprint);
  const approvalSubject = { target, kind: "execution-handoff-plan", id: plan.planFingerprint, revision: plan.source.revision, digest: plan.planFingerprint };
  const approvalSubjectMatches = approval && Object.entries(approvalSubject).every(([key, value]) => approval.subject?.[key] === value);
  if (!approval || matchingApprovals.length !== 1 || approval.fact !== "human.executionHandoff" || !approvalSubjectMatches
    || !validateFactAttestation(approval).ok) throw new Error("INVALID_HANDOFF_APPROVAL");
  const existing = exactExisting(outputDir, plan, approvalId);
  const handoffReady = snapshot.checkpoint.stage === "EXECUTION" && snapshot.checkpoint.verdict === "HANDOFF_READY"
    && snapshot.checkpoint.subject?.target === target && snapshot.checkpoint.subject?.id === plan.target && snapshot.checkpoint.subject?.revision === plan.source.revision;
  if (snapshot.approvals.consumed.some(({ id }) => id === approvalId)) {
    if (!existing || !handoffReady) throw new Error("HANDOFF_OUTPUT_CONFLICT");
    return { status: "COMPLETE", receipt: existing, nextCommand };
  }
  if (existing && handoffReady) {
    const readback = [...verifyHandoffFilesExactReadback({ outputDir, plan, approvalId }), ...verifyHandoffReceiptExact({ receipt: existing, plan, approvalId })];
    if (readback.length) throw new Error(readback[0].code);
    store.consumeApproval({ caseId, target, approvalId });
    const final = store.get({ caseId, target });
    if (final.approvals.pending.some(({ id }) => id === approvalId) || !final.approvals.consumed.some(({ id }) => id === approvalId)) throw new Error("APPROVAL_NOT_SINGLE_CONSUMED");
    return { status: "COMPLETE", receipt: existing, nextCommand };
  }
  const verified = existing
    ? { status: "READY", controllerConfigDigest: existing.controllerConfigDigest, controllerPlanDigest: existing.controllerPlanDigest }
    : verifyExecutionPlan(plan, input, adapter);
  if (verified.status !== "READY") return verified;
  const now = existing?.verifiedAt ?? clock();
  const mutationId = `execution-plan-apply:${plan.planFingerprint}`;
  if (snapshot.checkpoint.stage !== "ADMISSION" || snapshot.checkpoint.verdict !== "ACTIVATION_AWAITING_CONFIRMATION"
    || snapshot.checkpoint.subject?.target !== target || snapshot.checkpoint.subject?.id !== plan.target || snapshot.checkpoint.subject?.revision !== plan.source.revision || !snapshot.checkpoint.subject?.digest) throw new Error("INVALID_HANDOFF_CHECKPOINT");
  const allFacts = facts(plan, approval, mutationId, now, snapshot.checkpoint.subject);
  const proposed = { schema: "pi-ticket-planning:checkpoint:v2", lane: snapshot.checkpoint.lane, stage: "EXECUTION", verdict: "HANDOFF_READY", subject: snapshot.checkpoint.subject };
  const evaluated = evaluateMutation({ mutation: "executionPlan.apply", actor: "execution-plan-apply", transition: { current: snapshot.checkpoint, proposed, approvalSubject }, facts: allFacts, consumedApprovalIds: snapshot.approvals.consumed.map(({ id }) => id), consumedFactIds: snapshot.consumedFactIds, mutationId, now });
  if (!evaluated.allowed) throw new Error(evaluated.problems[0]?.code ?? "EXECUTION_HANDOFF_NOT_ALLOWED");
  const receipt = existing ?? materialize(outputDir, plan, receiptFor(plan, approvalId, verified.controllerConfigDigest, verified.controllerPlanDigest, now));
  const ready = createFactAttestation({ id: `F-execution-handoff-ready-${mutationId.slice(-12)}`, fact: "execution.handoffReady", value: true, subject: proposed.subject, source: producerAttestationSource("execution-plan-apply", "execution-plan-apply"), observedAt: now, expiresAt: null, evidence: { kind: "receipt", ref: plan.planFingerprint, digest: receipt.digest } });
  store.transition({ caseId, target, checkpoint: proposed, facts: [...allFacts.filter((fact) => fact.id !== approval.id), ready], mutationId, nextAction: { kind: "COMMAND", command: nextCommand, skill: null, requiredInputs: [], blockingFacts: [], contextRoute: null, reasonCode: "CONTROLLER_START_REQUIRED" } });
  store.consumeApproval({ caseId, target, approvalId });
  const final = store.get({ caseId, target });
  const postconditions = [...verifyHandoffFilesExactReadback({ outputDir, plan, approvalId }), ...verifyHandoffReceiptExact({ receipt, plan, approvalId }), final.approvals.consumed.filter(({ id }) => id === approvalId).length === 1 && !final.approvals.pending.some(({ id }) => id === approvalId) ? null : { code: "APPROVAL_NOT_SINGLE_CONSUMED" }].filter(Boolean);
  if (postconditions.length) throw new Error(postconditions[0].code);
  return { status: "COMPLETE", receipt, nextCommand };
}
