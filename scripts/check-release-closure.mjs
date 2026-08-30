import path from "node:path";

import { parseChildTicket } from "../execution-plan/markdown.mjs";
import { oracleVerifierProtectedPaths, pathMatches, patternsOverlap } from "./check-ticket-contract.mjs";

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

export function oracleVerifierProtectionProblems({ children, graphChildren }) {
  const problems = [];
  const graphById = new Map((graphChildren ?? []).map((child) => [canonicalId(child.id), child]));
  const bindings = [];
  for (const child of children ?? []) {
    try { bindings.push(parseChildTicket(child.body).oracleBinding); } catch { /* owned by Ticket validation */ }
  }
  const protectedPaths = oracleVerifierProtectedPaths(bindings);
  for (const child of children ?? []) {
    const graphChild = graphById.get(canonicalId(child.id));
    for (const verifierPath of protectedPaths) {
      if ((graphChild?.expectedPaths ?? []).some((pattern) => pathMatches(pattern, verifierPath))) {
        problems.push(issue("GLOBAL_ORACLE_VERIFIER_PATH_IN_WRITE_SET", `${child.id}:${verifierPath}`));
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
