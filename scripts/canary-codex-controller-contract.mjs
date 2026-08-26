import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { reviewBindingForAdmission } from "../admission/review-transport.mjs";
import { compileExecutionPlan } from "../execution-plan/compiler.mjs";
import { createControllerAdapter } from "../execution-plan/controller-adapter.mjs";
import { canonical, fingerprint, releasePlanDigest } from "../execution-plan/domain.mjs";
import { buildReviewerDispatchBinding } from "../extensions/reviewer-one-shot-gate.mjs";
import { validateArtifact } from "../protocol/kernel.mjs";
import { DELIVERY_GRAPH_MARKER, computeSpecContentHash, hashText } from "./check-delivery-graph.mjs";
import { checkTicketContext } from "./check-ticket-context.mjs";

const CONTROLLER_PLAN = "herdr-codex-controller:release-plan:v2";
const HEX = /^[a-f0-9]{64}$/;

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024, shell: false, ...options });
}

function requireRun(result, code) {
  if (result.error || result.signal || result.status !== 0) throw new Error(code);
  return result.stdout.trim();
}

function git(repository, args) {
  return requireRun(run("git", ["-C", repository, ...args]), "TEMP_GIT_FAILED");
}

function fixtureConfig(root) {
  return [
    "fixtures/controller.json",
    "fixtures/config.json",
    "test/fixtures/controller.json",
    "controller.config.example.json",
    "config.example.json",
  ].map((file) => path.join(root, file)).find((file) => {
    try { return fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink(); } catch { return false; }
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

function invalidPlanRejected(cli, config, file, plan) {
  fs.writeFileSync(file, `${JSON.stringify(plan)}\n`, { mode: 0o600 });
  const result = run(process.execPath, [cli, "plan", "validate", "--config", config, "--plan", file, "--json"]);
  if (result.status !== 0) return true;
  try { return JSON.parse(result.stdout).ok !== true; } catch { return true; }
}

function main() {
  const index = process.argv.indexOf("--controller-root");
  const requested = index >= 0 ? process.argv[index + 1] : process.env.HERDR_CODEX_CONTROLLER_ROOT;
  const controllerRoot = requested ?? path.resolve("..", "herdr-codex-controller");
  if (!path.isAbsolute(controllerRoot) || !fs.existsSync(controllerRoot) || !fs.statSync(controllerRoot).isDirectory()) {
    process.stderr.write("CONTROLLER_UNAVAILABLE: an absolute Controller checkout is required; no canary was run.\n");
    return 2;
  }
  const cli = path.join(controllerRoot, "dist", "src", "cli.js");
  const sourceConfig = fixtureConfig(controllerRoot);
  if (!fs.existsSync(cli) || !sourceConfig) {
    process.stderr.write("CONTROLLER_CONTRACT_FIXTURE_UNAVAILABLE: require dist/src/cli.js and a Controller-owned config fixture; no canary was run.\n");
    return 2;
  }

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "codex-controller-contract-"));
  try {
    fs.chmodSync(temporary, 0o700);
    const repository = path.join(temporary, "repo");
    fs.mkdirSync(repository, { mode: 0o700 });
    git(repository, ["init", "-q"]);
    git(repository, ["config", "user.email", "contract@example.invalid"]);
    git(repository, ["config", "user.name", "Contract Canary"]);
    fs.writeFileSync(path.join(repository, "seed.txt"), "contract canary\n", { mode: 0o600 });
    git(repository, ["add", "seed.txt"]);
    git(repository, ["commit", "-qm", "contract canary"]);
    const baseSha = git(repository, ["rev-parse", "HEAD"]);

    const config = path.join(temporary, "controller.json");
    fs.copyFileSync(sourceConfig, config);
    fs.chmodSync(config, 0o600);
    const adapter = createControllerAdapter({ cli, config });
    const controller = adapter.config();
    const repo = controller.config?.repo;
    const baseRef = controller.config?.baseRef;
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo ?? "") || typeof baseRef !== "string") throw new Error("CONTROLLER_CONFIG_CONTRACT_INVALID");
    const input = reviewedInput({ repositoryPath: repository, baseSha, repo, baseRef });
    const draft = compileExecutionPlan(input, { controller });
    const validated = adapter.validatePlan(draft.releasePlan);
    if (!HEX.test(validated.planDigest) || validated.planDigest !== releasePlanDigest(draft.releasePlan)
      || JSON.stringify(canonical(validated.plan)) !== JSON.stringify(canonical(draft.releasePlan))) throw new Error("CONTROLLER_PLAN_VECTOR_MISMATCH");

    const vector = path.join(temporary, "release-plan-vector.json");
    const extra = { ...draft.releasePlan, unexpected: true };
    const { parentIssue: _parentIssue, ...missing } = draft.releasePlan;
    if (validateArtifact(extra, { identity: CONTROLLER_PLAN }).ok
      || validateArtifact(missing, { identity: CONTROLLER_PLAN }).ok
      || !invalidPlanRejected(cli, config, vector, extra)
      || !invalidPlanRejected(cli, config, vector, missing)) throw new Error("CONTROLLER_SCHEMA_VECTOR_MISMATCH");

    process.stdout.write(`${JSON.stringify({ status: "PASS", configDigest: controller.configDigest, planDigest: validated.planDigest, releasePlanFingerprint: fingerprint(draft.releasePlan) })}\n`);
    return 0;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`ERROR ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
