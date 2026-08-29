import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { parseChildTicket } from "../execution-plan/markdown.mjs";
import { validateArtifact } from "../protocol/kernel.mjs";

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
const SPLIT_RISK_COMBINATIONS = [
  ["PROVIDER_ATTEMPT_RECOVERY", "PUBLICATION_RECOVERY"],
  ["PROVIDER_BOUNDARY", "DOMAIN_PERSISTENCE", "UI_BEHAVIOR"],
  ["REVIEWER_ELIGIBILITY", "WRITER_ELIGIBILITY", "ARTIFACT_ELIGIBILITY"],
  ["APPROVAL_BOUNDARY", "PUBLICATION_RECOVERY", "CRASH_RECOVERY"],
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

function safeExpectedPath(value) {
  return typeof value === "string" && value.length > 0
    && !path.posix.isAbsolute(value) && !path.win32.isAbsolute(value)
    && !value.includes("\\") && !value.split("/").includes("..")
    && !/[?[\]{}\u0000\r\n]/u.test(value) && !value.includes("**")
    && path.posix.normalize(value.replaceAll("*", "x")) === value.replaceAll("*", "x");
}

function globRegex(value) {
  return new RegExp(`^${value.split("*").map((part) => part.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&")).join("[^/]*")}$`, "u");
}

function pathMatches(pattern, value) {
  return safeExpectedPath(pattern) && safeExactPath(value) && globRegex(pattern).test(value);
}

function patternsOverlap(left, right) {
  if (left === right) return true;
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
  return ticketContractDigest(binding);
}

function validateOracleBinding(binding, { repo, baseSha, implementationOwner }, problems) {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
    problems.push(issue("MISSING_ORACLE_BINDING"));
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
  const waivers = validateWaivers(constraints.waivers, childId, problems);
  if (risks.length >= 4 || risks.length === 3 && !(deferWaiverValidation
    ? waiverDigests.length > 0
    : exactWaiver(waivers, "RISK_CLASS_LIMIT", childId, { riskClasses: risks }))) {
    problems.push(issue("TOO_MANY_RISK_CLASSES", String(childId)));
  }
  if (risks.length >= 4) problems.push(issue("TICKET_REQUIRES_SPLIT", String(childId)));
  if (SPLIT_RISK_COMBINATIONS.some((combination) => combination.every((risk) => risks.includes(risk)))
    || !Array.isArray(constraints.primaryVerificationSeams) || constraints.primaryVerificationSeams.length !== 1) {
    problems.push(issue("TICKET_REQUIRES_SPLIT", String(childId)));
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
  if (!Array.isArray(constraints.expectedPaths) || constraints.expectedPaths.length === 0 || constraints.expectedPaths.length > 8
    || constraints.expectedPaths.some((value) => !safeExpectedPath(value))) {
    problems.push(issue("SCOPE_BUDGET_TOO_LARGE", String(childId)));
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
  return {
    riskClasses: [...constraints.riskClasses],
    riskCount: constraints.riskClasses.length,
    primaryVerificationSeams: [...constraints.primaryVerificationSeams],
    scopeBudget: structuredClone(constraints.scopeBudget),
    expectedPaths: [...constraints.expectedPaths],
    protectedOraclePaths: [parsed.oracleBinding.artifact.path],
    oracleBindingDigest: oracleBindingDigest(parsed.oracleBinding),
    oracleBindingVerdict: "PASS",
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
  return risks.length >= 4
    || SPLIT_RISK_COMBINATIONS.some((combination) => combination.every((risk) => risks.includes(risk)))
    || !Array.isArray(projection?.primaryVerificationSeams) || projection.primaryVerificationSeams.length !== 1;
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
  if (!DIGEST.test(child?.oracleBindingDigest ?? "")) problems.push(issue("MISSING_ORACLE_BINDING", child?.id));
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
    const code = /Oracle binding/u.test(error?.message ?? "") ? "MISSING_ORACLE_BINDING" : "INVALID_EXECUTION_CONSTRAINTS";
    return { ok: false, problems: [issue(code, String(child?.id ?? ""))], parsed: null, projection: null };
  }
  const resolvedBase = resolveBase(repositoryPath, baseSha, problems);
  const constraints = parsed.executionConstraints;
  const oracle = validateOracleBinding(parsed.oracleBinding, {
    repo: repositoryPath,
    baseSha: resolvedBase ?? baseSha,
    implementationOwner: constraints.implementationOwner,
  }, problems);
  problems.push(...staticConstraintsProblems(constraints, child.id, oracle?.artifact?.path));
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
