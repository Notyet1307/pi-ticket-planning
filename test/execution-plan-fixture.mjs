import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compileExecutionPlan } from "../execution-plan/compiler.mjs";
import {
  DELIVERY_GRAPH_MARKER,
  computeSpecContentHash,
  hashText,
} from "../scripts/check-delivery-graph.mjs";
import { checkTicketContext } from "../scripts/check-ticket-context.mjs";
import { attachReviewBinding } from "./review-binding-fixture.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const BASE_SHA = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
export const NOW = "2026-08-20T00:30:00.000Z";
export const digest = (letter) => `sha256:${letter.repeat(64)}`;

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
  const child = {
    id: "101",
    title: "Build safe release",
    state: "open",
    labels: ["needs-triage"],
    blockedBy: [],
    updatedAt: "2026-08-20T00:00:00Z",
    body: `## What to build
Build the safe release.
## Primary verification
Run the release scenario.
## Acceptance criteria
- [ ] The release is created.
- [ ] The release is durable.
- [ ] A failed release leaves no partial state.
## Invariants and guardrails
No partial writes survive.
## Out of scope
No UI work.`,
  };
  const source = { identity: "accepted-release", revision: "r1", baseSha: BASE_SHA, baseRef: "main" };
  const graph = {
    version: 2,
    source: { identity: source.identity, revision: source.revision, baseSha: BASE_SHA, specContentHash: digest("0") },
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
    }],
    walkingSkeleton: [child.id],
  };
  const provisional = `${PARENT_SPEC}\n\n## Ticket coverage\n\n${DELIVERY_GRAPH_MARKER}\n\n\`\`\`json\n${JSON.stringify(graph)}\n\`\`\``;
  graph.source.specContentHash = computeSpecContentHash(provisional);
  const parent = {
    id: "100",
    title: "Release safely",
    state: "open",
    labels: ["needs-triage"],
    blockedBy: [],
    updatedAt: "2026-08-20T00:00:00Z",
    body: `${PARENT_SPEC}\n\n## Ticket coverage\n\n${DELIVERY_GRAPH_MARKER}\n\n\`\`\`json\n${JSON.stringify(graph)}\n\`\`\``,
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
    children: [child],
    contextChecks: [{ candidateId: child.id, result: checkTicketContext({ repo: ROOT, base: BASE_SHA, body: child.body }) }],
    policy: { identity: "policy", digest: digest("b"), accepted: true },
    review: {
      schema: "pi-ticket-planning:admission-review:v1",
      reviewer: "ticket-readiness-reviewer",
      reviewedAt: "2026-08-20T00:00:00Z",
      source: { identity: source.identity, revision: source.revision, baseSha: BASE_SHA },
      axes,
      graphVerdict: "READY",
      candidates: [{ id: child.id, verdict: "READY", executionLane: "AGENT" }],
    },
  });
}

export function controllerBinding(input, overrides = {}) {
  return {
    config: {
      repo: input.repo,
      baseRef: input.source.baseRef,
      policy: { maxIssues: 2 },
      review: { enabled: true },
      ...overrides.config,
    },
    configDigest: overrides.configDigest ?? "a".repeat(64),
    planDigest: overrides.planDigest ?? "c".repeat(64),
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
      return { config: structuredClone(controller.config), configDigest: controller.configDigest };
    },
    validatePlan(plan) {
      calls.push("plan validate");
      return { plan: structuredClone(plan), planDigest: controller.planDigest };
    },
    doctor() {
      calls.push("doctor");
      return { ok: true };
    },
  };
}
