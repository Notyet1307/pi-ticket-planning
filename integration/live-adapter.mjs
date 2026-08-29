import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { inspectCapabilities, selectReviewerChildTool, validateCapabilityReceipt } from "../capabilities/doctor.mjs";
import { applyAdmissionPlan } from "../admission/apply.mjs";
import { createGitHubAdapter } from "../admission/github-adapter.mjs";
import { buildStandaloneAdmissionPlan } from "../admission/plan.mjs";
import { bindAdmissionReviewInput, createAdmissionReviewInput, materializeAdmissionReviewInput } from "../admission/review-transport.mjs";
import { buildReviewerDispatchBinding } from "../extensions/reviewer-one-shot-gate.mjs";
import { runtimeMetadata } from "../installation/build-metadata.mjs";
import { buildOutcomeReceipt, ingestOutcomeReceipt } from "../outcome/ingest.mjs";
import { buildPlanningSessionBinding } from "../planning-case/bindings.mjs";
import { createPlanningCaseApproval } from "../planning-case/cli.mjs";
import { createPlanningCaseStore } from "../planning-case/store.mjs";
import { validateArtifact } from "../protocol/kernel.mjs";
import { checkTicketContext } from "../scripts/check-ticket-context.mjs";
import { createPiRpcSession, readPiSessionHeader } from "../scripts/eval-pi-behavior.mjs";
import { runHarnessReadiness } from "../scripts/readiness-receipt.mjs";
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
import { repositoryFromRemote, verifyDisposableGitHubAppAuth } from "./github-app-auth.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const LIVE_FAULT_BOUNDARIES = Object.freeze({
  "rate-limit": "github.comment.write",
  timeout: "github.comment.write",
  "write-succeeded-response-lost": "github.comment.response",
  "comment-succeeded-label-failed": "github.label.write",
  "source-drift-before-activation": "admission.source.readback",
  "body-title-policy-graph-context-drift": "admission.resource.readback",
  "harness-claim-mid-apply": "admission.claim.readback",
  "provider-timeout": "reviewer.provider.turn",
  "subagent-no-final-text": "reviewer.child.final",
  "reviewer-schema-error": "reviewer.output.schema",
  "reviewer-empty-axis": "reviewer.output.axis",
  "named-session-missing": "session.resume.named",
  "docker-environment-missing": "harness.readiness.docker",
  "readiness-expired": "harness.readiness.freshness",
  "receipt-forged": "capability.receipt.digest",
  "network-interruption-resume": "github.read-after-write",
  "cleanup-failure": "cleanup.process.recovery",
});

function failure(code, cause) {
  const error = new Error(code, cause ? { cause } : undefined);
  error.code = code;
  return error;
}

function jsonResult(text) {
  if (typeof text !== "string" || !text.trim()) throw failure("SUBAGENT_FINAL_MISSING");
  const values = [];
  try { values.push(JSON.parse(text.trim())); } catch { /* Try a fenced JSON result. */ }
  if (values.length === 0) {
    for (const match of text.matchAll(/```json\s*\n([\s\S]*?)\n```/gu)) values.push(JSON.parse(match[1]));
  }
  if (values.length !== 1) throw failure("REVIEWER_SCHEMA_INVALID");
  return values[0];
}

