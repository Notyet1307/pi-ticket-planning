import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IDENTITY = /^([a-z][a-z0-9-]*):([a-z][a-z0-9-]*):v([1-9][0-9]*)$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const FACT_ID = /^F-[A-Za-z0-9._:-]{1,126}$/;
const FACT_NAME = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)+$/;
const SAFE_TOKEN = /^[^\u0000\r\n]+$/;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function within(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveProtocolLink(link, root) {
  if (link?.schema !== "pi-ticket-planning:protocol-link:v1" || typeof link.ownerPath !== "string") {
    throw new Error("INVALID_PROTOCOL_LINK");
  }
  const target = path.resolve(root, link.ownerPath);
  if (!within(root, target)) throw new Error("PROTOCOL_LINK_ESCAPE");
  return readJson(target);
}

export function loadProtocol({ root = REPOSITORY_ROOT } = {}) {
  const resolvedRoot = path.resolve(root);
  const protocolRoot = path.join(resolvedRoot, "protocol");
  const workflowLink = readJson(path.join(protocolRoot, "workflow.json"));
  const authorityLink = readJson(path.join(protocolRoot, "authority.json"));
  return {
    root: resolvedRoot,
    registry: readJson(path.join(protocolRoot, "artifacts.json")),
    rules: readJson(path.join(protocolRoot, "rules.json")),
    laneStageMatrix: readJson(path.join(protocolRoot, "lane-stage-matrix.json")),
    workflow: resolveProtocolLink(workflowLink, resolvedRoot),
    authority: resolveProtocolLink(authorityLink, resolvedRoot),
  };
}

export function validateRegistry({ protocol = loadProtocol() } = {}) {
  const problems = [];
  const registry = protocol.registry;
  if (registry?.schema !== "pi-ticket-planning:artifact-registry:v1" || !Array.isArray(registry.artifacts)) {
    return { ok: false, problems: [problem("INVALID_ARTIFACT_REGISTRY")] };
  }
  const identities = new Set();
  const artifactNames = new Set();
  const schemaIds = new Set();
  for (const entry of registry.artifacts) {
    const key = `${entry.namespace}:${entry.name}`;
    if (artifactNames.has(key)) problems.push(problem("DUPLICATE_ARTIFACT_NAME", key));
    artifactNames.add(key);
    if (identities.has(entry.schemaIdentity)) problems.push(problem("DUPLICATE_SCHEMA_IDENTITY", entry.schemaIdentity));
    identities.add(entry.schemaIdentity);

    const match = typeof entry.schemaIdentity === "string" ? entry.schemaIdentity.match(IDENTITY) : null;
    if (!match || match[1] !== entry.namespace || match[2] !== entry.name || Number(match[3]) !== entry.currentMajor) {
      problems.push(problem("INVALID_CURRENT_SCHEMA_IDENTITY", key));
    }
    if (!Number.isInteger(entry.currentMajor)
      || !Array.isArray(entry.readableMajors)
      || !entry.readableMajors.includes(entry.currentMajor)
      || new Set(entry.readableMajors).size !== entry.readableMajors.length) {
      problems.push(problem("INVALID_READABLE_MAJORS", key));
    }
    if (typeof entry.writer !== "string" || entry.writer.length === 0) problems.push(problem("MISSING_ARTIFACT_WRITER", key));
    if (!Array.isArray(entry.readers) || entry.readers.length === 0 || new Set(entry.readers).size !== entry.readers.length) {
      problems.push(problem("MISSING_ARTIFACT_READERS", key));
    }
    if (typeof entry.fingerprintAlgorithm !== "string" || entry.fingerprintAlgorithm.length === 0) {
      problems.push(problem("MISSING_FINGERPRINT_ALGORITHM", key));
    }
    if (entry.currentMajor > Math.min(...entry.readableMajors) && !entry.migrationPath) {
      problems.push(problem("MISSING_ARTIFACT_MIGRATION", key));
    }

    const paths = new Set([entry.schemaPath, ...Object.values(entry.schemaPaths ?? {})]);
    for (const relative of paths) {
      const file = typeof relative === "string" ? path.resolve(protocol.root, relative) : "";
      if (!file || !within(protocol.root, file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        problems.push(problem("MISSING_ARTIFACT_SCHEMA", `${key}:${relative ?? ""}`));
        continue;
      }
      try {
        const schema = readJson(file);
        if (typeof schema.$id !== "string" || schema.$id.length === 0) problems.push(problem("MISSING_JSON_SCHEMA_ID", relative));
        else if (schemaIds.has(schema.$id)) problems.push(problem("DUPLICATE_JSON_SCHEMA_ID", schema.$id));
        else schemaIds.add(schema.$id);
      } catch {
        problems.push(problem("INVALID_ARTIFACT_SCHEMA", relative));
      }
    }
  }
  return { ok: problems.length === 0, problems };
}

function codeFiles(root, relative) {
  const directory = path.join(root, relative);
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...codeFiles(root, child));
    else if (entry.isFile() && entry.name.endsWith(".mjs")) files.push(child);
  }
  return files;
}

