import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { noNextAction } from "../planning-case/events.mjs";
import { validateArtifact } from "../protocol/kernel.mjs";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

const digest = (value) => `sha256:${createHash("sha256").update(JSON.stringify(canonical(value)), "utf8").digest("hex")}`;

function requireLegacy(value, schema) {
  if (value?.schema !== schema || !validateArtifact(value).ok) throw new Error("INVALID_LEGACY_ARTIFACT");
}

function migrateCandidate(candidate) {
  if (!candidate || typeof candidate.id !== "string" || typeof candidate.revision !== "string"
    || !/^sha256:[a-f0-9]{64}$/.test(candidate.digest ?? "") || typeof candidate.title !== "string") {
    throw new Error("LEGACY_CONTEXT_INCOMPLETE");
  }
  return structuredClone(candidate);
}

function migrateNextAction(action, checkpoint) {
  if (action?.kind === "NONE") return noNextAction("LEGACY_MIGRATION");
  if (typeof action?.command !== "string" || !action.command) throw new Error("LEGACY_CONTEXT_INCOMPLETE");
  return {
    kind: "COMMAND",
    command: action.command,
    skill: null,
    requiredInputs: [],
    blockingFacts: [],
    contextRoute: `${checkpoint.lane}/${checkpoint.stage}/${checkpoint.verdict}`,
    reasonCode: "LEGACY_MIGRATION",
  };
}

export function migratePlanningCaseV1(value) {
  requireLegacy(value, "pi-ticket-planning:planning-case:v1");
  const unsupported = [value.decisions, value.unknowns, value.assumptions].some((items) => items.length > 0)
    || value.evidenceMethod !== null
    || Object.entries(value.bindings).some(([name, binding]) => binding !== null && !["capability", "outcome", "harness"].includes(name));
  if (unsupported) throw new Error("LEGACY_CONTEXT_INCOMPLETE");
  const migrated = {
    schema: "pi-ticket-planning:planning-case:v2",
    target: value.target,
    caseId: value.caseId,
    checkpoint: structuredClone(value.checkpoint),
    blocker: value.blocker === null ? null : {
      id: "legacy-blocker",
      code: value.blocker.code,
      reason: value.blocker.reason,
      requiredFacts: [],
    },
    nextAction: migrateNextAction(value.nextAction, value.checkpoint),
    selectedCandidate: value.selectedCandidate === null ? null : migrateCandidate(value.selectedCandidate),
    excludedCandidates: value.excludedCandidates.map(migrateCandidate),
    facts: structuredClone(value.facts),
    consumedFactIds: [],
    decisions: [],
    unknowns: [],
    assumptions: [],
    evidenceMethod: null,
    evidence: [],
    bindings: { ...structuredClone(value.bindings), session: null, reviewer: null },
    approvals: structuredClone(value.approvals),
    admissionTransaction: null,
    learningDecisions: [],
    lastCheckpoint: structuredClone(value.lastCheckpoint),
    lastEvent: value.lastEvent,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
  const checked = validateArtifact(migrated);
  if (!checked.ok) throw new Error(`LEGACY_CONTEXT_INCOMPLETE:${checked.problems[0]?.code}`);
  return migrated;
}

export function migratePlanningCaseEventV1(value, { previousDigest = value.previousDigest } = {}) {
  requireLegacy(value, "pi-ticket-planning:planning-case-event:v1");
  const data = value.type === "CASE_CREATED" ? { snapshot: migratePlanningCaseV1(value.data.snapshot) } : structuredClone(value.data);
  const event = {
    schema: "pi-ticket-planning:planning-case-event:v2",
    id: value.id,
    sequence: value.sequence,
    caseId: value.caseId,
    target: value.target,
    type: value.type,
    at: value.at,
    data,
    transactionId: value.transactionId,
    previousDigest,
  };
  const migrated = { ...event, digest: digest(event) };
  if (!validateArtifact(migrated).ok) throw new Error("LEGACY_CONTEXT_INCOMPLETE");
  return migrated;
}

export function migrateCaseTransactionV1(value, context = {}) {
  requireLegacy(value, "pi-ticket-planning:case-transaction:v1");
  const event = migratePlanningCaseEventV1(value.event, context);
  const nextSnapshot = migratePlanningCaseV1(value.nextSnapshot);
  nextSnapshot.lastEvent = event.digest;
  const migrated = {
    ...structuredClone(value),
    schema: "pi-ticket-planning:case-transaction:v2",
    beforeEvent: event.previousDigest,
    event,
    nextSnapshot,
  };
  if (!validateArtifact(migrated).ok) throw new Error("LEGACY_CONTEXT_INCOMPLETE");
  return migrated;
}

const ownPath = fs.realpathSync(fileURLToPath(import.meta.url));
if (process.argv[1] && fs.realpathSync(process.argv[1]) === ownPath) {
  try {
    const args = new Map();
    for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
    if (args.get("--dry-run") !== "true" || !args.has("--input") || !args.has("--artifact")) throw new Error("usage: --artifact planning-case|planning-case-event|case-transaction --input FILE --dry-run true");
    const value = JSON.parse(fs.readFileSync(path.resolve(args.get("--input")), "utf8"));
    const migrate = { "planning-case": migratePlanningCaseV1, "planning-case-event": migratePlanningCaseEventV1, "case-transaction": migrateCaseTransactionV1 }[args.get("--artifact")];
    if (!migrate) throw new Error("unknown artifact");
    process.stdout.write(`${JSON.stringify({ dryRun: true, output: migrate(value) }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`ERROR ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
