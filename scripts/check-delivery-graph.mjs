import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateArtifact } from "../protocol/kernel.mjs";
import { staticGraphChildProblems } from "./check-ticket-contract.mjs";

export const DELIVERY_GRAPH_MARKER_V1 = "<!-- pi-ticket-planning:delivery-graph:v1 -->";
export const DELIVERY_GRAPH_MARKER = "<!-- pi-ticket-planning:delivery-graph:v2 -->";
export const ROADMAP_GRAPH_MARKER = "<!-- pi-ticket-planning:roadmap-graph:v1 -->";
export const DELIVERY_RELEASE_GRAPH_MARKER = "<!-- pi-ticket-planning:delivery-release-graph:v3 -->";
export const EXECUTABLE_DELIVERY_SPEC_MARKER = "<!-- pi-ticket-planning:parent-kind:executable-delivery-spec -->";
export const ROADMAP_PARENT_MARKER = "<!-- pi-ticket-planning:parent-kind:roadmap -->";
const DELIVERY_GRAPH_MARKERS = new Map([
  [DELIVERY_GRAPH_MARKER_V1, { version: 1 }],
  [DELIVERY_GRAPH_MARKER, { version: 2 }],
  [ROADMAP_GRAPH_MARKER, { schema: "pi-ticket-planning:roadmap-graph:v1" }],
  [DELIVERY_RELEASE_GRAPH_MARKER, { schema: "pi-ticket-planning:delivery-release-graph:v3" }],
]);
const SHA256 = /^sha256:[a-f0-9]{64}$/;

