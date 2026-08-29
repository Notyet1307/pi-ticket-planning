import path from "node:path";

import { parseChildTicket } from "../execution-plan/markdown.mjs";
import { readRegularBaseFile } from "./check-ticket-contract.mjs";

function issue(code, subject) {
  return subject === undefined ? { code } : { code, subject };
}

function canonicalId(value) {
  return String(value ?? "").replace(/^#/u, "");
}

function sameValues(left, right) {
  return [...left].sort().join("\n") === [...right].sort().join("\n");
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
  if (!safeExpectedPath(left) || !safeExpectedPath(right)) return false;
  if (left === right) return true;
  if (!left.includes("*") && pathMatches(right, left)) return true;
  if (!right.includes("*") && pathMatches(left, right)) return true;
  const leftPrefix = left.split("*", 1)[0];
  const rightPrefix = right.split("*", 1)[0];
  return Boolean(leftPrefix && rightPrefix && (leftPrefix.startsWith(rightPrefix) || rightPrefix.startsWith(leftPrefix)));
}

export function authorityProtectedPaths(graph) {
  const manifest = graph?.decisionManifest ?? {};
  return [...new Set([
    graph?.specAcceptanceBinding?.path,
    graph?.decisionManifestBinding?.path,
    graph?.predecessorReceiptBinding?.path,
    manifest.policy?.path,
    manifest.productRelease?.path,
    ...(manifest.decisions ?? []).map(({ path: entryPath }) => entryPath),
    ...(manifest.dependencyHandoffs ?? []).map(({ path: entryPath }) => entryPath),
  ].filter(safeExactPath))].sort();
}

export function graphReleaseClosureProblems(graph) {
  const problems = [];
  const children = Array.isArray(graph?.children) ? graph.children : [];
  const protectedAuthority = authorityProtectedPaths(graph);

  for (const child of children) {
    for (const authorityPath of protectedAuthority) {
      if ((child.expectedPaths ?? []).some((pattern) => pathMatches(pattern, authorityPath))) {
        problems.push(issue("AUTHORITY_PATH_IN_EXPECTED_WRITE_SET", `${child.id}:${authorityPath}`));
      }
    }
  }

  for (let leftIndex = 0; leftIndex < children.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < children.length; rightIndex += 1) {
      const left = children[leftIndex];
      const right = children[rightIndex];
      for (const leftPattern of left.expectedPaths ?? []) {
        for (const rightPattern of right.expectedPaths ?? []) {
          if (patternsOverlap(leftPattern, rightPattern)) {
            problems.push(issue("PATH_OWNERSHIP_OVERLAP", `${left.id}:${leftPattern}<->${right.id}:${rightPattern}`));
          }
        }
      }
    }
  }
  return problems;
}

function packageManifest(repositoryPath, baseSha, problems) {
  const bytes = readRegularBaseFile(repositoryPath, baseSha, "package.json");
  if (!bytes) {
    problems.push(issue("ORACLE_VALIDATION_CONFIG_MISSING", "package.json"));
    return null;
  }
  try {
    const manifest = JSON.parse(bytes.toString("utf8"));
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) || !manifest.scripts || typeof manifest.scripts !== "object") {
      throw new Error("invalid package manifest");
    }
    return manifest;
  } catch {
    problems.push(issue("ORACLE_VALIDATION_CONFIG_INVALID", "package.json"));
    return null;
  }
}