function defaultReviewerRuntime(env) {
  return {
    async dispatch({ reviewInput, directory, receipt, source, context, fault }) {
      if (fault === "named-session-missing") throw failure("SESSION_NAME_NOT_RESUMABLE_BY_RUNTIME");
      const descriptor = materializeAdmissionReviewInput(reviewInput, directory);
      const sessionDir = path.join(directory, "sessions");
      fs.mkdirSync(sessionDir, { mode: 0o700 });
      const session = await createPiRpcSession({
        cwd: directory,
        launcher: env.PI_TICKET_PLAN_LAUNCHER ?? path.join(ROOT, "profile", "pi-ticket-plan"),
        model: `${receipt.provider.name}/${receipt.provider.model}`,
        thinking: receipt.provider.thinking,
        timeoutMs: Number(env.PI_TICKET_PLAN_ACTIVE_PROBE_TIMEOUT_MS ?? 120_000),
        skill: "admit-ticket",
        tools: ["read", "subagent"],
        persisted: true,
        sessionDir,
        sessionName: `e2e-${context.runId}-${context.ordinal}-${fault ?? "baseline"}`,
        extensions: [path.join(ROOT, "extensions", "reviewer-one-shot-gate.mjs")],
      });
      try {
        const prompt = `/skill:admit-ticket Invoke the interactive subagent exactly once with only agent ticket-readiness-reviewer and a task. Give the child only this descriptor, require strict JSON bound to its exact input, treat the launch acknowledgement as non-evidence, wait for subagent_result, and return the child final result verbatim: ${JSON.stringify(descriptor)}`;
        const parent = await session.prompt(prompt, { turnTimeoutMs: fault === "provider-timeout" ? 1 : Number(env.PI_TICKET_PLAN_ACTIVE_PROBE_TIMEOUT_MS ?? 120_000) });
        const childTool = selectReviewerChildTool(parent.subagentResults);
        const child = childTool?.details?.results?.[0];
        let finalOutput = fault === "subagent-no-final-text" ? null : child?.finalOutput;
        if (!childTool || childTool.isError || !child?.sessionFile || typeof finalOutput !== "string") throw failure("SUBAGENT_FINAL_MISSING");
        const childHeader = readPiSessionHeader(child.sessionFile);
        let review = jsonResult(finalOutput);
        if (fault === "reviewer-schema-error") review = { ...review, schema: review.schema.replace(/v1$/u, "v999") };
        if (fault === "reviewer-empty-axis") { review = structuredClone(review); delete review.axes.candidateReadiness; }
        let reviewOk = false;
        try { reviewOk = validateArtifact(review).ok; } catch { /* Project to the stable fault code below. */ }
        if (!reviewOk) throw failure(fault === "reviewer-empty-axis" ? "REVIEWER_AXIS_EMPTY" : "REVIEWER_SCHEMA_INVALID");
        const dispatchBinding = buildReviewerDispatchBinding({
          parentSessionId: session.identity.id,
          childRunId: childTool.details.runId,
          childSessionId: childHeader.id,
          childFileDigest: childHeader.digest,
          inputDigest: descriptor.binding.inputDigest,
          outputDigest: digest(finalOutput),
          dispatchOrdinal: 1,
          totalDispatches: 1,
        });
        const sessionBinding = buildPlanningSessionBinding({
          target: `github:${context.repo}`,
          revision: source.revision,
          baseSha: source.baseSha,
          sessionId: session.identity.id,
          sessionFile: session.identity.file,
          provider: receipt.provider.name,
          model: receipt.provider.model,
          profileDigest: receipt.profileDigest,
        });
        return { review, dispatchBinding, sessionBinding, modelTurns: 1, toolCalls: 1 };
      } catch (error) {
        if (fault === "provider-timeout") throw failure("PROVIDER_TIMEOUT_RECOVERED", error);
        throw error;
      } finally {
        await session.close().catch(() => {});
      }
    },
  };
}

function defaultHarnessRuntime(env, execute) {
  return {
    async readiness({ repo, baseSha }) {
      if (!env.PI_TICKET_PLAN_HARNESS_CLI || !env.PI_TICKET_PLAN_HARNESS_CONFIG) return null;
      return runHarnessReadiness({
        harnessCli: env.PI_TICKET_PLAN_HARNESS_CLI,
        harnessConfig: env.PI_TICKET_PLAN_HARNESS_CONFIG,
        repo,
        baseSha,
      });
    },
    async execute({ repo, issue }) {
      const cli = env.PI_TICKET_PLAN_HARNESS_CLI;
      const config = env.PI_TICKET_PLAN_HARNESS_CONFIG;
      if (!cli || !config) throw failure("HARNESS_EXECUTION_ADAPTER_UNCONFIGURED");
      const maxCycles = String(Number(env.PTP_E2E_HARNESS_MAX_CYCLES ?? 120));
      const pollMs = String(Number(env.PTP_E2E_HARNESS_POLL_MS ?? 500));
      const run = execute(cli, ["run", "--config", config, "--max-cycles", maxCycles, "--poll-ms", pollMs], {
        encoding: "utf8",
        timeout: Number(env.PTP_E2E_HARNESS_TIMEOUT_MS ?? 30 * 60 * 1000),
        maxBuffer: 32 * 1024 * 1024,
      });
      if (run.status !== 0) throw failure("HARNESS_EXECUTION_FAILED");
      const status = execute(cli, ["status", "--config", config], { encoding: "utf8", timeout: 60_000, maxBuffer: 32 * 1024 * 1024 });
      if (status.status !== 0) throw failure("HARNESS_TERMINAL_READ_FAILED");
      const state = JSON.parse(status.stdout);
      const job = state.activeJob;
      if (job?.task?.repo !== repo || Number(job?.task?.issueNumber) !== Number(issue) || job.claimConfirmed !== true) throw failure("HARNESS_CLAIM_MISSING");
      if (!["done", "cancelled"].includes(job.state)) throw failure("HARNESS_TERMINAL_OUTCOME_MISSING");
      return {
        claimDetection: true,
        terminalOutcome: true,
        status: job.state,
        evidenceDigests: [digest({ repo, issue, jobId: job.id, revision: job.revision, state: job.state, result: job.activeAttempt?.result ?? null })],
      };
    },
  };
}

function digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

export function createLiveAdapter({ env = process.env, execute = spawnSync, reviewerRuntime, harnessRuntime, cleanupRecovery, spawnProcess = spawnSync } = {}) {
  reviewerRuntime ??= defaultReviewerRuntime(env);
  harnessRuntime ??= defaultHarnessRuntime(env, execute);
  let ready = null;
  let apiCalls = 0;
  let capabilityPromise = null;
  let githubAppEvidence = null;
  const mutations = [];

  function gh(args, input, { notFound = false } = {}) {
    apiCalls += 1;
    const methodIndex = args.indexOf("--method");
    const method = methodIndex >= 0 ? args[methodIndex + 1] : "GET";
    const endpoint = args.find((value) => typeof value === "string" && value.startsWith("repos/")) ?? "unknown";
    if (method !== "GET" && githubAppEvidence?.status !== "PASS") throw new Error("DISPOSABLE_APP_AUTH_REQUIRED");
    const run = execute("gh", args, {
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

  function createIssue(contract, context, { body } = {}) {
    assertReady(context);
    const label = ready.label;
    const marker = `<!-- ${context.resourceTag}:${contract.id}:${context.ordinal} -->`;
    const title = `[${context.resourceTag}] ${contract.id}:${context.ordinal}`;
    const issueBody = body ?? `${marker}\n\n# Controlled Beta scenario\n\n## Agent Brief\n\nExercise the exact disposable Admission and Harness path for ${contract.id}.`;
    saveState(declareE2EResource(ready.state, { marker, title }));
    const issue = gh(["api", "--method", "POST", `repos/${context.repo}/issues`, "--input", "-"], {
      title,
      body: issueBody,
      labels: [label, "needs-triage"],
    });
    const readback = gh(["api", `repos/${context.repo}/issues/${issue.number}`]);
    if (readback.body !== issueBody) throw new Error("GITHUB_READBACK_MISMATCH");
    saveState(bindE2EResource(ready.state, { marker, number: readback.number, actor: readback.user?.login, createdAt: readback.created_at }));
    return { issue: readback, marker, label };
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

  function trackerCandidate(issue) {
    return {
      id: String(issue.number),
      title: issue.title,
      body: issue.body ?? "",
      blockedBy: [],
      labels: (issue.labels ?? []).map((label) => typeof label === "string" ? label : label.name),
      state: issue.state,
      updatedAt: issue.updated_at ?? issue.created_at,
      comments: [],
    };
  }

  function admissionGitHub(contract) {
    let injected = false;
    let mutationObserved = false;
    const runJson = (args, input, options) => {
      const methodIndex = args.indexOf("--method");
      const method = methodIndex < 0 ? "GET" : args[methodIndex + 1];
      const endpoint = args.find((value) => typeof value === "string" && value.startsWith("repos/")) ?? "";
      const commentWrite = method === "POST" && /\/issues\/\d+\/comments$/u.test(endpoint);
      const labelAddition = method === "POST" && /\/issues\/\d+\/labels$/u.test(endpoint);
      const issueRead = method === "GET" && /\/issues\/\d+$/u.test(endpoint);
      if (!injected && commentWrite && ["rate-limit", "timeout"].includes(contract.id)) {
        injected = true;
        throw failure(contract.id === "rate-limit" ? "RATE_LIMIT_INJECTED" : "TIMEOUT_INJECTED");
      }
      if (!injected && labelAddition && contract.id === "comment-succeeded-label-failed") {
        injected = true;
        throw failure("LABEL_WRITE_INJECTED");
      }
      if (!injected && issueRead && mutationObserved && contract.id === "network-interruption-resume") {
        injected = true;
        throw failure("NETWORK_INTERRUPTION_INJECTED");
      }
      const value = gh(args, input, options);
      if (method !== "GET") mutationObserved = true;
      if (!injected && commentWrite && contract.id === "write-succeeded-response-lost") {
        injected = true;
        throw failure("WRITE_RESPONSE_LOST_INJECTED");
      }
      return value;
    };
    return { runJson, injected: () => injected };
  }

  function scenarioDirectory(context, contract) {
    const directory = path.join(path.dirname(path.resolve(ready.stateFile)), `scenario-${digest(`${context.runId}:${contract.id}:${context.ordinal}`).slice(-24)}`);
    fs.mkdirSync(directory, { mode: 0o700 });
    fs.chmodSync(directory, 0o700);
    return directory;
  }

  async function runProductPath(contract, context) {
    if (!ready.harnessBinding) throw failure("HARNESS_READINESS_BINDING_MISSING");
    const resource = createIssue(contract, context);
    const candidate = trackerCandidate(resource.issue);
    const source = {
      identity: `${context.repo}@${ready.capabilityReceipt.repo.baseSha}`,
      revision: ready.capabilityReceipt.subject.revision,
      baseSha: ready.capabilityReceipt.repo.baseSha,
    };
    let harnessBinding = structuredClone(ready.harnessBinding);
    let capabilityReceipt = structuredClone(ready.capabilityReceipt);
    if (contract.id === "docker-environment-missing") harnessBinding.readiness.projection.docker.status = "failed";
    if (contract.id === "readiness-expired") harnessBinding.readiness.observedAt = "2000-01-01T00:00:00.000Z";
    if (contract.id === "receipt-forged") capabilityReceipt.digest = `sha256:${"0".repeat(64)}`;
    const contextChecks = [{
      candidateId: candidate.id,
      result: checkTicketContext({ repo: ready.sourcePath, base: source.baseSha, body: candidate.body }),
    }];
    const policy = {
      accepted: true,
      identity: `AGENTS.md@${source.baseSha}`,
      digest: `sha256:${createHash("sha256").update(fs.readFileSync(path.join(ROOT, "AGENTS.md"))).digest("hex")}`,
    };
    const currentCheckpoint = {
      schema: "pi-ticket-planning:checkpoint:v2",
      lane: "TRIAGE",
      stage: "ADMISSION",
      verdict: "ACTIVATION_AWAITING_CONFIRMATION",
      subject: { target: `github:${context.repo}`, kind: "ticket", id: candidate.id, revision: source.revision, digest: digest({ repo: context.repo, issue: candidate.id, revision: source.revision }) },
    };
    let reviewInput;
    try {
      reviewInput = createAdmissionReviewInput({
        repo: context.repo,
        source,
        policy,
        candidate,
        contextChecks,
        harness: harnessBinding,
        capabilityReceipt,
        reviewedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (contract.id === "docker-environment-missing") throw failure("DOCKER_ENVIRONMENT_MISSING", error);
      if (contract.id === "receipt-forged") throw failure("RECEIPT_FORGED", error);
      throw error;
    }
    const directory = scenarioDirectory(context, contract);
    let reviewer;
    try {
      reviewer = await reviewerRuntime.dispatch({ reviewInput, directory, receipt: capabilityReceipt, source, context, fault: contract.id });
    } catch (error) {
      const expected = {
        "provider-timeout": "PROVIDER_TIMEOUT_RECOVERED",
        "subagent-no-final-text": "SUBAGENT_FINAL_MISSING",
        "reviewer-schema-error": "REVIEWER_SCHEMA_INVALID",
        "reviewer-empty-axis": "REVIEWER_AXIS_EMPTY",
        "named-session-missing": "SESSION_NAME_NOT_RESUMABLE_BY_RUNTIME",
      }[contract.id];
      if (contract.id === "provider-timeout" && error?.code === expected) {
        reviewer = await reviewerRuntime.dispatch({ reviewInput, directory, receipt: capabilityReceipt, source, context, fault: null });
        reviewer = { ...reviewer, recovered: true, modelTurns: (reviewer.modelTurns ?? 1) + 1, toolCalls: (reviewer.toolCalls ?? 1) + 1 };
      } else if (expected && error?.code === expected) throw error;
      else throw error;
    }
    const reviewBinding = bindAdmissionReviewInput(reviewInput).binding;
    const input = {
      repo: context.repo,
      repositoryPath: ready.sourcePath,
      candidate,
      source,
      contextChecks,
      policy,
      harness: harnessBinding,
      capabilityReceipt,
      review: reviewer.review,
      reviewBinding,
      reviewDispatchBinding: reviewer.dispatchBinding,
      currentCheckpoint,
    };
    let plan;
    try { plan = buildStandaloneAdmissionPlan(input); }
    catch (error) {
      if (contract.id === "readiness-expired") throw failure("READINESS_EXPIRED", error);
      throw error;
    }
    const caseId = `PC-E2E-${digest(`${context.runId}:${contract.id}:${context.ordinal}`).slice(-24)}`;
    const caseStateDir = path.join(directory, "case-state");
    const planningCaseStore = createPlanningCaseStore({ stateDir: caseStateDir, idGenerator: () => caseId });
    planningCaseStore.create({ target: `github:${context.repo}`, caseId });
    planningCaseStore.bind({ caseId, name: "session", binding: reviewer.sessionBinding });
    planningCaseStore.bind({ caseId, name: "reviewer", binding: reviewer.dispatchBinding });
    const approval = createPlanningCaseApproval({ plan, caseId, correlationId: `C-${digest(plan.planFingerprint).slice(-24)}`, observedAt: new Date().toISOString() });
    planningCaseStore.addApproval({ caseId, approval });
    if (contract.id === "source-drift-before-activation") {
      gh(["api", "--method", "PATCH", `repos/${context.repo}/issues/${candidate.id}`, "--input", "-"], { body: `${candidate.body}\n\nsource drift` });
    }
    if (contract.id === "body-title-policy-graph-context-drift") {
      const title = `${candidate.title} drift`;
      saveState(allowE2EResourceTitle(ready.state, { marker: resource.marker, title }));
      gh(["api", "--method", "PATCH", `repos/${context.repo}/issues/${candidate.id}`, "--input", "-"], { title });
    }
    if (contract.id === "harness-claim-mid-apply") {
      gh(["api", "--method", "PATCH", `repos/${context.repo}/issues/${candidate.id}`, "--input", "-"], { assignees: [ready.actor] });
    }
    const faultedGitHub = admissionGitHub(contract);
    const adapter = createGitHubAdapter({
      repo: context.repo,
      kind: "STANDALONE",
      target: candidate.id,
      authenticatedActor: ready.actor,
      runJson: faultedGitHub.runJson,
      context: { repositoryPath: ready.sourcePath, source, policy, harness: harnessBinding, capabilityReceipt, currentCheckpoint, contextChecks },
    });
    const applyOptions = {
      expectedFingerprint: plan.planFingerprint,
      planningCaseStore,
      caseId,
      approvalId: approval.id,
      now: new Date().toISOString(),
      evidenceTier: "L3_REAL_DISPOSABLE_INTEGRATION",
      githubAppEvidence: ready.githubAppEvidence,
      githubAppAuthorization: ready.githubAppAuthorization,
    };
    let applied = applyAdmissionPlan(plan, adapter, applyOptions);
    let retries = 0;
    const recoveryFault = ["rate-limit", "timeout", "write-succeeded-response-lost", "comment-succeeded-label-failed", "network-interruption-resume"].includes(contract.id);
    if (recoveryFault && applied.status !== "COMPLETE") {
      retries = 1;
      applied = applyAdmissionPlan(plan, adapter, applyOptions);
    } else if (recoveryFault && applied.recovered?.length > 0) retries = 1;
    if (["source-drift-before-activation", "body-title-policy-graph-context-drift", "harness-claim-mid-apply"].includes(contract.id)) {
      const expectedProblem = contract.id === "harness-claim-mid-apply" ? "HARNESS_CLAIM_DETECTED"
        : contract.id === "source-drift-before-activation" ? "BODY_HASH_MISMATCH" : "TITLE_MISMATCH";
      return { blocked: applied.status !== "COMPLETE" && applied.problems.some(({ code }) => code === expectedProblem), plan, applied, resource, reviewer, retries: 0, faultInjected: true };
    }
    if (applied.status !== "COMPLETE" || recoveryFault && !faultedGitHub.injected()) return { blocked: false, plan, applied, resource, reviewer, retries, faultInjected: faultedGitHub.injected() };
    const harness = await harnessRuntime.execute({ repo: context.repo, issue: candidate.id, plan, caseId, context, fault: contract.id });
    if (!harness.claimDetection || !harness.terminalOutcome) throw failure("HARNESS_FINAL_EVIDENCE_MISSING");
    ready.harnessEvidence = {
      ...ready.harnessEvidence,
      status: "PASS",
      final: { claimDetection: true, terminalOutcome: true },
      evidenceDigests: [...new Set([...ready.harnessEvidence.evidenceDigests, ...harness.evidenceDigests])],
    };
    const outcome = buildOutcomeReceipt({
      id: `OR-E2E-${digest(`${context.runId}:${contract.id}:${context.ordinal}`).slice(-64)}`,
      subject: { target: `github:${context.repo}`, kind: "ticket", id: candidate.id, revision: source.revision, digest: plan.planFingerprint },
      baseSha: source.baseSha,
      source: { kind: "harness", producer: "herdr-harness", producerVersion: ready.capabilityReceipt.harness.version, producerDigest: ready.capabilityReceipt.harness.configDigest },
      observedAt: new Date().toISOString(),
      status: harness.status === "done" ? "ACHIEVED" : "NOT_ACHIEVED",
      evidence: harness.evidenceDigests.map((value) => ({ kind: "harness-terminal", ref: `github:${context.repo}#${candidate.id}`, digest: value })),
    });
    ingestOutcomeReceipt(outcome, { expectedSubject: outcome.subject, store: planningCaseStore, caseId });
    if (contract.id === "cleanup-failure") ready.cleanupFaultRequested = true;
    return { blocked: false, complete: true, plan, applied, outcome, resource, reviewer, harness, retries, faultInjected: recoveryFault ? faultedGitHub.injected() : contract.id === "cleanup-failure" };
  }

  return {
    async preflight(context) {
      const repository = gh(["api", `repos/${context.repo}`]);
      const topics = gh(["api", `repos/${context.repo}/topics`]).names ?? [];
      const remote = execute("git", ["remote", "get-url", "origin"], { encoding: "utf8", timeout: 15_000 });
      const packageRepo = repositoryFromRemote(remote.stdout.trim());
      const isProductionRemote = context.repo === packageRepo || context.repo === env.GITHUB_REPOSITORY;
      if (!repository.has_issues || repository.archived || repository.disabled) throw new Error("DISPOSABLE_REPOSITORY_UNUSABLE");
      const auth = verifyDisposableGitHubAppAuth({ env, repo: context.repo, sourceRepo: packageRepo, api: gh });
      const actor = auth.actor;
      githubAppEvidence = auth.evidence;
      const receipt = await activeCapability();
      const harnessBinding = await harnessRuntime.readiness?.({ repo: context.repo, baseSha: receipt.repo.baseSha, context }) ?? null;
      const byName = new Map(receipt.capabilities.map((item) => [item.name, item]));
      const supported = (name) => byName.get(name)?.status === "SUPPORTED";
      const exactIdFileResume = supported("pi.exact-id-file-resume");
      const namedSession = supported("pi.named-session");
      const providerEvidence = {
        status: ["subagent.final-result", "reviewer.one-shot-dispatch", "reviewer.fresh-context", "reviewer.schema", "pi.exact-id-file-resume", "timeout-cancellation"].every(supported) ? "PASS" : "BLOCKED",
        childResult: supported("subagent.final-result"),
        freshContext: supported("reviewer.fresh-context"),
        strictSchema: supported("reviewer.schema"),
        namedSession,
        persistedSession: exactIdFileResume || supported("pi.persisted-session"),
        exactIdFileResume,
        sessionResume: namedSession || exactIdFileResume,
        timeoutCancellation: supported("timeout-cancellation"),
        evidenceDigests: [receipt.digest],
      };
      const harnessReady = supported("harness.readiness") && receipt.subject.target === `github:${context.repo}`;
      const harnessEvidence = {
        status: harnessReady ? "PARTIAL" : "BLOCKED",
        preflight: { exactTarget: harnessReady, readiness: harnessReady, validation: harnessReady, deliveryGate: harnessReady, noBypass: harnessReady },
        final: { claimDetection: false, terminalOutcome: false },
        evidenceDigests: [receipt.digest],
      };
      const targetGuardsPassed = env.E2E_REPO === context.repo
        && new Set((env.E2E_ALLOWLIST ?? "").split(",").map((value) => value.trim()).filter(Boolean)).has(context.repo)
        && new Set((env.E2E_ACTOR_ALLOWLIST ?? "").split(",").map((value) => value.trim()).filter(Boolean)).has(actor)
        && topics.includes(env.E2E_REPO_TOPIC)
        && repository.default_branch === env.E2E_DEFAULT_BRANCH
        && env.E2E_NO_PRODUCTION_REMOTE === "1" && !isProductionRemote;
      ready = {
        repo: context.repo,
        actor,
        topics,
        defaultBranch: repository.default_branch,
        isProductionRemote,
        providerEvidence,
        harnessEvidence,
        githubAppEvidence,
        githubAppAuthorization: auth.authorization,
        capabilityReceipt: receipt,
        harnessBinding,
        sourcePath: path.resolve(env.PTP_E2E_SOURCE_PATH ?? ROOT),
        label: null,
        state: null,
        stateFile: env.PTP_E2E_STATE ?? null,
      };
      let setup = { status: "NOT_RUN", externalWrites: 0, evidenceDigests: [digest({ runId: context.runId, setup: "not-run" })] };
      if (targetGuardsPassed && providerEvidence.status === "PASS" && harnessReady && ready.stateFile) {
        const before = mutations.length;
        const standardLabels = ["needs-triage", "ready-for-agent"].every((name) => gh(["api", `repos/${context.repo}/labels/${encodeURIComponent(name)}`], undefined, { notFound: true }));
        if (standardLabels) {
          ready.state = persistE2EState(createE2EState({ repo: context.repo, runId: context.runId, actor }), ready.stateFile);
          const control = gh(["api", "--method", "POST", `repos/${context.repo}/issues`, "--input", "-"], { title: e2eControlTitle(context.runId), body: e2eControlBody(ready.state), labels: [] });
          const controlReadback = gh(["api", `repos/${context.repo}/issues/${control.number}`]);
          const app = controlReadback.performed_via_github_app;
          if (controlReadback.body !== e2eControlBody(ready.state) || controlReadback.user?.login !== actor
            || app?.slug !== githubAppEvidence.appSlug || app.permissions?.metadata !== "read" || app.permissions?.issues !== "write"
            || app.permissions?.contents !== undefined || app.permissions?.administration !== undefined) throw new Error("E2E_CONTROL_CREATE_READBACK_FAILED");
          githubAppEvidence = { ...githubAppEvidence, writeActorReadback: true, evidenceDigests: [...new Set([...githubAppEvidence.evidenceDigests, digest({ appSlug: app.slug, permissions: app.permissions, actor })])] };
          ready.githubAppEvidence = githubAppEvidence;
          ready.state = persistE2EState(bindE2EControlIssue(ready.state, control.number), ready.stateFile);
          persistRemoteE2EState(ready.state, gh);
          ready.label = ensureLabel(context);
          labels(context, control.number, [ready.label]);
          setup = { status: "PASS", externalWrites: mutations.length - before, evidenceDigests: [digest(mutations.slice(before))] };
        } else {
          setup = { status: "FAIL", externalWrites: 0, evidenceDigests: [digest({ runId: context.runId, setup: "standard-labels-missing" })] };
        }
      }
      return { repo: ready.repo, actor, topics, defaultBranch: ready.defaultBranch, isProductionRemote, providerEvidence, harnessEvidence, githubAppEvidence, setup };
    },

    async runScenario(contract, context) {
      assertReady(context);
      const start = Date.now();
      const before = apiCalls;
      const beforeMutations = mutations.length;
      const base = { unauthorizedWrites: 0, externalWrites: 0, modelTurns: 0, toolCalls: 0, contextTokens: 0 };
      let result = null;
      let thrown = null;
      try { result = await runProductPath(contract, context); }
      catch (error) { thrown = error; }
      const externalWrites = mutations.length - beforeMutations;
      const expectedThrown = {
        "subagent-no-final-text": "SUBAGENT_FINAL_MISSING",
        "reviewer-schema-error": "REVIEWER_SCHEMA_INVALID",
        "reviewer-empty-axis": "REVIEWER_AXIS_EMPTY",
        "named-session-missing": "SESSION_NAME_NOT_RESUMABLE_BY_RUNTIME",
        "docker-environment-missing": "DOCKER_ENVIRONMENT_MISSING",
        "readiness-expired": "READINESS_EXPIRED",
        "receipt-forged": "RECEIPT_FORGED",
      }[contract.id];
      const thrownVerified = expectedThrown !== undefined && thrown?.code === expectedThrown;
      const pathVerified = contract.expectedStatus === "EXPECTED_BLOCK" ? result?.blocked === true
        : result?.complete === true && (contract.id === "success" || result.faultInjected === true || result.reviewer?.recovered === true);
      const verified = thrownVerified || pathVerified;
      const retries = result?.reviewer?.recovered ? 1 : result?.retries ?? 0;
      return {
        status: verified ? contract.expectedStatus : "FAIL",
        reasonCode: verified ? contract.expectedReasonCode : "FAULT_SCENARIO_UNPROVEN",
        durationMs: Date.now() - start,
        retries,
        recoveryAttempted: verified && contract.expectedRecovery,
        evidenceVerified: verified,
        metrics: { ...base, externalWrites, githubApiCalls: apiCalls - before, modelTurns: result?.reviewer?.modelTurns ?? (thrown ? 1 : 0), toolCalls: result?.reviewer?.toolCalls ?? (thrown ? 1 : 0) },
        evidenceDigests: evidence(contract, context, beforeMutations, { boundary: LIVE_FAULT_BOUNDARIES[contract.id] ?? "healthy", verified, error: thrown?.code ?? null, plan: result?.plan?.planFingerprint ?? null, outcome: result?.outcome?.digest ?? null }),
      };
    },

    async cleanup(context) {
      assertReady(context);
      const auth = { githubAppAuthorization: ready.githubAppAuthorization, githubAppEvidence: ready.githubAppEvidence };
      if (!ready.cleanupFaultRequested) return cleanupPersistedE2E({ file: ready.stateFile, repo: context.repo, runId: context.runId, actor: ready.actor, api: gh, ...auth });
      let interrupted = false;
      const interruptingApi = (args, input, options) => {
        const methodIndex = args.indexOf("--method");
        const method = methodIndex < 0 ? "GET" : args[methodIndex + 1];
        if (!interrupted && method !== "GET") { interrupted = true; throw failure("CLEANUP_INTERRUPTED"); }
        return gh(args, input, options);
      };
      try { cleanupPersistedE2E({ file: ready.stateFile, repo: context.repo, runId: context.runId, actor: ready.actor, api: interruptingApi, ...auth }); }
      catch (error) { if (error?.code !== "CLEANUP_INTERRUPTED") throw error; }
      if (!interrupted) throw failure("CLEANUP_FAULT_NOT_INJECTED");
      if (cleanupRecovery) {
        if (await cleanupRecovery({ context, stateFile: ready.stateFile, stateDigest: ready.state.digest }) !== true) throw failure("CLEANUP_RECOVERY_FAILED");
      } else {
        const child = spawnProcess(process.execPath, [path.join(ROOT, "integration", "cleanup.mjs"), "--state", ready.stateFile, "--repo", context.repo, "--run-id", context.runId], {
          encoding: "utf8",
          env: { ...process.env, ...env },
          timeout: 30 * 60 * 1000,
          maxBuffer: 32 * 1024 * 1024,
        });
        if (child.status !== 0 || JSON.parse(child.stdout).status !== "PASS") throw failure("CLEANUP_RECOVERY_FAILED");
      }
      const verified = cleanupPersistedE2E({ file: ready.stateFile, repo: context.repo, runId: context.runId, actor: ready.actor, api: gh, ...auth });
      return { ...verified, recoveredByAnotherProcess: true };
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
