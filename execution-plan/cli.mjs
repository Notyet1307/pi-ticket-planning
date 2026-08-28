import fs from "node:fs";
import path from "node:path";
import { createPlanningCaseStore } from "../planning-case/store.mjs";
import { createGitHubAdapter } from "../admission/github-adapter.mjs";
import { compileExecutionPlan } from "./compiler.mjs";
import { createControllerAdapter } from "./controller-adapter.mjs";
import { applyExecutionPlan } from "./handoff-apply.mjs";
import {
  assertCanonicalAbsentChildPath,
  assertCanonicalPrivateExistingDirectory,
  assertCanonicalPrivateExistingFile,
  assertCanonicalPrivateOutputParent,
} from "./private-paths.mjs";
import { verifyExecutionPlan } from "./validate.mjs";

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
  const parent = values.get("parent") ?? plan?.target;
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
      requireOptions(values, ["input", "repo", "parent", "review", "review-binding", "review-dispatch-binding", "context", "controller-cli", "controller-config", "out", "json"], ["controller-cli", "controller-config"]);
      if (values.has("input") === values.has("repo")) throw new Error("CHOOSE_INPUT_OR_LIVE_GITHUB");
      if (!values.has("input") && !values.has("parent")) throw new Error("MISSING_OPTION:parent");
      const input = values.has("input") ? json(values.get("input")) : liveInput(values); const adapter = createControllerAdapter({ cli: values.get("controller-cli"), config: values.get("controller-config") });
      const config = adapter.config();
      const draft = compileExecutionPlan(input, { controller: config });
      const validated = adapter.validatePlan(draft.releasePlan, config.configDigest, config.configIdentity);
      const plan = compileExecutionPlan(input, { controller: { ...config, planDigest: validated.planDigest, provenance: validated.provenance } });
      write(values.get("out"), plan);
      return 0;
    }
    if (command === "verify") {
      requireOptions(values, ["plan", "input", "repo", "parent", "review", "review-binding", "review-dispatch-binding", "context", "controller-cli", "controller-config", "json"], ["plan", "controller-cli", "controller-config"]);
      const plan = json(values.get("plan"));
      if (values.has("input") === values.has("context")) throw new Error("VERIFY_REQUIRES_ONE_SOURCE_INPUT");
      const result = verifyExecutionPlan(plan, values.has("input") ? json(values.get("input")) : liveInput(values, { plan }), createControllerAdapter({ cli: values.get("controller-cli"), config: values.get("controller-config") }));
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return result.status === "READY" ? 0 : 1;
    }
    if (command === "apply") {
      requireOptions(values, ["plan", "input", "repo", "parent", "review", "review-binding", "review-dispatch-binding", "context", "expected-fingerprint", "case-id", "approval-id", "controller-cli", "controller-config", "output-dir", "json"], ["plan", "expected-fingerprint", "case-id", "approval-id", "controller-cli", "controller-config", "output-dir"]);
      const plan = json(values.get("plan"));
      if (values.has("input") === values.has("context")) throw new Error("APPLY_REQUIRES_ONE_SOURCE_INPUT");
      const outputDir = outputDirectory(values.get("output-dir"));
      const nextCommand = [
        "node",
        shellQuote(values.get("controller-cli")),
        "start",
        "--config",
        shellQuote(values.get("controller-config")),
        "--plan",
        shellQuote(path.join(outputDir, "release-plan.json")),
        "--expected-config-digest",
        shellQuote(plan.controller.configDigest),
        "--expected-controller-revision",
        shellQuote(plan.controller.provenance.controller.sourceRevision),
        "--expected-controller-provenance-digest",
        shellQuote(plan.controller.provenance.digest),
        "--json",
      ].join(" ");
      const result = applyExecutionPlan({ plan, input: values.has("input") ? json(values.get("input")) : liveInput(values, { plan }), adapter: createControllerAdapter({ cli: values.get("controller-cli"), config: values.get("controller-config") }), store: createPlanningCaseStore(), caseId: values.get("case-id"), approvalId: values.get("approval-id"), expectedFingerprint: values.get("expected-fingerprint"), outputDir, nextCommand });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return result.status === "COMPLETE" ? 0 : 1;
    }
    throw new Error("USAGE: execution-plan build|verify|apply");
  } catch (error) {
    process.stderr.write(`ERROR ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}
