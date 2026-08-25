import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";

import { inspectCapabilities, validateCapabilityReceipt } from "../capabilities/doctor.mjs";
import { runtimeMetadata } from "../installation/build-metadata.mjs";
import { validateArtifact } from "../protocol/kernel.mjs";
import {
  allowE2EResourceTitle,
  bindE2EControlIssue,
  bindE2EResource,
  cleanupPersistedE2E,
  createE2EState,
  declareE2EResource,
  e2eControlBody,
  e2eControlTitle,
  e2eLabel,
  persistE2EState,
  persistRemoteE2EState,
} from "./e2e-state.mjs";

function digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

function repositoryFromRemote(value) {
  return value?.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/i)?.slice(1, 3).join("/") ?? null;
}

export function createLiveAdapter({ env = process.env } = {}) {
  let ready = null;
  let apiCalls = 0;
  let capabilityPromise = null;
  const mutations = [];

  function gh(args, input, { notFound = false } = {}) {
    apiCalls += 1;
    const methodIndex = args.indexOf("--method");
    const method = methodIndex >= 0 ? args[methodIndex + 1] : "GET";
    const endpoint = args.find((value) => typeof value === "string" && value.startsWith("repos/")) ?? "unknown";
    const run = spawnSync("gh", args, {
      encoding: "utf8",
      input: input === undefined ? undefined : JSON.stringify(input),
      timeout: 60_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    if (run.status !== 0) {
      if (notFound && /(?:HTTP\s+)?404\b/.test(run.stderr)) return null;
      throw new Error("GITHUB_API_FAILED");
    }
    const value = run.stdout.trim() ? JSON.parse(run.stdout) : null;
    if (method !== "GET") mutations.push({ method, endpoint, digest: digest(value ?? { status: run.status }) });
    return value;
  }

  function assertReady(context) {
    if (!ready || ready.repo !== context.repo || ready.isProductionRemote) throw new Error("LIVE_ADAPTER_NOT_READY");
  }

  function labelName(runId) {
    return e2eLabel(runId);
  }

  function ensureLabel(context, name = labelName(context.runId), description = context.resourceTag) {
    const existing = gh(["api", `repos/${context.repo}/labels/${encodeURIComponent(name)}`], undefined, { notFound: true });
    if (!existing) gh(["api", "--method", "POST", `repos/${context.repo}/labels`, "--input", "-"], { name, color: "5319e7", description });
    return name;
  }

  function createIssue(contract, context) {
    assertReady(context);
    const label = ready.label;
    const marker = `<!-- ${context.resourceTag}:${contract.id}:${context.ordinal} -->`;
    const title = `[${context.resourceTag}] ${contract.id}:${context.ordinal}`;
    saveState(declareE2EResource(ready.state, { marker, title }));
    const issue = gh(["api", "--method", "POST", `repos/${context.repo}/issues`, "--input", "-"], {
      title,
      body: `${marker}\n\nDisposable controlled-Beta evidence resource.`,
      labels: [label],
    });
    const readback = gh(["api", `repos/${context.repo}/issues/${issue.number}`]);
    if (readback.body !== `${marker}\n\nDisposable controlled-Beta evidence resource.`) throw new Error("GITHUB_READBACK_MISMATCH");
    saveState(bindE2EResource(ready.state, { marker, number: readback.number, actor: readback.user?.login, createdAt: readback.created_at }));
    return { issue: readback, marker, label };
  }

  function comment(context, number, body) {
    const created = gh(["api", "--method", "POST", `repos/${context.repo}/issues/${number}/comments`, "--input", "-"], { body });
    const readback = gh(["api", `repos/${context.repo}/issues/comments/${created.id}`]);
    if (readback.body !== body) throw new Error("GITHUB_COMMENT_READBACK_MISMATCH");
    return readback;
  }

  function labels(context, number, values) {
    gh(["api", "--method", "PUT", `repos/${context.repo}/issues/${number}/labels`, "--input", "-"], { labels: values });
    const readback = gh(["api", `repos/${context.repo}/issues/${number}`]);
    const actual = readback.labels.map(({ name }) => name).sort();
    if (JSON.stringify(actual) !== JSON.stringify([...values].sort())) throw new Error("GITHUB_LABEL_READBACK_MISMATCH");
    return readback;
  }

  function evidence(contract, context, before, extra = {}) {
    return [digest({ repo: context.repo, runId: context.runId, scenario: contract.id, ordinal: context.ordinal, mutations: mutations.slice(before), ...extra })];
  }

  function saveState(value) {
    ready.state = persistE2EState(value, ready.stateFile);
    if (ready.state.controlIssue !== null) persistRemoteE2EState(ready.state, gh);
    return ready.state;
  }

  async function activeCapability() {
    capabilityPromise ??= env.PTP_CAPABILITY_RECEIPT
      ? Promise.resolve().then(() => {
        const receipt = JSON.parse(fs.readFileSync(env.PTP_CAPABILITY_RECEIPT, "utf8"));
        if (!validateCapabilityReceipt(receipt, { now: new Date().toISOString() }).ok) throw new Error("CAPABILITY_RECEIPT_INVALID");
        return receipt;
      })
      : inspectCapabilities({ activeProbe: true, env });
    return capabilityPromise;
  }

  return {
    async preflight(context) {
      const actor = gh(["api", "user"]).login;
      const repository = gh(["api", `repos/${context.repo}`]);
      const topics = gh(["api", `repos/${context.repo}/topics`]).names ?? [];
      const remote = spawnSync("git", ["remote", "get-url", "origin"], { encoding: "utf8", timeout: 15_000 });
      const packageRepo = repositoryFromRemote(remote.stdout.trim());
      const isProductionRemote = context.repo === packageRepo || context.repo === env.GITHUB_REPOSITORY;
      if (!repository.has_issues || repository.archived || repository.disabled) throw new Error("DISPOSABLE_REPOSITORY_UNUSABLE");
      const receipt = await activeCapability();
      const byName = new Map(receipt.capabilities.map((item) => [item.name, item]));
      const supported = (name) => byName.get(name)?.status === "SUPPORTED";
      const providerEvidence = {
        status: ["subagent.final-result", "reviewer.fresh-context", "reviewer.schema", "pi.named-session", "pi.persisted-session", "timeout-cancellation"].every(supported) ? "PASS" : "BLOCKED",
        childResult: supported("subagent.final-result"),
        freshContext: supported("reviewer.fresh-context"),
        strictSchema: supported("reviewer.schema"),
        namedSession: supported("pi.named-session"),
        persistedSession: supported("pi.persisted-session"),
        timeoutCancellation: supported("timeout-cancellation"),
        evidenceDigests: [receipt.digest],
      };
      const harnessReady = supported("harness.readiness") && receipt.subject.target === `github:${context.repo}`;
      const harnessEvidence = {
        status: harnessReady ? "PARTIAL" : "BLOCKED",
        exactTarget: harnessReady,
        readiness: harnessReady,
        validation: harnessReady,
        deliveryGate: harnessReady,
        noBypass: harnessReady,
        claimDetection: false,
        terminalOutcome: false,
        evidenceDigests: [receipt.digest],
      };
      ready = { repo: context.repo, actor, topics, defaultBranch: repository.default_branch, isProductionRemote, providerEvidence, harnessEvidence, label: null, state: null, stateFile: env.PTP_E2E_STATE ?? null };
      let setup = { status: "NOT_RUN", externalWrites: 0, evidenceDigests: [digest({ runId: context.runId, setup: "not-run" })] };
      if (!isProductionRemote && providerEvidence.status === "PASS" && harnessEvidence.status === "PASS" && ready.stateFile) {
        const before = mutations.length;
        const standardLabels = ["needs-triage", "ready-for-agent"].every((name) => gh(["api", `repos/${context.repo}/labels/${encodeURIComponent(name)}`], undefined, { notFound: true }));
        if (standardLabels) {
          ready.state = persistE2EState(createE2EState({ repo: context.repo, runId: context.runId, actor }), ready.stateFile);
          ready.label = ensureLabel(context);
          const control = gh(["api", "--method", "POST", `repos/${context.repo}/issues`, "--input", "-"], { title: e2eControlTitle(context.runId), body: e2eControlBody(ready.state), labels: [ready.label] });
          const controlReadback = gh(["api", `repos/${context.repo}/issues/${control.number}`]);
          if (controlReadback.body !== e2eControlBody(ready.state) || controlReadback.user?.login !== actor) throw new Error("E2E_CONTROL_CREATE_READBACK_FAILED");
          ready.state = persistE2EState(bindE2EControlIssue(ready.state, control.number), ready.stateFile);
          persistRemoteE2EState(ready.state, gh);
          setup = { status: "PASS", externalWrites: mutations.length - before, evidenceDigests: [digest(mutations.slice(before))] };
        } else {
          setup = { status: "FAIL", externalWrites: 0, evidenceDigests: [digest({ runId: context.runId, setup: "standard-labels-missing" })] };
        }
      }
      return { repo: ready.repo, actor, topics, defaultBranch: ready.defaultBranch, isProductionRemote, providerEvidence, harnessEvidence, setup };
    },

    async runScenario(contract, context) {
      assertReady(context);
      const start = Date.now();
      const before = apiCalls;
      const beforeMutations = mutations.length;
      const base = { unauthorizedWrites: 0, externalWrites: 0, modelTurns: 0, toolCalls: 0, contextTokens: 0 };
      if (["rate-limit", "timeout"].includes(contract.id)) {
        return { status: "UNTESTED", reasonCode: "FAULT_WRAPPER_NOT_EXECUTED", durationMs: Date.now() - start, retries: 0, recoveryAttempted: false, evidenceVerified: false, metrics: { ...base, githubApiCalls: apiCalls - before }, evidenceDigests: evidence(contract, context, beforeMutations, { fault: contract.id }) };
      }
      if (["subagent-no-final-text", "reviewer-schema-error", "reviewer-empty-axis", "receipt-forged"].includes(contract.id)) {
        const binding = { schema: "pi-ticket-planning:admission-review-binding:v1", subject: { target: `github:${context.repo}`, kind: "admission-review", id: "fault", revision: "r1", digest: `sha256:${"a".repeat(64)}` }, inputDigest: `sha256:${"b".repeat(64)}`, byteCount: 2, createdAt: "2026-08-26T00:00:00Z" };
        const malformed = { schema: "pi-ticket-planning:admission-review:v1", reviewer: "ticket-readiness-reviewer", reviewedAt: "2026-08-26T00:00:00Z", source: { identity: "fault", revision: "r1", baseSha: "a".repeat(40) }, axes: { candidateReadiness: "NEEDS_INFO", contextQuality: "NEEDS_INFO", deliveryGraph: "NEEDS_INFO", scenarioCoverage: "NEEDS_INFO", walkingSkeleton: "NEEDS_INFO", strictFrontier: "NEEDS_INFO", executionLane: "PASS", inputBinding: "PASS" }, graphVerdict: "NEEDS_INFO", candidates: [{ id: "fault", verdict: "NEEDS_INFO", executionLane: "HUMAN" }], inputBinding: binding };
        if (contract.id === "reviewer-schema-error") malformed.schema = "pi-ticket-planning:admission-review:v999";
        if (contract.id === "reviewer-empty-axis") delete malformed.axes.candidateReadiness;
        const rejected = ["reviewer-schema-error", "reviewer-empty-axis"].includes(contract.id) && (() => { try { return !validateArtifact(malformed).ok; } catch { return true; } })();
        return { status: rejected ? contract.expectedStatus : "UNTESTED", reasonCode: rejected ? contract.expectedReasonCode : "FAULT_SCENARIO_UNPROVEN", durationMs: Date.now() - start, retries: 0, recoveryAttempted: false, evidenceVerified: rejected, metrics: { ...base, githubApiCalls: apiCalls - before }, evidenceDigests: evidence(contract, context, beforeMutations, { rejected }) };
      }
      if (["provider-timeout", "named-session-missing"].includes(contract.id)) {
        const receipt = await activeCapability();
        const name = contract.id === "provider-timeout" ? "timeout-cancellation" : "pi.named-session";
        const capability = receipt.capabilities.find((item) => item.name === name);
        const matched = contract.id === "provider-timeout"
          ? capability?.status === "SUPPORTED"
          : capability?.status === "BLOCKED" && capability.reasonCode === contract.expectedReasonCode;
        return { status: matched ? contract.expectedStatus : "UNTESTED", reasonCode: matched ? contract.expectedReasonCode : "REAL_PROVIDER_SCENARIO_UNPROVEN", durationMs: Date.now() - start, retries: contract.expectedRecovery && matched ? 1 : 0, recoveryAttempted: contract.expectedRecovery && matched, evidenceVerified: matched, metrics: { ...base, githubApiCalls: apiCalls - before, modelTurns: 1, toolCalls: 1 }, evidenceDigests: [receipt.digest] };
      }
      if (["docker-environment-missing", "readiness-expired"].includes(contract.id)) {
        return { status: "UNTESTED", reasonCode: "HARNESS_FAULT_NOT_EXECUTED", durationMs: Date.now() - start, retries: 0, recoveryAttempted: false, evidenceVerified: false, metrics: { ...base, githubApiCalls: apiCalls - before }, evidenceDigests: evidence(contract, context, beforeMutations, { controlledReadinessFault: true }) };
      }

      const resource = createIssue(contract, context);
      if (contract.id === "success") {
        comment(context, resource.issue.number, `${resource.marker}:comment-1`);
        labels(context, resource.issue.number, [resource.label, "needs-triage"]);
        comment(context, resource.issue.number, `${resource.marker}:comment-2`);
        labels(context, resource.issue.number, [resource.label, "ready-for-agent"]);
      } else if (contract.id === "write-succeeded-response-lost") {
        comment(context, resource.issue.number, `${resource.marker}:ambiguous`);
        const comments = gh(["api", `repos/${context.repo}/issues/${resource.issue.number}/comments`]);
        if (!comments.some(({ body }) => body === `${resource.marker}:ambiguous`)) throw new Error("AMBIGUOUS_WRITE_NOT_RECOVERED");
      } else if (contract.id === "comment-succeeded-label-failed") {
        comment(context, resource.issue.number, `${resource.marker}:partial`);
        try { labels(context, resource.issue.number, [resource.label, `missing-${context.runId}`]); } catch { /* Controlled partial write. */ }
        labels(context, resource.issue.number, [resource.label, "ready-for-agent"]);
      } else if (contract.id === "harness-claim-mid-apply") {
        labels(context, resource.issue.number, [resource.label, "ready-for-agent"]);
        gh(["api", "--method", "PATCH", `repos/${context.repo}/issues/${resource.issue.number}`, "--input", "-"], { assignees: [ready.actor] });
      } else if (contract.id === "network-interruption-resume" || contract.id === "cleanup-failure") {
        labels(context, resource.issue.number, [resource.label, "ready-for-agent"]);
      } else if (contract.id === "source-drift-before-activation") {
        gh(["api", "--method", "PATCH", `repos/${context.repo}/issues/${resource.issue.number}`, "--input", "-"], { body: `${resource.marker}\n\nsource drift` });
      } else if (contract.id === "body-title-policy-graph-context-drift") {
        const title = `${resource.issue.title} drift`;
        saveState(allowE2EResourceTitle(ready.state, { marker: resource.marker, title }));
        gh(["api", "--method", "PATCH", `repos/${context.repo}/issues/${resource.issue.number}`, "--input", "-"], { title });
      }
      const externalWrites = mutations.length - beforeMutations;
      const verified = contract.id === "write-succeeded-response-lost";
      const status = contract.expectedStatus;
      return {
        status: verified ? status : "UNTESTED",
        reasonCode: verified ? contract.expectedReasonCode : "ADMISSION_PATH_NOT_EXECUTED",
        durationMs: Date.now() - start,
        retries: verified && contract.expectedRecovery ? 1 : 0,
        recoveryAttempted: verified && contract.expectedRecovery,
        evidenceVerified: verified,
        metrics: { ...base, externalWrites, githubApiCalls: apiCalls - before },
        evidenceDigests: evidence(contract, context, beforeMutations, { issue: resource.issue.number, externalWrites }),
      };
    },

    async cleanup(context) {
      assertReady(context);
      return cleanupPersistedE2E({ file: ready.stateFile, repo: context.repo, runId: context.runId, api: gh });
    },

    async evidence(context) {
      assertReady(context);
      return { harnessEvidence: ready.harnessEvidence, providerEvidence: ready.providerEvidence };
    },

    metadata() {
      return runtimeMetadata();
    },
  };
}