export function validateCodeSchemaCoverage({ protocol = loadProtocol() } = {}) {
  const declared = new Set(protocol.registry.artifacts.flatMap((entry) =>
    entry.readableMajors.map((major) => `${entry.namespace}:${entry.name}:v${major}`)));
  const observed = new Map();
  const assignment = /(?:\b[A-Z][A-Z0-9_]*SCHEMA[A-Z0-9_]*\s*=\s*|\bschema\s*:\s*)["'`]((?:pi-ticket-planning|herdr-harness):[a-z0-9-]+:v[1-9][0-9]*)["'`]/g;
  for (const relative of ["scripts", "protocol", "admission", "planning-case"].flatMap((directory) => codeFiles(protocol.root, directory))) {
    const text = fs.readFileSync(path.join(protocol.root, relative), "utf8");
    for (const match of text.matchAll(assignment)) {
      if (!observed.has(match[1])) observed.set(match[1], relative);
    }
  }
  const problems = [...observed]
    .filter(([identity]) => !declared.has(identity))
    .map(([identity, relative]) => problem("UNREGISTERED_CODE_SCHEMA", `${identity}:${relative}`));
  return { ok: problems.length === 0, problems };
}

export function validateProtocolRules({ protocol = loadProtocol() } = {}) {
  const problems = [];
  if (protocol.rules?.schema !== "pi-ticket-planning:protocol-rules:v1" || !Array.isArray(protocol.rules.rules)) {
    return { ok: false, problems: [problem("INVALID_PROTOCOL_RULES")] };
  }
  const ids = new Set();
  const rulesById = new Map(protocol.rules.rules.map((rule) => [rule.id, rule]));
  for (const rule of protocol.rules.rules) {
    if (!/^PTP-[A-Z]+-[0-9]{3}$/.test(rule.id ?? "")) problems.push(problem("INVALID_RULE_ID", rule.id));
    if (ids.has(rule.id)) problems.push(problem("DUPLICATE_ACTIVE_RULE", rule.id));
    ids.add(rule.id);
    const owner = typeof rule.ownerPath === "string" ? path.resolve(protocol.root, rule.ownerPath) : "";
    if (!owner || !within(protocol.root, owner) || !fs.existsSync(owner)) problems.push(problem("MISSING_RULE_OWNER", rule.id));
    if (!(["draft", "active", "deprecated"].includes(rule.status)) || !rule.kind || !rule.since || !rule.sourceDecision) {
      problems.push(problem("INCOMPLETE_RULE_DECLARATION", rule.id));
    }
    if (rule.status === "deprecated" && (!rule.replacement || !rulesById.has(rule.replacement))) {
      problems.push(problem("MISSING_RULE_REPLACEMENT", rule.id));
    }
  }
  return { ok: problems.length === 0, problems };
}

function artifactEntry(registry, namespace, name) {
  return registry?.artifacts?.find((entry) => entry.namespace === namespace && entry.name === name);
}

export function parseArtifactIdentity(identity, registry = loadProtocol().registry) {
  const match = typeof identity === "string" ? identity.match(IDENTITY) : null;
  if (!match) throw new Error(`INVALID_ARTIFACT_IDENTITY: ${identity ?? ""}`);
  const parsed = { namespace: match[1], name: match[2], major: Number(match[3]) };
  const entry = artifactEntry(registry, parsed.namespace, parsed.name);
  if (!entry) throw new Error(`UNKNOWN_ARTIFACT: ${parsed.namespace}:${parsed.name}`);
  if (!entry.readableMajors?.includes(parsed.major)) {
    throw new Error(`UNSUPPORTED_ARTIFACT_MAJOR: ${identity}`);
  }
  return parsed;
}

export function validateArtifact(value, { protocol = loadProtocol() } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.schema !== "string") {
    throw new Error("INVALID_ARTIFACT");
  }
  const identity = parseArtifactIdentity(value.schema, protocol.registry);
  if (identity.name === "fact-attestation") return validateFactAttestation(value, { protocol });
  if (identity.name === "checkpoint") {
    const problems = validateCheckpoint(value, protocol);
    return { ok: problems.length === 0, problems };
  }
  return { ok: true, problems: [] };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function same(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function problem(code, subject) {
  return subject === undefined ? { code } : { code, subject };
}

function validTime(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validSubject(subject, requiredFields) {
  if (!subject || typeof subject !== "object" || Array.isArray(subject)) return false;
  if (requiredFields.some((field) => subject[field] === undefined || subject[field] === null || subject[field] === "")) return false;
  return typeof subject.target === "string"
    && SAFE_TOKEN.test(subject.target)
    && typeof subject.kind === "string"
    && /^[a-z][a-z0-9-]{0,63}$/.test(subject.kind)
    && typeof subject.id === "string"
    && SAFE_TOKEN.test(subject.id)
    && typeof subject.revision === "string"
    && SAFE_TOKEN.test(subject.revision)
    && DIGEST.test(subject.digest ?? "");
}

function factRule(name, authority) {
  const rule = authority.facts?.[name];
  if (!rule) return null;
  return {
    ...authority.factDefaults,
    ...rule,
    freshness: { ...(authority.factDefaults?.freshness ?? {}), ...(rule.freshness ?? {}) },
  };
}

export function createFactAttestation(value) {
  return { schema: "pi-ticket-planning:fact-attestation:v1", ...structuredClone(value) };
}

export function validateFactAttestation(attestation, {
  protocol = loadProtocol(),
  expectedSubject,
  now,
} = {}) {
  const problems = [];
  if (!attestation || typeof attestation !== "object" || Array.isArray(attestation)) {
    return { ok: false, problems: [problem("INVALID_FACT_ATTESTATION")] };
  }
  if (attestation.schema !== "pi-ticket-planning:fact-attestation:v1") problems.push(problem("INVALID_FACT_SCHEMA"));
  if (!FACT_ID.test(attestation.id ?? "")) problems.push(problem("INVALID_FACT_ID"));
  if (!FACT_NAME.test(attestation.fact ?? "")) problems.push(problem("INVALID_FACT_NAME"));
  const rule = factRule(attestation.fact, protocol.authority);
  if (!rule) problems.push(problem("UNKNOWN_FACT", attestation.fact));
  const requiredFields = rule?.requiredSubjectFields ?? ["target", "kind", "id", "revision", "digest"];
  if (!validSubject(attestation.subject, requiredFields)) problems.push(problem("INVALID_FACT_SUBJECT"));
  else if (expectedSubject && !same(attestation.subject, expectedSubject)) problems.push(problem("FACT_SUBJECT_MISMATCH"));

  const source = attestation.source;
  if (!source || typeof source !== "object" || Array.isArray(source)
    || !SAFE_TOKEN.test(source.kind ?? "")
    || !SAFE_TOKEN.test(source.producer ?? "")
    || !SAFE_TOKEN.test(source.producerVersion ?? "")
    || !DIGEST.test(source.producerDigest ?? "")) {
    problems.push(problem("INVALID_FACT_SOURCE"));
  } else if (rule && !rule.sources?.includes(source.kind)) {
    problems.push(problem("FACT_PRODUCER_NOT_ALLOWED"));
  }

  if (!validTime(attestation.observedAt)) problems.push(problem("INVALID_FACT_OBSERVED_AT"));
  if (attestation.expiresAt !== null && !validTime(attestation.expiresAt)) problems.push(problem("INVALID_FACT_EXPIRES_AT"));
  const observedAt = Date.parse(attestation.observedAt);
  const checkedAt = now === undefined ? null : Date.parse(now);
  if (Number.isFinite(checkedAt) && Number.isFinite(observedAt)) {
    if (checkedAt < observedAt - 60_000) problems.push(problem("FACT_FROM_FUTURE"));
    if (attestation.expiresAt !== null && checkedAt > Date.parse(attestation.expiresAt)) problems.push(problem("STALE_FACT"));
    if (rule?.freshness?.mode === "max-age" && checkedAt - observedAt > rule.freshness.maxAgeMs) {
      problems.push(problem("STALE_FACT"));
    }
  }

  const evidence = attestation.evidence;
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)
    || !["receipt", "artifact", "tracker", "operator", "harness", "capability"].includes(evidence.kind)
    || !SAFE_TOKEN.test(evidence.ref ?? "")
    || !DIGEST.test(evidence.digest ?? "")) {
    problems.push(problem("INVALID_FACT_EVIDENCE"));
  }
  return { ok: problems.length === 0, problems };
}

function validateCheckpoint(checkpoint, protocol) {
  const problems = [];
  if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint)) return [problem("INVALID_CHECKPOINT")];
  if (checkpoint.schema !== "pi-ticket-planning:checkpoint:v2") problems.push(problem("INVALID_CHECKPOINT_SCHEMA"));
  const stage = protocol.workflow.stages?.[checkpoint.stage];
  if (!protocol.workflow.lanes?.includes(checkpoint.lane)) problems.push(problem("INVALID_LANE", checkpoint.lane));
  if (!stage) problems.push(problem("INVALID_STAGE", checkpoint.stage));
  else {
    if (!stage.verdicts?.includes(checkpoint.verdict)) problems.push(problem("INVALID_STAGE_VERDICT", `${checkpoint.stage}:${checkpoint.verdict}`));
    if (!stage.identityKinds?.includes(checkpoint.subject?.kind)) problems.push(problem("INVALID_STATE_IDENTITY", `${checkpoint.stage}:${checkpoint.subject?.kind ?? ""}`));
  }
  if (!protocol.laneStageMatrix.combinations?.[checkpoint.lane]?.includes(checkpoint.stage)) {
    problems.push(problem("INVALID_LANE_STAGE", `${checkpoint.lane}:${checkpoint.stage}`));
  }
  if (!validSubject(checkpoint.subject, protocol.authority.factDefaults.requiredSubjectFields)) {
    problems.push(problem("INVALID_CHECKPOINT_SUBJECT"));
  }
  return problems;
}

