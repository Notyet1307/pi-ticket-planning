import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { reviewBindingForAdmission } from "../admission/review-transport.mjs";
import { compileExecutionPlan } from "../execution-plan/compiler.mjs";
import { createControllerAdapter } from "../execution-plan/controller-adapter.mjs";
import { canonical, fingerprint, releasePlanDigest } from "../execution-plan/domain.mjs";
import {
  assertCanonicalExistingDirectory,
  assertCanonicalPrivateExistingFile,
} from "../execution-plan/private-paths.mjs";
import { buildReviewerDispatchBinding } from "../extensions/reviewer-one-shot-gate.mjs";
import { validateArtifact } from "../protocol/kernel.mjs";
import { DELIVERY_GRAPH_MARKER, computeSpecContentHash, hashText } from "./check-delivery-graph.mjs";
import { checkTicketContext } from "./check-ticket-context.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTROLLER_PLAN = "herdr-codex-controller:release-plan:v2";
const CONTRACT_LOCK = path.join(ROOT, "compatibility", "codex-controller-contract.json");
const PLANNER_SCHEMA = path.join(ROOT, "schemas", "herdr-codex-release-plan-v2.schema.json");
const HEX = /^[a-f0-9]{64}$/;

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024, shell: false, ...options });
}

function requireRun(result, code) {
  if (result.error || result.signal || result.status !== 0) throw new Error(code);
  return result.stdout.trim();
}

