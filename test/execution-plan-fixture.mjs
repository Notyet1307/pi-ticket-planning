import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compileExecutionPlan } from "../execution-plan/compiler.mjs";
import { fingerprint } from "../execution-plan/domain.mjs";
import {
  EXECUTABLE_DELIVERY_SPEC_MARKER,
  hashText,
} from "../scripts/check-delivery-graph.mjs";
import { checkTicketContext } from "../scripts/check-ticket-context.mjs";
import { attachReviewBinding } from "./review-binding-fixture.mjs";
import {
  executionConstraints,
  graphContractFields,
  oracleBinding,
  reviewContractFields,
  ticketBody,
} from "./ticket-contract-fixture.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const BASE_SHA = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
export const NOW = "2026-08-20T00:30:00.000Z";
export const digest = (letter) => `sha256:${letter.repeat(64)}`;

export const CONTROLLER_IDENTITY = {
  version: 1,
  sourceRevision: "987a30872494e50987f17d1cc74304763bc74a28",
  sourceManifestDigest: "a9d8f7af31575d33ca9bbb9d795d68e776801709416e6fec08c99481e39da737",
  buildDigest: "b3df861932cd74545937508a5e42d5def94973ddaa6095d778fd6962f6c9db0a",
  digest: "0352949ac5fedc92717d402af0d36a71ec921cdb07343a298ccf8577eb2a984f",
};

export function controllerProvenance(configDigest, planDigest, controllerIdentity = CONTROLLER_IDENTITY) {
  const body = { version: 1, controller: controllerIdentity, executionMode: "release-plan-v2-direct", configDigest, releasePlan: { version: 2, digest: planDigest } };
  return { ...body, digest: fingerprint(body).slice("sha256:".length) };
}

export const PARENT_SPEC = `## Delivery outcome
Release a safe change
## Behavioral scenarios
### S1: release
Observable result: A user sees the completed change.
Important failure behavior: A failed write leaves no partial state.
Exit state or produced artifact: A durable release artifact exists.
## Release signal mapping
- Preserve a compatibility guardrail.
## Walking skeleton target
The first path produces the release artifact.
## Decisions
- Preserve compatibility for legacy input.
## Constraints and dependencies
- No partial writes.
## Out of scope
None.`;

