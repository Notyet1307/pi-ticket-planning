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
import { ingestControllerCompletion } from "../execution-plan/completion-ingest.mjs";
import {
  assertCanonicalExistingDirectory,
  assertCanonicalPrivateExistingFile,
} from "../execution-plan/private-paths.mjs";
import { buildReviewerDispatchBinding } from "../extensions/reviewer-one-shot-gate.mjs";
import { validateArtifact } from "../protocol/kernel.mjs";
import { EXECUTABLE_DELIVERY_SPEC_MARKER, ROADMAP_PARENT_MARKER, hashText } from "./check-delivery-graph.mjs";
import { checkTicketContext } from "./check-ticket-context.mjs";
import { unknownRiskClasses } from "./risk-classes.mjs";
import {
  buildOracleVerifierManifest,
  oracleBindingDigest,
  REQUIRED_REPLAN_TRIGGERS,
  ticketReviewProjection,
} from "./check-ticket-contract.mjs";
import { parseChildTicket } from "../execution-plan/markdown.mjs";
import { assertFreshExecutionInput, executionFreshnessProjection, gitRemoteBase } from "../execution-plan/freshness.mjs";
import { verifyExecutionPlan } from "../execution-plan/validate.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTROLLER_PLAN = "herdr-codex-controller:release-plan:v2";
const CONTRACT_LOCK = path.join(ROOT, "compatibility", "codex-controller-contract.json");
const PLANNER_SCHEMA = path.join(ROOT, "schemas", "herdr-codex-release-plan-v2.schema.json");
const PLANNER_COMPLETION_SCHEMA = path.join(ROOT, "schemas", "herdr-codex-release-completion-v3.schema.json");
const PLANNER_CONFIG_SCHEMA = path.join(ROOT, "schemas", "herdr-codex-controller-config-v3.schema.json");
const PLANNER_HISTORY_SCHEMA = path.join(ROOT, "schemas", "herdr-codex-controller-identity-history-v1.schema.json");
const PLANNER_HISTORY = path.join(ROOT, "compatibility", "controller-identity-history.json");
const PLANNER_TRUST = path.join(ROOT, "compatibility", "codex-controller-trust.json");
const PLANNER_RISK_CLASS_REGISTRY = path.join(ROOT, "contracts", "risk-class-registry.json");
const HEX = /^[a-f0-9]{64}$/;
const REVISION = /^[a-f0-9]{40}$/;

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

function hexDigest(value) { return fingerprint(value).slice(7); }
function withDigest(body) { return { ...body, digest: hexDigest(body) }; }

function exactMirror(plannerPath, controllerPath, expectedSha256, code) {
  const planner = fs.readFileSync(assertCanonicalPrivateExistingFile(plannerPath, `PLANNER_${code}`));
  const controller = fs.readFileSync(assertCanonicalPrivateExistingFile(controllerPath, `CONTROLLER_${code}`));
  if (!HEX.test(expectedSha256) || sha256(planner) !== expectedSha256
    || sha256(controller) !== expectedSha256 || !planner.equals(controller)) throw new Error(code);
  return { bytes: planner, sha256: expectedSha256 };
}

