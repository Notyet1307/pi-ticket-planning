import fs from "node:fs";
import path from "node:path";
import { createPlanningCaseStore } from "../planning-case/store.mjs";
import { createGitHubAdapter } from "../admission/github-adapter.mjs";
import { compileExecutionPlan } from "./compiler.mjs";
import { applyExecutionPlan } from "./handoff-apply.mjs";
import { fingerprint, releasePlanDigest } from "./domain.mjs";
import {
  assertCanonicalAbsentChildPath,
  assertCanonicalPrivateExistingDirectory,
  assertCanonicalPrivateExistingFile,
  assertCanonicalPrivateOutputParent,
} from "./private-paths.mjs";
import { verifyExecutionPlan } from "./validate.mjs";
import { assertFreshExecutionInput } from "./freshness.mjs";

function options(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key?.startsWith("--") || values.has(key.slice(2))) throw new Error("INVALID_OPTIONS");
    if (key === "--json") { values.set("json", true); continue; }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error("INVALID_OPTIONS");
    values.set(key.slice(2), value); index += 1;
  }
  return values;
}
function requireOptions(values, allowed, required) {
  for (const key of values.keys()) if (!allowed.includes(key)) throw new Error(`UNKNOWN_OPTION:${key}`);
  for (const key of required) if (!values.has(key)) throw new Error(`MISSING_OPTION:${key}`);
}
function json(file) { return JSON.parse(fs.readFileSync(path.resolve(file), "utf8")); }
function liveInput(values, { plan } = {}) {
  const repo = values.get("repo") ?? plan?.repo;
  const parent = values.get("parent") ?? plan?.parentIssue;
  if (!values.has("context")) throw new Error("MISSING_OPTION:context");
  const context = json(values.get("context"));
  const review = values.has("review") ? json(values.get("review")) : context.review;
  const reviewBinding = values.has("review-binding") ? json(values.get("review-binding")) : context.reviewBinding;
  const reviewDispatchBinding = values.has("review-dispatch-binding") ? json(values.get("review-dispatch-binding")) : context.reviewDispatchBinding;
  if (!repo || !parent || !review || !reviewBinding || !reviewDispatchBinding) throw new Error("MISSING_LIVE_EXECUTION_INPUT");
  const state = createGitHubAdapter({ repo, kind: "DELIVERY_GRAPH", target: parent, context }).read();
  return { ...context, ...state, kind: "DELIVERY_GRAPH", repo, review, reviewBinding: reviewBinding.binding ?? reviewBinding, reviewDispatchBinding };
}
function write(file, value) {
  const output = `${JSON.stringify(value, null, 2)}\n`;
  if (!file || file === "-") return process.stdout.write(output);
  const target = assertCanonicalAbsentChildPath(file, "OUTPUT", "OUTPUT_PARENT");
  fs.writeFileSync(target, output, { encoding: "utf8", mode: 0o600, flag: "wx" });
  fs.chmodSync(target, 0o600);
  assertCanonicalPrivateExistingFile(target, "OUTPUT", { mode: 0o600 });
}

function outputDirectory(value) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw new Error("OUTPUT_DIR_MUST_BE_ABSOLUTE");
  const parent = assertCanonicalPrivateOutputParent(path.dirname(value), "OUTPUT_PARENT");
  const target = path.join(parent, path.basename(value));
  return fs.lstatSync(target, { throwIfNoEntry: false })
    ? assertCanonicalPrivateExistingDirectory(target, "OUTPUT_DIR")
    : assertCanonicalAbsentChildPath(value, "OUTPUT_DIR", "OUTPUT_PARENT");
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

export function runExecutionPlanCli(argv = process.argv.slice(2)) {
  try {
    const [command, ...rest] = argv;
    const values = options(rest);
    if (command === "build") {
      requireOptions(values, ["repo", "parent", "review", "review-binding", "review-dispatch-binding", "context", "out", "json"], ["repo", "parent", "context"]);
      const input = liveInput(values);
      assertFreshExecutionInput(input);
      const plan = compileExecutionPlan(input);
      const finalInput = liveInput(values);
      assertFreshExecutionInput(finalInput);
      if (fingerprint(compileExecutionPlan(finalInput)) !== fingerprint(plan)) throw new Error("SOURCE_OR_PLAN_DRIFT");
      write(values.get("out"), plan);
      return 0;
    }
    if (command === "verify") {
      requireOptions(values, ["plan", "repo", "parent", "review", "review-binding", "review-dispatch-binding", "context", "json"], ["plan", "context"]);
      const plan = json(values.get("plan"));
      const input = liveInput(values, { plan });
      const result = verifyExecutionPlan(plan, input, { reloadInput: () => liveInput(values, { plan }) });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return result.status === "READY" ? 0 : 1;
    }
    if (command === "apply") {
      requireOptions(values, ["plan", "repo", "parent", "review", "review-binding", "review-dispatch-binding", "context", "expected-fingerprint", "case-id", "approval-id", "controller-cli", "controller-config", "output-dir", "json"], ["plan", "context", "expected-fingerprint", "case-id", "approval-id", "controller-cli", "controller-config", "output-dir"]);
      const plan = json(values.get("plan"));
      const outputDir = outputDirectory(values.get("output-dir"));
      const nextCommand = [
        "node",
        shellQuote(values.get("controller-cli")),
        "start",
        "--config",
        shellQuote(values.get("controller-config")),
        "--plan",
        shellQuote(path.join(outputDir, "release-plan.json")),
        "--approve-plan",
        shellQuote(releasePlanDigest(plan)),
        "--json",
      ].join(" ");
      const input = liveInput(values, { plan });
      if (values.get("expected-fingerprint") !== fingerprint(plan)) throw new Error("EXPECTED_FINGERPRINT_MISMATCH");
      const result = applyExecutionPlan({ plan, input, reloadInput: () => liveInput(values, { plan }), store: createPlanningCaseStore(), caseId: values.get("case-id"), approvalId: values.get("approval-id"), expectedFingerprint: values.get("expected-fingerprint"), outputDir, nextCommand });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return result.status === "COMPLETE" ? 0 : 1;
    }
    throw new Error("USAGE: execution-plan build|verify|apply");
  } catch (error) {
    process.stderr.write(`ERROR ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}
