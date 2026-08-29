function section(body, heading) {
  const matches = [...body.matchAll(new RegExp(`^## ${heading.replace(/[.*+?^${}()|[\]\\\\]/g, "\\$&")}[ \\t]*$`, "gm"))];
  if (matches.length !== 1) throw new Error(`${matches.length === 0 ? "MISSING" : "DUPLICATE"}_SECTION:${heading}`);
  const start = matches[0].index + matches[0][0].length;
  const next = body.slice(start).match(/^## (?!#)/m);
  return body.slice(start, next ? start + next.index : body.length).trim();
}

function oneLine(value, code) {
  const text = value.trim();
  if (!text || /[\r\n]/.test(text)) throw new Error(code);
  return text;
}

function jsonFence(value, code) {
  const match = value.match(/^```json[ \t]*\n([\s\S]+)\n```$/u);
  if (!match) throw new Error(code);
  try {
    const parsed = JSON.parse(match[1]);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(code);
    return parsed;
  } catch {
    throw new Error(code);
  }
}

export function parseControlledLines(value) {
  const entries = [];
  let current = "";
  let kind = null;
  const flush = () => {
    if (current) entries.push(current);
    current = "";
    kind = null;
  };
  for (const raw of String(value).replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    const item = line.match(/^(?:[-*+]\s+|[1-9][0-9]*[.)]\s+)(.+)$/);
    if (item) {
      flush();
      current = item[1].trim();
      kind = "list";
    } else if (!line) {
      flush();
    } else if (kind === "list" || kind === "paragraph") {
      current += `\n${line}`;
    } else {
      current = line;
      kind = "paragraph";
    }
  }
  flush();
  return entries;
}

export function parseParentDeliverySpec(body) {
  if (typeof body !== "string") throw new Error("INVALID_PARENT_BODY");
  const required = ["Delivery outcome", "Behavioral scenarios", "Release signal mapping", "Walking skeleton target", "Decisions", "Constraints and dependencies", "Out of scope"];
  const values = Object.fromEntries(required.map((name) => [name, section(body, name)]));
  const scenarioParts = values["Behavioral scenarios"].split(/^### (S[1-9][0-9]*):[^\n]*$/m);
  if (scenarioParts[0].trim() || scenarioParts.length < 3 || scenarioParts.length % 2 === 0) throw new Error("INVALID_SCENARIOS");
  const scenarios = Array.from({ length: (scenarioParts.length - 1) / 2 }, (_, index) => {
    const id = scenarioParts[index * 2 + 1];
    const part = scenarioParts[index * 2 + 2];
    const field = (name) => {
      const found = part.match(new RegExp(`^${name}:\\s*(.+)$`, "m"));
      if (!found) throw new Error(`MISSING_SCENARIO_FIELD:${id}:${name}`);
      return oneLine(found[1], `EMPTY_SCENARIO_FIELD:${id}:${name}`);
    };
    return { id, observable: field("Observable result"), failure: field("Important failure behavior"), exit: field("Exit state or produced artifact") };
  });
  if (scenarios.length === 0 || new Set(scenarios.map(({ id }) => id)).size !== scenarios.length) throw new Error("INVALID_SCENARIOS");
  return { objective: oneLine(values["Delivery outcome"], "EMPTY_DELIVERY_OUTCOME"), scenarios, walkingSkeleton: oneLine(values["Walking skeleton target"], "EMPTY_WALKING_SKELETON"), releaseSignals: values["Release signal mapping"], decisions: values.Decisions, constraints: values["Constraints and dependencies"] };
}

export function parseChildTicket(body) {
  if (typeof body !== "string") throw new Error("INVALID_CHILD_BODY");
  const required = ["What to build", "Primary verification", "Acceptance criteria", "Invariants and guardrails", "Oracle binding", "Execution constraints", "Out of scope"];
  const values = Object.fromEntries(required.map((name) => [name, section(body, name)]));
  if (values["Acceptance criteria"].split("\n").some((line) => line.trim() && !/^\s*[-*]\s*\[ \]\s+[^\r\n]+$/.test(line))) throw new Error("INVALID_ACCEPTANCE_CRITERIA_CONTENT");
  const criteria = [...values["Acceptance criteria"].matchAll(/^\s*[-*]\s*\[ \]\s+(.+)$/gm)].map((match) => oneLine(match[1], "INVALID_ACCEPTANCE_CRITERION"));
  if (criteria.length < 3 || criteria.length > 8) throw new Error("INVALID_ACCEPTANCE_CRITERIA_COUNT");
  return {
    objective: oneLine(values["What to build"], "EMPTY_CHILD_OBJECTIVE"),
    primaryVerification: oneLine(values["Primary verification"], "EMPTY_PRIMARY_VERIFICATION"),
    acceptanceCriteria: criteria,
    oracleBinding: jsonFence(values["Oracle binding"], "INVALID_ORACLE_BINDING_SECTION"),
    executionConstraints: jsonFence(values["Execution constraints"], "INVALID_EXECUTION_CONSTRAINTS_SECTION"),
  };
}
