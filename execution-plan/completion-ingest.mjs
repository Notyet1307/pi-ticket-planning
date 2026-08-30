import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateArtifact } from "../protocol/kernel.mjs";
import { assertCanonicalAbsentChildPath, assertCanonicalPrivateExistingFile, assertCanonicalPublicExistingFile } from "./private-paths.mjs";
import { fingerprint } from "./domain.mjs";

export const CONTROLLER_COMPLETION_SCHEMA = "herdr-codex-controller:release-completion:v1";
export const PREDECESSOR_RECEIPT_SCHEMA = "pi-ticket-planning:release-predecessor-receipt:v2";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCK_PATH = path.join(ROOT, "compatibility", "codex-controller-contract.json");

function problem(code) { return { code }; }
function prefixed(value) { return `sha256:${value}`; }
function exactDigest(value) {
  const { digest, ...body } = value ?? {};
  return digest === fingerprint(body);
}
function canonicalTime(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function lockIdentity(lock) {
  return {
    version: 1,
    sourceRevision: lock.commit,
    sourceManifestDigest: lock.sourceManifestDigest,
    buildDigest: lock.buildDigest,
    digest: lock.identityDigest,
  };
}
function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }

export function validateControllerCompletion(value, { lock = JSON.parse(fs.readFileSync(LOCK_PATH, "utf8")) } = {}) {
  const problems = [];
  try {
    if (!validateArtifact(value, { identity: CONTROLLER_COMPLETION_SCHEMA }).ok) return [problem("CONTROLLER_COMPLETION_EXPORT_INVALID")];
  } catch {
    return [problem("CONTROLLER_COMPLETION_EXPORT_INVALID")];
  }
  if (!exactDigest(value)) problems.push(problem("CONTROLLER_COMPLETION_DIGEST_MISMATCH"));
  const provenance = value.controllerProvenance;
  const { digest: controllerDigest, ...controllerBody } = provenance.controller;
  const { digest: provenanceDigest, ...provenanceBody } = provenance;
  if (controllerDigest !== fingerprint(controllerBody).slice(7)
    || provenanceDigest !== fingerprint(provenanceBody).slice(7)
    || !same(provenance.controller, lockIdentity(lock))) {
    problems.push(problem("CONTROLLER_COMPLETION_PROVENANCE_MISMATCH"));
  }
  if (provenance.executionMode !== "release-plan-v2-direct" || provenance.releasePlan.version !== 2
    || value.requiredChecks.length === 0) problems.push(problem("CONTROLLER_COMPLETION_NOT_VERIFIED"));
  if (provenance.releasePlan.digest !== value.planDigest) problems.push(problem("CONTROLLER_COMPLETION_PLAN_MISMATCH"));
  if (value.pullRequest.headSha !== value.candidateSha || value.pullRequest.baseRef !== value.baseRef) {
    problems.push(problem("CONTROLLER_COMPLETION_CANDIDATE_MISMATCH"));
  }
  if (value.pullRequest.mergeSha !== value.mergedMainSha) problems.push(problem("CONTROLLER_COMPLETION_MERGE_MISMATCH"));
  if (!canonicalTime(value.pullRequest.mergedAt) || !canonicalTime(value.completedAt)
    || Date.parse(value.completedAt) < Date.parse(value.pullRequest.mergedAt)) {
    problems.push(problem("CONTROLLER_COMPLETION_NOT_VERIFIED"));
  }
  if (new Set(value.issueCommits.map(({ issueNumber }) => issueNumber)).size !== value.issueCommits.length) {
    problems.push(problem("CONTROLLER_COMPLETION_ISSUE_COMMIT_MISMATCH"));
  }
  return problems;
}

export function ingestControllerCompletion(value, options = {}) {
  const problems = validateControllerCompletion(value, options);
  if (problems.length > 0) throw new Error(problems[0].code);
  const body = {
    schema: PREDECESSOR_RECEIPT_SCHEMA,
    releaseId: value.releaseId,
    controllerCompletion: structuredClone(value),
    controllerCompletionDigest: value.digest,
    planDigest: prefixed(value.planDigest),
    candidateSha: value.candidateSha,
    mergeSha: value.pullRequest.mergeSha,
    mergedMainSha: value.mergedMainSha,
    handoffDigests: [...value.dependencyHandoffDigests],
    validationDigest: prefixed(value.releaseValidationDigest),
    reviewResultDigest: prefixed(value.reviewResultDigest),
    controllerProvenanceDigest: prefixed(value.controllerProvenance.digest),
    completedAt: value.completedAt,
  };
  return { ...body, digest: fingerprint(body) };
}