function changedIdentityFields(current, proposed) {
  const fields = [];
  for (const field of ["target", "kind", "id", "revision"]) {
    if (current.subject?.[field] !== proposed.subject?.[field]) fields.push(`subject.${field}`);
  }
  return fields;
}

function transitionShape(current, proposed, protocol, rebind) {
  const problems = [...validateCheckpoint(proposed, protocol)];
  const requiredFacts = [];
  if (!current) return { problems, requiredFacts };
  problems.push(...validateCheckpoint(current, protocol));
  if (protocol.workflow.stages?.[current.stage]
    && protocol.workflow.stages?.[proposed.stage]
    && !protocol.workflow.allowedTransitions?.[current.stage]?.includes(proposed.stage)) {
    problems.push(problem("ILLEGAL_STAGE_TRANSITION", `${current.stage}->${proposed.stage}`));
  }
  const changes = changedIdentityFields(current, proposed);
  if (changes.length > 0) {
    const rule = rebind === true
      ? protocol.workflow.rebindTransitions?.find((candidate) => candidate.sourceStage === current.stage
        && candidate.targetStage === proposed.stage
        && changes.every((field) => candidate.changes?.includes(field)))
      : null;
    if (!rule) problems.push(problem("ILLEGAL_IDENTITY_TRANSITION", changes.join(",")));
    else requiredFacts.push(...(rule.requiredFacts ?? []));
  }
  return { problems, requiredFacts };
}

