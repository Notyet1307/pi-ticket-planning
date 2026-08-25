const CHECKPOINT = /^Checkpoint: ([A-Z]+)\/([A-Z_]+) · ([^\s·]+) · ([A-Z_]+)$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;

export const LEGACY_DEPRECATION = Object.freeze({
  removeAfter: "2026-11-30",
  migrationCommand: "node scripts/migrate-artifacts.mjs --artifact checkpoint --input FILE --context FILE --dry-run true",
  deletionCondition: "No legacy facade use in two consecutive release cycles",
});

function incomplete() {
  const error = new Error("LEGACY_CONTEXT_INCOMPLETE");
  error.code = "LEGACY_CONTEXT_INCOMPLETE";
  throw error;
}

function assertContext(context) {
  if (!context || typeof context !== "object" || Array.isArray(context)
    || typeof context.target !== "string" || !context.target
    || !Number.isFinite(Date.parse(context.observedAt))
    || !context.producer || typeof context.producer !== "object"
    || typeof context.producer.name !== "string" || !context.producer.name
    || typeof context.producer.version !== "string" || !context.producer.version
    || !DIGEST.test(context.producer.digest ?? "")) incomplete();
}

function assertSubject(subject, target) {
  if (!subject || typeof subject !== "object" || Array.isArray(subject)
    || subject.target !== target
    || typeof subject.kind !== "string" || !subject.kind
    || typeof subject.id !== "string" || !subject.id
    || typeof subject.revision !== "string" || !subject.revision
    || !DIGEST.test(subject.digest ?? "")) incomplete();
}

function legacyIdentity(subject) {
  if (subject.kind === "none") return "NONE";
  if (subject.kind === "ticket") return `${subject.id}@${subject.revision}`;
  if (subject.kind === "release") return `${subject.id}/${subject.revision}`;
  return incomplete();
}

export function adaptLegacyCheckpoint(value, context) {
  assertContext(context);
  assertSubject(context.subject, context.target);
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !["lane", "stage", "identity", "verdict"].every((key) => typeof value[key] === "string")
    || value.identity !== legacyIdentity(context.subject)) incomplete();
  return {
    schema: "pi-ticket-planning:checkpoint:v2",
    lane: value.lane,
    stage: value.stage,
    verdict: value.verdict,
    subject: structuredClone(context.subject),
  };
}

export function parseLegacyCheckpoint(line, context) {
  if (typeof line !== "string") incomplete();
  const match = line.trim().match(CHECKPOINT);
  if (!match) throw new Error("INVALID_LEGACY_CHECKPOINT");
  return adaptLegacyCheckpoint({ lane: match[1], stage: match[2], identity: match[3], verdict: match[4] }, context);
}

export function adaptLegacyFacts(rawFacts, authority, context) {
  assertContext(context);
  assertSubject(context.subject, context.target);
  if (!rawFacts || typeof rawFacts !== "object" || Array.isArray(rawFacts)) incomplete();
  const facts = [];
  for (const [name, observation] of Object.entries(rawFacts)) {
    if (!authority.facts?.[name]) continue;
    if (!observation || typeof observation !== "object" || Array.isArray(observation)
      || typeof observation.value !== "boolean" || typeof observation.source !== "string"
      || !observation.evidence || !DIGEST.test(observation.evidence.digest ?? "")) incomplete();
    const rule = { ...authority.factDefaults, ...authority.facts[name] };
    const producer = context.producers?.[observation.source] ?? context.producer;
    if (!producer || typeof producer.name !== "string" || !producer.name
      || typeof producer.version !== "string" || !producer.version || !DIGEST.test(producer.digest ?? "")) incomplete();
    facts.push({
      schema: "pi-ticket-planning:fact-attestation:v1",
      id: observation.id ?? `F-legacy-${name.replaceAll(".", "-")}`,
      fact: name,
      value: observation.value,
      subject: structuredClone(observation.subject ?? context.subject),
      source: {
        kind: observation.source,
        producer: producer.name,
        producerVersion: producer.version,
        producerDigest: producer.digest,
      },
      observedAt: context.observedAt,
      expiresAt: observation.expiresAt ?? null,
      ...(rule.freshness?.mode === "same-mutation" ? { mutationId: context.mutationId ?? incomplete() } : {}),
      evidence: structuredClone(observation.evidence),
    });
  }
  return facts;
}

export function legacyUsageRecord(operation) {
  return JSON.stringify({
    kind: "pi-ticket-planning-legacy-usage-v1",
    operation,
    removeAfter: LEGACY_DEPRECATION.removeAfter,
    migrationCommand: LEGACY_DEPRECATION.migrationCommand,
  });
}
