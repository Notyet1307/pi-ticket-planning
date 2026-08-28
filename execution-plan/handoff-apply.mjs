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
import {
  assertCanonicalAbsentChildPath,
  assertCanonicalPrivateExistingDirectory,
  assertCanonicalPrivateExistingFile,
  assertCanonicalPrivateOutputParent,
  assertSameFileSystem,
} from "./private-paths.mjs";
import { verifyExecutionPlan } from "./validate.mjs";

function outputDirectory(value) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw new Error("OUTPUT_DIR_MUST_BE_ABSOLUTE");
  const parent = assertCanonicalPrivateOutputParent(path.dirname(value), "OUTPUT_PARENT");
  const target = path.join(parent, path.basename(value));
  return fs.lstatSync(target, { throwIfNoEntry: false })
    ? assertCanonicalPrivateExistingDirectory(target, "OUTPUT_DIR")
    : assertCanonicalAbsentChildPath(value, "OUTPUT_DIR", "OUTPUT_PARENT");
}

function bytes(value) { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function shellQuote(value) { return `'${String(value).replaceAll("'", `'"'"'`)}'`; }

function receiptFor(plan, approvalId, configDigest, planDigest, now) {
  const provenance = plan.controller.provenance;
  const body = { schema: HANDOFF_RECEIPT_SCHEMA, status: "COMPLETE", repo: plan.repo, target: plan.target, planFingerprint: plan.planFingerprint, controllerPlanDigest: planDigest, controllerConfigDigest: configDigest, controllerRevision: provenance.controller.sourceRevision, controllerSourceManifestDigest: provenance.controller.sourceManifestDigest, controllerBuildDigest: provenance.controller.buildDigest, controllerIdentityDigest: provenance.controller.digest, controllerProvenanceDigest: provenance.digest, approvalId, verifiedAt: now };
  const complete = { ...body, releasePlanDigest: fingerprint(plan.releasePlan) };
  return { ...complete, digest: fingerprint(complete) };
}

function exactExisting(outputDir, plan, approvalId) {
  const names = ["execution-handoff-plan.json", "execution-handoff-receipt.json", "release-plan.json"];
  outputDir = outputDirectory(outputDir);
  if (!fs.lstatSync(outputDir, { throwIfNoEntry: false })) return null;
  if (fs.readdirSync(outputDir).sort().join("\n") !== names.join("\n")) throw new Error("HANDOFF_OUTPUT_CONFLICT");
  const raw = Object.fromEntries(names.map((name) => {
    const file = path.join(outputDir, name);
    try { assertCanonicalPrivateExistingFile(file, "HANDOFF_OUTPUT", { mode: 0o600 }); } catch { throw new Error("HANDOFF_OUTPUT_CONFLICT"); }
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
    || receipt.controllerRevision !== plan.controller.provenance.controller.sourceRevision
    || receipt.controllerSourceManifestDigest !== plan.controller.provenance.controller.sourceManifestDigest
    || receipt.controllerBuildDigest !== plan.controller.provenance.controller.buildDigest
    || receipt.controllerIdentityDigest !== plan.controller.provenance.controller.digest
    || receipt.controllerProvenanceDigest !== plan.controller.provenance.digest
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
      || receipt.controllerRevision !== plan.controller.provenance.controller.sourceRevision
      || receipt.controllerSourceManifestDigest !== plan.controller.provenance.controller.sourceManifestDigest
      || receipt.controllerBuildDigest !== plan.controller.provenance.controller.buildDigest
      || receipt.controllerIdentityDigest !== plan.controller.provenance.controller.digest
      || receipt.controllerProvenanceDigest !== plan.controller.provenance.digest
      || receipt.releasePlanDigest !== fingerprint(plan.releasePlan))
    || approvalId && receipt.approvalId !== approvalId) return [{ code: "HANDOFF_RECEIPT_MISMATCH" }];
  return [];
}

function materialize(outputDir, plan, receipt) {
  outputDir = assertCanonicalAbsentChildPath(outputDir, "OUTPUT_DIR", "OUTPUT_PARENT");
  const parent = assertCanonicalPrivateOutputParent(path.dirname(outputDir), "OUTPUT_PARENT");
  const staging = fs.mkdtempSync(path.join(path.dirname(outputDir), ".execution-handoff-"), { encoding: "utf8" });
  try {
    fs.chmodSync(staging, 0o700);
    assertSameFileSystem(parent, staging);
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
  return [create("source.unchanged", "execution-plan-compiler", plan.source.deliveryGraphDigest), create("policy.accepted", "git-policy-check", plan.policy.digest), create("graph.passed", "execution-plan-compiler", plan.source.deliveryGraphDigest), create("review.ready", "ticket-readiness-reviewer", plan.reviewedFingerprint), create("executionPlan.validated", "execution-plan-compiler", plan.planFingerprint), create("controller.readinessPassed", "codex-controller-cli", hashText(plan.controller.provenance.digest)), approval];
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
  nextCommand = `node <controller-cli> start --config <controller-config> --plan ${shellQuote(path.join(outputDir, "release-plan.json"))} --expected-config-digest ${shellQuote(plan.controller.configDigest)} --expected-controller-revision ${shellQuote(plan.controller.provenance.controller.sourceRevision)} --expected-controller-provenance-digest ${shellQuote(plan.controller.provenance.digest)} --json`,
}) {
  outputDir = outputDirectory(outputDir);
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
  const verified = verifyExecutionPlan(plan, input, adapter);
  if (verified.status !== "READY") return verified;
  const now = clock();
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