export function validateControllerPredecessorReceipt(receipt, options = {}) {
  if (receipt?.schema !== PREDECESSOR_RECEIPT_SCHEMA) return [problem("PREDECESSOR_COMPLETION_EXPORT_REQUIRED")];
  try {
    if (!validateArtifact(receipt, { identity: PREDECESSOR_RECEIPT_SCHEMA }).ok) return [problem("INVALID_PREDECESSOR_RECEIPT")];
  } catch {
    return [problem("INVALID_PREDECESSOR_RECEIPT")];
  }
  const problems = exactDigest(receipt) ? [] : [problem("PREDECESSOR_RECEIPT_DIGEST_MISMATCH")];
  problems.push(...validateControllerCompletion(receipt.controllerCompletion, options));
  const completion = receipt.controllerCompletion;
  if (receipt.controllerCompletionDigest !== completion.digest) problems.push(problem("CONTROLLER_COMPLETION_DIGEST_MISMATCH"));
  if (receipt.releaseId !== completion.releaseId) problems.push(problem("CONTROLLER_COMPLETION_RELEASE_MISMATCH"));
  if (receipt.planDigest !== prefixed(completion.planDigest)) problems.push(problem("CONTROLLER_COMPLETION_PLAN_MISMATCH"));
  if (receipt.candidateSha !== completion.candidateSha || receipt.candidateSha !== completion.pullRequest.headSha) {
    problems.push(problem("CONTROLLER_COMPLETION_CANDIDATE_MISMATCH"));
  }
  if (receipt.mergeSha !== completion.pullRequest.mergeSha || receipt.mergedMainSha !== completion.mergedMainSha) {
    problems.push(problem("CONTROLLER_COMPLETION_MERGE_MISMATCH"));
  }
  if (receipt.validationDigest !== prefixed(completion.releaseValidationDigest)) {
    problems.push(problem("CONTROLLER_COMPLETION_VALIDATION_MISMATCH"));
  }
  if (receipt.reviewResultDigest !== prefixed(completion.reviewResultDigest)) {
    problems.push(problem("CONTROLLER_COMPLETION_REVIEW_MISMATCH"));
  }
  if (receipt.controllerProvenanceDigest !== prefixed(completion.controllerProvenance.digest)) {
    problems.push(problem("CONTROLLER_COMPLETION_PROVENANCE_MISMATCH"));
  }
  if (!same(receipt.handoffDigests, completion.dependencyHandoffDigests)) {
    problems.push(problem("CONTROLLER_COMPLETION_HANDOFF_MISMATCH"));
  }
  if (receipt.completedAt !== completion.completedAt) problems.push(problem("CONTROLLER_COMPLETION_RELEASE_MISMATCH"));
  return problems;
}

function options(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--json") {
      if (values.has("json")) throw new Error("INVALID_OPTIONS");
      values.set("json", true); continue;
    }
    if (!key?.startsWith("--") || values.has(key.slice(2))) throw new Error("INVALID_OPTIONS");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error("INVALID_OPTIONS");
    values.set(key.slice(2), value); index += 1;
  }
  for (const key of values.keys()) if (!["completion", "out", "json"].includes(key)) throw new Error(`UNKNOWN_OPTION:${key}`);
  if (!values.has("completion")) throw new Error("MISSING_OPTION:completion");
  return values;
}

export function runControllerCompletionIngestion(argv = process.argv.slice(2)) {
  try {
    const values = options(argv);
    let input;
    try { input = assertCanonicalPublicExistingFile(path.resolve(values.get("completion")), "CONTROLLER_COMPLETION"); }
    catch { throw new Error("CONTROLLER_COMPLETION_INPUT_NOT_PUBLIC"); }
    const receipt = ingestControllerCompletion(JSON.parse(fs.readFileSync(input, "utf8")));
    const output = `${JSON.stringify(receipt, null, 2)}\n`;
    if (!values.has("out") || values.get("out") === "-") process.stdout.write(output);
    else {
      const target = assertCanonicalAbsentChildPath(path.resolve(values.get("out")), "OUTPUT", "OUTPUT_PARENT");
      fs.writeFileSync(target, output, { encoding: "utf8", mode: 0o600, flag: "wx" });
      fs.chmodSync(target, 0o600);
      assertCanonicalPrivateExistingFile(target, "OUTPUT", { mode: 0o600 });
      if (values.has("json")) process.stdout.write(`${JSON.stringify(receipt)}\n`);
    }
    return 0;
  } catch (error) {
    process.stderr.write(`ERROR ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runControllerCompletionIngestion();
}