export function executionInput() {
  const binding = oracleBinding({ repo: ROOT, baseSha: BASE_SHA });
  const constraints = executionConstraints({
    expectedPaths: ["execution-plan/compiler.mjs"],
    protectedPaths: [
      "fixtures/admission-cases.json",
      "package.json",
      "scripts/verify-protocol.mjs",
      "evidence/spec-acceptance.json",
      "evidence/decision-manifest.json",
      "AGENTS.md",
      "README.md",
    ],
    primaryVerificationSeams: ["Run the release scenario."],
  });
  const child = {
    id: "101",
    title: "Build safe release",
    state: "open",
    labels: ["needs-triage"],
    blockedBy: [],
    updatedAt: "2026-08-20T00:00:00Z",
    body: ticketBody({
      objective: "Build the safe release.",
      primaryVerification: "Run the release scenario.",
      acceptanceCriteria: ["The release is created.", "The release is durable.", "A failed release leaves no partial state."],
      guardrails: "No partial writes survive.",
      outOfScope: "No UI work.",
      binding,
      constraints,
    }),
  };
  const parent = {
    id: "100",
    title: "Release safely",
    state: "open",
    labels: ["needs-triage"],
    blockedBy: [],
    updatedAt: "2026-08-20T00:00:00Z",
    body: `${PARENT_SPEC}\n\n${EXECUTABLE_DELIVERY_SPEC_MARKER}`,
  };
  const specContentHash = hashText(parent.body);
  const acceptanceBody = {
    schema: "pi-ticket-planning:spec-acceptance:v1",
    parent: { number: Number(parent.id), title: parent.title, bodyHash: hashText(parent.body) },
    source: { baseSha: BASE_SHA, specContentHash },
    decision: { caseId: "PC-release-r1", approvalId: "F-spec-approval", acceptedAt: "2026-08-20T00:00:00Z" },
  };
  const source = { identity: "accepted-release", revision: "r1", baseSha: BASE_SHA, baseRef: "main", remote: "origin", specContentHash };
  const decisionManifestBody = {
    schema: "pi-ticket-planning:decision-manifest:v1",
    baseSha: BASE_SHA,
    policy: { identity: "AGENTS.md", path: "AGENTS.md", sha256: digest("a"), byteCount: 1 },
    productRelease: { identity: "R001/r1", path: "README.md", sha256: digest("b"), byteCount: 1 },
    decisions: [],
    dependencyHandoffs: [],
  };
  const graph = {
    schema: "pi-ticket-planning:delivery-release-graph:v3",
    kind: "EXECUTABLE_RELEASE",
    executable: true,
    readinessState: "GRAPH_REVIEWED",
    releaseId: "R001-C1-r1",
    releaseOrdinal: 1,
    planningBaseSha: BASE_SHA,
    executionBaseSha: BASE_SHA,
    executionBasePolicy: "PLANNING_BASE_OR_DESCENDANT",
    roadmapDigest: null,
    predecessorReleaseId: null,
    predecessorReceipt: null,
    predecessorReceiptBinding: null,
    specAcceptance: { ...acceptanceBody, digest: fingerprint(acceptanceBody) },
    specAcceptanceBinding: { path: "evidence/spec-acceptance.json", baseSha: BASE_SHA, sha256: digest("c"), byteCount: 1 },
    decisionManifest: { ...decisionManifestBody, digest: fingerprint(decisionManifestBody) },
    decisionManifestBinding: { path: "evidence/decision-manifest.json", baseSha: BASE_SHA, sha256: digest("d"), byteCount: 1 },
    decisionManifestDigest: digest("d"),
    source: { identity: source.identity, revision: source.revision, specContentHash },
    scenarios: [{ id: "S1", behavior: "Release", entry: "external:input", exit: "artifact", releaseSignal: "release", smallestLoop: true }],
    children: [{
      id: child.id,
      title: child.title,
      coverageRole: "DIRECT",
      sourceScenarios: ["S1"],
      blockedBy: [],
      externalBlockers: [],
      bodyHash: hashText(child.body),
      startingState: "input",
      primaryVerification: "Run the release scenario.",
      executionLane: "AGENT",
      ...graphContractFields(child.body),
    }],
    walkingSkeleton: [child.id],
  };
  const axes = Object.fromEntries([
    "candidateReadiness",
    "contextQuality",
    "deliveryGraph",
    "scenarioCoverage",
    "walkingSkeleton",
    "strictFrontier",
    "executionLane",
    "inputBinding",
  ].map((name) => [name, "PASS"]));
  return attachReviewBinding({
    kind: "DELIVERY_GRAPH",
    repo: "acme/product",
    repositoryPath: ROOT,
    source,
    parent,
    specAcceptance: graph.specAcceptance,
    deliveryGraph: graph,
    children: [child],
    contextChecks: [{ candidateId: child.id, result: checkTicketContext({ repo: ROOT, base: BASE_SHA, body: child.body }) }],
    policy: { identity: "policy", digest: digest("b"), accepted: true },
    review: {
      schema: "pi-ticket-planning:admission-review:v1",
      reviewer: "ticket-readiness-reviewer",
      reviewedAt: "2026-08-20T00:00:00Z",
      source: { identity: source.identity, revision: source.revision, baseSha: BASE_SHA, specContentHash },
      axes,
      graphVerdict: "READY",
      candidates: [{
        id: child.id,
        verdict: "READY",
        executionLane: "AGENT",
        ...reviewContractFields(child.body, graph.children[0], graph.children),
      }],
    },
  });
}

export function controllerBinding(input, overrides = {}) {
  return {
    config: {
      repo: input.repo,
      baseRef: input.source.baseRef,
      executionMode: "release-plan-v2-direct",
      validation: { release: [{ command: "npm run verify:protocol", timeoutMs: 900000 }] },
      policy: { maxIssues: 2 },
      review: { enabled: true },
      ...overrides.config,
    },
    configDigest: overrides.configDigest ?? "a".repeat(64),
    planDigest: overrides.planDigest ?? "c".repeat(64),
    controllerIdentity: overrides.controllerIdentity ?? CONTROLLER_IDENTITY,
  };
}

export function compiledFixture() {
  const input = executionInput();
  const controller = controllerBinding(input);
  return { input, controller, plan: compileExecutionPlan(input, { controller }) };
}

export function controllerAdapter(controller, calls = []) {
  return {
    config() {
      calls.push("config validate");
      return { config: structuredClone(controller.config), configDigest: controller.configDigest, configIdentity: "test-config-identity", controllerIdentity: structuredClone(controller.controllerIdentity) };
    },
    validatePlan(plan, expectedConfigDigest, expectedConfigIdentity) {
      calls.push("plan validate");
      if (expectedConfigDigest !== controller.configDigest || expectedConfigIdentity !== "test-config-identity") throw new Error("CONTROLLER_CONFIG_DRIFT");
      return { plan: structuredClone(plan), planDigest: controller.planDigest, provenance: controllerProvenance(controller.configDigest, controller.planDigest, controller.controllerIdentity) };
    },
    doctor(expectedConfigDigest, expectedConfigIdentity, expectedControllerIdentity) {
      calls.push("doctor");
      if (expectedConfigDigest !== controller.configDigest || expectedConfigIdentity !== "test-config-identity") throw new Error("CONTROLLER_DOCTOR_CONFIG_DRIFT");
      if (JSON.stringify(expectedControllerIdentity) !== JSON.stringify(controller.controllerIdentity)) throw new Error("CONTROLLER_IDENTITY_DRIFT");
      return { ok: true, configDigest: controller.configDigest, controller: structuredClone(controller.controllerIdentity) };
    },
  };
}
