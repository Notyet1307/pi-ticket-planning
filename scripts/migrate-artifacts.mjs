import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseLegacyCheckpoint } from "../protocol/legacy-adapter.mjs";
import { validateArtifact } from "../protocol/kernel.mjs";
import { predecessorReleaseResult, validateDeliveryGraph } from "./check-delivery-graph.mjs";
import { fingerprint } from "../execution-plan/domain.mjs";

const digest = (value) => `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;

export function migrateCheckpointV1(line, context) {
  try {
    return parseLegacyCheckpoint(line, context);
  } catch (error) {
    if (error?.code === "LEGACY_CONTEXT_INCOMPLETE") throw new Error("Checkpoint migration context is incomplete");
    throw error;
  }
}

export function inspectLegacyCheckpointForEvaluation(line, { target = "eval:pi-behavior", observedAt = new Date(0).toISOString() } = {}) {
  const match = typeof line === "string"
    ? line.trim().match(/^Checkpoint: ([A-Z]+)\/([A-Z_]+) · ([^\s·]+) · ([A-Z_]+)$/)
    : null;
  if (!match) throw new Error("INVALID_LEGACY_CHECKPOINT");
  const identity = match[3];
  const kind = identity === "NONE" ? "none" : identity.includes("@") ? "ticket" : "release";
  const separator = kind === "ticket" ? "@" : "/";
  const parts = kind === "none" ? ["NONE", "0"] : identity.split(separator);
  if (parts.length !== 2) throw new Error("INVALID_LEGACY_CHECKPOINT");
  return migrateCheckpointV1(line, {
    target,
    subject: { target, kind, id: parts[0], revision: parts[1], digest: digest({ target, identity }) },
    observedAt,
    producer: { name: "pi-behavior-evaluator", version: "1", digest: digest({ component: "scripts/eval-pi-behavior.mjs" }) },
  });
}

export function migrateDeliveryGraphV1(value, context) {
  if (value?.version !== 1) throw new Error("Delivery Graph migration requires v1");
  if (!/^sha256:[a-f0-9]{64}$/.test(context?.specContentHash ?? "") || !context?.children) {
    throw new Error("Delivery Graph migration context is incomplete");
  }
  const children = value.children.map((child) => {
    const supplied = context.children[child.id];
    if (!/^sha256:[a-f0-9]{64}$/.test(supplied?.bodyHash ?? "") || typeof supplied?.startingState !== "string" || !supplied.startingState) {
      throw new Error(`Delivery Graph migration context is incomplete for ${child.id}`);
    }
    return { ...child, externalBlockers: child.externalBlockers ?? [], bodyHash: supplied.bodyHash, startingState: supplied.startingState };
  });
  return { ...structuredClone(value), version: 2, source: { ...value.source, specContentHash: context.specContentHash }, children };
}

function exactObject(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join("\n") !== [...keys].sort().join("\n")) throw new Error(`Delivery Graph v2 migration context is incomplete: ${label}`);
  return value;
}

function childContract(context, id) {
  return structuredClone(exactObject(context?.childContracts?.[id], [
    "primaryVerificationSeams",
    "implementationOwner",
    "riskClasses",
    "scopeBudget",
    "expectedPaths",
    "protectedPaths",
    "replanTriggers",
    "oracleBindingDigest",
    "integrationOnly",
    "waiverDigests",
  ], `child ${id}`));
}

function v3Candidate(value, context, childIds) {
  const release = exactObject(context?.release, [
    "releaseId",
    "releaseOrdinal",
    "planningBaseSha",
    "executionBaseSha",
    "executionBasePolicy",
    "roadmapDigest",
    "predecessorReleaseId",
    "predecessorPlanDigest",
    "predecessorReceipt",
    "predecessorReceiptBinding",
    "specAcceptance",
    "specAcceptanceBinding",
    "decisionManifest",
    "decisionManifestBinding",
  ], "release");
  const selected = value.children.filter(({ id }) => childIds.includes(String(id)));
  if (selected.length !== childIds.length || selected.some(({ executionLane, externalBlockers }) => executionLane !== "AGENT" || externalBlockers.length > 0)) {
    throw new Error("Delivery Graph v2 migration current Release is not one unblocked AGENT tranche");
  }
  const candidate = {
    schema: "pi-ticket-planning:delivery-release-graph:v3",
    kind: "EXECUTABLE_RELEASE",
    executable: true,
    readinessState: "PLANNED",
    releaseId: release.releaseId,
    releaseOrdinal: release.releaseOrdinal,
    planningBaseSha: release.planningBaseSha,
    executionBaseSha: release.executionBaseSha,
    executionBasePolicy: release.executionBasePolicy,
    roadmapDigest: release.roadmapDigest,
    predecessorReleaseId: release.predecessorReleaseId,
    predecessorPlanDigest: predecessorReleaseResult(release.predecessorReceipt)?.planDigest ?? null,
    predecessorReceipt: structuredClone(release.predecessorReceipt),
    predecessorReceiptBinding: structuredClone(release.predecessorReceiptBinding),
    specAcceptance: structuredClone(release.specAcceptance),
    specAcceptanceBinding: structuredClone(release.specAcceptanceBinding),
    decisionManifest: structuredClone(release.decisionManifest),
    decisionManifestBinding: structuredClone(release.decisionManifestBinding),
    decisionManifestDigest: release.decisionManifestBinding?.sha256,
    source: { identity: value.source.identity, revision: value.source.revision, specContentHash: value.source.specContentHash },
    scenarios: structuredClone(value.scenarios),
    children: selected.map((child) => ({ ...structuredClone(child), ...childContract(context, String(child.id)) })),
    walkingSkeleton: value.walkingSkeleton.filter((id) => childIds.includes(String(id))),
  };
  const checked = validateDeliveryGraph(candidate, { requireAncestry: false });
  if (checked.problems.length > 0) throw new Error(`Delivery Graph v2 migration context is incomplete: ${checked.problems[0].code}`);
  return candidate;
}

export function migrateDeliveryGraphV2(value, context) {
  if (value?.version !== 2) throw new Error("Delivery Graph v2 migration requires v2");
  const checked = validateArtifact(value, { identity: "pi-ticket-planning:delivery-graph:v2" });
  if (!checked.ok) throw new Error("Delivery Graph v2 migration input is invalid");
  let explicitSingle = false;
  if (context?.releaseMembership !== undefined) {
    const membership = exactObject(context.releaseMembership, ["singleCurrentRelease", "releaseId", "childIds"], "releaseMembership");
    const childIds = value.children.map(({ id }) => String(id));
    if (membership.singleCurrentRelease !== true || membership.releaseId !== context.release?.releaseId
      || !Array.isArray(membership.childIds) || membership.childIds.map(String).join("\n") !== childIds.join("\n")) {
      throw new Error("Delivery Graph v2 migration release membership is invalid");
    }
    explicitSingle = true;
  }
  const simple = explicitSingle
    && value.children.every(({ executionLane, externalBlockers }) => executionLane === "AGENT" && externalBlockers.length === 0);
  const sourceDigest = fingerprint(value);
  if (simple) {
    return {
      migration: "v2-to-v3",
      kind: "EXECUTABLE_RELEASE_CANDIDATE",
      requiresHumanApproval: true,
      sourceDigest,
      currentReleaseCandidate: v3Candidate(value, context, value.children.map(({ id }) => String(id))),
    };
  }
  const roadmap = structuredClone(context?.roadmapCandidate);
  const roadmapCheck = validateDeliveryGraph(roadmap);
  if (roadmap?.schema !== "pi-ticket-planning:roadmap-graph:v1" || !roadmapCheck.ok) {
    throw new Error("Delivery Graph v2 migration context is incomplete: roadmapCandidate");
  }
  const currentIds = context?.currentReleaseChildIds;
  if (!Array.isArray(currentIds) || new Set(currentIds.map(String)).size !== currentIds.length) {
    throw new Error("Delivery Graph v2 migration context is incomplete: currentReleaseChildIds");
  }
  return {
    migration: "v2-to-v3",
    kind: "ROADMAP_AND_CURRENT_RELEASE_CANDIDATES",
    requiresHumanApproval: true,
    sourceDigest,
    roadmapCandidate: roadmap,
    currentReleaseCandidate: currentIds.length > 0 ? v3Candidate(value, context, currentIds.map(String)) : null,
  };
}

function migrationOptions(argv) {
  const allowed = new Set(["--artifact", "--input", "--context", "--dry-run"]);
  const args = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!allowed.has(key) || value === undefined || value.startsWith("--") || args.has(key)) throw new Error("invalid migration options");
    args.set(key, value);
  }
  if (!args.has("--artifact") || !args.has("--input") || args.get("--dry-run") !== "true") {
    throw new Error("usage: --artifact NAME --input FILE --context FILE --dry-run true");
  }
  return args;
}

const ownPath = fs.realpathSync(fileURLToPath(import.meta.url));
if (process.argv[1] && fs.realpathSync(process.argv[1]) === ownPath) {
  try {
    const args = migrationOptions(process.argv.slice(2));
    const input = fs.readFileSync(path.resolve(args.get("--input")), "utf8");
    const context = args.has("--context") ? JSON.parse(fs.readFileSync(path.resolve(args.get("--context")), "utf8")) : {};
    const artifact = args.get("--artifact");
    const output = artifact === "checkpoint"
      ? migrateCheckpointV1(input.trim(), context)
      : artifact === "delivery-graph-v1"
        ? migrateDeliveryGraphV1(JSON.parse(input), context)
        : artifact === "delivery-graph-v2"
          ? migrateDeliveryGraphV2(JSON.parse(input), context)
          : (() => { throw new Error("unsupported migration artifact"); })();
    process.stdout.write(`${JSON.stringify({ dryRun: true, output }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`ERROR ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
