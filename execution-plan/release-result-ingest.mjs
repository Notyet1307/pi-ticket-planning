import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertCanonicalAbsentChildPath, assertCanonicalPrivateExistingFile, assertCanonicalPublicExistingFile } from "./private-paths.mjs";
import { assertReleasePlan, validateReleaseResult } from "./release-contract.mjs";
import { releasePlanDigest } from "./domain.mjs";

function problem(code) { return { code }; }

export function validateControllerResult(value, expected = {}) {
  const problems = validateReleaseResult(value);
  if (expected.releaseId !== undefined && value?.releaseId !== expected.releaseId) problems.push(problem("RELEASE_RESULT_RELEASE_MISMATCH"));
  if (expected.planDigest !== undefined && value?.planDigest !== expected.planDigest) problems.push(problem("RELEASE_RESULT_PLAN_MISMATCH"));
  if (expected.baseSha !== undefined && value?.baseSha !== expected.baseSha) problems.push(problem("RELEASE_RESULT_BASE_MISMATCH"));
  return problems;
}

export function ingestControllerResult(value, expected = {}) {
  if (!expected.releaseId || !expected.planDigest || !expected.baseSha) throw new Error("RELEASE_RESULT_BINDING_REQUIRED");
  const problems = validateControllerResult(value, expected);
  if (problems.length > 0) throw new Error(problems[0].code);
  return structuredClone(value);
}

function options(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--json") {
      if (values.has("json")) throw new Error("INVALID_OPTIONS");
      values.set("json", true); continue;
    }
    if (!key?.startsWith("--") || values.has(key.slice(2))) throw new Error("INVALID_OPTIONS");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error("INVALID_OPTIONS");
    values.set(key.slice(2), value); index += 1;
  }
  for (const key of values.keys()) if (!["result", "plan", "out", "json"].includes(key)) throw new Error(`UNKNOWN_OPTION:${key}`);
  if (!values.has("result")) throw new Error("MISSING_OPTION:result");
  if (!values.has("plan")) throw new Error("MISSING_OPTION:plan");
  return values;
}

export function runControllerResultIngestion(argv = process.argv.slice(2)) {
  try {
    const values = options(argv);
    let input;
    try { input = assertCanonicalPublicExistingFile(path.resolve(values.get("result")), "CONTROLLER_RESULT"); }
    catch { throw new Error("CONTROLLER_RESULT_INPUT_NOT_PUBLIC"); }
    let planPath;
    try { planPath = assertCanonicalPrivateExistingFile(path.resolve(values.get("plan")), "RELEASE_PLAN", { mode: 0o600 }); }
    catch { throw new Error("RELEASE_PLAN_INPUT_NOT_PRIVATE"); }
    const plan = assertReleasePlan(JSON.parse(fs.readFileSync(planPath, "utf8")));
    const result = ingestControllerResult(JSON.parse(fs.readFileSync(input, "utf8")), {
      releaseId: plan.id,
      planDigest: releasePlanDigest(plan),
      baseSha: plan.baseSha,
    });
    const output = `${JSON.stringify(result, null, 2)}\n`;
    if (!values.has("out") || values.get("out") === "-") process.stdout.write(output);
    else {
      const target = assertCanonicalAbsentChildPath(path.resolve(values.get("out")), "OUTPUT", "OUTPUT_PARENT");
      fs.writeFileSync(target, output, { encoding: "utf8", mode: 0o600, flag: "wx" });
      fs.chmodSync(target, 0o600);
      assertCanonicalPrivateExistingFile(target, "OUTPUT", { mode: 0o600 });
      if (values.has("json")) process.stdout.write(`${JSON.stringify(result)}\n`);
    }
    return 0;
  } catch (error) {
    process.stderr.write(`ERROR ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runControllerResultIngestion();
}