function git(repository, args, code = "TEMP_GIT_FAILED") {
  return requireRun(run("git", ["-C", repository, ...args]), code);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fixtureConfig(root) {
  return [
    "examples/controller.config.example.json",
    "fixtures/controller.json",
    "fixtures/config.json",
    "test/fixtures/controller.json",
    "controller.config.example.json",
    "config.example.json",
  ].map((file) => path.join(root, file)).find((file) => {
    try { return Boolean(assertCanonicalPrivateExistingFile(file, "CONTROLLER_CONFIG_FIXTURE")); } catch { return false; }
  });
}

function reviewedInput({ repositoryPath, baseSha, repo, baseRef }) {
  const child = {
    id: "101",
    title: "Build the contract canary artifact",
    state: "open",
    labels: ["needs-triage"],
    blockedBy: [],
    updatedAt: "2026-08-20T00:00:00.000Z",
    body: `## What to build
Build the contract canary artifact.
## Primary verification
Validate the exact Controller Release Plan.
## Acceptance criteria
- [ ] The exact Plan passes Controller validation.
- [ ] An extra key fails validation.
- [ ] A missing key fails validation.
## Invariants and guardrails
No Controller job or network operation starts.
## Out of scope
Controller execution.`,
  };
  const source = { identity: "contract-canary", revision: "r1", baseSha, baseRef };
  const spec = `## Delivery outcome
Prove the Planner and Controller accept one identical Release Plan v2.
## Behavioral scenarios
### S1: validate the contract
Observable result: Both repositories accept the same exact Plan.
Important failure behavior: Extra or missing keys fail closed.
Exit state or produced artifact: A bounded digest comparison exists.
## Release signal mapping
- S1 maps to matching Plan validation and digest.
## Walking skeleton target
Compile Plan, validate Plan, compare digest.
## Decisions
- Preserve Controller v1 readability outside this Planner-owned v2 canary.
## Constraints and dependencies
- Never call doctor, start, Codex, GitHub, or network writes.
## Out of scope
Controller execution.`;
  const graph = {
    version: 2,
    source: { identity: source.identity, revision: source.revision, baseSha, specContentHash: `sha256:${"0".repeat(64)}` },
    scenarios: [{ id: "S1", behavior: "Validate one Plan", entry: "external:fixture", exit: "contract-result", releaseSignal: "matching digest", smallestLoop: true }],
    children: [{ id: child.id, title: child.title, coverageRole: "DIRECT", sourceScenarios: ["S1"], blockedBy: [], externalBlockers: [], bodyHash: hashText(child.body), startingState: "fixture", primaryVerification: "Validate the exact Controller Release Plan.", executionLane: "AGENT" }],
    walkingSkeleton: [child.id],
  };
  const provisional = `${spec}\n\n## Ticket coverage\n\n${DELIVERY_GRAPH_MARKER}\n\n\`\`\`json\n${JSON.stringify(graph)}\n\`\`\``;
  graph.source.specContentHash = computeSpecContentHash(provisional);
  const parent = {
    id: "100",
    title: "Controller contract canary",
    body: `${spec}\n\n## Ticket coverage\n\n${DELIVERY_GRAPH_MARKER}\n\n\`\`\`json\n${JSON.stringify(graph)}\n\`\`\``,
    state: "open",
    labels: ["needs-triage"],
    blockedBy: [],
    updatedAt: "2026-08-20T00:00:00.000Z",
  };
  const input = {
    kind: "DELIVERY_GRAPH",
    repo,
    repositoryPath,
    source,
    parent,
    children: [child],
    contextChecks: [{ candidateId: child.id, result: checkTicketContext({ repo: repositoryPath, base: baseSha, body: child.body }) }],
    policy: { accepted: true, identity: "contract-canary-policy", digest: fingerprint("contract-canary-policy") },
    review: {
      schema: "pi-ticket-planning:admission-review:v1",
      reviewer: "ticket-readiness-reviewer",
      reviewedAt: "2026-08-20T00:00:00.000Z",
      source: { identity: source.identity, revision: source.revision, baseSha },
      axes: Object.fromEntries(["candidateReadiness", "contextQuality", "deliveryGraph", "scenarioCoverage", "walkingSkeleton", "strictFrontier", "executionLane", "inputBinding"].map((axis) => [axis, "PASS"])),
      graphVerdict: "READY",
      candidates: [{ id: child.id, verdict: "READY", executionLane: "AGENT" }],
    },
  };
  const binding = reviewBindingForAdmission(input);
  input.reviewBinding = structuredClone(binding);
  input.review.inputBinding = structuredClone(binding);
  input.reviewDispatchBinding = buildReviewerDispatchBinding({
    parentSessionId: "contract-canary-parent",
    childRunId: "contract-canary-run",
    childSessionId: "contract-canary-child",
    childFileDigest: fingerprint("contract-canary-child"),
    inputDigest: binding.inputDigest,
    outputDigest: fingerprint(input.review),
    dispatchOrdinal: 1,
    totalDispatches: 1,
  });
  return input;
}

function invalidPlanRejected(cli, config, file, plan, nodeArgs) {
  fs.writeFileSync(file, `${JSON.stringify(plan)}\n`, { mode: 0o600 });
  const result = run(process.execPath, [...nodeArgs, cli, "plan", "validate", "--config", config, "--plan", file, "--json"]);
  if (result.status !== 0) return true;
  try { return JSON.parse(result.stdout).ok !== true; } catch { return true; }
}

function controllerCli(root, temporary) {
  const nodeModules = path.join(root, "node_modules");
  const tsc = path.join(nodeModules, "typescript", "bin", "tsc");
  if (!fs.existsSync(nodeModules) || !fs.existsSync(tsc)) {
    throw new Error(`CONTROLLER_NOT_BUILT: run npm --prefix '${root.replaceAll("'", `'"'"'`)}' ci --ignore-scripts --no-audit --no-fund, then rerun the canary`);
  }
  const buildRoot = path.join(temporary, "controller-build");
  fs.mkdirSync(buildRoot, { mode: 0o700 });
  requireRun(run("git", ["-C", root, "checkout-index", "--all", `--prefix=${buildRoot}${path.sep}`]), "CONTROLLER_BUILD_EXPORT_FAILED");
  fs.symlinkSync(nodeModules, path.join(buildRoot, "node_modules"), "dir");
  const cli = path.join(buildRoot, "dist", "src", "cli.js");
  const built = run(process.execPath, [
    "--permission",
    "--allow-fs-read=*",
    `--allow-fs-write=${buildRoot}`,
    assertCanonicalPrivateExistingFile(tsc, "CONTROLLER_TYPESCRIPT"),
    "-p",
    path.join(buildRoot, "tsconfig.json"),
  ], {
    cwd: buildRoot,
    timeout: 120_000,
  });
  if (built.error?.code === "ETIMEDOUT") throw new Error("CONTROLLER_BUILD_TIMEOUT");
  if (built.error?.code === "ENOBUFS") throw new Error("CONTROLLER_BUILD_OUTPUT_TOO_LARGE");
  if (built.error || built.signal || built.status !== 0 || !fs.existsSync(cli)) throw new Error("CONTROLLER_BUILD_FAILED");
  fs.chmodSync(cli, 0o700);
  return assertCanonicalPrivateExistingFile(cli, "CONTROLLER_CLI");
}

function contractRoot(value) {
  if (typeof value !== "string" || !path.isAbsolute(value) || !fs.existsSync(value)) {
    throw new Error("CONTROLLER_UNAVAILABLE: an absolute Controller checkout is required; no canary was run");
  }
  return assertCanonicalExistingDirectory(value, "CONTROLLER_ROOT");
}

function contractVectors({ cli, sourceConfig, temporary, nodeArgs = [] }) {
  fs.mkdirSync(temporary, { recursive: true, mode: 0o700 });
  fs.chmodSync(temporary, 0o700);
  const repository = path.join(temporary, "repo");
  fs.mkdirSync(repository, { mode: 0o700 });
  git(repository, ["init", "-q"]);
  git(repository, ["config", "user.email", "contract@example.invalid"]);
  git(repository, ["config", "user.name", "Contract Canary"]);
  fs.writeFileSync(path.join(repository, "seed.txt"), "contract canary\n", { mode: 0o600 });
  git(repository, ["add", "seed.txt"]);
  requireRun(run("git", ["-C", repository, "commit", "-qm", "contract canary"], {
    env: { ...process.env, GIT_AUTHOR_DATE: "2026-08-20T00:00:00Z", GIT_COMMITTER_DATE: "2026-08-20T00:00:00Z" },
  }), "TEMP_GIT_FAILED");
  const baseSha = git(repository, ["rev-parse", "HEAD"]);

  const config = path.join(temporary, "controller.json");
  fs.copyFileSync(sourceConfig, config);
  fs.chmodSync(config, 0o600);
  const adapter = createControllerAdapter({ cli, config, nodeArgs });
  const controller = adapter.config();
  const repo = controller.config?.repo;
  const baseRef = controller.config?.baseRef;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo ?? "") || typeof baseRef !== "string") throw new Error("CONTROLLER_CONFIG_CONTRACT_INVALID");
  const input = reviewedInput({ repositoryPath: repository, baseSha, repo, baseRef });
  const draft = compileExecutionPlan(input, { controller });
  if (!validateArtifact(draft.releasePlan, { identity: CONTROLLER_PLAN }).ok) throw new Error("PLANNER_SCHEMA_POSITIVE_VECTOR_REJECTED");
  const validated = adapter.validatePlan(draft.releasePlan, controller.configDigest, controller.configIdentity);
  const plannerPlanDigest = releasePlanDigest(draft.releasePlan);
  if (!HEX.test(validated.planDigest) || validated.planDigest !== plannerPlanDigest
    || JSON.stringify(canonical(validated.plan)) !== JSON.stringify(canonical(draft.releasePlan))) throw new Error("CONTROLLER_PLAN_VECTOR_MISMATCH");

  const vectorFile = path.join(temporary, "release-plan-vector.json");
  const { parentIssue: _parentIssue, ...missingRequired } = draft.releasePlan;
  const vectors = [
    ["extraTopLevel", { ...draft.releasePlan, unexpected: true }],
    ["missingRequired", missingRequired],
    ["extraSource", { ...draft.releasePlan, source: { ...draft.releasePlan.source, unexpected: true } }],
    ["extraIssue", { ...draft.releasePlan, issues: draft.releasePlan.issues.map((issue, index) => index === 0 ? { ...issue, unexpected: true } : issue) }],
  ];
  for (const [, vector] of vectors) {
    if (validateArtifact(vector, { identity: CONTROLLER_PLAN }).ok || !invalidPlanRejected(cli, config, vectorFile, vector, nodeArgs)) {
      throw new Error("CONTROLLER_SCHEMA_VECTOR_MISMATCH");
    }
  }

  return {
    status: "PASS",
    configDigest: controller.configDigest,
    planDigest: validated.planDigest,
    plannerPlanDigest,
    releasePlanFingerprint: fingerprint(draft.releasePlan),
    vectors: Object.fromEntries(vectors.map(([name]) => [name, "REJECTED"])),
  };
}

