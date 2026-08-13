import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DELIVERY_GRAPH_MARKER = "<!-- pi-ticket-planning:delivery-graph:v1 -->";

function issue(code, subject) {
  return subject ? { code, subject } : { code };
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function repeated(values) {
  return values.filter((value, index) => values.indexOf(value) !== index);
}

export function parseDeliveryGraph(text) {
  const source = text.trim();
  if (source.startsWith("{")) return JSON.parse(source);

  const sections = source.split(DELIVERY_GRAPH_MARKER);
  if (sections.length !== 2) throw new Error("expected exactly one delivery-graph marker");
  const match = sections[1].match(/^\s*```json\s*\n([\s\S]*?)\n```/);
  if (!match) throw new Error("delivery-graph marker must be followed by one JSON fence");
  return JSON.parse(match[1]);
}

export function validateDeliveryGraph(snapshot) {
  const contract = [];
  const coverage = [];
  const skeleton = [];
  const frontier = [];

  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    contract.push(issue("INVALID_SNAPSHOT"));
    return result(contract, coverage, skeleton, frontier);
  }

  if (snapshot.version !== 1) contract.push(issue("UNSUPPORTED_VERSION"));
  for (const field of ["identity", "revision", "baseSha"]) {
    if (!nonEmpty(snapshot.source?.[field])) contract.push(issue("MISSING_SOURCE_FIELD", field));
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
  }

  for (const child of children) {
    if (!nonEmpty(child?.id)) {
      contract.push(issue("MISSING_CHILD_ID"));
      continue;
    }
    if (!["DIRECT", "ENABLER"].includes(child.coverageRole)) {
      contract.push(issue("INVALID_COVERAGE_ROLE", child.id));
    }
    if (!Array.isArray(child.sourceScenarios) || child.sourceScenarios.length === 0) {
      coverage.push(issue("ORPHAN_CHILD", child.id));
    } else {
      for (const scenarioId of child.sourceScenarios) {
        if (!scenariosById.has(scenarioId)) contract.push(issue("UNKNOWN_SCENARIO", `${child.id}:${scenarioId}`));
      }
    }
    if (!Array.isArray(child.blockedBy)) {
      contract.push(issue("MISSING_BLOCKERS", child.id));
    } else {
      for (const blockerId of child.blockedBy) {
        if (!childrenById.has(blockerId)) contract.push(issue("UNKNOWN_BLOCKER", `${child.id}:${blockerId}`));
      }
    }

    if (child.coverageRole === "ENABLER") {
      if (!nonEmpty(child.exitCondition)) coverage.push(issue("MISSING_ENABLER_EXIT", child.id));
      if (!Array.isArray(child.downstreamConsumers) || child.downstreamConsumers.length === 0) {
        coverage.push(issue("MISSING_ENABLER_CONSUMER", child.id));
      }
      for (const consumerId of child.downstreamConsumers ?? []) {
        const consumer = childrenById.get(consumerId);
        if (!consumer?.blockedBy?.includes(child.id)) {
          coverage.push(issue("INVALID_ENABLER_EDGE", `${child.id}:${consumerId}`));
        }
      }
    }
  }

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
  if (walkingSkeleton.length === 0) {
    skeleton.push(issue("MISSING_WALKING_SKELETON"));
  } else {
    for (const id of new Set(repeated(walkingSkeleton))) skeleton.push(issue("DUPLICATE_SKELETON_CHILD", id));
    for (const id of walkingSkeleton) {
      if (!childrenById.has(id)) skeleton.push(issue("UNKNOWN_SKELETON_CHILD", id));
    }

    const skeletonPositions = new Map(walkingSkeleton.map((id, index) => [id, index]));
    for (const childId of walkingSkeleton) {
      const child = childrenById.get(childId);
      for (const blockerId of child?.blockedBy ?? []) {
        if (!skeletonPositions.has(blockerId) || skeletonPositions.get(blockerId) >= skeletonPositions.get(childId)) {
          skeleton.push(issue("INVALID_SKELETON_ORDER", `${blockerId}->${childId}`));
        }
      }
    }

    for (const scenario of scenarios) {
      if (!scenario?.smallestLoop) continue;
      const covered = walkingSkeleton.some((childId) => {
        const child = childrenById.get(childId);
        return child?.coverageRole === "DIRECT" && child.sourceScenarios?.includes(scenario.id);
      });
      if (!covered) skeleton.push(issue("SCENARIO_ABSENT_FROM_SKELETON", scenario.id));
    }

    const available = new Set();
    const seenScenarios = new Set();
    for (const childId of walkingSkeleton) {
      const child = childrenById.get(childId);
      for (const scenarioId of child?.sourceScenarios ?? []) {
        const scenario = scenariosById.get(scenarioId);
        if (!scenario?.smallestLoop || seenScenarios.has(scenarioId)) continue;
        seenScenarios.add(scenarioId);
        if (nonEmpty(scenario.entry) && !scenario.entry.startsWith("external:") && !available.has(scenario.entry)) {
          skeleton.push(issue("BROKEN_SCENARIO_HANDOFF", scenario.id));
        }
        if (nonEmpty(scenario.exit)) available.add(scenario.exit);
      }
    }
  }

  return result(contract, coverage, skeleton, frontier);
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
