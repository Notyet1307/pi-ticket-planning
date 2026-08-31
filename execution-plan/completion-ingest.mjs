import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

import { validateArtifact } from "../protocol/kernel.mjs";
import { assertCanonicalAbsentChildPath, assertCanonicalPrivateExistingFile, assertCanonicalPublicExistingFile } from "./private-paths.mjs";
import { fingerprint } from "./domain.mjs";

export const CONTROLLER_COMPLETION_SCHEMA = "herdr-codex-controller:release-completion:v3";
export const PREDECESSOR_RECEIPT_SCHEMA = "pi-ticket-planning:release-predecessor-receipt:v3";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCK_PATH = path.join(ROOT, "compatibility", "codex-controller-contract.json");
const TRUST_PATH = path.join(ROOT, "compatibility", "codex-controller-trust.json");
const HISTORY_PATH = path.join(ROOT, "compatibility", "controller-identity-history.json");
const CONFIG_CONTRACT = "herdr-codex-controller:config:v3";
const COMPLETION_SCHEMAS = new Map([
  ["herdr-codex-controller:release-completion:v2", path.join(ROOT, "schemas", "herdr-codex-release-completion-v2.schema.json")],
  ["herdr-codex-controller:release-completion:v3", path.join(ROOT, "schemas", "herdr-codex-release-completion-v3.schema.json")],
]);

