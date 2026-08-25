import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { createPlanningCaseStore, PlanningCaseError } from "./store.mjs";
import { resultEnvelope } from "./result.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SAFE_CASE_ID = /^PC-[A-Za-z0-9._-]{1,96}$/;

export function controlMetadata({ clock, correlationId }) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const git = spawnSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" });
  if (git.status !== 0 || !/^[a-f0-9]{40}$/.test(git.stdout.trim())) throw new PlanningCaseError("SOURCE_COMMIT_UNAVAILABLE");
  return {
    producer: "pi-ticket-planning",
    producerVersion: packageJson.version,
    commit: git.stdout.trim(),
    observedAt: clock(),
    correlationId,
  };
}

function parse(argv) {
  const [scope, command, ...rest] = argv;
  if (scope !== "case" || !command) throw new PlanningCaseError("INVALID_COMMAND");
  const options = new Map();
  const positionals = [];
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const name = token.slice(2);
    if (options.has(name)) throw new PlanningCaseError("DUPLICATE_OPTION");
    if (["json", "dry-run"].includes(name)) options.set(name, true);
    else {
      const value = rest[index + 1];
      if (value === undefined || value.startsWith("--")) throw new PlanningCaseError("MISSING_OPTION_VALUE");
      options.set(name, value);
      index += 1;
    }
  }
  return { command, options, positionals };
}

function requireShape(parsed, { allowed = [], required = [], positionals = 0 }) {
  const allowedSet = new Set([...allowed, "json"]);
  for (const option of parsed.options.keys()) if (!allowedSet.has(option)) throw new PlanningCaseError("UNKNOWN_OPTION");
  for (const option of required) if (!parsed.options.has(option)) throw new PlanningCaseError("MISSING_REQUIRED_OPTION");
  if (parsed.positionals.length !== positionals) throw new PlanningCaseError("INVALID_POSITIONAL_ARGUMENTS");
}

function recoveryFor(caseId) {
  return SAFE_CASE_ID.test(caseId ?? "") ? { command: `pi-ticket-planctl case recover ${caseId} --dry-run --json` } : null;
}

function errorStatus(code) {
  if (["CASE_LOCKED", "STALE_LOCK", "RECOVERY_REQUIRED"].includes(code)) return "BLOCKED";
  if (code.startsWith("UNSAFE_") || code.includes("CORRUPT") || code.includes("MISMATCH") || code.includes("CONFLICT") || code.includes("DRIFT")) return "CONFLICT";
  if (code === "SOURCE_COMMIT_UNAVAILABLE") return "DEGRADED";
  return "INVALID";
}

export function runPlanningCaseCli(argv, {
  env = process.env,
  clock = () => new Date().toISOString(),
  correlationId = `C-${randomUUID()}`,
  storeOptions = {},
} = {}) {
  let command = "case.invalid";
  let caseId = null;
  try {
    const parsed = parse(argv);
    command = `case.${parsed.command}`;
    const store = createPlanningCaseStore({
      stateDir: env.PI_TICKET_PLAN_STATE_DIR,
      clock,
      ...storeOptions,
    });
    let status = "COMPLETE";
    let data;
    let problems = [];
    let recovery = null;

    if (parsed.command === "create") {
      requireShape(parsed, { allowed: ["target", "case-id"], required: ["target"] });
      const created = store.create({ target: parsed.options.get("target"), caseId: parsed.options.get("case-id") });
      caseId = created.caseId;
      data = { caseId: created.caseId, target: created.target, checkpoint: created.checkpoint };
    } else if (parsed.command === "list") {
      requireShape(parsed, { allowed: ["target"] });
      data = { cases: store.list({ target: parsed.options.get("target") }) };
    } else if (parsed.command === "status") {
      requireShape(parsed, { allowed: ["target"], positionals: 1 });
      [caseId] = parsed.positionals;
      data = { case: store.get({ caseId, target: parsed.options.get("target") }) };
    } else if (parsed.command === "resume") {
      requireShape(parsed, { allowed: ["target"], positionals: 1 });
      [caseId] = parsed.positionals;
      data = store.resume({ caseId, target: parsed.options.get("target") });
    } else if (parsed.command === "abandon") {
      requireShape(parsed, { allowed: ["target", "reason"], required: ["reason"], positionals: 1 });
      [caseId] = parsed.positionals;
      data = { case: store.abandon({ caseId, target: parsed.options.get("target"), reason: parsed.options.get("reason") }) };
    } else if (parsed.command === "verify") {
      requireShape(parsed, { allowed: ["target"], positionals: 1 });
      [caseId] = parsed.positionals;
      const verification = store.verify({ caseId, target: parsed.options.get("target") });
      data = { verification };
      if (verification.status !== "COMPLETE") {
        status = "CONFLICT";
        problems = verification.problems;
        recovery = recoveryFor(caseId);
      }
    } else if (parsed.command === "recover") {
      requireShape(parsed, { allowed: ["target", "dry-run"], positionals: 1 });
      [caseId] = parsed.positionals;
      const recovered = store.recover({
        caseId,
        target: parsed.options.get("target"),
        dryRun: parsed.options.has("dry-run"),
      });
      data = { recovery: recovered };
      if (recovered.status !== "COMPLETE") {
        status = recovered.status === "BLOCKED" ? "BLOCKED" : "CONFLICT";
        problems = recovered.problems;
        recovery = recoveryFor(caseId);
      }
    } else if (parsed.command === "migrate") {
      requireShape(parsed, { allowed: ["dry-run"] });
      data = { dryRun: parsed.options.has("dry-run"), migrations: [] };
    } else {
      throw new PlanningCaseError("INVALID_COMMAND");
    }

    return {
      exitCode: status === "COMPLETE" ? 0 : 1,
      envelope: resultEnvelope({
        command,
        status,
        data,
        problems,
        recovery,
        meta: controlMetadata({ clock, correlationId }),
      }),
    };
  } catch (error) {
    const code = error instanceof PlanningCaseError ? error.code : "UNCLASSIFIED_FAILURE";
    const status = errorStatus(code);
    return {
      exitCode: 1,
      envelope: resultEnvelope({
        command,
        status,
        data: {},
        problems: [{ code }],
        recovery: recoveryFor(caseId),
        meta: controlMetadata({ clock, correlationId }),
      }),
    };
  }
}
