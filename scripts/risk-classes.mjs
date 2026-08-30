import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RISK_CLASS_REGISTRY_SCHEMA = "pi-ticket-planning:risk-class-registry:v1";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY_PATH = path.join(ROOT, "contracts", "risk-class-registry.json");
const TOKEN = /^[A-Z][A-Z0-9_]{0,63}$/u;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function fingerprint(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical(value)), "utf8").digest("hex")}`;
}

function sorted(values) {
  return [...values].sort().join("\n") === values.join("\n");
}

export function validateRiskClassRegistry(value) {
  const problems = [];
  const keys = ["aliases", "classes", "digest", "schema", "splitCombinations"];
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join("\n") !== keys.sort().join("\n")
    || value.schema !== RISK_CLASS_REGISTRY_SCHEMA
    || !Array.isArray(value.classes) || value.classes.length === 0 || value.classes.length > 64
    || value.classes.some((entry) => typeof entry !== "string" || !TOKEN.test(entry))
    || new Set(value.classes).size !== value.classes.length || !sorted(value.classes)
    || !value.aliases || typeof value.aliases !== "object" || Array.isArray(value.aliases) || Object.keys(value.aliases).length !== 0
    || !Array.isArray(value.splitCombinations) || value.splitCombinations.length === 0 || value.splitCombinations.length > 32) {
    return [{ code: "INVALID_RISK_CLASS_REGISTRY" }];
  }
  const classes = new Set(value.classes);
  if (value.splitCombinations.some((combination) => !Array.isArray(combination)
    || combination.length < 2 || combination.length > 4
    || combination.some((entry) => !classes.has(entry))
    || new Set(combination).size !== combination.length || !sorted(combination))
    || new Set(value.splitCombinations.map((combination) => combination.join("\n"))).size !== value.splitCombinations.length
    || !sorted(value.splitCombinations.map((combination) => combination.join("\n")))) {
    problems.push({ code: "INVALID_RISK_CLASS_REGISTRY" });
  }
  const { digest, ...body } = value;
  if (digest !== fingerprint(body)) problems.push({ code: "RISK_CLASS_REGISTRY_DIGEST_MISMATCH" });
  return problems;
}

export const RISK_CLASS_REGISTRY = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
const registryProblems = validateRiskClassRegistry(RISK_CLASS_REGISTRY);
if (registryProblems.length > 0) throw new Error(registryProblems[0].code);
const RISK_CLASSES = new Set(RISK_CLASS_REGISTRY.classes);

export function isCanonicalRiskClass(value) {
  return typeof value === "string" && RISK_CLASSES.has(value);
}

export function unknownRiskClasses(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => !isCanonicalRiskClass(value)))];
}

export function riskClassesRequireSplit(values) {
  return Array.isArray(values) && unknownRiskClasses(values).length === 0 && RISK_CLASS_REGISTRY.splitCombinations
    .some((combination) => combination.every((risk) => values.includes(risk)));
}