export function runControllerContractVectors({ cli, sourceConfig }) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "codex-controller-vectors-"));
  try {
    fs.chmodSync(temporary, 0o700);
    return contractVectors({ cli, sourceConfig, temporary });
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

export function runControllerContractCanary({ controllerRoot, lock = JSON.parse(fs.readFileSync(CONTRACT_LOCK, "utf8")) }) {
  const root = contractRoot(controllerRoot);
  if (!validateArtifact(lock).ok) throw new Error("CONTROLLER_CONTRACT_LOCK_INVALID");
  const controllerCommit = git(root, ["rev-parse", "HEAD"], "CONTROLLER_GIT_UNAVAILABLE");
  if (controllerCommit !== lock.commit) throw new Error("CONTROLLER_COMMIT_DRIFT");
  if (git(root, ["status", "--porcelain=v1", "--untracked-files=all"], "CONTROLLER_GIT_UNAVAILABLE")) throw new Error("CONTROLLER_WORKTREE_DIRTY");

  const plannerSchema = assertCanonicalPrivateExistingFile(PLANNER_SCHEMA, "PLANNER_SCHEMA");
  const controllerSchema = assertCanonicalPrivateExistingFile(path.join(root, lock.schemaPath), "CONTROLLER_SCHEMA");
  const plannerBytes = fs.readFileSync(plannerSchema);
  const controllerBytes = fs.readFileSync(controllerSchema);
  const plannerSchemaSha256 = sha256(plannerBytes);
  const controllerSchemaSha256 = sha256(controllerBytes);
  if (!HEX.test(lock.schemaSha256)
    || plannerSchemaSha256 !== lock.schemaSha256
    || controllerSchemaSha256 !== lock.schemaSha256
    || !plannerBytes.equals(controllerBytes)) throw new Error("CONTROLLER_SCHEMA_DRIFT");

  const sourceConfig = fixtureConfig(root);
  if (!sourceConfig) throw new Error("CONTROLLER_CONFIG_FIXTURE_UNAVAILABLE");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "codex-controller-contract-"));
  try {
    fs.chmodSync(temporary, 0o700);
    if (!process.allowedNodeEnvironmentFlags.has("--permission") || !process.allowedNodeEnvironmentFlags.has("--allow-net")) {
      throw new Error("CONTROLLER_BUILD_ISOLATION_UNAVAILABLE");
    }
    const nodeArgs = ["--permission", "--allow-fs-read=*"];
    const vectors = contractVectors({ cli: controllerCli(root, temporary), sourceConfig, temporary: path.join(temporary, "vectors"), nodeArgs });
    return { ...vectors, controllerCommit, schemaSha256: plannerSchemaSha256, controllerSource: "exact-tracked-index", networkIsolation: "node-permission-deny-net" };
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function requestedControllerRoot(argv = process.argv.slice(2), env = process.env) {
  if (argv.length !== 0 && (argv.length !== 2 || argv[0] !== "--controller-root" || !argv[1])) throw new Error("INVALID_OPTIONS");
  return argv.length === 2 ? argv[1] : env.HERDR_CODEX_CONTROLLER_ROOT ?? path.resolve(ROOT, "..", "herdr-codex-controller");
}

function main() {
  try {
    process.stdout.write(`${JSON.stringify(runControllerContractCanary({ controllerRoot: requestedControllerRoot() }))}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`ERROR ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) process.exitCode = main();
