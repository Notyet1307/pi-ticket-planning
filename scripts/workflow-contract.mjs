import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultWorkflow = JSON.parse(fs.readFileSync(path.join(moduleRoot, "contracts", "workflow.json"), "utf8"));
const defaultAuthority = JSON.parse(fs.readFileSync(path.join(moduleRoot, "contracts", "authority.json"), "utf8"));

function issue(code, subject) {
  return subject ? { code, subject } : { code };
}

function validateState(state, workflow, role) {
  const problems = [];
  if (!state || typeof state !== "object" || Array.isArray(state)) return [issue(`INVALID_${role}_STATE`)];
  if (!workflow.lanes.includes(state.lane)) problems.push(issue("INVALID_LANE", state.lane));
  const stage = workflow.stages[state.stage];
  if (!stage) return [...problems, issue("INVALID_STAGE", state.stage)];
  if (!stage.verdicts.includes(state.verdict)) problems.push(issue("INVALID_STAGE_VERDICT", `${state.stage}:${state.verdict}`));
  const identityKind = Object.entries(workflow.identityPatterns)
    .find(([, pattern]) => new RegExp(pattern).test(state.identity ?? ""))?.[0];
  if (!identityKind || !stage.identityKinds.includes(identityKind)) {
    problems.push(issue("INVALID_STATE_IDENTITY", `${state.stage}:${state.identity ?? ""}`));
  }
  return problems;
}

export function validateContracts(workflow = defaultWorkflow, authority = defaultAuthority) {
  const problems = [];
  if (workflow?.version !== 1) problems.push(issue("INVALID_WORKFLOW_VERSION"));
  if (authority?.version !== 1) problems.push(issue("INVALID_AUTHORITY_VERSION"));
  if (!Array.isArray(workflow?.lanes) || workflow.lanes.length === 0) problems.push(issue("MISSING_LANES"));
  if (!workflow?.stages || typeof workflow.stages !== "object") problems.push(issue("MISSING_STAGES"));
  if (!workflow?.identityPatterns || typeof workflow.identityPatterns !== "object") problems.push(issue("MISSING_IDENTITY_PATTERNS"));
  if (!authority?.facts || typeof authority.facts !== "object") problems.push(issue("MISSING_FACT_AUTHORITIES"));

  for (const [stage, targets] of Object.entries(workflow?.allowedTransitions ?? {})) {
    if (!workflow.stages?.[stage]) problems.push(issue("UNKNOWN_TRANSITION_STAGE", stage));
    for (const target of targets ?? []) {
      if (!workflow.stages?.[target]) problems.push(issue("UNKNOWN_TRANSITION_TARGET", `${stage}->${target}`));
    }
  }
  for (const [verdict, facts] of Object.entries(workflow?.verdictRequirements ?? {})) {
    const knownVerdict = Object.values(workflow.stages ?? {}).some((stage) => stage.verdicts?.includes(verdict));
    if (!knownVerdict) problems.push(issue("UNKNOWN_REQUIREMENT_VERDICT", verdict));
    for (const fact of facts ?? []) {
      if (!authority.facts?.[fact]) problems.push(issue("UNKNOWN_REQUIRED_FACT", `${verdict}:${fact}`));
    }
  }
  for (const [index, rule] of (workflow?.transitionRequirements ?? []).entries()) {
    const subject = `transitionRequirements[${index}]`;
    if (!workflow.stages?.[rule.sourceStage]?.verdicts?.includes(rule.sourceVerdict)) {
      problems.push(issue("INVALID_TRANSITION_REQUIREMENT_SOURCE", subject));
    }
    if (!Array.isArray(rule.targetStages) || rule.targetStages.some((stage) => !workflow.stages?.[stage])) {
      problems.push(issue("INVALID_TRANSITION_REQUIREMENT_TARGET", subject));
    }
    for (const fact of rule.requiredFacts ?? []) {
      if (!authority.facts?.[fact]) problems.push(issue("UNKNOWN_TRANSITION_REQUIREMENT_FACT", `${subject}:${fact}`));
    }
  }
  for (const [name, mutation] of Object.entries(authority?.mutations ?? {})) {
    if (!workflow.stages?.[mutation.targetStage]?.verdicts?.includes(mutation.targetVerdict)) {
      problems.push(issue("INVALID_MUTATION_TARGET", name));
    }
    if (!workflow.stages?.[mutation.sourceStage]?.verdicts?.includes(mutation.sourceVerdict)) {
      problems.push(issue("INVALID_MUTATION_SOURCE", name));
    }
    if (mutation.approvalFact && !authority.facts?.[mutation.approvalFact]) {
      problems.push(issue("UNKNOWN_MUTATION_APPROVAL_FACT", `${name}:${mutation.approvalFact}`));
    }
    for (const fact of [...(mutation.requiredFacts ?? []), ...(mutation.producesFacts ?? [])]) {
      if (!authority.facts?.[fact]) problems.push(issue("UNKNOWN_MUTATION_FACT", `${name}:${fact}`));
    }
  }
  return { ok: problems.length === 0, problems };
}

export function parseCheckpoint(line) {
  if (typeof line !== "string") throw new TypeError("checkpoint must be a string");
  const match = line.trim().match(/^Checkpoint: ([A-Z]+)\/([A-Z_]+) · ([^\s·]+) · ([A-Z_]+)$/);
  if (!match) throw new Error("invalid Checkpoint format");
  return { lane: match[1], stage: match[2], identity: match[3], verdict: match[4] };
}