function scopedTransitionFacts(current, proposed, workflow) {
  if (!current) return [];
  return (workflow.transitionRequirements ?? [])
    .filter((rule) => rule.sourceStage === current.stage
      && rule.sourceVerdict === current.verdict
      && rule.targetStages?.includes(proposed.stage)
      && (!rule.sameRelease || current.subject?.id === proposed.subject?.id))
    .flatMap((rule) => rule.requiredFacts ?? []);
}

function factsByName(facts) {
  const byName = new Map();
  const duplicates = [];
  for (const fact of facts ?? []) {
    if (byName.has(fact?.fact)) duplicates.push(fact?.fact);
    else byName.set(fact?.fact, fact);
  }
  return { byName, duplicates };
}

function requiredFactProblems(names, facts, expectedSubject, protocol, now) {
  const problems = [];
  for (const name of [...new Set(names)]) {
    const attestation = facts.get(name);
    if (!attestation) {
      problems.push(problem("MISSING_REQUIRED_FACT", name));
      continue;
    }
    const checked = validateFactAttestation(attestation, { protocol, expectedSubject, now });
    problems.push(...checked.problems.map((item) => ({ ...item, fact: name })));
    if (attestation.value !== true) problems.push(problem("MISSING_REQUIRED_FACT", name));
  }
  return problems;
}

