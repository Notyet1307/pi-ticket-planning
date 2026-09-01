import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { parseChildTicket } from "../execution-plan/markdown.mjs";
import { validateArtifact } from "../protocol/kernel.mjs";
import { oracleRequiredForRiskClasses, riskClassesRequireSplit, unknownRiskClasses } from "./risk-classes.mjs";

export const REQUIRED_REPLAN_TRIGGERS = [
  "ACCEPTED_DECISION_CHANGE_REQUIRED",
  "THIRD_RISK_CLASS_DISCOVERED",
  "SCOPE_BUDGET_EXCEEDED",
  "DOWNSTREAM_RELEASE_BEHAVIOR_DISCOVERED",
];

const EXACT_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const CONSTRAINT_KEYS = [
  "implementationOwner",
  "riskClasses",
  "scopeBudget",
  "expectedPaths",
  "protectedPaths",
  "replanTriggers",
  "primaryVerificationSeams",
  "integrationOnly",
  "waivers",
];
function issue(code, subject) {
  return subject ? { code, subject } : { code };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function same(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

export function ticketContractDigest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical(value)), "utf8").digest("hex")}`;
}

function exactArtifactDigest(value) {
  const { digest, ...body } = value ?? {};
  return DIGEST.test(digest ?? "") && ticketContractDigest(body) === digest;
}

function safeExactPath(value) {
  return typeof value === "string" && value.length > 0
    && !path.posix.isAbsolute(value) && !path.win32.isAbsolute(value)
    && !value.includes("\\") && !value.split("/").includes("..")
    && !/[*?[\]{}\u0000\r\n]/u.test(value)
    && path.posix.normalize(value) === value;
}

export function safeExpectedPath(value) {
  return typeof value === "string" && value.length > 0
    && !path.posix.isAbsolute(value) && !path.win32.isAbsolute(value)
    && !value.includes("\\") && !value.split("/").includes("..")
    && !value.split("/", 1)[0].includes("*")
    && !/[?[\]{}\u0000\r\n]/u.test(value) && !value.includes("**")
    && path.posix.normalize(value.replaceAll("*", "x")) === value.replaceAll("*", "x");
}

function globRegex(value) {
  return new RegExp(`^${value.split("*").map((part) => part.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&")).join("[^/]*")}$`, "u");
}

export function pathMatches(pattern, value) {
  return safeExpectedPath(pattern) && safeExactPath(value) && globRegex(pattern).test(value);
}

export function patternsOverlap(left, right) {
  if (left === right) return true;
  if (!safeExpectedPath(left) || !safeExpectedPath(right)) return true;
  if (!left.includes("*") && pathMatches(right, left)) return true;
  if (!right.includes("*") && pathMatches(left, right)) return true;
  const leftPrefix = left.split("*", 1)[0];
  const rightPrefix = right.split("*", 1)[0];
  return Boolean(leftPrefix && rightPrefix && (leftPrefix.startsWith(rightPrefix) || rightPrefix.startsWith(leftPrefix)));
}

function runGit(repo, args, { buffer = false } = {}) {
  const run = spawnSync("git", ["-C", repo, ...args], {
    encoding: buffer ? null : "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return { ok: !run.error && run.status === 0, stdout: run.stdout };
}

function resolveBase(repo, baseSha, problems) {
  if (!path.isAbsolute(repo ?? "")) {
    problems.push(issue("REPOSITORY_PATH_NOT_ABSOLUTE"));
    return null;
  }
  try {
    if (!fs.statSync(repo).isDirectory()) throw new Error("not directory");
  } catch {
    problems.push(issue("INVALID_REPOSITORY_PATH"));
    return null;
  }
  if (!EXACT_SHA.test(baseSha ?? "")) {
    problems.push(issue("ORACLE_BASE_MISMATCH"));
    return null;
  }
  const resolved = runGit(repo, ["rev-parse", "--verify", `${baseSha}^{commit}`]);
  if (!resolved.ok || resolved.stdout.trim() !== baseSha) {
    problems.push(issue("ORACLE_BASE_MISMATCH"));
    return null;
  }
  return baseSha;
}

export function readRegularBaseFile(repo, baseSha, file) {
  if (!safeExactPath(file)) return null;
  const tree = runGit(repo, ["ls-tree", "-z", baseSha, "--", file], { buffer: true });
  if (!tree.ok || !tree.stdout?.length) return null;
  const record = tree.stdout.toString("utf8").replace(/\0$/u, "");
  const match = record.match(/^(100644|100755) blob [a-f0-9]+\t([^\u0000]+)$/u);
  if (!match || match[2] !== file) return null;
  const shown = runGit(repo, ["show", `${baseSha}:${file}`], { buffer: true });
  return shown.ok && Buffer.isBuffer(shown.stdout) ? shown.stdout : null;
}

function digestBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join("\n") === [...keys].sort().join("\n");
}

export function buildOracleVerifierManifest({ repo, baseSha, oracleId, command, files }) {
  const commandMatch = typeof command === "string" ? command.match(/^npm run (verify:[A-Za-z0-9:_-]+)$/u) : null;
  const packageBytes = readRegularBaseFile(repo, baseSha, "package.json");
  let packageJson;
  try { packageJson = JSON.parse(packageBytes?.toString("utf8")); } catch { throw new Error("ORACLE_VERIFIER_BINDING_DRIFT"); }
  const definition = commandMatch ? packageJson?.scripts?.[commandMatch[1]] : null;
  if (typeof definition !== "string" || !Array.isArray(files) || files.length === 0
    || new Set(files).size !== files.length) {
    throw new Error("ORACLE_VERIFIER_BINDING_DRIFT");
  }
  const bindings = [...new Set(files)].sort().map((file) => {
    if (file === "package.json" || !safeExactPath(file)) throw new Error("ORACLE_VERIFIER_BINDING_DRIFT");
    const bytes = readRegularBaseFile(repo, baseSha, file);
    if (!bytes) throw new Error("ORACLE_VERIFIER_BINDING_DRIFT");
    return { path: file, sha256: digestBytes(bytes), byteCount: bytes.length };
  });
  const body = {
    schema: "herdr-codex-controller:oracle-verifier-manifest:v1",
    oracleId,
    command,
    packageScript: { name: commandMatch[1], definitionSha256: digestBytes(Buffer.from(definition, "utf8")) },
    files: bindings,
  };
  return { ...body, digest: ticketContractDigest(body) };
}

export function oracleVerifierProtectedPaths(bindings) {
  const present = (bindings ?? []).filter(Boolean);
  if (present.length === 0) return [];
  return [...new Set(["package.json", ...present.flatMap((binding) => binding.verifier?.files?.map(({ path: file }) => file) ?? [])])].sort();
}

function validateOracleVerifier(binding, { repo, baseSha }, problems) {
  const verifier = binding?.verifier;
  if (!exactKeys(verifier, ["schema", "oracleId", "command", "packageScript", "files", "digest"])
    || verifier.schema !== "herdr-codex-controller:oracle-verifier-manifest:v1"
    || !exactKeys(verifier.packageScript, ["name", "definitionSha256"])
    || !Array.isArray(verifier.files) || verifier.files.length === 0 || verifier.files.length > 100
    || verifier.files.some((file) => !exactKeys(file, ["path", "sha256", "byteCount"]))) {
    problems.push(issue("ORACLE_VERIFIER_MANIFEST_MISSING", binding?.id));
    return null;
  }
  const command = typeof binding.execution?.command === "string" ? binding.execution.command : "";
  const commandMatch = command.match(/^npm run (verify:[A-Za-z0-9:_-]+)$/u);
  const paths = verifier.files.map(({ path: file }) => file);
  const { digest: _digest, ...verifierBody } = verifier;
  let drift = verifier.oracleId !== binding.id
    || verifier.command !== command
    || !commandMatch || verifier.packageScript.name !== commandMatch?.[1]
    || !DIGEST.test(verifier.packageScript.definitionSha256 ?? "")
    || !DIGEST.test(verifier.digest ?? "") || ticketContractDigest(verifierBody) !== verifier.digest
    || paths.includes("package.json") || new Set(paths).size !== paths.length
    || paths.join("\n") !== [...paths].sort().join("\n")
    || verifier.files.some((file) => !safeExactPath(file.path) || !DIGEST.test(file.sha256 ?? "")
      || !Number.isInteger(file.byteCount) || file.byteCount < 0 || file.byteCount > 64 * 1024 * 1024);
  const packageBytes = readRegularBaseFile(repo, baseSha, "package.json");
  let definition = null;
  try { definition = JSON.parse(packageBytes?.toString("utf8"))?.scripts?.[verifier.packageScript.name]; } catch { /* drift below */ }
  if (typeof definition !== "string"
    || digestBytes(Buffer.from(definition, "utf8")) !== verifier.packageScript.definitionSha256) drift = true;
  for (const file of verifier.files) {
    const bytes = readRegularBaseFile(repo, baseSha, file.path);
    if (!bytes || bytes.length !== file.byteCount || digestBytes(bytes) !== file.sha256) drift = true;
  }
  if (drift) problems.push(issue("ORACLE_VERIFIER_BINDING_DRIFT", binding.id));
  return verifier;
}

function allowedOracleCommand(repo, baseSha, command, problems) {
  const bytes = readRegularBaseFile(repo, baseSha, "package.json");
  if (!bytes) {
    problems.push(issue("ORACLE_VALIDATION_CONFIG_MISSING"));
    return;
  }
  let manifest;
  try { manifest = JSON.parse(bytes.toString("utf8")); } catch {
    problems.push(issue("ORACLE_VALIDATION_CONFIG_INVALID"));
    return;
  }
  const match = typeof command === "string" ? command.match(/^npm run (verify:[A-Za-z0-9:_-]+)$/u) : null;
  if (!match || typeof manifest.scripts?.[match[1]] !== "string" || !manifest.scripts[match[1]].trim()) {
    problems.push(issue("ORACLE_COMMAND_NOT_ALLOWED", command));
  }
}

export function oracleBindingDigest(binding) {
  return binding === null ? null : ticketContractDigest(binding);
}

function validateOracleBinding(binding, { repo, baseSha, implementationOwner, required }, problems) {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
    if (required) problems.push(issue("MISSING_ORACLE_BINDING"));
    return null;
  }
  try {
    const checked = validateArtifact(binding, { identity: "pi-ticket-planning:oracle-binding:v1" });
    if (!checked.ok) problems.push(issue("MISSING_ORACLE_BINDING"));
  } catch {
    problems.push(issue("MISSING_ORACLE_BINDING"));
    return null;
  }
  if (binding.artifact?.baseSha !== baseSha) problems.push(issue("ORACLE_BASE_MISMATCH", binding.id));
  if (binding.workerMutationAllowed !== false) problems.push(issue("ORACLE_MUTABLE_BY_WORKER", binding.id));
  if (binding.owner?.kind !== "INDEPENDENT_VERIFICATION" || binding.owner?.identity === implementationOwner) {
    problems.push(issue("ORACLE_OWNER_NOT_INDEPENDENT", binding.id));
  }
  if (!safeExactPath(binding.artifact?.path)) {
    problems.push(issue("INVALID_ORACLE_ARTIFACT_PATH", binding.artifact?.path));
    return binding;
  }
  const bytes = readRegularBaseFile(repo, baseSha, binding.artifact.path);
  if (!bytes) problems.push(issue("ORACLE_ARTIFACT_NOT_FOUND", binding.artifact.path));
  else {
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (digest !== binding.artifact.sha256 || bytes.length !== binding.artifact.byteCount) {
      problems.push(issue("ORACLE_DIGEST_MISMATCH", binding.artifact.path));
    }
  }
  allowedOracleCommand(repo, baseSha, binding.execution?.command, problems);
  validateOracleVerifier(binding, { repo, baseSha }, problems);
  return binding;
}

function validateWaivers(waivers, childId, problems) {
  if (!Array.isArray(waivers)) return [];
  const valid = [];
  for (const waiver of waivers) {
    try {
      const checked = validateArtifact(waiver, { identity: "pi-ticket-planning:ticket-readiness-waiver:v1" });
      if (!checked.ok || !exactArtifactDigest(waiver) || waiver.childId !== String(childId)) throw new Error("invalid");
      valid.push(waiver);
    } catch {
      problems.push(issue("INVALID_TICKET_READINESS_WAIVER", String(childId)));
    }
  }
  return valid;
}

function exactWaiver(waivers, kind, childId, exception) {
  return waivers.some((waiver) => waiver.kind === kind && waiver.childId === String(childId) && same(waiver.exception, exception));
}

function staticConstraintsProblems(constraints, childId, oraclePath = null, { deferWaiverValidation = false, waiverDigests = [] } = {}) {
  const problems = [];
  if (!constraints || typeof constraints !== "object" || Array.isArray(constraints)
    || Object.keys(constraints).sort().join("\n") !== [...CONSTRAINT_KEYS].sort().join("\n")) {
    return [issue("INVALID_EXECUTION_CONSTRAINTS", String(childId))];
  }
  if (typeof constraints.implementationOwner !== "string" || !constraints.implementationOwner.trim()
    || !Array.isArray(constraints.riskClasses) || constraints.riskClasses.length === 0
    || new Set(constraints.riskClasses).size !== constraints.riskClasses.length
    || constraints.riskClasses.some((risk) => !/^[A-Z][A-Z0-9_]{0,63}$/u.test(risk))
    || !Array.isArray(constraints.waivers)) problems.push(issue("INVALID_EXECUTION_CONSTRAINTS", String(childId)));
  const risks = Array.isArray(constraints.riskClasses) ? constraints.riskClasses : [];
  const unknownRisks = unknownRiskClasses(risks);
  for (const risk of unknownRisks) problems.push(issue("UNKNOWN_RISK_CLASS", `${childId}:${risk}`));
  const waivers = validateWaivers(constraints.waivers, childId, problems);
  if (unknownRisks.length === 0) {
    if (risks.length >= 4 || risks.length === 3 && !(deferWaiverValidation
      ? waiverDigests.length > 0
      : exactWaiver(waivers, "RISK_CLASS_LIMIT", childId, { riskClasses: risks }))) {
      problems.push(issue("TOO_MANY_RISK_CLASSES", String(childId)));
    }
    if (risks.length >= 4 || riskClassesRequireSplit(risks)
      || !Array.isArray(constraints.primaryVerificationSeams) || constraints.primaryVerificationSeams.length !== 1) {
      problems.push(issue("TICKET_REQUIRES_SPLIT", String(childId)));
    }
  }
  const budget = constraints.scopeBudget ?? {};
  if (!Number.isInteger(budget.maxFiles) || budget.maxFiles < 1
    || !Number.isInteger(budget.maxChangedLines) || budget.maxChangedLines < 1) {
    problems.push(issue("SCOPE_BUDGET_TOO_LARGE", String(childId)));
  }
  const scopeException = { scopeBudget: { maxFiles: budget.maxFiles, maxChangedLines: budget.maxChangedLines }, mechanicalMigration: false };
  const mechanicalException = { scopeBudget: { maxFiles: budget.maxFiles, maxChangedLines: budget.maxChangedLines }, mechanicalMigration: true };
  if (budget.maxFiles > 8 || budget.maxChangedLines > 1500) {
    const allowed = deferWaiverValidation && waiverDigests.length > 0 || (budget.maxChangedLines > 2500
      ? exactWaiver(waivers, "MECHANICAL_MIGRATION", childId, mechanicalException)
      : exactWaiver(waivers, "SCOPE_BUDGET", childId, scopeException));
    if (!allowed) problems.push(issue("SCOPE_BUDGET_TOO_LARGE", String(childId)));
  }
  if (!Array.isArray(constraints.expectedPaths) || constraints.expectedPaths.length === 0 || constraints.expectedPaths.length > 8) {
    problems.push(issue("SCOPE_BUDGET_TOO_LARGE", String(childId)));
  } else if (constraints.expectedPaths.some((value) => !safeExpectedPath(value))) {
    problems.push(issue("INVALID_EXPECTED_PATH_PATTERN", String(childId)));
  }
  if (!Array.isArray(constraints.replanTriggers)
    || REQUIRED_REPLAN_TRIGGERS.some((trigger) => !constraints.replanTriggers.includes(trigger))) {
    problems.push(issue("MISSING_REPLAN_TRIGGERS", String(childId)));
  }
  if (!Array.isArray(constraints.protectedPaths) || constraints.protectedPaths.some((value) => !safeExactPath(value))) {
    problems.push(issue("MISSING_PROTECTED_ORACLE_PATH", String(childId)));
  }
  if (oraclePath && !constraints.protectedPaths?.includes(oraclePath)) {
    problems.push(issue("MISSING_PROTECTED_ORACLE_PATH", oraclePath));
  }
  for (const protectedPath of constraints.protectedPaths ?? []) {
    if ((constraints.expectedPaths ?? []).some((expected) => pathMatches(expected, protectedPath))) {
      problems.push(issue("PROTECTED_PATH_IN_EXPECTED_WRITE_SET", `${childId}:${protectedPath}`));
    }
  }
  if (constraints.integrationOnly !== null) {
    const integration = constraints.integrationOnly;
    if (!integration || integration.noNewProductBehavior !== true || integration.noSchemaChanges !== true
      || integration.noDuplicatedProductionLogic !== true || integration.missingBehavior !== "REPLAN_REQUIRED") {
      problems.push(issue("INTEGRATION_ONLY_CONTRACT_VIOLATION", String(childId)));
    }
  }
  return problems;
}

function graphProjection(parsed) {
  const constraints = parsed.executionConstraints;
  return {
    primaryVerificationSeams: constraints.primaryVerificationSeams,
    implementationOwner: constraints.implementationOwner,
    riskClasses: constraints.riskClasses,
    scopeBudget: constraints.scopeBudget,
    expectedPaths: constraints.expectedPaths,
    protectedPaths: constraints.protectedPaths,
    replanTriggers: constraints.replanTriggers,
    oracleBindingDigest: oracleBindingDigest(parsed.oracleBinding),
    integrationOnly: constraints.integrationOnly,
    waiverDigests: (constraints.waivers ?? []).map(({ digest }) => digest),
  };
}

function hotspotOverlap(graphChild, graphChildren) {
  return (graphChild.expectedPaths ?? []).filter((candidate) => graphChildren.some((other) => other !== graphChild
    && (other.expectedPaths ?? []).some((value) => patternsOverlap(candidate, value))));
}

export function ticketReviewProjection({ parsed, graphChild = null, graphChildren = [] }) {
  const constraints = parsed.executionConstraints;
  const oracle = parsed.oracleBinding;
  return {
    riskClasses: [...constraints.riskClasses],
    riskCount: constraints.riskClasses.length,
    primaryVerificationSeams: [...constraints.primaryVerificationSeams],
    scopeBudget: structuredClone(constraints.scopeBudget),
    expectedPaths: [...constraints.expectedPaths],
    protectedOraclePaths: oracle ? [oracle.artifact.path] : [],
    oracleBindingDigest: oracleBindingDigest(oracle),
    oracleBindingVerdict: oracle ? "PASS" : "NOT_APPLICABLE",
    replanTriggers: [...constraints.replanTriggers],
    codeHotspotOverlap: graphChild ? hotspotOverlap(graphChild, graphChildren) : [],
    integrationOnlyVerdict: constraints.integrationOnly === null ? "NOT_APPLICABLE" : "PASS",
    waiverDigests: (constraints.waivers ?? []).map(({ digest }) => digest),
  };
}

export function humanTicketReviewProjection() {
  return {
    riskClasses: [],
    riskCount: 0,
    primaryVerificationSeams: [],
    scopeBudget: null,
    expectedPaths: [],
    protectedOraclePaths: [],
    oracleBindingDigest: null,
    oracleBindingVerdict: "NOT_APPLICABLE",
    replanTriggers: [],
    codeHotspotOverlap: [],
    integrationOnlyVerdict: "NOT_APPLICABLE",
    waiverDigests: [],
  };
}

export function reviewProjectionRequiresSplit(projection) {
  const risks = projection?.riskClasses ?? [];
  return unknownRiskClasses(risks).length === 0 && (risks.length >= 4
    || riskClassesRequireSplit(risks)
    || !Array.isArray(projection?.primaryVerificationSeams) || projection.primaryVerificationSeams.length !== 1);
}

export function reviewCandidateMatchesTicketContract(candidate, projection, problems = []) {
  return [
    "riskClasses",
    "riskCount",
    "primaryVerificationSeams",
    "scopeBudget",
    "expectedPaths",
    "protectedOraclePaths",
    "oracleBindingDigest",
    "oracleBindingVerdict",
    "replanTriggers",
    "codeHotspotOverlap",
    "integrationOnlyVerdict",
    "waiverDigests",
  ].every((key) => same(candidate?.[key], projection[key]))
    && candidate?.verdict === ticketContractVerdict(problems);
}

export function ticketContractVerdict(problems) {
  return problems.length === 0 ? "READY" : problems.some(({ code }) => code === "TICKET_REQUIRES_SPLIT") ? "SPLIT" : "NEEDS_INFO";
}

export function staticGraphChildProblems(child) {
  const constraints = {
    implementationOwner: child?.implementationOwner,
    riskClasses: child?.riskClasses,
    scopeBudget: child?.scopeBudget,
    expectedPaths: child?.expectedPaths,
    protectedPaths: child?.protectedPaths,
    replanTriggers: child?.replanTriggers,
    primaryVerificationSeams: child?.primaryVerificationSeams,
    integrationOnly: child?.integrationOnly,
    waivers: [],
  };
  const problems = [];
  const oracleRequired = oracleRequiredForRiskClasses(child?.riskClasses);
  if (oracleRequired && !DIGEST.test(child?.oracleBindingDigest ?? "")) problems.push(issue("MISSING_ORACLE_BINDING", child?.id));
  if (!oracleRequired && child?.oracleBindingDigest !== null && !DIGEST.test(child?.oracleBindingDigest ?? "")) {
    problems.push(issue("MISSING_ORACLE_BINDING", child?.id));
  }
  problems.push(...staticConstraintsProblems(constraints, child?.id, null, {
    deferWaiverValidation: true,
    waiverDigests: child?.waiverDigests ?? [],
  }));
  return problems;
}

export function validateTicketContract({ repositoryPath, baseSha, child, graphChild = null, graphChildren = [] }) {
  const problems = [];
  let parsed;
  try { parsed = parseChildTicket(child?.body); } catch (error) {
    const code = /ORACLE_BINDING/u.test(error?.message ?? "") ? "MISSING_ORACLE_BINDING" : "INVALID_EXECUTION_CONSTRAINTS";
    return { ok: false, problems: [issue(code, String(child?.id ?? ""))], parsed: null, projection: null };
  }
  const resolvedBase = resolveBase(repositoryPath, baseSha, problems);
  const constraints = parsed.executionConstraints;
  const oracleRequired = oracleRequiredForRiskClasses(constraints.riskClasses);
  const oracle = validateOracleBinding(parsed.oracleBinding, {
    repo: repositoryPath,
    baseSha: resolvedBase ?? baseSha,
    implementationOwner: constraints.implementationOwner,
    required: oracleRequired,
  }, problems);
  problems.push(...staticConstraintsProblems(constraints, child.id, oracle?.artifact?.path));
  for (const verifierPath of oracleVerifierProtectedPaths(oracle ? [oracle] : [])) {
    if ((constraints.expectedPaths ?? []).some((expected) => pathMatches(expected, verifierPath))) {
      problems.push(issue("GLOBAL_ORACLE_VERIFIER_PATH_IN_WRITE_SET", `${child.id}:${verifierPath}`));
    }
  }
  if (graphChild) {
    try {
      const projected = graphProjection(parsed);
      for (const [key, value] of Object.entries(projected)) {
        if (!same(graphChild[key], value)) problems.push(issue("TICKET_CONTRACT_PROJECTION_MISMATCH", `${child.id}:${key}`));
      }
    } catch {
      problems.push(issue("INVALID_EXECUTION_CONSTRAINTS", String(child.id)));
    }
  }
  let projection = null;
  try { projection = ticketReviewProjection({ parsed, graphChild, graphChildren }); } catch {
    if (!problems.some(({ code }) => code === "INVALID_EXECUTION_CONSTRAINTS")) problems.push(issue("INVALID_EXECUTION_CONSTRAINTS", String(child.id)));
  }
  return { ok: problems.length === 0, problems, parsed, projection };
}
