import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeSpecContentHash,
  hashText,
  parseDeliveryGraph,
  validateDeliveryGraph,
} from "./check-delivery-graph.mjs";
import { verifyCandidateContextChecks } from "./check-ticket-context.mjs";

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

export function validateAdmissionState(bundle) {
  const problems = [];
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
    return result([issue("INVALID_ADMISSION_BUNDLE")]);
  }
  if (typeof bundle.parentBody !== "string") {
    return result([issue("MISSING_PARENT_BODY")]);
  }

  let snapshot;
  try {
    snapshot = parseDeliveryGraph(bundle.parentBody);
  } catch (error) {
    return result([issue("INVALID_DELIVERY_GRAPH", error instanceof Error ? error.message : String(error))]);
  }

  const graph = validateDeliveryGraph(snapshot);
  problems.push(...graph.problems);

  for (const [field, code] of [
    ["identity", "SOURCE_IDENTITY_MISMATCH"],
    ["revision", "SOURCE_REVISION_MISMATCH"],
    ["baseSha", "SOURCE_BASE_SHA_MISMATCH"],
  ]) {
    if (bundle.source?.[field] !== snapshot.source?.[field]) problems.push(issue(code));
  }

  try {
    if (computeSpecContentHash(bundle.parentBody) !== snapshot.source?.specContentHash) {
      problems.push(issue("SPEC_CONTENT_HASH_MISMATCH"));
    }
  } catch (error) {
    problems.push(issue("INVALID_SPEC_CONTENT", error instanceof Error ? error.message : String(error)));
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
    baseSha: snapshot.source?.baseSha,
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
