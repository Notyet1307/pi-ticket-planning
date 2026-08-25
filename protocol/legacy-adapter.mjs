export function normalizeLegacyFacts(rawFacts, authority) {
  if (!rawFacts || typeof rawFacts !== "object" || Array.isArray(rawFacts)) throw new TypeError("legacy facts must be an object");
  const normalized = {};
  for (const [name, observation] of Object.entries(rawFacts)) {
    if (!authority.facts?.[name]) continue;
    if (!observation || typeof observation !== "object" || Array.isArray(observation)
      || Object.keys(observation).some((key) => !["value", "source", "subject"].includes(key))) {
      normalized[name] = { value: false, source: "legacy-invalid" };
      continue;
    }
    normalized[name] = {
      value: observation.value,
      source: observation.source,
      ...(observation.subject === undefined ? {} : { subject: observation.subject }),
    };
  }
  return normalized;
}
