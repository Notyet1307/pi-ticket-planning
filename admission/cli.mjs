import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runHarnessReadiness } from "../scripts/readiness-receipt.mjs";
import { buildAdmissionPlan, buildStandaloneAdmissionPlan } from "./plan.mjs";
import { applyAdmissionPlan } from "./apply.mjs";
import { createGitHubAdapter } from "./github-adapter.mjs";
import { createAdmissionReviewInput, materializeAdmissionReviewInput } from "./review-transport.mjs";
import { safeError } from "./domain.mjs";
import { requireAdmissionCapabilities } from "../capabilities/admission.mjs";
import { createPlanningCaseStore } from "../planning-case/store.mjs";

function parseOptions(argv) {
  const values = new Map();
  const allowed = new Set([
    "input", "repo", "parent", "issue", "review", "context", "out", "plan", "expected-fingerprint",
    "harness-cli", "harness-config", "base",
    "review-binding", "review-dispatch-binding", "review-dir", "reviewed-at",
    "case-id", "approval-id",
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("options must be --name value pairs");
    const name = key.slice(2);
    if (!allowed.has(name)) throw new Error(`unknown option --${name}`);
    if (values.has(name)) throw new Error(`duplicate option --${name}`);
    values.set(name, value);
  }
  return values;
}

function requireOptions(values, allowed, required) {
  for (const name of values.keys()) if (!allowed.includes(name)) throw new Error(`option --${name} is not valid for this command`);
  for (const name of required) if (!values.has(name)) throw new Error(`--${name} is required`);
}

function writeJson(target, value) {
  const output = `${JSON.stringify(value, null, 2)}\n`;
  if (!target || target === "-") process.stdout.write(output);
  else fs.writeFileSync(path.resolve(target), output, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

function preflightJsonTarget(target) {
  if (!target || target === "-") return;
  const resolved = path.resolve(target);
  if (fs.existsSync(resolved)) throw new Error(`output already exists: ${resolved}`);
  fs.accessSync(path.dirname(resolved), fs.constants.W_OK);
}

function writeApplyResult(target, result) {
  try {
    writeJson(target, result);
  } catch (error) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    console.error(`WARN Admission result file was not written: ${safeError(error instanceof Error ? error.message : error)}`);
  }
}

function readJson(target, name) {
  if (!target) throw new Error(`${name} is required`);
  const text = target === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(path.resolve(target), "utf8");
  return JSON.parse(text);
}

function reviewRequiresHarness(review, target) {
  return review?.candidates?.some((candidate) => String(candidate.id) === String(target) && candidate.executionLane === "AGENT") === true;
}

function executeReadiness(options, { repo, source }) {
  return runHarnessReadiness({
    harnessCli: options.get("harness-cli"),
    harnessConfig: options.get("harness-config"),
    repo,
    baseSha: source?.baseSha,
  });
}

function planFromOptions(options) {
  const suppliedBinding = readJson(options.get("review-binding"), "--review-binding");
  const reviewBinding = suppliedBinding.binding ?? suppliedBinding;
  const reviewDispatchBinding = readJson(options.get("review-dispatch-binding"), "--review-dispatch-binding");
  if (options.has("input")) {
    const input = readJson(options.get("input"), "--input");
    requireAdmissionCapabilities(input.capabilityReceipt, { repo: input.repo, baseSha: input.source?.baseSha });
    const required = input.candidate ? reviewRequiresHarness(input.review, input.candidate.id) : true;
    return input.candidate
      ? buildStandaloneAdmissionPlan({ ...input, reviewBinding, reviewDispatchBinding, harness: required ? executeReadiness(options, input) : null })
      : buildAdmissionPlan({ ...input, reviewBinding, reviewDispatchBinding, harness: executeReadiness(options, input) });
  }
  if (options.has("parent") === options.has("issue")) throw new Error("choose exactly one of --parent or --issue");
  const repo = options.get("repo");
  const kind = options.has("issue") ? "STANDALONE" : "DELIVERY_GRAPH";
  const target = options.get(kind === "STANDALONE" ? "issue" : "parent");
  const context = readJson(options.get("context"), "--context");
  const review = readJson(options.get("review"), "--review");
  const adapter = createGitHubAdapter({ repo, kind, target, context });
  const state = adapter.read();
  requireAdmissionCapabilities(context.capabilityReceipt, { repo, baseSha: state.source?.baseSha });
  if (kind === "STANDALONE") {
    const required = reviewRequiresHarness(review, state.candidate?.id);
    return buildStandaloneAdmissionPlan({
      repo,
      repositoryPath: state.repositoryPath,
      candidate: state.candidate,
      source: state.source,
      policy: state.policy,
      contextChecks: state.contextChecks,
      harness: required ? executeReadiness(options, { repo, source: state.source }) : null,
      review,
      reviewBinding,
      reviewDispatchBinding,
      currentCheckpoint: state.currentCheckpoint,
    });
  }
  return buildAdmissionPlan({
    repo,
    repositoryPath: state.repositoryPath,
    parent: state.parent,
    source: state.source,
    specAcceptance: context.specAcceptance,
    deliveryGraph: context.deliveryGraph,
    roadmapGraph: context.roadmapGraph,
    roadmapParent: state.roadmapParent,
    children: state.children,
    policy: state.policy,
    contextChecks: state.contextChecks,
    harness: executeReadiness(options, { repo, source: state.source }),
    review,
    reviewBinding,
    reviewDispatchBinding,
    currentCheckpoint: state.currentCheckpoint,
  });
}

export function runAdmissionCli() {
  try {
    const [command, ...argv] = process.argv.slice(2);
    const options = parseOptions(argv);
    if (command === "readiness") {
      requireOptions(options, ["repo", "base", "harness-cli", "harness-config", "out"], ["repo", "base", "harness-cli", "harness-config"]);
      preflightJsonTarget(options.get("out"));
      writeJson(options.get("out"), runHarnessReadiness({
        harnessCli: options.get("harness-cli"),
        harnessConfig: options.get("harness-config"),
        repo: options.get("repo"),
        baseSha: options.get("base"),
      }));
    } else if (command === "review-input") {
      requireOptions(options, ["input", "review-dir", "reviewed-at", "out"], ["input", "review-dir"]);
      const input = readJson(options.get("input"), "--input");
      const reviewInput = createAdmissionReviewInput({
        ...input,
        reviewedAt: options.get("reviewed-at") ?? input.reviewedAt,
      });
      preflightJsonTarget(options.get("out"));
      writeJson(options.get("out"), materializeAdmissionReviewInput(reviewInput, options.get("review-dir")));
    } else if (command === "plan") {
      if (options.has("input")) {
        requireOptions(options, ["input", "review-binding", "review-dispatch-binding", "harness-cli", "harness-config", "out"], ["input", "review-binding", "review-dispatch-binding"]);
      } else {
        requireOptions(options, ["repo", "parent", "issue", "review", "review-binding", "review-dispatch-binding", "context", "harness-cli", "harness-config", "out"], ["repo", "review", "review-binding", "review-dispatch-binding", "context"]);
      }
      preflightJsonTarget(options.get("out"));
      writeJson(options.get("out"), planFromOptions(options));
    } else if (command === "apply") {
      requireOptions(options, ["plan", "expected-fingerprint", "context", "harness-cli", "harness-config", "case-id", "approval-id", "out"], ["plan", "expected-fingerprint", "context", "case-id", "approval-id"]);
      const plan = readJson(options.get("plan"), "--plan");
      const context = readJson(options.get("context"), "--context");
      requireAdmissionCapabilities(context.capabilityReceipt, { repo: plan.repo, baseSha: plan.reviewed?.source?.baseSha });
      context.harness = plan.reviewed?.harness
        ? executeReadiness(options, { repo: plan.repo, source: plan.reviewed.source })
        : null;
      preflightJsonTarget(options.get("out"));
      const adapter = createGitHubAdapter({ repo: plan.repo, kind: plan.kind, target: plan.target, context });
      const result = applyAdmissionPlan(plan, adapter, {
        expectedFingerprint: options.get("expected-fingerprint"),
        planningCaseStore: createPlanningCaseStore(),
        caseId: options.get("case-id"),
        approvalId: options.get("approval-id"),
      });
      writeApplyResult(options.get("out"), result);
      if (result.status !== "COMPLETE") process.exitCode = 1;
    } else {
      throw new Error("usage: readiness --repo OWNER/REPO --base SHA --harness-cli FILE --harness-config FILE [--out FILE]; review-input --input FILE --review-dir PRIVATE_DIR [--reviewed-at ISO8601] [--out FILE]; plan (--input FILE | --repo OWNER/REPO (--parent NUMBER | --issue NUMBER) --review FILE --context FILE) --review-binding FILE --review-dispatch-binding FILE --harness-cli FILE --harness-config FILE [--out FILE]; apply --plan FILE --expected-fingerprint SHA256 --case-id PC-ID --approval-id F-ID --context FILE --harness-cli FILE --harness-config FILE [--out FILE]");
    }
  } catch (error) {
    console.error(`ERROR ${safeError(error instanceof Error ? error.message : error)}`);
    process.exitCode = 2;
  }
}

const ownPath = fs.realpathSync(fileURLToPath(import.meta.url));
if (process.argv[1] && fs.realpathSync(process.argv[1]) === ownPath) runAdmissionCli();