function humanGates(problems, authority) {
  return [...new Set(problems
    .filter(({ code, subject }) => code === "MISSING_REQUIRED_FACT" && authority.facts?.[subject]?.owner === "human")
    .map(({ subject }) => subject))];
}

export function evaluateTransition({ current, proposed, facts = [], now, rebind = false }, { protocol = loadProtocol() } = {}) {
  const shaped = transitionShape(current, proposed, protocol, rebind);
  const indexed = factsByName(facts);
  const required = [
    ...(protocol.workflow.verdictRequirements?.[proposed?.verdict] ?? []),
    ...scopedTransitionFacts(current, proposed, protocol.workflow),
    ...shaped.requiredFacts,
  ];
  const problems = [
    ...shaped.problems,
    ...indexed.duplicates.map((name) => problem("DUPLICATE_FACT_ATTESTATION", name)),
    ...requiredFactProblems(required, indexed.byName, proposed?.subject, protocol, now),
  ];
  return { allowed: problems.length === 0, problems, requiredHumanGates: humanGates(problems, protocol.authority) };
}

export function evaluateMutation({
  mutation,
  actor,
  transition,
  facts = [],
  consumedApprovalIds = [],
  now,
}, { protocol = loadProtocol() } = {}) {
  const rule = protocol.authority.mutations?.[mutation];
  if (!rule) return { allowed: false, problems: [problem("UNKNOWN_MUTATION", mutation)], requiredHumanGates: [], postconditions: [] };
  const shaped = transitionShape(transition?.current, transition?.proposed, protocol, false);
  const problems = [...shaped.problems];
  if (actor !== rule.actor) problems.push(problem("UNAUTHORIZED_MUTATION_ACTOR", `${mutation}:${actor}`));
  if (transition?.current?.stage !== rule.sourceStage || transition?.current?.verdict !== rule.sourceVerdict) {
    problems.push(problem("INVALID_MUTATION_SOURCE", mutation));
  }
  if (transition?.proposed?.stage !== rule.targetStage || transition?.proposed?.verdict !== rule.targetVerdict) {
    problems.push(problem("INVALID_MUTATION_TRANSITION", mutation));
  }

  const indexed = factsByName(facts);
  problems.push(...indexed.duplicates.map((name) => problem("DUPLICATE_FACT_ATTESTATION", name)));
  for (const name of rule.requiredFacts ?? []) {
    const expectedSubject = name === rule.approvalFact ? transition?.approvalSubject : transition?.proposed?.subject;
    problems.push(...requiredFactProblems([name], indexed.byName, expectedSubject, protocol, now));
  }
  if (rule.approvalFact) {
    if (!transition?.approvalSubject) problems.push(problem("MISSING_APPROVAL_SUBJECT", rule.approvalFact));
    const approval = indexed.byName.get(rule.approvalFact);
    if (approval && consumedApprovalIds.includes(approval.id)) problems.push(problem("APPROVAL_ALREADY_CONSUMED", approval.id));
  }
  return {
    allowed: problems.length === 0,
    problems,
    requiredHumanGates: humanGates(problems, protocol.authority),
    postconditions: [...(rule.postconditions ?? [])],
  };
}