function completionProvenance(lock, repo, planDigest) {
  const binary = { configuredPathDigest: fingerprint("canary-configured"), realPathDigest: fingerprint("canary-real"), byteCount: 1, sha256: fingerprint("canary-binary"), versionOutput: "codex canary" };
  const requiredCheckContractDigest = hexDigest({ version: 1, checks: [{ name: "verify", required: true }] });
  const body = {
    version: 3,
    controller: { version: 1, sourceRevision: lock.commit, sourceManifestDigest: lock.sourceManifestDigest, buildDigest: lock.buildDigest, digest: lock.identityDigest },
    executionRuntime: withDigest({ version: 1, binary, fixedPolicyDigest: hexDigest("canary-fixed-policy"), profilesDisabled: true }),
    remoteIdentity: withDigest({ version: 1, remote: "origin", repo: repo.toLowerCase(), fetchUrl: `https://github.com/${repo.toLowerCase()}.git`, pushUrl: `https://github.com/${repo.toLowerCase()}.git`, fetchTransport: "https", pushTransport: "https" }),
    validationSandbox: withDigest({ version: 1, provider: "codex-permission-profile", binary, policyDigest: hexDigest("canary-sandbox-policy") }),
    requiredCheckContractDigest,
    mergeAuthorityDigest: hexDigest(lock.mergeAuthorityContract),
    identityHistoryDigest: lock.controllerIdentityHistoryDigest,
    executionMode: "release-plan-v2-direct",
    configDigest: hexDigest("C1-config"),
    releasePlan: { version: 2, digest: planDigest },
  };
  return { provenance: withDigest(body), requiredCheckContractDigest };
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
  const oracleBytes = fs.readFileSync(path.join(repositoryPath, "seed.txt"));
  const oracleBody = {
    schema: "pi-ticket-planning:oracle-binding:v1",
    id: "O01",
    owner: { kind: "INDEPENDENT_VERIFICATION", identity: "contract-canary-oracle" },
    artifact: {
      path: "seed.txt",
      format: "text/plain",
      baseSha,
      sha256: `sha256:${sha256(oracleBytes)}`,
      byteCount: oracleBytes.length,
    },
    execution: { command: "npm run verify:oracle:o01" },
    workerMutationAllowed: false,
  };
  const oracle = {
    ...oracleBody,
    verifier: buildOracleVerifierManifest({
      repo: repositoryPath,
      baseSha,
      oracleId: oracleBody.id,
      command: oracleBody.execution.command,
      files: ["scripts/verify-o01.mjs"],
    }),
  };
  const constraints = {
    implementationOwner: "contract-canary-worker",
    riskClasses: ["AUTHORITY_BOUNDARY"],
    scopeBudget: { maxFiles: 2, maxChangedLines: 200 },
    expectedPaths: ["src/plan.ts"],
    protectedPaths: ["seed.txt"],
    replanTriggers: REQUIRED_REPLAN_TRIGGERS,
    primaryVerificationSeams: ["Controller plan validation"],
    integrationOnly: null,
    waivers: [],
  };
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
## Oracle binding
\`\`\`json
${JSON.stringify(oracle)}
\`\`\`
## Execution constraints
\`\`\`json
${JSON.stringify(constraints)}
\`\`\`
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
  const parent = {
    id: "100",
    title: "Controller contract canary",
    body: `${spec}\n\n${EXECUTABLE_DELIVERY_SPEC_MARKER}`,
    state: "open",
    labels: ["needs-triage"],
    blockedBy: [],
    updatedAt: "2026-08-20T00:00:00.000Z",
  };
  source.specContentHash = hashText(spec);
  const acceptanceBody = {
    schema: "pi-ticket-planning:spec-acceptance:v1",
    parent: { number: Number(parent.id), title: parent.title, bodyHash: hashText(parent.body) },
    source: { baseSha, specContentHash: source.specContentHash },
    decision: { caseId: "PC-contract-canary", approvalId: "F-spec-approval", acceptedAt: "2026-08-20T00:00:00.000Z" },
  };
  const packageBytes = fs.readFileSync(path.join(repositoryPath, "package.json"));
  const decisionManifestBody = {
    schema: "pi-ticket-planning:decision-manifest:v1",
    baseSha,
    policy: { identity: "seed-policy", path: "seed.txt", sha256: `sha256:${sha256(oracleBytes)}`, byteCount: oracleBytes.length },
    productRelease: { identity: "contract-canary/r1", path: "package.json", sha256: `sha256:${sha256(packageBytes)}`, byteCount: packageBytes.length },
    decisions: [],
    dependencyHandoffs: [],
  };
  const graph = {
    schema: "pi-ticket-planning:delivery-release-graph:v3",
    kind: "EXECUTABLE_RELEASE",
    executable: true,
    readinessState: "GRAPH_REVIEWED",
    releaseId: "contract-canary-r1",
    releaseOrdinal: 1,
    planningBaseSha: baseSha,
    executionBaseSha: baseSha,
    executionBasePolicy: "PLANNING_BASE_OR_DESCENDANT",
    roadmapDigest: null,
    predecessorReleaseId: null,
    predecessorReceipt: null,
    predecessorReceiptBinding: null,
    specAcceptance: { ...acceptanceBody, digest: fingerprint(acceptanceBody) },
    specAcceptanceBinding: { path: "seed.txt", baseSha, sha256: `sha256:${sha256(oracleBytes)}`, byteCount: oracleBytes.length },
    decisionManifest: { ...decisionManifestBody, digest: fingerprint(decisionManifestBody) },
    decisionManifestBinding: { path: "seed.txt", baseSha, sha256: `sha256:${sha256(oracleBytes)}`, byteCount: oracleBytes.length },
    decisionManifestDigest: `sha256:${sha256(oracleBytes)}`,
    source: { identity: source.identity, revision: source.revision, specContentHash: source.specContentHash },
    scenarios: [{ id: "S1", behavior: "Validate one Plan", entry: "external:fixture", exit: "contract-result", releaseSignal: "matching digest", smallestLoop: true }],
    children: [{
      id: child.id,
      title: child.title,
      coverageRole: "DIRECT",
      sourceScenarios: ["S1"],
      blockedBy: [],
      externalBlockers: [],
      bodyHash: hashText(child.body),
      startingState: "fixture",
      primaryVerification: "Validate the exact Controller Release Plan.",
      primaryVerificationSeams: constraints.primaryVerificationSeams,
      executionLane: "AGENT",
      implementationOwner: constraints.implementationOwner,
      riskClasses: constraints.riskClasses,
      scopeBudget: constraints.scopeBudget,
      expectedPaths: constraints.expectedPaths,
      protectedPaths: constraints.protectedPaths,
      replanTriggers: constraints.replanTriggers,
      oracleBindingDigest: oracleBindingDigest(oracle),
      integrationOnly: null,
      waiverDigests: [],
    }],
    walkingSkeleton: [child.id],
  };
  const input = {
    kind: "DELIVERY_GRAPH",
    repo,
    repositoryPath,
    source,
    parent,
    specAcceptance: graph.specAcceptance,
    deliveryGraph: graph,
    children: [child],
    contextChecks: [{ candidateId: child.id, result: checkTicketContext({ repo: repositoryPath, base: baseSha, body: child.body }) }],
    policy: { accepted: true, identity: "contract-canary-policy", digest: fingerprint("contract-canary-policy") },
    review: {
      schema: "pi-ticket-planning:admission-review:v1",
      reviewer: "ticket-readiness-reviewer",
      reviewedAt: "2026-08-20T00:00:00.000Z",
      source: { identity: source.identity, revision: source.revision, baseSha, specContentHash: source.specContentHash },
      axes: Object.fromEntries(["candidateReadiness", "contextQuality", "deliveryGraph", "scenarioCoverage", "walkingSkeleton", "strictFrontier", "executionLane", "inputBinding"].map((axis) => [axis, "PASS"])),
      graphVerdict: "READY",
      candidates: [{
        id: child.id,
        verdict: "READY",
        executionLane: "AGENT",
        ...ticketReviewProjection({ parsed: parseChildTicket(child.body), graphChild: graph.children[0], graphChildren: graph.children }),
      }],
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

function trackedBinding(repository, baseSha, identity, file, extra = {}) {
  const read = run("git", ["-C", repository, "show", `${baseSha}:${file}`], { encoding: null });
  if (read.error || read.signal || read.status !== 0 || !Buffer.isBuffer(read.stdout)) throw new Error("FRESH_CANARY_ARTIFACT_MISSING");
  return { identity, ...extra, path: file, sha256: `sha256:${sha256(read.stdout)}`, byteCount: read.stdout.length };
}

function artifactBinding(binding, baseSha) {
  return { path: binding.path, baseSha, sha256: binding.sha256, byteCount: binding.byteCount };
}

function commitAndPush(repository, message) {
  git(repository, ["add", "."]);
  git(repository, ["commit", "-qm", message]);
  git(repository, ["push", "origin", "main"]);
  return git(repository, ["rev-parse", "HEAD"]);
}

function rebindExecutionInput(input, baseSha) {
  const parsed = parseChildTicket(input.children[0].body);
  const oracleBytes = fs.readFileSync(path.join(input.repositoryPath, parsed.oracleBinding.artifact.path));
  const oracle = {
    ...parsed.oracleBinding,
    artifact: {
      ...parsed.oracleBinding.artifact,
      baseSha,
      sha256: `sha256:${sha256(oracleBytes)}`,
      byteCount: oracleBytes.length,
    },
  };
  input.children[0].body = input.children[0].body.replace(JSON.stringify(parsed.oracleBinding), JSON.stringify(oracle));
  input.source = { ...input.source, baseSha, remote: "origin" };
  input.deliveryGraph.executionBaseSha = baseSha;
  input.deliveryGraph.children[0].bodyHash = hashText(input.children[0].body);
  input.deliveryGraph.children[0].oracleBindingDigest = oracleBindingDigest(oracle);
  input.contextChecks = [{ candidateId: input.children[0].id, result: checkTicketContext({ repo: input.repositoryPath, base: baseSha, body: input.children[0].body }) }];
  input.review.source = { identity: input.source.identity, revision: input.source.revision, baseSha, specContentHash: input.source.specContentHash };
  input.review.candidates[0] = {
    id: input.children[0].id,
    verdict: "READY",
    executionLane: "AGENT",
    ...ticketReviewProjection({ parsed: parseChildTicket(input.children[0].body), graphChild: input.deliveryGraph.children[0], graphChildren: input.deliveryGraph.children }),
  };
  delete input.reviewBinding;
  delete input.review.inputBinding;
  delete input.reviewDispatchBinding;
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

function freshC1(repository, planningBaseSha, input) {
  fs.mkdirSync(path.join(repository, "evidence"), { recursive: true });
  fs.writeFileSync(path.join(repository, "evidence", "spec-acceptance.json"), `${JSON.stringify(input.deliveryGraph.specAcceptance)}\n`);
  const decisionBody = {
    schema: "pi-ticket-planning:decision-manifest:v1",
    baseSha: planningBaseSha,
    policy: trackedBinding(repository, planningBaseSha, "seed-policy", "seed.txt"),
    productRelease: trackedBinding(repository, planningBaseSha, "contract-canary/r1", "package.json"),
    decisions: [],
    dependencyHandoffs: [],
  };
  const decisionManifest = { ...decisionBody, digest: fingerprint(decisionBody) };
  fs.writeFileSync(path.join(repository, "evidence", "decision-manifest.json"), `${JSON.stringify(decisionManifest)}\n`);
  const executionBaseSha = commitAndPush(repository, "publish C1 evidence");
  input.source.remote = "origin";
  input.deliveryGraph.executionBasePolicy = "PLANNING_BASE_OR_DESCENDANT";
  input.deliveryGraph.planningBaseSha = planningBaseSha;
  input.deliveryGraph.specAcceptanceBinding = artifactBinding(trackedBinding(repository, executionBaseSha, "spec-acceptance", "evidence/spec-acceptance.json"), executionBaseSha);
  input.deliveryGraph.decisionManifest = decisionManifest;
  input.deliveryGraph.decisionManifestBinding = artifactBinding(trackedBinding(repository, executionBaseSha, "decision-manifest", "evidence/decision-manifest.json"), executionBaseSha);
  input.deliveryGraph.decisionManifestDigest = input.deliveryGraph.decisionManifestBinding.sha256;
  return rebindExecutionInput(input, executionBaseSha);
}

function freshC2(repository, c1, mergedMainSha) {
  const handoff = trackedBinding(repository, mergedMainSha, "C1-handoff", "handoff.txt");
  const lock = JSON.parse(fs.readFileSync(CONTRACT_LOCK, "utf8"));
  const planDigest = fingerprint(c1.deliveryGraph).slice(7);
  const { provenance, requiredCheckContractDigest } = completionProvenance(lock, c1.repo, planDigest);
  const completionBody = {
    schema: "herdr-codex-controller:release-completion:v3",
    releaseId: c1.deliveryGraph.releaseId,
    repo: c1.repo,
    baseRef: c1.source.baseRef,
    planDigest,
    sourceBaseSha: c1.deliveryGraph.planningBaseSha,
    candidateSha: c1.source.baseSha,
    issueCommits: [{ issueNumber: Number(c1.children[0].id), sha: c1.source.baseSha }],
    releaseValidationDigest: fingerprint("C1-validation").slice(7),
    reviewResultDigest: fingerprint("C1-review").slice(7),
    pullRequest: { number: 1, headRef: "agent/contract-canary-r1", headSha: c1.source.baseSha, baseRef: c1.source.baseRef, mergeSha: mergedMainSha, mergedAt: "2026-08-20T00:59:00.000Z" },
    requiredChecks: ["verify"],
    mergedMainSha,
    dependencyHandoffDigests: [handoff.sha256],
    controllerProvenance: provenance,
    completedAt: "2026-08-20T01:00:00.000Z",
    digestAlgorithm: lock.digestAlgorithm,
    schemaSha256: `sha256:${lock.completionSchemaSha256}`,
    requiredCheckContractDigest,
  };
  const completion = { ...completionBody, digest: fingerprint(completionBody) };
  const receipt = ingestControllerCompletion(completion);
  fs.writeFileSync(path.join(repository, "evidence", "predecessor.json"), `${JSON.stringify(receipt)}\n`);
  const decisionBody = {
    schema: "pi-ticket-planning:decision-manifest:v1",
    baseSha: mergedMainSha,
    policy: trackedBinding(repository, mergedMainSha, "seed-policy", "seed.txt"),
    productRelease: trackedBinding(repository, mergedMainSha, "contract-canary/r1", "package.json"),
    decisions: [],
    dependencyHandoffs: [trackedBinding(repository, mergedMainSha, "C1-handoff", "handoff.txt")],
  };
  const decisionManifest = { ...decisionBody, digest: fingerprint(decisionBody) };
  fs.writeFileSync(path.join(repository, "evidence", "decision-manifest.json"), `${JSON.stringify(decisionManifest)}\n`);
  const executionBaseSha = commitAndPush(repository, "publish C2 predecessor");
  const input = structuredClone(c1);
  Object.assign(input.deliveryGraph, {
    releaseId: "contract-canary-r2",
    releaseOrdinal: 2,
    executionBasePolicy: "PREDECESSOR_MERGE_OR_DESCENDANT",
    predecessorReleaseId: c1.deliveryGraph.releaseId,
    predecessorReceipt: receipt,
    predecessorReceiptBinding: artifactBinding(trackedBinding(repository, executionBaseSha, "predecessor", "evidence/predecessor.json"), executionBaseSha),
    specAcceptanceBinding: artifactBinding(trackedBinding(repository, executionBaseSha, "spec-acceptance", "evidence/spec-acceptance.json"), executionBaseSha),
  });
  input.deliveryGraph.decisionManifest = decisionManifest;
  input.deliveryGraph.decisionManifestBinding = artifactBinding(trackedBinding(repository, executionBaseSha, "decision-manifest", "evidence/decision-manifest.json"), executionBaseSha);
  input.deliveryGraph.decisionManifestDigest = input.deliveryGraph.decisionManifestBinding.sha256;
  input.roadmapParent = { id: "99", title: "Contract canary Roadmap", body: `# Roadmap\n\n${ROADMAP_PARENT_MARKER}`, state: "open", labels: ["needs-triage"], blockedBy: [], updatedAt: "2026-08-20T01:00:00.000Z" };
  const roadmapBody = { schema: "pi-ticket-planning:roadmap-graph:v1", kind: "ROADMAP", executable: false, readinessState: "PLANNED", roadmapId: "contract-canary", planningBaseSha: input.deliveryGraph.planningBaseSha, parent: { number: 99, title: input.roadmapParent.title, bodyHash: hashText(input.roadmapParent.body) }, plannedReleases: [{ releaseId: c1.deliveryGraph.releaseId, releaseOrdinal: 1, readinessState: "PLANNED", objective: "C1", scenarioCoverage: ["S1"], predecessors: [], candidateTickets: [] }, { releaseId: input.deliveryGraph.releaseId, releaseOrdinal: 2, readinessState: "PLANNED", objective: "C2", scenarioCoverage: input.deliveryGraph.scenarios.map(({ id }) => id), predecessors: [c1.deliveryGraph.releaseId], candidateTickets: input.deliveryGraph.children.map((child) => ({ id: child.id, title: child.title, objective: parseChildTicket(input.children.find(({ id }) => String(id) === String(child.id))?.body).objective, executionLane: "AGENT" })) }] };
  input.roadmapGraph = { ...roadmapBody, digest: fingerprint(roadmapBody) };
  input.deliveryGraph.roadmapDigest = input.roadmapGraph.digest;
  return rebindExecutionInput(input, executionBaseSha);
}