function directScriptPaths(repositoryPath, baseSha, source) {
  const matches = [...String(source).matchAll(/(?:^|[\s"'=])([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\.(?:cjs|cts|js|json|mjs|mts|sh|ts|txt))(?=$|[\s"';&|)])/gu)]
    .map((match) => match[1])
    .filter(safeExactPath);
  return [...new Set(matches.filter((candidate) => readRegularBaseFile(repositoryPath, baseSha, candidate) !== null))];
}

function verifierPaths(repositoryPath, baseSha, manifest, scriptName, problems, stack = new Set()) {
  if (stack.has(scriptName)) {
    problems.push(issue("ORACLE_VERIFIER_SCRIPT_CYCLE", scriptName));
    return [];
  }
  const source = manifest.scripts?.[scriptName];
  if (typeof source !== "string" || !source.trim()) {
    problems.push(issue("ORACLE_COMMAND_NOT_ALLOWED", `npm run ${scriptName}`));
    return [];
  }
  const next = new Set(stack);
  next.add(scriptName);
  const paths = directScriptPaths(repositoryPath, baseSha, source);
  for (const match of source.matchAll(/(?:^|&&|\|\||;)\s*npm\s+run\s+([A-Za-z0-9:_-]+)/gu)) {
    paths.push(...verifierPaths(repositoryPath, baseSha, manifest, match[1], problems, next));
  }
  return [...new Set(paths)];
}

export function oracleVerifierProtectionProblems({ repositoryPath, baseSha, children, graphChildren }) {
  const problems = [];
  const manifest = packageManifest(repositoryPath, baseSha, problems);
  if (!manifest) return problems;
  const graphById = new Map((graphChildren ?? []).map((child) => [canonicalId(child.id), child]));

  for (const child of children ?? []) {
    let parsed;
    try { parsed = parseChildTicket(child.body); } catch { continue; }
    const command = parsed.oracleBinding?.execution?.command;
    const match = typeof command === "string" ? command.match(/^npm run (verify:[A-Za-z0-9:_-]+)$/u) : null;
    if (!match) {
      problems.push(issue("ORACLE_COMMAND_NOT_ALLOWED", `${child.id}:${command ?? ""}`));
      continue;
    }
    const sources = verifierPaths(repositoryPath, baseSha, manifest, match[1], problems);
    if (sources.length === 0) {
      problems.push(issue("ORACLE_VERIFIER_SOURCE_MISSING", `${child.id}:${command}`));
    }
    const graphChild = graphById.get(canonicalId(child.id));
    for (const verifierPath of ["package.json", ...sources]) {
      if ((graphChild?.expectedPaths ?? []).some((pattern) => pathMatches(pattern, verifierPath))) {
        problems.push(issue("ORACLE_VERIFIER_PATH_IN_EXPECTED_WRITE_SET", `${child.id}:${verifierPath}`));
      }
    }
  }
  return problems;
}

export function oracleValidationCoverageProblems({ controllerConfig, children }) {
  const releaseCommands = new Set((controllerConfig?.validation?.release ?? [])
    .map((entry) => entry?.command)
    .filter((command) => typeof command === "string"));
  const problems = [];
  for (const child of children ?? []) {
    let parsed;
    try { parsed = parseChildTicket(child.body); } catch { continue; }
    const command = parsed.oracleBinding?.execution?.command;
    if (typeof command === "string" && !releaseCommands.has(command)) {
      problems.push(issue("ORACLE_VALIDATION_COMMAND_MISSING", `${child.id}:${command}`));
    }
  }
  return problems;
}

export function roadmapReleaseBindingProblems({ roadmap, graph, children }) {
  const problems = [];
  if (!roadmap || !graph) return problems;
  const current = (roadmap.plannedReleases ?? []).find(({ releaseId }) => releaseId === graph.releaseId);
  if (!current) return [issue("ROADMAP_RELEASE_MEMBERSHIP_MISMATCH", graph.releaseId)];

  const roadmapScenarios = current.scenarioCoverage ?? [];
  const graphScenarios = (graph.scenarios ?? []).map(({ id }) => id);
  if (!sameValues(roadmapScenarios, graphScenarios)) {
    problems.push(issue("ROADMAP_SCENARIO_COVERAGE_MISMATCH", graph.releaseId));
  }

  const plannedAgents = (current.candidateTickets ?? []).filter(({ executionLane }) => executionLane === "AGENT");
  const plannedById = new Map(plannedAgents.map((candidate) => [canonicalId(candidate.id), candidate]));
  const graphIds = (graph.children ?? []).map(({ id }) => canonicalId(id));
  if (!sameValues(plannedById.keys(), graphIds)) {
    problems.push(issue("ROADMAP_RELEASE_MEMBERSHIP_MISMATCH", graph.releaseId));
    return problems;
  }

  const liveById = new Map((children ?? []).map((child) => [canonicalId(child.id), child]));
  for (const graphChild of graph.children ?? []) {
    const id = canonicalId(graphChild.id);
    const planned = plannedById.get(id);
    const live = liveById.get(id);
    let objective = null;
    try { objective = parseChildTicket(live?.body).objective; } catch { /* owned by Ticket validation */ }
    if (!planned || planned.title !== graphChild.title || planned.executionLane !== "AGENT"
      || objective !== null && planned.objective !== objective) {
      problems.push(issue("ROADMAP_TICKET_IDENTITY_MISMATCH", id));
    }
  }
  return problems;
}