function reachableStages(workflow) {
  const reached = new Set(["ORIENT"]);
  const queue = ["ORIENT"];
  while (queue.length > 0) {
    for (const target of workflow.allowedTransitions?.[queue.shift()] ?? []) {
      if (!reached.has(target)) {
        reached.add(target);
        queue.push(target);
      }
    }
  }
  return reached;
}

function factConsumers(protocol) {
  const consumers = new Set();
  for (const facts of Object.values(protocol.workflow.verdictRequirements ?? {})) for (const fact of facts) consumers.add(fact);
  for (const rule of protocol.workflow.transitionRequirements ?? []) for (const fact of rule.requiredFacts ?? []) consumers.add(fact);
  for (const rule of protocol.workflow.rebindTransitions ?? []) for (const fact of rule.requiredFacts ?? []) consumers.add(fact);
  for (const mutation of Object.values(protocol.authority.mutations ?? {})) {
    for (const fact of [...(mutation.requiredFacts ?? []), ...(mutation.producesFacts ?? [])]) consumers.add(fact);
  }
  return consumers;
}

export function verifyProtocol({ protocol = loadProtocol() } = {}) {
  const stages = Object.keys(protocol.workflow.stages ?? {});
  const reached = reachableStages(protocol.workflow);
  const consumers = factConsumers(protocol);
  const facts = Object.entries(protocol.authority.facts ?? {});
  const report = {
    reachableStates: `${reached.size}/${stages.length}`,
    unreachableStates: stages.filter((stage) => !reached.has(stage)),
    undeclaredDeadEnds: stages.filter((stage) => (protocol.workflow.allowedTransitions?.[stage] ?? []).length === 0),
    factsWithoutProducer: facts.filter(([, rule]) => !Array.isArray(rule.sources) || rule.sources.length === 0).map(([name]) => name),
    factsWithoutConsumer: facts.filter(([name]) => !consumers.has(name)).map(([name]) => name),
    mutationsWithoutPostconditions: Object.entries(protocol.authority.mutations ?? {})
      .filter(([, mutation]) => !Array.isArray(mutation.postconditions) || mutation.postconditions.length === 0)
      .map(([name]) => name),
    ambiguousAuthorityOwners: facts.filter(([, rule]) => typeof rule.owner !== "string" || rule.owner.length === 0).map(([name]) => name),
    invalidIdentityTransitions: (protocol.workflow.rebindTransitions ?? [])
      .filter((rule) => !protocol.workflow.stages?.[rule.sourceStage]
        || !protocol.workflow.stages?.[rule.targetStage]
        || !Array.isArray(rule.changes)
        || rule.changes.length === 0
        || rule.requiredFacts?.some((fact) => !protocol.authority.facts?.[fact]))
      .map((rule) => `${rule.sourceStage ?? "?"}->${rule.targetStage ?? "?"}`),
  };
  return report;
}