function issue(code, subject) {
  return subject ? { code, subject } : { code };
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function hashText(value) {
  if (typeof value !== "string") throw new TypeError("hash input must be a string");
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export function computeSpecContentHash(parentBody) {
  if (typeof parentBody !== "string") throw new TypeError("parent body must be a string");
  const matches = [...parentBody.matchAll(/^## Ticket coverage[ \t]*$/gm)];
  if (matches.length !== 1) throw new Error("expected exactly one Ticket coverage section");
  const start = matches[0].index;
  const afterHeading = start + matches[0][0].length;
  const nextHeading = parentBody.slice(afterHeading).match(/^## (?!#)/m);
  const end = nextHeading ? afterHeading + nextHeading.index : parentBody.length;
  const before = parentBody.slice(0, start).trimEnd();
  const after = parentBody.slice(end).trimStart();
  return hashText([before, after].filter(Boolean).join("\n\n"));
}

function repeated(values) {
  return values.filter((value, index) => values.indexOf(value) !== index);
}

function duplicateIssues(target, values, code, subjectPrefix) {
  if (!Array.isArray(values)) return;
  for (const value of new Set(repeated(values))) {
    target.push(issue(code, `${subjectPrefix}:${value}`));
  }
}

function findDependencyCycle(childrenById) {
  const visited = new Set();
  const visiting = new Set();
  const path = [];

  function visit(id) {
    if (visiting.has(id)) return [...path.slice(path.indexOf(id)), id];
    if (visited.has(id)) return undefined;
    visiting.add(id);
    path.push(id);
    for (const blockerId of childrenById.get(id)?.blockedBy ?? []) {
      if (!childrenById.has(blockerId) || blockerId === id) continue;
      const cycle = visit(blockerId);
      if (cycle) return cycle;
    }
    path.pop();
    visiting.delete(id);
    visited.add(id);
    return undefined;
  }

  for (const id of childrenById.keys()) {
    const cycle = visit(id);
    if (cycle) return cycle;
  }
  return undefined;
}

function validateWalkingSkeleton(walkingSkeleton, scenarios, scenariosById, childrenById) {
  const problems = [];
  if (walkingSkeleton.length === 0) return [issue("MISSING_WALKING_SKELETON")];

  for (const id of new Set(repeated(walkingSkeleton))) problems.push(issue("DUPLICATE_SKELETON_CHILD", id));
  for (const id of walkingSkeleton) {
    if (!childrenById.has(id)) problems.push(issue("UNKNOWN_SKELETON_CHILD", id));
  }

  const skeletonPositions = new Map(walkingSkeleton.map((id, index) => [id, index]));
  for (const childId of walkingSkeleton) {
    const child = childrenById.get(childId);
    for (const blockerId of child?.blockedBy ?? []) {
      if (!skeletonPositions.has(blockerId) || skeletonPositions.get(blockerId) >= skeletonPositions.get(childId)) {
        problems.push(issue("INVALID_SKELETON_ORDER", `${blockerId}->${childId}`));
      }
    }
  }

  for (const scenario of scenarios) {
    if (scenario?.smallestLoop !== true) continue;
    const covered = walkingSkeleton.some((childId) => {
      const child = childrenById.get(childId);
      return child?.coverageRole === "DIRECT" && child.sourceScenarios?.includes(scenario.id);
    });
    if (!covered) problems.push(issue("SCENARIO_ABSENT_FROM_SKELETON", scenario.id));
  }

  const available = new Set();
  const seenScenarios = new Set();
  for (const childId of walkingSkeleton) {
    const child = childrenById.get(childId);
    for (const scenarioId of child?.sourceScenarios ?? []) {
      const scenario = scenariosById.get(scenarioId);
      if (scenario?.smallestLoop !== true || seenScenarios.has(scenarioId)) continue;
      seenScenarios.add(scenarioId);
      if (nonEmpty(scenario.entry) && !scenario.entry.startsWith("external:") && !available.has(scenario.entry)) {
        problems.push(issue("BROKEN_SCENARIO_HANDOFF", scenario.id));
      }
      if (nonEmpty(scenario.exit)) available.add(scenario.exit);
    }
  }

  return problems;
}

export function parseDeliveryGraph(text) {
  const source = text.trim();
  if (source.startsWith("{")) return JSON.parse(source);

  const occurrences = [];
  for (const [marker, identity] of DELIVERY_GRAPH_MARKERS) {
    let offset = source.indexOf(marker);
    while (offset !== -1) {
      occurrences.push({ marker, identity, offset });
      offset = source.indexOf(marker, offset + marker.length);
    }
  }
  if (occurrences.length !== 1) throw new Error("expected exactly one delivery-graph marker");
  const [{ marker, identity, offset }] = occurrences;
  const match = source.slice(offset + marker.length).match(/^\s*```json\s*\n([\s\S]*?)\n```/);
  if (!match) throw new Error("delivery-graph marker must be followed by one JSON fence");
  const snapshot = JSON.parse(match[1]);
  if (identity.version !== undefined && snapshot.version !== identity.version) {
    throw new Error(`delivery-graph marker v${identity.version} does not match snapshot version`);
  }
  if (identity.schema !== undefined && snapshot.schema !== identity.schema) {
    throw new Error("delivery artifact marker does not match snapshot schema");
  }
  return snapshot;
}

function validateLegacyDeliveryGraph(snapshot) {
  const contract = [];
  const coverage = [];
  const skeleton = [];
  const frontier = [];

  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    contract.push(issue("INVALID_SNAPSHOT"));
    return result(contract, coverage, skeleton, frontier);
  }

  try {
    const structural = validateArtifact(snapshot, { identity: `pi-ticket-planning:delivery-graph:v${snapshot.version}` });
    contract.push(...structural.problems);
  } catch {
    contract.push(issue("INVALID_DELIVERY_GRAPH_ARTIFACT"));
  }

  if (snapshot.version === 1) contract.push(issue("NEEDS_MIGRATION", "v1->v3"));
  else if (snapshot.version !== 2) contract.push(issue("UNSUPPORTED_VERSION"));
  for (const field of ["identity", "revision", "baseSha"]) {
    if (!nonEmpty(snapshot.source?.[field])) contract.push(issue("MISSING_SOURCE_FIELD", field));
  }
  if (snapshot.version === 2 && !SHA256.test(snapshot.source?.specContentHash ?? "")) {
    contract.push(issue("MISSING_SPEC_CONTENT_HASH"));
  }

  const scenarios = Array.isArray(snapshot.scenarios) ? snapshot.scenarios : [];
  const children = Array.isArray(snapshot.children) ? snapshot.children : [];
  if (scenarios.length === 0) contract.push(issue("MISSING_SCENARIOS"));
  if (children.length === 0) contract.push(issue("MISSING_CHILDREN"));

  const scenarioIds = scenarios.map((item) => item?.id).filter(nonEmpty);
  const childIds = children.map((item) => item?.id).filter(nonEmpty);
  for (const id of new Set(repeated(scenarioIds))) contract.push(issue("DUPLICATE_SCENARIO", id));
  for (const id of new Set(repeated(childIds))) contract.push(issue("DUPLICATE_CHILD", id));

  const scenariosById = new Map(scenarios.filter((item) => nonEmpty(item?.id)).map((item) => [item.id, item]));
  const childrenById = new Map(children.filter((item) => nonEmpty(item?.id)).map((item) => [item.id, item]));

  for (const scenario of scenarios) {
    if (!nonEmpty(scenario?.id)) {
      contract.push(issue("MISSING_SCENARIO_ID"));
      continue;
    }
    if (!nonEmpty(scenario.entry) || !nonEmpty(scenario.exit)) {
      contract.push(issue("MISSING_SCENARIO_HANDOFF", scenario.id));
    }
    for (const field of ["behavior", "releaseSignal"]) {
      if (!nonEmpty(scenario[field])) contract.push(issue("MISSING_SCENARIO_FIELD", `${scenario.id}:${field}`));
    }
    if (typeof scenario.smallestLoop !== "boolean") {
      contract.push(issue("INVALID_SMALLEST_LOOP_TYPE", scenario.id));
    }
  }
  if (!scenarios.some((scenario) => scenario?.smallestLoop === true)) {
    contract.push(issue("MISSING_SMALLEST_LOOP"));
  }

  for (const child of children) {
    if (!nonEmpty(child?.id)) {
      contract.push(issue("MISSING_CHILD_ID"));
      continue;
    }
    if (!["DIRECT", "ENABLER"].includes(child.coverageRole)) {
      contract.push(issue("INVALID_COVERAGE_ROLE", child.id));
    }
    for (const field of ["title", "primaryVerification"]) {
      if (!nonEmpty(child[field])) contract.push(issue("MISSING_CHILD_FIELD", `${child.id}:${field}`));
    }
    if (snapshot.version === 2) {
      if (!SHA256.test(child.bodyHash ?? "")) contract.push(issue("MISSING_CHILD_BODY_HASH", child.id));
      if (!nonEmpty(child.startingState)) contract.push(issue("MISSING_CHILD_STARTING_STATE", child.id));
    }
    if (!["AGENT", "HUMAN"].includes(child.executionLane)) {
      contract.push(issue("INVALID_EXECUTION_LANE", child.id));
    }
    if (!Array.isArray(child.sourceScenarios) || child.sourceScenarios.length === 0) {
      coverage.push(issue("ORPHAN_CHILD", child.id));
    } else {
      duplicateIssues(contract, child.sourceScenarios, "DUPLICATE_SOURCE_SCENARIO", child.id);
      for (const scenarioId of child.sourceScenarios) {
        if (!scenariosById.has(scenarioId)) contract.push(issue("UNKNOWN_SCENARIO", `${child.id}:${scenarioId}`));
      }
    }
    if (!Array.isArray(child.blockedBy)) {
      contract.push(issue("MISSING_BLOCKERS", child.id));
    } else {
      duplicateIssues(contract, child.blockedBy, "DUPLICATE_BLOCKER", child.id);
      for (const blockerId of child.blockedBy) {
        if (!childrenById.has(blockerId)) contract.push(issue("UNKNOWN_BLOCKER", `${child.id}:${blockerId}`));
        if (blockerId === child.id) contract.push(issue("SELF_DEPENDENCY", child.id));
      }
    }
    if (child.externalBlockers !== undefined) {
      if (!Array.isArray(child.externalBlockers) || child.externalBlockers.some((blocker) => !nonEmpty(blocker))) {
        contract.push(issue("INVALID_EXTERNAL_BLOCKERS", child.id));
      } else if (child.externalBlockers.length > 0) {
        frontier.push(issue("OPEN_EXTERNAL_BLOCKER", child.id));
      }
    }

    if (child.coverageRole === "ENABLER") {
      if (!nonEmpty(child.exitCondition)) coverage.push(issue("MISSING_ENABLER_EXIT", child.id));
      if (!Array.isArray(child.downstreamConsumers) || child.downstreamConsumers.length === 0) {
        coverage.push(issue("MISSING_ENABLER_CONSUMER", child.id));
      }
      duplicateIssues(contract, child.downstreamConsumers, "DUPLICATE_DOWNSTREAM_CONSUMER", child.id);
      for (const consumerId of child.downstreamConsumers ?? []) {
        const consumer = childrenById.get(consumerId);
        if (!consumer?.blockedBy?.includes(child.id)) {
          coverage.push(issue("INVALID_ENABLER_EDGE", `${child.id}:${consumerId}`));
        }
      }
    }
  }

  const dependencyCycle = findDependencyCycle(childrenById);
  if (dependencyCycle) frontier.push(issue("DEPENDENCY_CYCLE", dependencyCycle.join("->")));

  for (const scenario of scenarios) {
    if (!nonEmpty(scenario?.id)) continue;
    const direct = children.some(
      (child) => child.coverageRole === "DIRECT" && child.sourceScenarios?.includes(scenario.id),
    );
    if (!direct) coverage.push(issue("UNCOVERED_SCENARIO", scenario.id));
  }

  const positions = new Map(children.map((child, index) => [child?.id, index]));
  for (const child of children) {
    for (const blockerId of child.blockedBy ?? []) {
      if (positions.has(blockerId) && positions.get(blockerId) >= positions.get(child.id)) {
        frontier.push(issue("INVALID_FRONTIER_ORDER", `${blockerId}->${child.id}`));
      }
    }
  }

  const walkingSkeleton = Array.isArray(snapshot.walkingSkeleton) ? snapshot.walkingSkeleton : [];
  const skeletonProblems = validateWalkingSkeleton(walkingSkeleton, scenarios, scenariosById, childrenById);
  skeleton.push(...skeletonProblems);
  if (skeletonProblems.length === 0 && walkingSkeleton.length > 1) {
    for (let index = 0; index < walkingSkeleton.length; index += 1) {
      const reduced = walkingSkeleton.toSpliced(index, 1);
      if (validateWalkingSkeleton(reduced, scenarios, scenariosById, childrenById).length === 0) {
        skeleton.push(issue("REDUNDANT_SKELETON_CHILD", walkingSkeleton[index]));
      }
    }
  }

  return result(contract, coverage, skeleton, frontier);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function exactDigest(value) {
  const { digest, ...body } = value ?? {};
  return SHA256.test(digest ?? "") && hashText(JSON.stringify(canonical(body))) === digest;
}

export function validateSpecAcceptance(receipt) {
  const problems = [];
  try {
    const checked = validateArtifact(receipt, { identity: "pi-ticket-planning:spec-acceptance:v1" });
    problems.push(...checked.problems);
  } catch {
    problems.push(issue("INVALID_SPEC_ACCEPTANCE_RECEIPT"));
    return problems;
  }
  if (!exactDigest(receipt)) problems.push(issue("SPEC_ACCEPTANCE_DIGEST_MISMATCH"));
  return problems;
}

export function validatePredecessorReceipt(receipt) {
  const problems = [];
  try {
    const checked = validateArtifact(receipt, { identity: "pi-ticket-planning:release-predecessor-receipt:v1" });
    problems.push(...checked.problems);
  } catch {
    problems.push(issue("INVALID_PREDECESSOR_RECEIPT"));
    return problems;
  }
  if (!exactDigest(receipt)) problems.push(issue("PREDECESSOR_RECEIPT_DIGEST_MISMATCH"));
  return problems;
}

function validateRoadmap(snapshot) {
  const problems = [];
  try {
    problems.push(...validateArtifact(snapshot, { identity: "pi-ticket-planning:roadmap-graph:v1" }).problems);
  } catch {
    problems.push(issue("INVALID_ROADMAP_ARTIFACT"));
  }
  if (!exactDigest(snapshot)) problems.push(issue("ROADMAP_DIGEST_MISMATCH"));
  const ids = (snapshot.plannedReleases ?? []).map(({ releaseId }) => releaseId);
  const ordinals = (snapshot.plannedReleases ?? []).map(({ releaseOrdinal }) => releaseOrdinal);
  duplicateIssues(problems, ids, "DUPLICATE_RELEASE_ID", "roadmap");
  duplicateIssues(problems, ordinals, "DUPLICATE_RELEASE_ORDINAL", "roadmap");
  return {
    ok: problems.length === 0,
    verdict: problems.length === 0 ? "PLANNED" : "NEEDS_INFO",
    executable: false,
    contract: problems.length === 0 ? "PASS" : "FAIL",
    scenarioCoverage: "NOT_APPLICABLE",
    walkingSkeleton: "NOT_APPLICABLE",
    strictFrontier: "NOT_APPLICABLE",
    problems,
  };
}

function validateExecutableRelease(snapshot) {
  const contract = [];
  for (const child of snapshot.children ?? []) contract.push(...staticGraphChildProblems(child));
  try {
    contract.push(...validateArtifact(snapshot, { identity: "pi-ticket-planning:delivery-release-graph:v3" }).problems);
  } catch {
    contract.push(issue("INVALID_DELIVERY_RELEASE_GRAPH"));
  }
  if (Array.isArray(snapshot.plannedReleases) || Array.isArray(snapshot.releases)) {
    contract.push(issue("MULTIPLE_RELEASES_NOT_EXECUTABLE"));
  }
  if ((snapshot.children ?? []).some(({ executionLane }) => executionLane === "HUMAN")) {
    contract.push(issue("HUMAN_CHILD_NOT_EXECUTABLE"));
  }
  if ((snapshot.children ?? []).some(({ externalBlockers }) => (externalBlockers ?? []).length > 0)) {
    contract.push(issue("OPEN_EXTERNAL_BLOCKER"));
  }
  const maxChildren = snapshot.childPolicy?.maxChildren ?? 4;
  if ((snapshot.children?.length ?? 0) > maxChildren) contract.push(issue("CHILD_COUNT_POLICY_EXCEEDED", `${snapshot.children.length}>${maxChildren}`));
  contract.push(...validateSpecAcceptance(snapshot.specAcceptance));
  if (snapshot.specAcceptance?.source?.baseSha !== snapshot.planningBaseSha
    || snapshot.specAcceptance?.source?.specContentHash !== snapshot.source?.specContentHash) {
    contract.push(issue("SPEC_ACCEPTANCE_SOURCE_MISMATCH"));
  }
  if (snapshot.releaseOrdinal === 1 && snapshot.predecessorReceipt !== null) {
    contract.push(issue("UNEXPECTED_PREDECESSOR_RECEIPT"));
  }
  if (snapshot.releaseOrdinal === 1 && snapshot.predecessorReleaseId !== null) {
    contract.push(issue("UNEXPECTED_PREDECESSOR_RELEASE"));
  }
  if (snapshot.releaseOrdinal > 1) {
    if (!SHA256.test(snapshot.roadmapDigest ?? "")) contract.push(issue("MISSING_ROADMAP_BINDING"));
    if (!nonEmpty(snapshot.predecessorReleaseId)) contract.push(issue("MISSING_PREDECESSOR_RELEASE"));
    if (!snapshot.predecessorReceipt) contract.push(issue("MISSING_PREDECESSOR_RECEIPT"));
    else {
      contract.push(...validatePredecessorReceipt(snapshot.predecessorReceipt));
      if (snapshot.predecessorReceipt.releaseId !== snapshot.predecessorReleaseId) {
        contract.push(issue("PREDECESSOR_RELEASE_MISMATCH"));
      }
      if (snapshot.executionBaseSha !== snapshot.predecessorReceipt.mergedMainSha) {
        contract.push(issue("PREDECESSOR_EXECUTION_BASE_MISMATCH"));
      }
    }
  }
  const semantic = validateLegacyDeliveryGraph({
    version: 2,
    source: {
      identity: snapshot.source?.identity,
      revision: snapshot.source?.revision,
      baseSha: snapshot.executionBaseSha,
      specContentHash: snapshot.source?.specContentHash,
    },
    scenarios: snapshot.scenarios,
    children: snapshot.children,
    walkingSkeleton: snapshot.walkingSkeleton,
  });
  const semanticProblems = semantic.problems.filter(({ code }) => code !== "ARTIFACT_SCHEMA_INVALID");
  const problems = [...contract, ...semanticProblems];
  const readinessProblems = ["GRAPH_REVIEWED", "HANDOFF_APPROVED", "HANDOFF_READY"].includes(snapshot.readinessState)
    ? []
    : [issue("RELEASE_NOT_GRAPH_REVIEWED", snapshot.readinessState)];
  return {
    ok: problems.length === 0,
    verdict: problems.length > 0 ? "NEEDS_INFO" : readinessProblems.length === 0 ? "READY" : snapshot.readinessState,
    executable: problems.length === 0 && readinessProblems.length === 0,
    contract: contract.length === 0 && semantic.contract === "PASS" ? "PASS" : "FAIL",
    scenarioCoverage: semantic.scenarioCoverage,
    walkingSkeleton: semantic.walkingSkeleton,
    strictFrontier: semantic.strictFrontier,
    readinessProblems,
    problems,
  };
}

export function validateDeliveryGraph(snapshot) {
  if (snapshot?.schema === "pi-ticket-planning:roadmap-graph:v1" || snapshot?.kind === "ROADMAP") {
    return validateRoadmap(snapshot);
  }
  if (snapshot?.schema === "pi-ticket-planning:delivery-release-graph:v3" || snapshot?.kind === "EXECUTABLE_RELEASE") {
    return validateExecutableRelease(snapshot);
  }
  const legacy = validateLegacyDeliveryGraph(snapshot);
  return snapshot?.version === 2
    ? {
        ...legacy,
        ok: false,
        verdict: "NEEDS_MIGRATION",
        executable: false,
        migration: "NEEDS_MIGRATION",
        legacyVerdict: legacy.verdict,
        problems: [...legacy.problems, issue("NEEDS_MIGRATION", "v2->v3")],
      }
    : legacy;
}

function result(contract, coverage, skeleton, frontier) {
  const problems = [...contract, ...coverage, ...skeleton, ...frontier];
  return {
    ok: problems.length === 0,
    verdict: problems.length === 0 ? "READY" : "NEEDS_INFO",
    contract: contract.length === 0 ? "PASS" : "FAIL",
    scenarioCoverage: coverage.length === 0 ? "PASS" : "FAIL",
    walkingSkeleton: skeleton.length === 0 ? "PASS" : "FAIL",
    strictFrontier: frontier.length === 0 ? "PASS" : "FAIL",
    problems,
  };
}

const ownPath = fs.realpathSync(fileURLToPath(import.meta.url));
if (process.argv[1] && fs.realpathSync(process.argv[1]) === ownPath) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== "--input") {
      throw new Error("usage: --input FILE_OR_DASH");
    }
    const input = process.argv[3] === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(path.resolve(process.argv[3]), "utf8");
    const checked = validateDeliveryGraph(parseDeliveryGraph(input));
    console.log(JSON.stringify(checked, null, 2));
    if (!checked.ok) process.exitCode = 1;
  } catch (error) {
    console.error(`ERROR ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