function invalidPlanRejected(cli, config, file, plan, nodeArgs) {
  fs.writeFileSync(file, `${JSON.stringify(plan)}\n`, { mode: 0o600 });
  const result = run(process.execPath, [...nodeArgs, cli, "plan", "validate", "--config", config, "--plan", file, "--json"]);
  if (result.status !== 0) return true;
  try { return JSON.parse(result.stdout).ok !== true; } catch { return true; }
}

function controllerCli(root, temporary, commit) {
  const nodeModules = path.join(root, "node_modules");
  const tsc = path.join(nodeModules, "typescript", "bin", "tsc");
  if (!fs.existsSync(nodeModules) || !fs.existsSync(tsc)) {
    throw new Error(`CONTROLLER_NOT_BUILT: run npm --prefix '${root.replaceAll("'", `'"'"'`)}' ci --ignore-scripts --no-audit --no-fund, then rerun the canary`);
  }
  const buildRoot = path.join(temporary, "controller-build");
  requireRun(run("git", ["clone", "--quiet", "--no-checkout", "--no-hardlinks", root, buildRoot]), "CONTROLLER_BUILD_EXPORT_FAILED");
  requireRun(run("git", ["-C", buildRoot, "checkout", "--quiet", "--detach", commit]), "CONTROLLER_BUILD_EXPORT_FAILED");
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
  return { buildRoot, cli: assertCanonicalPrivateExistingFile(cli, "CONTROLLER_CLI") };
}

function controllerP0RuntimeTests(buildRoot) {
  const suites = [
    { category: "oracle", file: "oracle-verifier.test.js", names: ["each Issue Oracle runs before commit and release validation runs every Oracle again", "every Worker globally protects other Tickets' verifier files and package scripts", "verifier manifest byte drift and hardening drift are REPLAN_REQUIRED"] },
    { category: "sandbox", file: "validation-sandbox.test.js", names: ["interrupted sandbox cleanup is recovered idempotently after restart", "missing sandbox capability blocks before candidate validation", "validation output flooding is bounded and recorded as a failed termination", "validation projection includes admitted changes and excludes ignored Worker state", "validation sandbox denies Controller env, network, and reads or writes outside its root"] },
    { category: "review-config-runtime", file: "config-plan.test.js", names: ["production direct policy requires canonical review, versioned checks, and Controller auto-merge", "production runtime disallows profiles and PATH-resolved Codex binaries"] },
    { category: "review", file: "codex-runner.test.js", names: ["canonical review status is derived from blocking findings"] },
    { category: "ci", file: "github.test.js", names: ["versioned required checks accept configured conclusions and ignore observational failures", "auto-merge is bound to the exact reviewed candidate SHA"] },
    { category: "remote", file: "git-security.test.js", names: ["remote inspection rejects push redirection, URL rewrites, and local endpoints", "remote mismatch is rejected before any push mutation", "remote branch quarantine is expected-head CAS and never deletes a changed head"] },
    { category: "lifecycle", file: "controller.test.js", names: ["semantically inconsistent aggregate review is rejected before push or PR creation", "production v2 completes only after exact candidate, required checks, and merged-base verification", "abort revokes auto-merge and quarantines the exact remote branch", "source drift after auto-merge authorization revokes and quarantines before terminal block", "revocation resumes after interruption between disable and quarantine", "missing and pending required checks reach durable deadlines without resetting on restart", "CI code and infrastructure failures consume separate budgets and only code gets bounded evidence"] },
    { category: "completion-history", file: "completion-export.test.js", names: ["completion export CLI is public, restart-safe, and byte-idempotent", "qualified Controller A completion remains exportable after Controller B is active", "completion export rejects incomplete, drifted, private, and forged evidence"] },
    { category: "prompt-boundary", file: "prompts.test.js", names: ["Planner, Issue, and diagnostic strings stay inside one closed untrusted-data envelope"] },
  ];
  const names = suites.flatMap((suite) => suite.names);
  const files = suites.map((suite) => assertCanonicalPrivateExistingFile(path.join(buildRoot, "dist", "test", suite.file), `CONTROLLER_${suite.category.toUpperCase().replaceAll("-", "_")}_TEST`));
  const pattern = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|");
  const result = run(process.execPath, [
    "--test",
    `--test-name-pattern=${pattern}`,
    ...files,
  ], { cwd: buildRoot, timeout: 180_000, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.signal || result.status !== 0 || names.some((name) => !result.stdout.includes(name))) {
    throw new Error("CONTROLLER_P0_RUNTIME_TEST_FAILED");
  }
  return { status: "PASS", suites: Object.fromEntries(suites.map(({ category, names: tests }) => [category, tests])), evidence: "deterministic-exact-controller-runtime-tests" };
}

function contractRoot(value) {
  if (typeof value !== "string" || !path.isAbsolute(value) || !fs.existsSync(value)) {
    throw new Error("CONTROLLER_UNAVAILABLE: an absolute Controller checkout is required; no canary was run");
  }
  return assertCanonicalExistingDirectory(value, "CONTROLLER_ROOT");
}

function qualifiedCommit(root, expected) {
  const commit = git(root, ["rev-parse", "HEAD"], "CONTROLLER_GIT_UNAVAILABLE");
  if (commit !== expected) throw new Error("CONTROLLER_COMMIT_DRIFT");
  if (git(root, ["status", "--porcelain=v1", "--untracked-files=all"], "CONTROLLER_GIT_UNAVAILABLE")) throw new Error("CONTROLLER_WORKTREE_DIRTY");
  return commit;
}

function legacyPlanVector() {
  return {
    version: 1,
    id: "legacy-plan-is-not-planner-handoff",
    title: "Legacy compatibility vector",
    objective: "Prove Release Plan v1 is outside the qualified Planner handoff.",
    parentIssue: null,
    issues: [{ number: 101, order: 1, dependsOn: [], objective: null, acceptanceCriteria: ["The vector is rejected."], suggestedValidation: [], allowNoop: false }],
    releaseAcceptanceCriteria: ["The direct v2 config rejects this Plan."],
    reviewFocus: [],
  };
}

function contractVectors({ cli, sourceConfig, temporary, nodeArgs = [] }) {
  fs.mkdirSync(temporary, { recursive: true, mode: 0o700 });
  fs.chmodSync(temporary, 0o700);
  temporary = fs.realpathSync(temporary);
  const repository = path.join(temporary, "repo");
  const remote = path.join(temporary, "remote.git");
  git(temporary, ["init", "--bare", "-q", remote]);
  fs.mkdirSync(repository, { mode: 0o700 });
  git(repository, ["init", "-q"]);
  git(repository, ["config", "user.email", "contract@example.invalid"]);
  git(repository, ["config", "user.name", "Contract Canary"]);
  fs.writeFileSync(path.join(repository, "seed.txt"), "contract canary\n", { mode: 0o600 });
  fs.writeFileSync(path.join(repository, "handoff.txt"), "C1 handoff\n", { mode: 0o600 });
  fs.mkdirSync(path.join(repository, "scripts"), { mode: 0o700 });
  fs.writeFileSync(path.join(repository, "scripts", "verify-o01.mjs"), "import fs from 'node:fs';\nif (fs.readFileSync('seed.txt', 'utf8') !== 'contract canary\\n') process.exit(1);\n", { mode: 0o600 });
  fs.writeFileSync(path.join(repository, "package.json"), `${JSON.stringify({ scripts: { "verify:oracle:o01": "node scripts/verify-o01.mjs" } })}\n`, { mode: 0o600 });
  git(repository, ["add", "seed.txt", "handoff.txt", "package.json", "scripts/verify-o01.mjs"]);
  requireRun(run("git", ["-C", repository, "commit", "-qm", "contract canary"], {
    env: { ...process.env, GIT_AUTHOR_DATE: "2026-08-20T00:00:00Z", GIT_COMMITTER_DATE: "2026-08-20T00:00:00Z" },
  }), "TEMP_GIT_FAILED");
  git(repository, ["branch", "-M", "main"]);
  git(repository, ["remote", "add", "origin", remote]);
  git(repository, ["push", "-u", "origin", "main"]);
  const planningBaseSha = git(repository, ["rev-parse", "HEAD"]);

  const config = path.join(temporary, "controller.json");
  fs.copyFileSync(sourceConfig, config);
  fs.chmodSync(config, 0o600);
  const canaryConfig = JSON.parse(fs.readFileSync(config, "utf8"));
  const runtimeFixture = path.join(temporary, "codex-fixture");
  fs.writeFileSync(runtimeFixture, "#!/bin/sh\nprintf 'codex-contract-fixture 1.0\\n'\n", { mode: 0o700 });
  if (canaryConfig.codex && canaryConfig.validation?.sandbox) {
    canaryConfig.localPath = repository;
    canaryConfig.stateDir = path.join(temporary, "controller-state");
    canaryConfig.worktreeRoot = path.join(temporary, "controller-worktrees");
    canaryConfig.codex.bin = runtimeFixture;
    canaryConfig.validation.sandbox.bin = runtimeFixture;
    canaryConfig.validation.sandbox.root = path.join("/var/tmp", `herdr-codex-contract-${process.pid}-${path.basename(temporary)}`);
  }
  canaryConfig.validation ??= {};
  canaryConfig.validation.release ??= [];
  if (!canaryConfig.validation.release.some((entry) => (typeof entry === "string" ? entry : entry?.command) === "npm run verify:oracle:o01")) {
    canaryConfig.validation.release.push({ command: "npm run verify:oracle:o01", timeoutMs: 900000 });
  }
  fs.writeFileSync(config, `${JSON.stringify(canaryConfig)}\n`);
  const adapter = createControllerAdapter({ cli, config, nodeArgs });
  const controller = adapter.config();
  const repo = controller.config?.repo;
  const baseRef = controller.config?.baseRef;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo ?? "") || typeof baseRef !== "string") throw new Error("CONTROLLER_CONFIG_CONTRACT_INVALID");
  const input = freshC1(repository, planningBaseSha, reviewedInput({ repositoryPath: repository, baseSha: planningBaseSha, repo, baseRef }));
  const readFresh = (value) => assertFreshExecutionInput(value, { resolveRemoteBase: gitRemoteBase });
  if (fingerprint(readFresh(input)) !== fingerprint(executionFreshnessProjection(input))) throw new Error("FRESH_C1_VECTOR_MISMATCH");
  const draft = compileExecutionPlan(input, { controller, draft: true });
  if (!validateArtifact(draft.releasePlan, { identity: CONTROLLER_PLAN }).ok) throw new Error("PLANNER_SCHEMA_POSITIVE_VECTOR_REJECTED");
  const validated = adapter.validatePlan(draft.releasePlan, controller.configDigest, controller.configIdentity);
  const plannerPlanDigest = releasePlanDigest(draft.releasePlan);
  if (!HEX.test(validated.planDigest) || validated.planDigest !== plannerPlanDigest
    || JSON.stringify(canonical(validated.plan)) !== JSON.stringify(canonical(draft.releasePlan))
    || validated.provenance.configDigest !== controller.configDigest
    || validated.provenance.releasePlan.version !== 2
    || validated.provenance.releasePlan.digest !== validated.planDigest
    || JSON.stringify(canonical(validated.provenance.controller)) !== JSON.stringify(canonical(controller.controllerIdentity))) throw new Error("CONTROLLER_PLAN_VECTOR_MISMATCH");

  const vectorFile = path.join(temporary, "release-plan-vector.json");
  const uncoveredConfig = structuredClone(canaryConfig);
  uncoveredConfig.validation.release = uncoveredConfig.validation.release
    .filter((entry) => (typeof entry === "string" ? entry : entry?.command) !== "npm run verify:oracle:o01");
  const uncoveredConfigFile = path.join(temporary, "controller-without-oracle.json");
  fs.writeFileSync(uncoveredConfigFile, `${JSON.stringify(uncoveredConfig)}\n`, { mode: 0o600 });
  if (!invalidPlanRejected(cli, uncoveredConfigFile, vectorFile, draft.releasePlan, nodeArgs)) {
    throw new Error("CONTROLLER_ORACLE_VALIDATION_COVERAGE_MISMATCH");
  }
  const { parentIssue: _parentIssue, ...missingRequired } = draft.releasePlan;
  const rootWildcard = { ...draft.releasePlan, issues: draft.releasePlan.issues.map((issue, index) => index === 0 ? { ...issue, expectedPaths: ["*.ts"] } : issue) };
  const vectors = [
    ["extraTopLevel", { ...draft.releasePlan, unexpected: true }],
    ["missingRequired", missingRequired],
    ["extraSource", { ...draft.releasePlan, source: { ...draft.releasePlan.source, unexpected: true } }],
    ["extraIssue", { ...draft.releasePlan, issues: draft.releasePlan.issues.map((issue, index) => index === 0 ? { ...issue, unexpected: true } : issue) }],
    ["rootWildcardExpectedPath", rootWildcard],
    ["releasePlanV1", legacyPlanVector()],
  ];
  for (const [, vector] of vectors) {
    if (validateArtifact(vector, { identity: CONTROLLER_PLAN }).ok || !invalidPlanRejected(cli, config, vectorFile, vector, nodeArgs)) {
      throw new Error("CONTROLLER_SCHEMA_VECTOR_MISMATCH");
    }
  }
  const unknownRiskClass = { ...draft.releasePlan, issues: draft.releasePlan.issues.map((issue, index) => index === 0 ? { ...issue, riskClasses: ["BOUNDED_CHANGE"] } : issue) };
  if (unknownRiskClasses(unknownRiskClass.issues[0].riskClasses).length === 0
    || !invalidPlanRejected(cli, config, vectorFile, unknownRiskClass, nodeArgs)) {
    throw new Error("CONTROLLER_RISK_CLASS_VECTOR_MISMATCH");
  }

  const freshCases = { "c1-base-a": "PASS" };
  fs.writeFileSync(path.join(repository, "merged.txt"), "C1 merged\n");
  const mergedMainSha = commitAndPush(repository, "merge C1");
  try { readFresh(input); freshCases["c2-stale-base-a"] = "UNEXPECTED_PASS"; }
  catch (error) { freshCases["c2-stale-base-a"] = error.message; }
  const c2 = freshC2(repository, input, mergedMainSha);
  readFresh(c2);
  freshCases["c2-fresh-base-b"] = "PASS";

  const c2Draft = compileExecutionPlan(c2, { controller, draft: true });
  const c2Validated = adapter.validatePlan(c2Draft.releasePlan, controller.configDigest, controller.configIdentity);
  const c2Plan = compileExecutionPlan(c2, { controller: { ...controller, planDigest: c2Validated.planDigest, provenance: c2Validated.provenance } });
  freshCases["exact-v3-v2-direct"] = "PASS";

  const decisionDrift = structuredClone(c2);
  decisionDrift.deliveryGraph.decisionManifest.policy.sha256 = `sha256:${"0".repeat(64)}`;
  try { readFresh(decisionDrift); freshCases["accepted-decision-drift"] = "UNEXPECTED_PASS"; }
  catch (error) { freshCases["accepted-decision-drift"] = error.message; }
  const oracleDrift = structuredClone(c2);
  oracleDrift.children[0].body = oracleDrift.children[0].body.replace(/"sha256":"sha256:[a-f0-9]{64}"/u, `"sha256":"sha256:${"0".repeat(64)}"`);
  try { readFresh(oracleDrift); freshCases["oracle-drift"] = "UNEXPECTED_PASS"; }
  catch (error) { freshCases["oracle-drift"] = error.message; }
  const verifierDrift = structuredClone(c2);
  const parsedVerifier = parseChildTicket(verifierDrift.children[0].body).oracleBinding;
  const driftedVerifier = structuredClone(parsedVerifier);
  driftedVerifier.verifier.files[0].sha256 = `sha256:${"0".repeat(64)}`;
  const { digest: _verifierDigest, ...verifierBody } = driftedVerifier.verifier;
  driftedVerifier.verifier.digest = fingerprint(verifierBody);
  verifierDrift.children[0].body = verifierDrift.children[0].body
    .replace(JSON.stringify(parsedVerifier), JSON.stringify(driftedVerifier));
  rebindExecutionInput(verifierDrift, verifierDrift.source.baseSha);
  try { readFresh(verifierDrift); freshCases["verifier-byte-drift"] = "UNEXPECTED_PASS"; }
  catch (error) { freshCases["verifier-byte-drift"] = error.message; }

  const parentDrift = structuredClone(c2);
  parentDrift.parent.body += "\nchanged";
  freshCases["parent-body-drift"] = verifyExecutionPlan(c2Plan, parentDrift, adapter, { doctor: false, readFresh }).problems[0]?.code;
  const childDrift = structuredClone(c2);
  childDrift.children[0].body += "\nchanged";
  freshCases["child-body-drift"] = verifyExecutionPlan(c2Plan, childDrift, adapter, { doctor: false, readFresh }).problems[0]?.code;
  const provenanceAdapter = {
    ...adapter,
    config() {
      const current = adapter.config();
      return { ...current, controllerIdentity: { ...current.controllerIdentity, sourceRevision: "f".repeat(40) } };
    },
  };
  freshCases["controller-provenance-drift"] = verifyExecutionPlan(c2Plan, c2, provenanceAdapter, { doctor: false, readFresh }).problems[0]?.code;
  try { compileExecutionPlan({ ...c2, deliveryGraph: c2.roadmapGraph }, { controller }); freshCases["roadmap-or-human"] = "UNEXPECTED_PASS"; }
  catch (error) { freshCases["roadmap-or-human"] = error.message; }

  const dependencyDrift = structuredClone(c2);
  fs.writeFileSync(path.join(repository, "handoff.txt"), "changed handoff\n");
  const dependencyBaseSha = commitAndPush(repository, "change C1 handoff");
  dependencyDrift.deliveryGraph.specAcceptanceBinding.baseSha = dependencyBaseSha;
  dependencyDrift.deliveryGraph.predecessorReceiptBinding.baseSha = dependencyBaseSha;
  dependencyDrift.deliveryGraph.decisionManifestBinding.baseSha = dependencyBaseSha;
  rebindExecutionInput(dependencyDrift, dependencyBaseSha);
  try { readFresh(dependencyDrift); freshCases["dependency-handoff-drift"] = "UNEXPECTED_PASS"; }
  catch (error) { freshCases["dependency-handoff-drift"] = error.message; }

  const expectedCases = JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures", "fresh-handoff-cases.json"), "utf8")).cases;
  for (const { id, expected } of expectedCases) if (freshCases[id] !== expected) throw new Error(`FRESH_CANARY_CASE_MISMATCH:${id}:${freshCases[id]}`);

  return {
    status: "PASS",
    configDigest: controller.configDigest,
    planDigest: validated.planDigest,
    plannerPlanDigest,
    provenanceDigest: validated.provenance.digest,
    controllerRevision: validated.provenance.controller.sourceRevision,
    controllerSourceManifestDigest: validated.provenance.controller.sourceManifestDigest,
    controllerBuildDigest: validated.provenance.controller.buildDigest,
    controllerIdentityDigest: validated.provenance.controller.digest,
    releasePlanFingerprint: fingerprint(draft.releasePlan),
    handoffScope: { releasePlanV2Direct: "ACCEPTED", releasePlanV1: "REJECTED", dispatch: "OUT_OF_SCOPE" },
    vectors: { ...Object.fromEntries(vectors.map(([name]) => [name, "REJECTED"])), unknownRiskClass: "REJECTED", oracleValidationCommandMissing: "REJECTED" },
    freshCases,
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
  const controllerCommit = qualifiedCommit(root, lock.commit);

  const planMirror = exactMirror(PLANNER_SCHEMA, path.join(root, lock.schemaPath), lock.schemaSha256, "CONTROLLER_SCHEMA_DRIFT");
  const completionMirror = exactMirror(PLANNER_COMPLETION_SCHEMA, path.join(root, lock.completionSchemaPath), lock.completionSchemaSha256, "CONTROLLER_COMPLETION_SCHEMA_DRIFT");
  exactMirror(PLANNER_CONFIG_SCHEMA, path.join(root, lock.configSchemaPath), lock.configSchemaSha256, "CONTROLLER_CONFIG_SCHEMA_DRIFT");
  exactMirror(PLANNER_HISTORY_SCHEMA, path.join(root, lock.controllerIdentityHistorySchemaPath), lock.controllerIdentityHistorySchemaSha256, "CONTROLLER_IDENTITY_HISTORY_SCHEMA_DRIFT");
  const historyMirror = exactMirror(PLANNER_HISTORY, path.join(root, lock.controllerIdentityHistoryPath), lock.controllerIdentityHistorySha256, "CONTROLLER_IDENTITY_HISTORY_DRIFT");
  for (const historical of lock.historicalCompletionSchemas) {
    exactMirror(path.join(ROOT, "schemas", `herdr-codex-${path.basename(historical.path)}`), path.join(root, historical.path), historical.sha256, "CONTROLLER_HISTORICAL_COMPLETION_SCHEMA_DRIFT");
  }
  const plannerRiskRegistry = assertCanonicalPrivateExistingFile(PLANNER_RISK_CLASS_REGISTRY, "PLANNER_RISK_CLASS_REGISTRY");
  const controllerRiskRegistry = assertCanonicalPrivateExistingFile(path.join(root, lock.riskClassRegistryPath), "CONTROLLER_RISK_CLASS_REGISTRY");
  const controllerRuntimeLock = assertCanonicalPrivateExistingFile(path.join(root, lock.controllerRuntimeContractLockPath), "CONTROLLER_RUNTIME_CONTRACT_LOCK");
  const plannerRiskBytes = fs.readFileSync(plannerRiskRegistry);
  const controllerRiskBytes = fs.readFileSync(controllerRiskRegistry);
  const riskClassRegistrySha256 = sha256(plannerRiskBytes);
  const history = JSON.parse(historyMirror.bytes.toString("utf8"));
  const trust = JSON.parse(fs.readFileSync(assertCanonicalPrivateExistingFile(PLANNER_TRUST, "PLANNER_CONTROLLER_TRUST"), "utf8"));
  const historyProjection = (entry) => Object.fromEntries(["identity", "ownedSchemas", "qualificationStatus", "activatedAt", "revocation"].map((key) => [key, entry[key]]));
  if (!validateArtifact(trust).ok || trust.digest !== lock.trustRegistryDigest
    || trust.activeIdentityDigest !== lock.identityDigest || history.digest !== lock.controllerIdentityHistoryDigest
    || JSON.stringify(trust.entries.filter((entry) => !entry.active).map(historyProjection)) !== JSON.stringify(history.entries)) {
    throw new Error("CONTROLLER_TRUST_REGISTRY_DRIFT");
  }
  const riskRegistry = JSON.parse(plannerRiskBytes.toString("utf8"));
  const runtimeLock = JSON.parse(fs.readFileSync(controllerRuntimeLock, "utf8"));
  const { digest: runtimeLockDigest, ...runtimeLockBody } = runtimeLock;
  if (!HEX.test(lock.riskClassRegistrySha256) || riskClassRegistrySha256 !== lock.riskClassRegistrySha256
    || sha256(controllerRiskBytes) !== lock.riskClassRegistrySha256 || !plannerRiskBytes.equals(controllerRiskBytes)
    || riskRegistry.digest !== lock.riskClassRegistryDigest
    || runtimeLockDigest !== fingerprint(runtimeLockBody)
    || sha256(fs.readFileSync(controllerRuntimeLock)) !== lock.controllerRuntimeContractLockSha256
    || runtimeLockDigest !== lock.controllerRuntimeContractLockDigest
    || runtimeLock.plannerRiskRegistry?.commit !== lock.riskClassRegistrySourceCommit
    || runtimeLock.plannerRiskRegistry?.byteSha256 !== lock.riskClassRegistrySha256
    || runtimeLock.plannerRiskRegistry?.artifactDigest !== lock.riskClassRegistryDigest) {
    throw new Error("CONTROLLER_RISK_CLASS_REGISTRY_DRIFT");
  }

  const sourceConfig = fixtureConfig(root);
  if (!sourceConfig) throw new Error("CONTROLLER_CONFIG_FIXTURE_UNAVAILABLE");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "codex-controller-contract-"));
  try {
    fs.chmodSync(temporary, 0o700);
    if (!process.allowedNodeEnvironmentFlags.has("--permission") || !process.allowedNodeEnvironmentFlags.has("--allow-net")
      || !process.allowedNodeEnvironmentFlags.has("--allow-child-process")) {
      throw new Error("CONTROLLER_BUILD_ISOLATION_UNAVAILABLE");
    }
    const nodeArgs = ["--permission", "--allow-fs-read=*", "--allow-child-process"];
    const built = controllerCli(root, temporary, lock.commit);
    const vectors = contractVectors({ cli: built.cli, sourceConfig, temporary: path.join(temporary, "vectors"), nodeArgs });
    if (!REVISION.test(vectors.controllerRevision) || vectors.controllerRevision !== controllerCommit
      || vectors.controllerSourceManifestDigest !== lock.sourceManifestDigest
      || vectors.controllerBuildDigest !== lock.buildDigest
      || vectors.controllerIdentityDigest !== lock.identityDigest) throw new Error("CONTROLLER_IDENTITY_READBACK_DRIFT");
    const p0Runtime = controllerP0RuntimeTests(built.buildRoot);
    fs.appendFileSync(path.join(built.buildRoot, "README.md"), "\n");
    try { qualifiedCommit(built.buildRoot, lock.commit); throw new Error("CONTROLLER_DIRTY_CHECKOUT_ACCEPTED"); }
    catch (error) { if (error.message !== "CONTROLLER_WORKTREE_DIRTY") throw error; }
    return { ...vectors, controllerCommit, schemaSha256: planMirror.sha256, completionSchemaSha256: completionMirror.sha256, riskClassRegistrySha256, controllerTrustDigest: trust.digest, controllerIdentityHistoryDigest: history.digest, controllerRuntimeContractLockDigest: runtimeLock.digest, controllerReadback: "MATCHED", controllerP0Runtime: p0Runtime, controllerDoctor: { status: "NOT_RUN", reason: "requires-live-handoff-repository-and-sandbox" }, dirtyCheckout: "REJECTED", controllerSource: "exact-local-clone", networkIsolation: "node-permission-deny-net" };
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
