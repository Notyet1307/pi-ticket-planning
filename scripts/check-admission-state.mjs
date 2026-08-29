import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  EXECUTABLE_DELIVERY_SPEC_MARKER,
  DELIVERY_GRAPH_MARKER,
  DELIVERY_GRAPH_MARKER_V1,
  DELIVERY_RELEASE_GRAPH_MARKER,
  ROADMAP_GRAPH_MARKER,
  ROADMAP_PARENT_MARKER,
  hashText,
  parseDeliveryGraph,
  validateDeliveryGraph,
  validateSpecAcceptance,
} from "./check-delivery-graph.mjs";
import { verifyCandidateContextChecks } from "./check-ticket-context.mjs";
import { validateTicketContract } from "./check-ticket-contract.mjs";

function issue(code, subject) {
  return subject ? { code, subject } : { code };
}

function canonicalId(value) {
  if (Number.isInteger(value) && value > 0) return String(value);
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return /^#\d+$/.test(trimmed) ? trimmed.slice(1) : trimmed;
}

function sameValues(left, right) {
  return [...left].sort().join("\n") === [...right].sort().join("\n");
}

function extractSpecScenarioIds(parentBody) {
  const heading = parentBody.match(/^## Behavioral scenarios[ \t]*$/m);
  if (!heading) return [];
  const start = heading.index + heading[0].length;
  const nextHeading = parentBody.slice(start).match(/^## (?!#)/m);
  const section = parentBody.slice(start, nextHeading ? start + nextHeading.index : parentBody.length);
  return [...section.matchAll(/^### (S[0-9]+):/gm)].map((match) => match[1]);
}

function isAncestor(repositoryPath, ancestor, descendant) {
  if (!path.isAbsolute(repositoryPath ?? "")) return false;
  const run = spawnSync("git", ["-C", repositoryPath, "merge-base", "--is-ancestor", ancestor, descendant], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  return !run.error && !run.signal && run.status === 0;
}

export function validateAdmissionState(bundle) {
  const problems = [];
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
    return result([issue("INVALID_ADMISSION_BUNDLE")]);
  }
  if (typeof bundle.parentBody !== "string") {
    return result([issue("MISSING_PARENT_BODY")]);
  }
  const parent = bundle.parent ?? {};

  let snapshot;
  try {
    snapshot = bundle.deliveryGraph && typeof bundle.deliveryGraph === "object"
      ? structuredClone(bundle.deliveryGraph)
      : parseDeliveryGraph(bundle.parentBody);
  } catch (error) {
    return result([issue("INVALID_DELIVERY_GRAPH", error instanceof Error ? error.message : String(error))]);
  }

  const graph = validateDeliveryGraph(snapshot, { isAncestor: (from, to) => isAncestor(bundle.repositoryPath, from, to) });
  problems.push(...graph.problems);
  if (snapshot?.schema === "pi-ticket-planning:roadmap-graph:v1" || snapshot?.kind === "ROADMAP") {
    problems.push(issue("ROADMAP_NOT_EXECUTABLE"));
    return result(problems, graph);
  }
  if (snapshot?.schema !== "pi-ticket-planning:delivery-release-graph:v3") {
    problems.push(issue("NEEDS_MIGRATION", "v2->v3"));
    return result(problems, graph);
  }
  if (!graph.executable) problems.push(...(graph.readinessProblems ?? [issue("RELEASE_NOT_GRAPH_REVIEWED")]));

  const roadmap = bundle.roadmapGraph;
  if (snapshot.roadmapDigest !== null || roadmap !== undefined && roadmap !== null) {
    const checked = validateDeliveryGraph(roadmap);
    if (roadmap?.schema !== "pi-ticket-planning:roadmap-graph:v1" || !checked.ok) {
      problems.push(issue("INVALID_ROADMAP_BINDING"));
    } else {
      const roadmapParent = bundle.roadmapParent;
      const roadmapParentMarkers = typeof roadmapParent?.body === "string"
        ? roadmapParent.body.split(ROADMAP_PARENT_MARKER).length - 1
        : 0;
      const roadmapParentHasGraph = typeof roadmapParent?.body === "string" && [
        EXECUTABLE_DELIVERY_SPEC_MARKER,
        ROADMAP_GRAPH_MARKER,
        DELIVERY_RELEASE_GRAPH_MARKER,
        DELIVERY_GRAPH_MARKER,
        DELIVERY_GRAPH_MARKER_V1,
      ].some((value) => roadmapParent.body.includes(value));
      if (!roadmapParent || String(roadmapParent.id) === String(parent.id)
        || Number(roadmapParent.id) !== roadmap.parent.number
        || roadmapParent.title !== roadmap.parent.title
        || hashText(roadmapParent.body ?? "") !== roadmap.parent.bodyHash
        || roadmapParentMarkers !== 1 || roadmapParentHasGraph) {
        problems.push(issue("ROADMAP_PARENT_MISMATCH"));
      }
      if (roadmap.digest !== snapshot.roadmapDigest) problems.push(issue("ROADMAP_BINDING_MISMATCH"));
      if (roadmap.planningBaseSha !== snapshot.planningBaseSha) problems.push(issue("ROADMAP_PLANNING_BASE_MISMATCH"));
      const current = roadmap.plannedReleases.find(({ releaseId }) => releaseId === snapshot.releaseId);
      const previous = roadmap.plannedReleases.find(({ releaseOrdinal }) => releaseOrdinal === snapshot.releaseOrdinal - 1);
      if (!current || current.releaseOrdinal !== snapshot.releaseOrdinal) problems.push(issue("ROADMAP_RELEASE_MISMATCH"));
      if (snapshot.releaseOrdinal > 1 && (!previous || previous.releaseId !== snapshot.predecessorReleaseId
        || !current?.predecessors?.includes(previous.releaseId))) problems.push(issue("ROADMAP_PREDECESSOR_MISMATCH"));
    }
  } else if (snapshot.releaseOrdinal > 1) {
    problems.push(issue("MISSING_ROADMAP_BINDING"));
  }

  if (bundle.source?.identity !== snapshot.source?.identity) problems.push(issue("SOURCE_IDENTITY_MISMATCH"));
  if (bundle.source?.revision !== snapshot.source?.revision) problems.push(issue("SOURCE_REVISION_MISMATCH"));
  if (bundle.source?.baseSha !== snapshot.executionBaseSha) problems.push(issue("SOURCE_BASE_SHA_MISMATCH"));
  if (bundle.source?.specContentHash !== undefined && bundle.source.specContentHash !== snapshot.source?.specContentHash) {
    problems.push(issue("SPEC_CONTENT_HASH_MISMATCH"));
  }

  const executableMarkers = bundle.parentBody.split(EXECUTABLE_DELIVERY_SPEC_MARKER).length - 1;
  const embeddedGraphMarker = [
    ROADMAP_PARENT_MARKER,
    ROADMAP_GRAPH_MARKER,
    DELIVERY_RELEASE_GRAPH_MARKER,
    DELIVERY_GRAPH_MARKER,
    DELIVERY_GRAPH_MARKER_V1,
  ].some((value) => bundle.parentBody.includes(value));
  if (executableMarkers !== 1 || embeddedGraphMarker) {
    problems.push(issue("PARENT_KIND_CONTRADICTION"));
  }
  const acceptance = snapshot.specAcceptance;
  const boundAcceptance = bundle.specAcceptance ?? bundle.spec?.acceptance;
  if (!boundAcceptance) problems.push(issue("MISSING_SPEC_ACCEPTANCE_RECEIPT"));
  else {
    problems.push(...validateSpecAcceptance(boundAcceptance));
    if (boundAcceptance.digest !== acceptance?.digest) problems.push(issue("SPEC_ACCEPTANCE_RECEIPT_MISMATCH"));
  }
  const parentMatches = Number(parent.id) === acceptance?.parent?.number
    && parent.title === acceptance?.parent?.title
    && hashText(bundle.parentBody) === acceptance?.parent?.bodyHash;
  if (!parentMatches) problems.push(issue("SPEC_ACCEPTANCE_RECEIPT_STALE"));
  if (/\bSPEC_IN_PROGRESS\b|\bnot\s+accepted\b|尚未接受|未接受/iu.test(bundle.parentBody)) {
    problems.push(issue("PARENT_ACCEPTANCE_CONTRADICTION"));
  }

  const specScenarioIds = extractSpecScenarioIds(bundle.parentBody);
  const graphScenarioIds = (snapshot.scenarios ?? []).map(({ id }) => id);
  if (!sameValues(specScenarioIds, graphScenarioIds)) {
    problems.push(issue("SPEC_SCENARIO_SET_MISMATCH"));
  }

  const liveChildren = Array.isArray(bundle.children) ? bundle.children : [];
  if (!Array.isArray(bundle.children)) problems.push(issue("MISSING_LIVE_CHILDREN"));
  problems.push(...verifyCandidateContextChecks({
    repositoryPath: bundle.repositoryPath,
    candidates: liveChildren,
    baseSha: snapshot.executionBaseSha,
    contextChecks: bundle.contextChecks,
  }));
  const liveIds = liveChildren.map(({ id }) => canonicalId(id));
  const snapshotIds = (snapshot.children ?? []).map(({ id }) => canonicalId(id));
  if (liveIds.some((id) => !id) || new Set(liveIds).size !== liveIds.length) {
    problems.push(issue("INVALID_LIVE_CHILD_SET"));
  }
  if (!sameValues(liveIds, snapshotIds)) {
    const missing = snapshotIds.filter((id) => !liveIds.includes(id));
    const unexpected = liveIds.filter((id) => !snapshotIds.includes(id));
    problems.push(issue("CHILD_SET_MISMATCH", `missing=${missing.join(",")};unexpected=${unexpected.join(",")}`));
  } else if (liveIds.join("\n") !== snapshotIds.join("\n")) {
    problems.push(issue("CHILD_ORDER_MISMATCH", `${snapshotIds.join(",")}!=${liveIds.join(",")}`));
  }

  const liveById = new Map(liveChildren.map((child) => [canonicalId(child.id), child]));
  const liveIdSet = new Set(liveIds);
  for (const child of snapshot.children ?? []) {
    const id = canonicalId(child.id);
    const live = liveById.get(id);
    if (!live) continue;
    if (typeof live.body !== "string" || hashText(live.body) !== child.bodyHash) {
      problems.push(issue("BODY_HASH_MISMATCH", id));
    }
    problems.push(...validateTicketContract({
      repositoryPath: bundle.repositoryPath,
      baseSha: snapshot.executionBaseSha,
      child: live,
      graphChild: child,
      graphChildren: snapshot.children,
    }).problems);
    if (/\bAccepted Delivery Spec\b|已接受(?:的)?\s*Delivery Spec/iu.test(live.body ?? "") && !parentMatches) {
      problems.push(issue("CHILD_ACCEPTANCE_WITHOUT_EXACT_RECEIPT", id));
    }

    if (!Array.isArray(live.blockedBy)) {
      problems.push(issue("INVALID_LIVE_BLOCKERS", id));
      continue;
    }
    const liveBlockers = live.blockedBy.map(canonicalId);
    const external = liveBlockers.filter((blockerId) => !liveIdSet.has(blockerId));
    if (external.length > 0) problems.push(issue("OPEN_EXTERNAL_BLOCKER", `${id}:${external.join(",")}`));
    const internal = liveBlockers.filter((blockerId) => liveIdSet.has(blockerId));
    const expected = (child.blockedBy ?? []).map(canonicalId);
    if (!sameValues(internal, expected)) {
      problems.push(issue("NATIVE_GRAPH_MISMATCH", `${id}:${expected.join(",")}!=${internal.join(",")}`));
    }
  }

  return result(problems, graph);
}

function result(problems, graph) {
  return {
    ok: problems.length === 0,
    verdict: problems.length === 0 ? "READY" : "NEEDS_INFO",
    deliveryGraph: graph?.ok ? "PASS" : "FAIL",
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
    const checked = validateAdmissionState(JSON.parse(input));
    console.log(JSON.stringify(checked, null, 2));
    if (!checked.ok) process.exitCode = 1;
  } catch (error) {
    console.error(`ERROR ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