export function validateCheckpointState(state, contracts = {}) {
  return validateState(state, contracts.workflow ?? defaultWorkflow, "CHECKPOINT");
}

function evaluateTransitionShape(current, proposed, workflow) {
  const problems = validateState(proposed, workflow, "PROPOSED");
  if (current !== null && current !== undefined) {
    problems.push(...validateState(current, workflow, "CURRENT"));
    if (
      workflow.stages[current?.stage]
      && workflow.stages[proposed?.stage]
      && !workflow.allowedTransitions[current.stage]?.includes(proposed.stage)
    ) {
      problems.push(issue("ILLEGAL_STAGE_TRANSITION", `${current.stage}->${proposed.stage}`));
    }
  }
  return problems;
}

function transitionFacts(current, proposed, workflow) {
  if (!current || !proposed) return [];
  return (workflow.transitionRequirements ?? [])
    .filter((rule) => rule.sourceStage === current.stage
      && rule.sourceVerdict === current.verdict
      && rule.targetStages.includes(proposed.stage))
    .flatMap((rule) => rule.requiredFacts ?? []);
}

function evaluateFacts(requiredFacts, facts, authority) {
  const problems = [];
  for (const factName of requiredFacts) {
    const observation = facts[factName];
    if (observation?.value !== true) {
      problems.push(issue("MISSING_REQUIRED_FACT", factName));
      continue;
    }
    if (!authority.facts[factName].sources.includes(observation.source)) {
      problems.push(issue("UNTRUSTED_FACT_SOURCE", `${factName}:${observation.source ?? ""}`));
    }
  }
  return problems;
}

function humanGates(problems, authority) {
  return [...new Set(problems
    .filter(({ code, subject }) => code === "MISSING_REQUIRED_FACT" && authority.facts[subject]?.owner === "human")
    .map(({ subject }) => subject))];
}

export function evaluateTransition({ current, proposed, facts = {} }, contracts = {}) {
  const workflow = contracts.workflow ?? defaultWorkflow;
  const authority = contracts.authority ?? defaultAuthority;
  const contractCheck = validateContracts(workflow, authority);
  if (!contractCheck.ok) return { allowed: false, problems: contractCheck.problems, requiredHumanGates: [] };

  const problems = [
    ...evaluateTransitionShape(current, proposed, workflow),
    ...evaluateFacts([
      ...(workflow.verdictRequirements[proposed?.verdict] ?? []),
      ...transitionFacts(current, proposed, workflow),
    ], facts, authority),
  ];
  return { allowed: problems.length === 0, problems, requiredHumanGates: humanGates(problems, authority) };
}

export function evaluateMutation({ mutation, actor, transition, facts = {} }, contracts = {}) {
  const workflow = contracts.workflow ?? defaultWorkflow;
  const authority = contracts.authority ?? defaultAuthority;
  const contractCheck = validateContracts(workflow, authority);
  if (!contractCheck.ok) return { allowed: false, problems: contractCheck.problems, requiredHumanGates: [] };
  const problems = [];
  const rule = authority.mutations?.[mutation];
  if (!rule) return { allowed: false, problems: [issue("UNKNOWN_MUTATION", mutation)], requiredHumanGates: [] };
  if (actor !== rule.actor) problems.push(issue("UNAUTHORIZED_MUTATION_ACTOR", `${mutation}:${actor}`));
  if (transition?.proposed?.stage !== rule.targetStage || transition?.proposed?.verdict !== rule.targetVerdict) {
    problems.push(issue("INVALID_MUTATION_TRANSITION", mutation));
  }
  if (transition?.current?.stage !== rule.sourceStage || transition?.current?.verdict !== rule.sourceVerdict) {
    problems.push(issue("INVALID_MUTATION_SOURCE", mutation));
  }
  if (rule.approvalFact) {
    if (!transition?.approvalSubject) problems.push(issue("MISSING_APPROVAL_SUBJECT", rule.approvalFact));
    else if (facts[rule.approvalFact]?.subject !== transition.approvalSubject) {
      problems.push(issue("APPROVAL_SUBJECT_MISMATCH", rule.approvalFact));
    }
  }
  problems.push(...evaluateTransitionShape(transition?.current, transition?.proposed, workflow));
  problems.push(...evaluateFacts([
    ...(rule.requiredFacts ?? []),
    ...transitionFacts(transition?.current, transition?.proposed, workflow),
  ], facts, authority));
  return {
    allowed: problems.length === 0,
    problems,
    requiredHumanGates: humanGates(problems, authority),
  };
}

const ownPath = fs.realpathSync(fileURLToPath(import.meta.url));
if (process.argv[1] && fs.realpathSync(process.argv[1]) === ownPath) {
  try {
    let result;
    if (process.argv.length === 2) {
      result = validateContracts();
    } else {
      if (process.argv.length !== 4 || process.argv[2] !== "--input") throw new Error("usage: [--input FILE_OR_DASH]");
      const input = process.argv[3] === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(path.resolve(process.argv[3]), "utf8");
      result = evaluateTransition(JSON.parse(input));
    }
    console.log(JSON.stringify(result, null, 2));
    if (result.allowed === false || result.ok === false) process.exitCode = 1;
  } catch (error) {
    console.error(`ERROR ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
