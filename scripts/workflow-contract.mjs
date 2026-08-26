import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  evaluateMutation as evaluateKernelMutation,
  evaluateTransition as evaluateKernelTransition,
  loadProtocol,
  validateArtifact,
  validateProtocolDefinition,
} from "../protocol/kernel.mjs";
import {
  adaptLegacyCheckpoint,
  adaptLegacyFacts,
  legacyUsageRecord,
} from "../protocol/legacy-adapter.mjs";

export function validateContracts(workflow, authority) {
  const protocol = loadProtocol();
  return validateProtocolDefinition(workflow ?? protocol.workflow, authority ?? protocol.authority, { protocol });
}

export function validateCheckpointState(state, context) {
  const protocol = loadProtocol();
  const checkpoint = state?.schema === "pi-ticket-planning:checkpoint:v2" ? state : adaptLegacyCheckpoint(state, context);
  return validateArtifact(checkpoint, { protocol }).problems;
}

function adaptTransition(transition, context) {
  const current = transition.current === null || transition.current === undefined
    ? null
    : adaptLegacyCheckpoint(transition.current, { ...context, subject: context.currentSubject ?? context.subject });
  const proposed = adaptLegacyCheckpoint(transition.proposed, { ...context, subject: context.proposedSubject ?? context.subject });
  return { current, proposed, ...(transition.approvalSubject ? { approvalSubject: context.approvalSubject } : {}) };
}

export function evaluateTransition(input, context = input?.context) {
  const protocol = loadProtocol();
  const transition = adaptTransition(input, context);
  return evaluateKernelTransition({
    ...transition,
    facts: adaptLegacyFacts(input.facts ?? {}, protocol.authority, { ...context, subject: transition.proposed.subject }),
    now: context.observedAt,
    mutationId: context.mutationId,
  }, { protocol });
}

export function evaluateMutation(input, context = input?.context) {
  const protocol = loadProtocol();
  const transition = adaptTransition(input.transition, context);
  return evaluateKernelMutation({
    mutation: input.mutation,
    actor: input.actor,
    transition,
    facts: adaptLegacyFacts(input.facts ?? {}, protocol.authority, { ...context, subject: transition.proposed.subject }),
    now: context.observedAt,
    mutationId: context.mutationId,
  }, { protocol });
}

const ownPath = fs.realpathSync(fileURLToPath(import.meta.url));
if (process.argv[1] && fs.realpathSync(process.argv[1]) === ownPath) {
  try {
    let result;
    if (process.argv.length === 2) result = validateContracts();
    else {
      if (process.argv.length !== 4 || process.argv[2] !== "--input") throw new Error("usage: [--input FILE_OR_DASH]");
      const text = process.argv[3] === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(path.resolve(process.argv[3]), "utf8");
      const input = JSON.parse(text);
      process.stderr.write(`${legacyUsageRecord(input.mutation ? "evaluate-mutation" : "evaluate-transition")}\n`);
      result = input.mutation ? evaluateMutation(input) : evaluateTransition(input);
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.allowed === false || result.ok === false) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`ERROR ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