function problem(code) { return { code }; }
function prefixed(value) { return `sha256:${value}`; }
function exactDigest(value) {
  const { digest, ...body } = value ?? {};
  return digest === fingerprint(body);
}
function canonicalTime(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function sha256(value) { return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`; }
function qualificationCore(entry) {
  return Object.fromEntries(["identity", "ownedSchemas", "qualificationStatus", "activatedAt", "historyDigest"].map((key) => [key, entry?.[key]]));
}
function trustRegistry(value, { contract, historyBytes }) {
  const { digest, ...body } = value ?? {};
  let history;
  try { history = JSON.parse(historyBytes); } catch { throw new Error("CONTROLLER_TRUST_REGISTRY_INVALID"); }
  const { digest: historyDigest, ...historyBody } = history ?? {};
  const active = value?.entries?.find((entry) => entry.active);
  const expectedIdentity = { version: 1, sourceRevision: contract.commit, sourceManifestDigest: contract.sourceManifestDigest, buildDigest: contract.buildDigest, digest: contract.identityDigest };
  const expectedActiveSchemas = [
    { schema: CONFIG_CONTRACT, sha256: prefixed(contract.configSchemaSha256) },
    { schema: "herdr-codex-controller:release-completion:v3", sha256: prefixed(contract.completionSchemaSha256) },
    { schema: "herdr-codex-controller:release-plan:v2", sha256: prefixed(contract.schemaSha256) },
  ];
  const inactive = value?.entries?.filter((entry) => !entry.active) ?? [];
  if (!validateArtifact(value, { identity: "pi-ticket-planning:controller-trust-registry:v1" }).ok
    || value?.schema !== "pi-ticket-planning:controller-trust-registry:v1"
    || value.digestAlgorithm !== "utf16-code-unit-canonical-json-v1+sha256-hex"
    || digest !== fingerprint(body) || digest !== contract.trustRegistryDigest || !Array.isArray(value.entries)
    || new Set(value.entries.map((entry) => entry.identity?.digest)).size !== value.entries.length
    || value.entries.filter((entry) => entry.active).length !== 1
    || active?.identity?.digest !== value.activeIdentityDigest || value.activeIdentityDigest !== contract.identityDigest
    || !same(active.identity, expectedIdentity) || !same(active.ownedSchemas, expectedActiveSchemas)
    || active.historyDigest !== contract.controllerIdentityHistoryDigest
    || value.entries.some((entry) => entry.qualificationDigest !== fingerprint(qualificationCore(entry)))
    || history?.schema !== "herdr-codex-controller:identity-history:v1" || history.version !== 1
    || history.digestAlgorithm !== value.digestAlgorithm || historyDigest !== fingerprint(historyBody)
    || historyDigest !== contract.controllerIdentityHistoryDigest
    || sha256(historyBytes).slice(7) !== contract.controllerIdentityHistorySha256
    || inactive.length !== history.entries.length
    || history.entries.some((historical) => {
      const entry = inactive.find((candidate) => candidate.identity?.digest === historical.identity?.digest);
      const source = ({ identity, ownedSchemas, qualificationStatus, activatedAt }) => ({ identity, ownedSchemas, qualificationStatus, activatedAt });
      return !entry || !same(source(entry), source(historical))
        || historical.revocation !== null && !same(entry.revocation, historical.revocation);
    })) {
    throw new Error("CONTROLLER_TRUST_REGISTRY_INVALID");
  }
  return value;
}
function trustContext({ trust, contract, historyBytes } = {}) {
  const resolvedContract = contract ?? JSON.parse(fs.readFileSync(LOCK_PATH, "utf8"));
  const resolvedHistoryBytes = historyBytes ?? fs.readFileSync(HISTORY_PATH);
  return {
    contract: resolvedContract,
    trust: trustRegistry(trust ?? JSON.parse(fs.readFileSync(TRUST_PATH, "utf8")), { contract: resolvedContract, historyBytes: resolvedHistoryBytes }),
  };
}
function trustedEntry(completion, trust) {
  const identity = completion?.controllerProvenance?.controller;
  const entry = trust.entries.find((candidate) => candidate.identity?.digest === identity?.digest);
  if (!entry || !same(entry.identity, identity)) return { problem: "CONTROLLER_IDENTITY_UNKNOWN" };
  if (entry.revocation !== null) return { problem: "CONTROLLER_IDENTITY_REVOKED" };
  const schemaPath = COMPLETION_SCHEMAS.get(completion.schema);
  const owned = entry.ownedSchemas?.find((schema) => schema.schema === completion.schema);
  if (!schemaPath || !owned || owned.sha256 !== sha256(fs.readFileSync(schemaPath))) return { problem: "CONTROLLER_COMPLETION_SCHEMA_UNTRUSTED" };
  return { entry, schemaSha256: owned.sha256 };
}

export function validateControllerCompletion(value, options = {}) {
  const problems = [];
  try {
    if (!COMPLETION_SCHEMAS.has(value?.schema) || !validateArtifact(value, { identity: value.schema }).ok) return [problem("CONTROLLER_COMPLETION_EXPORT_INVALID")];
  } catch {
    return [problem("CONTROLLER_COMPLETION_EXPORT_INVALID")];
  }
  if (!exactDigest(value)) problems.push(problem("CONTROLLER_COMPLETION_DIGEST_MISMATCH"));
  const provenance = value.controllerProvenance;
  const { digest: controllerDigest, ...controllerBody } = provenance.controller;
  const { digest: provenanceDigest, ...provenanceBody } = provenance;
  const nestedProvenanceMatches = [provenance.executionRuntime, provenance.remoteIdentity, provenance.validationSandbox]
    .filter(Boolean)
    .every((entry) => {
      const { digest, ...body } = entry;
      return digest === fingerprint(body).slice(7);
    });
  if (controllerDigest !== fingerprint(controllerBody).slice(7)
    || provenanceDigest !== fingerprint(provenanceBody).slice(7) || !nestedProvenanceMatches) {
    problems.push(problem("CONTROLLER_COMPLETION_PROVENANCE_MISMATCH"));
  }
  let trusted;
  let trust;
  try {
    const context = trustContext(options);
    trust = context.trust;
    trusted = trustedEntry(value, trust);
  }
  catch { trusted = { problem: "CONTROLLER_TRUST_REGISTRY_INVALID" }; }
  if (trusted.problem) problems.push(problem(trusted.problem));
  if (value.schema === "herdr-codex-controller:release-completion:v3"
    && (value.digestAlgorithm !== trust?.digestAlgorithm
      || value.schemaSha256 !== trusted.schemaSha256
      || provenance.version !== 3
      || value.requiredCheckContractDigest !== provenance.requiredCheckContractDigest
      || provenance.identityHistoryDigest !== trusted.entry?.historyDigest)) {
    problems.push(problem("CONTROLLER_COMPLETION_TRUST_BINDING_MISMATCH"));
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
  const trust = trustContext(options).trust;
  const trusted = trustedEntry(value, trust);
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
    controllerIdentityDigest: value.controllerProvenance.controller.digest,
    controllerQualificationDigest: trusted.entry.qualificationDigest,
    controllerCompletionSchemaSha256: trusted.schemaSha256,
    completedAt: value.completedAt,
  };
  return { ...body, digest: fingerprint(body) };
}

export function validateControllerPredecessorReceipt(receipt, options = {}) {
  if (receipt?.schema === "pi-ticket-planning:release-predecessor-receipt:v2") return [problem("PREDECESSOR_RECEIPT_NEEDS_MIGRATION")];
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
  let trusted;
  try { trusted = trustedEntry(completion, trustContext(options).trust); }
  catch { trusted = { problem: "CONTROLLER_TRUST_REGISTRY_INVALID" }; }
  if (trusted.problem || receipt.controllerIdentityDigest !== completion.controllerProvenance.controller.digest
    || receipt.controllerQualificationDigest !== trusted.entry?.qualificationDigest
    || receipt.controllerCompletionSchemaSha256 !== trusted.schemaSha256) {
    problems.push(problem("CONTROLLER_COMPLETION_TRUST_BINDING_MISMATCH"));
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
