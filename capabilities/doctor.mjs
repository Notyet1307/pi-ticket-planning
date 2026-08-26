import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { validateArtifact, validateArtifactRuntime, validateCodeSchemaCoverage, validateProtocolRules, validateRegistry } from "../protocol/kernel.mjs";
import { runtimeMetadata } from "../installation/build-metadata.mjs";
import { buildReviewerDispatchBinding } from "../extensions/reviewer-one-shot-gate.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const STATUSES = new Set(["SUPPORTED", "DEGRADED", "BLOCKED", "UNTESTED"]);
const RUNTIME_ONLY = new Set([
  "pi.arguments",
  "pi.session",
  "pi.named-session",
  "pi.persisted-session",
  "pi.exact-id-file-resume",
  "subagent.final-result",
  "reviewer.one-shot-dispatch",
  "reviewer.fresh-context",
  "reviewer.schema",
  "tool-calling",
  "timeout-cancellation",
  "harness.readiness",
  "provider.reviewer",
]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function hash(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical(value)), "utf8").digest("hex")}`;
}

function problem(code, subject) {
  return subject === undefined ? { code } : { code, subject };
}

export function isSuccessfulReviewerChild(child) {
  return child?.index === 0 && child.agent === "ticket-readiness-reviewer" && child.exitCode === 0
    && child.processSignal == null && child.timedOut !== true && child.interrupted !== true
    && child.stopped !== true && typeof child.finalOutput === "string" && child.finalOutput.length > 0;
}

export function selectReviewerChildTool(evidence) {
  const executions = (evidence ?? []).filter((item) => item?.details?.mode === "single"
    && item?.toolCall?.arguments?.agent === "ticket-readiness-reviewer"
    && item.details.results?.length === 1);
  return executions.length === 1 ? executions[0] : null;
}

function projection(receipt) {
  const { digest, ...value } = receipt;
  return value;
}

export function buildCapabilityReceipt(value) {
  const receipt = {
    schema: "pi-ticket-planning:capability-receipt:v1",
    subject: structuredClone(value.subject),
    observedAt: value.observedAt,
    expiresAt: value.expiresAt,
    pi: structuredClone(value.pi),
    subagent: structuredClone(value.subagent),
    provider: structuredClone(value.provider),
    profileDigest: value.profileDigest,
    harness: value.harness === null ? null : structuredClone(value.harness),
    repo: structuredClone(value.repo),
    capabilities: structuredClone(value.capabilities),
  };
  return { ...receipt, digest: hash(receipt) };
}

export function validateCapabilityReceipt(receipt, { now } = {}) {
  const problems = [];
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    return { ok: false, problems: [problem("INVALID_CAPABILITY_RECEIPT")] };
  }
  try {
    problems.push(...validateArtifact(receipt).problems);
  } catch {
    problems.push(problem("INVALID_CAPABILITY_RECEIPT"));
  }
  if (now !== undefined && Number.isFinite(Date.parse(now)) && Date.parse(now) > Date.parse(receipt.expiresAt)) {
    problems.push(problem("CAPABILITY_RECEIPT_EXPIRED"));
  }
  if (receipt.schema !== "pi-ticket-planning:capability-receipt:v1") problems.push(problem("INVALID_CAPABILITY_RECEIPT_SCHEMA"));
  if (!Number.isFinite(Date.parse(receipt.observedAt)) || !Number.isFinite(Date.parse(receipt.expiresAt))
    || Date.parse(receipt.expiresAt) <= Date.parse(receipt.observedAt)) problems.push(problem("INVALID_CAPABILITY_RECEIPT_TIME"));
  if (!DIGEST.test(receipt.profileDigest ?? "") || !DIGEST.test(receipt.pi?.digest ?? "")) {
    problems.push(problem("INVALID_CAPABILITY_RECEIPT_BINDING"));
  }
  if (!Array.isArray(receipt.capabilities) || receipt.capabilities.length === 0) {
    problems.push(problem("MISSING_CAPABILITIES"));
  } else {
    const names = new Set();
    for (const capability of receipt.capabilities) {
      if (!/^[a-z][a-z0-9.-]{0,127}$/.test(capability?.name ?? "")
        || !STATUSES.has(capability?.status)
        || !/^[A-Z][A-Z0-9_]{0,127}$/.test(capability?.reasonCode ?? "")
        || !Array.isArray(capability?.evidence)) {
        problems.push(problem("INVALID_CAPABILITY", capability?.name));
        continue;
      }
      if (names.has(capability.name)) problems.push(problem("DUPLICATE_CAPABILITY", capability.name));
      names.add(capability.name);
      if (capability.status === "SUPPORTED" && RUNTIME_ONLY.has(capability.name)
        && !capability.evidence.some((item) => item?.kind === "active-probe" && DIGEST.test(item.digest ?? ""))) {
        problems.push(problem("CAPABILITY_SUPPORT_UNPROVEN", capability.name));
      }
      if (capability.status === "SUPPORTED" && capability.evidence.length === 0) {
        problems.push(problem("CAPABILITY_SUPPORT_UNPROVEN", capability.name));
      }
    }
  }
  if (!DIGEST.test(receipt.digest ?? "") || receipt.digest !== hash(projection(receipt))) {
    problems.push(problem("CAPABILITY_RECEIPT_DIGEST_MISMATCH"));
  }
  return { ok: problems.length === 0, problems };
}

function fileDigest(file) {
  return `sha256:${createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`;
}

function unavailableDigest(label) {
  return `sha256:${createHash("sha256").update(`UNAVAILABLE:${label}`, "utf8").digest("hex")}`;
}

function executable(command, env) {
  const candidates = path.isAbsolute(command)
    ? [command]
    : (env.PATH ?? "").split(path.delimiter).filter(Boolean).map((directory) => path.join(directory, command));
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      const resolved = fs.realpathSync(candidate);
      if (!fs.statSync(resolved).isFile()) continue;
      const version = spawnSync(resolved, ["--version"], { encoding: "utf8", timeout: 15_000 });
      return {
        available: version.status === 0,
        path: resolved,
        version: (version.stdout || version.stderr).trim().split(/\r?\n/, 1)[0] || "UNKNOWN",
        digest: fileDigest(resolved),
      };
    } catch {
      // Try the next PATH entry.
    }
  }
  return { available: false, path: "UNAVAILABLE", version: "UNAVAILABLE", digest: unavailableDigest(command) };
}

function gitOutput(args) {
  const result = spawnSync("git", ["-C", ROOT, ...args], { encoding: "utf8", timeout: 15_000 });
  return result.status === 0 ? result.stdout.trim() : "";
}

function repositoryTarget(env) {
  if (env.PI_TICKET_PLAN_TARGET) return env.PI_TICKET_PLAN_TARGET;
  const remote = gitOutput(["remote", "get-url", "origin"]);
  const match = remote.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/i);
  return match ? `github:${match[1]}/${match[2]}` : `local:${createHash("sha256").update(ROOT).digest("hex")}`;
}

function profileObservation(env) {
  const profileDir = path.resolve(env.PI_TICKET_PLAN_PROFILE_DIR ?? path.join(os.homedir(), ".pi", "ticket-planning"));
  const settingsFile = path.join(profileDir, "settings.json");
  try {
    const metadata = fs.lstatSync(settingsFile);
    if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) throw new Error("unsafe settings");
    const settings = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    const source = settings.packages?.find(({ source: value }) => /^npm:pi-subagents@/.test(value ?? ""))?.source ?? "";
    const settingsDigest = fileDigest(settingsFile);
    const checked = spawnSync(process.execPath, [path.join(ROOT, "scripts", "check-profile.mjs")], {
      encoding: "utf8",
      timeout: 60_000,
      env: { ...env, PI_TICKET_PLAN_PROFILE_DIR: profileDir },
    });
    return {
      available: checked.status === 0,
      digest: hash({ settingsDigest, checkStatus: checked.status, checkOutput: checked.status === 0 ? checked.stdout.trim() : "FAILED" }),
      subagentVersion: source.match(/@([^@]+)$/)?.[1] ?? "UNKNOWN",
    };
  } catch {
    return { available: false, digest: unavailableDigest("profile"), subagentVersion: "UNKNOWN" };
  }
}

function harnessObservation(env) {
  const cli = env.PI_TICKET_PLAN_HARNESS_CLI;
  const config = env.PI_TICKET_PLAN_HARNESS_CONFIG;
  if (!cli || !config) return null;
  try {
    const resolvedCli = fs.realpathSync(cli);
    const resolvedConfig = fs.realpathSync(config);
    const configMetadata = fs.lstatSync(resolvedConfig);
    if (!fs.statSync(resolvedCli).isFile() || !configMetadata.isFile() || configMetadata.isSymbolicLink() || (configMetadata.mode & 0o077) !== 0) return null;
    return {
      path: resolvedCli,
      version: spawnSync(resolvedCli, ["--version"], { encoding: "utf8", timeout: 15_000 }).stdout.trim() || "UNKNOWN",
      digest: fileDigest(resolvedCli),
      configPath: resolvedConfig,
      configDigest: fileDigest(resolvedConfig),
    };
  } catch {
    return null;
  }
}

export function observeStaticCapabilities({ env = process.env } = {}) {
  const node = { available: true, path: fs.realpathSync(process.execPath), version: process.version, digest: fileDigest(fs.realpathSync(process.execPath)) };
  const pi = executable(env.PI_TICKET_PLAN_LAUNCHER ?? path.join(ROOT, "profile", "pi-ticket-plan"), env);
  const git = executable("git", env);
  const gh = executable("gh", env);
  const docker = executable("docker", env);
  const profile = profileObservation(env);
  const protocol = [validateRegistry(), validateCodeSchemaCoverage(), validateProtocolRules()];
  const baseSha = runtimeMetadata({ root: ROOT }).sourceCommit;
  const target = repositoryTarget(env);
  const provider = env.PI_TICKET_PLAN_PROVIDER ?? "UNCONFIGURED";
  const model = env.PI_TICKET_PLAN_MODEL ?? "UNCONFIGURED";
  const harness = harnessObservation(env);
  return {
    target,
    baseSha,
    provider,
    model,
    node,
    pi,
    git,
    gh,
    docker,
    profile,
    protocolOk: protocol.every(({ ok }) => ok),
    harness,
  };
}

function staticEvidence(observation) {
  return [{ kind: "static-check", digest: observation.digest }];
}

function configuredEvidence(value) {
  return [{ kind: "configuration", digest: `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}` }];
}

function staticCapability(name, observation, essential = false) {
  return observation.available
    ? { name, status: "SUPPORTED", reasonCode: "STATIC_VERSION_OK", evidence: staticEvidence(observation) }
    : { name, status: essential ? "BLOCKED" : "DEGRADED", reasonCode: "EXECUTABLE_UNAVAILABLE", evidence: [] };
}

const RUNTIME_NAMES = [...RUNTIME_ONLY];

function activeEvidence(observed, name, value = "PASS") {
  return [{
    kind: "active-probe",
    digest: hash({ name, value, pi: observed.pi.digest, provider: observed.provider, model: observed.model }),
  }];
}

function uniqueJsonBlock(text) {
  if (typeof text !== "string" || !text.trim()) throw new Error("REVIEW_MACHINE_OUTPUT_MISSING");
  const candidates = [];
  try { candidates.push(JSON.parse(text.trim())); } catch { /* Require one fenced JSON block below. */ }
  if (candidates.length === 0) {
    for (const match of text.matchAll(/```json\s*\n([\s\S]*?)\n```/gu)) {
      try { candidates.push(JSON.parse(match[1])); } catch { throw new Error("REVIEW_MACHINE_OUTPUT_INVALID"); }
    }
  }
  if (candidates.length !== 1) throw new Error("REVIEW_MACHINE_OUTPUT_NOT_UNIQUE");
  return candidates[0];
}

async function defaultActiveProbe(observed, { env }) {
  const results = new Map(RUNTIME_NAMES.map((name) => [name, {
    name,
    status: "UNTESTED",
    reasonCode: "ACTIVE_PROBE_NOT_COMPLETED",
    evidence: [],
  }]));
  if (!observed.pi.available) {
    for (const name of RUNTIME_NAMES) results.set(name, { name, status: "BLOCKED", reasonCode: "PI_UNAVAILABLE", evidence: [] });
    return [...results.values()];
  }
  const help = spawnSync(observed.pi.path, ["--help"], { encoding: "utf8", timeout: 15_000 });
  results.set("pi.arguments", help.status === 0
    ? { name: "pi.arguments", status: "SUPPORTED", reasonCode: "ACTIVE_ARGUMENT_PROBE_PASS", evidence: activeEvidence(observed, "pi.arguments") }
    : { name: "pi.arguments", status: "BLOCKED", reasonCode: "PI_HELP_FAILED", evidence: [] });

  if (observed.provider === "UNCONFIGURED" || observed.model === "UNCONFIGURED" || !env.PI_TICKET_PLAN_THINKING) {
    const reasonCode = !env.PI_TICKET_PLAN_THINKING ? "THINKING_CONFIG_REQUIRED" : "PROVIDER_MODEL_CONFIG_REQUIRED";
    for (const name of ["pi.session", "pi.named-session", "pi.persisted-session", "pi.exact-id-file-resume", "subagent.final-result", "reviewer.one-shot-dispatch", "reviewer.fresh-context", "reviewer.schema", "tool-calling", "timeout-cancellation", "provider.reviewer"]) {
      results.set(name, { name, status: "BLOCKED", reasonCode, evidence: [] });
    }
  } else {
    const timeoutMs = Number(env.PI_TICKET_PLAN_ACTIVE_PROBE_TIMEOUT_MS ?? 120_000);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 10_000 || timeoutMs > 10 * 60 * 1000) throw new Error("active probe timeout is invalid");
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-capability-workspace-"));
    const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-capability-session-"));
    const reviewDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-capability-review-"));
    fs.chmodSync(reviewDirectory, 0o700);
    const token = `TOOL_OK_${createHash("sha256").update(`${process.pid}:${Date.now()}`).digest("hex").slice(0, 12)}`;
    fs.writeFileSync(path.join(workspace, "capability-probe.txt"), `${token}\n`, { mode: 0o600 });
    let toolSession;
    let reviewerSession;
    let namedSession;
    let resumedSession;
    let timeoutSession;
    let timeoutEvidence = null;
    try {
      const { createPiRpcSession } = await import("../scripts/eval-pi-behavior.mjs");
      toolSession = await createPiRpcSession({
        cwd: workspace,
        launcher: observed.pi.path,
        model: `${observed.provider}/${observed.model}`,
        thinking: env.PI_TICKET_PLAN_THINKING,
        timeoutMs,
        skill: "ticket-readiness",
        tools: ["read"],
        persisted: false,
        sessionDir: "",
        sessionName: "capability-tool",
      });
      const toolResult = await toolSession.prompt(`Use the read tool on capability-probe.txt, then reply with the exact token from that file and nothing else.`);
      results.set("pi.session", { name: "pi.session", status: "SUPPORTED", reasonCode: "ACTIVE_SESSION_PASS", evidence: activeEvidence(observed, "pi.session", toolSession.identity.id) });
      results.set("tool-calling", toolResult.text.trim() === token
        ? { name: "tool-calling", status: "SUPPORTED", reasonCode: "READ_TOOL_PROBE_PASS", evidence: activeEvidence(observed, "tool-calling", token) }
        : { name: "tool-calling", status: "BLOCKED", reasonCode: "READ_TOOL_PROBE_FAIL", evidence: [] });

      const { captureAdmissionReviewInput, createAdmissionReviewInput, materializeAdmissionReviewInput } = await import("../admission/review-transport.mjs");
      const reviewedAt = new Date().toISOString();
      const reviewInput = createAdmissionReviewInput({
        repo: observed.target.startsWith("github:") ? observed.target.slice("github:".length) : "capability/probe",
        source: { identity: "capability-probe", revision: observed.baseSha, baseSha: observed.baseSha },
        policy: { accepted: true, identity: "capability-probe-policy", digest: hash({ policy: "read-only" }) },
        candidate: {
          id: "CAPABILITY-1",
          title: "Read-only Reviewer capability probe",
          body: "# Capability probe\n\nThe required Context check is intentionally absent.",
          blockedBy: [],
          labels: ["needs-triage"],
          state: "open",
          updatedAt: reviewedAt,
        },
        contextChecks: [],
        harness: null,
        reviewedAt,
      });
      const descriptor = materializeAdmissionReviewInput(reviewInput, reviewDirectory);
      reviewerSession = await createPiRpcSession({
        cwd: reviewDirectory,
        launcher: observed.pi.path,
        model: `${observed.provider}/${observed.model}`,
        thinking: env.PI_TICKET_PLAN_THINKING,
        timeoutMs,
        skill: "admit-ticket",
        tools: ["read", "subagent"],
        persisted: false,
        sessionDir: "",
        sessionName: "capability-reviewer",
        extensions: [path.join(ROOT, "extensions", "reviewer-one-shot-gate.mjs")],
      });
      const expectedAxes = { candidateReadiness: "NEEDS_INFO", contextQuality: "NEEDS_INFO", deliveryGraph: "NEEDS_INFO", scenarioCoverage: "NEEDS_INFO", walkingSkeleton: "NEEDS_INFO", strictFrontier: "NEEDS_INFO", executionLane: "PASS", inputBinding: "PASS" };
      const reviewerResult = await reviewerSession.prompt(`/skill:admit-ticket This is a read-only capability probe, not an Admission activation. Invoke ticket-readiness-reviewer exactly once with async false, context fresh, artifacts false, mission false, and omitted acceptance. Give the child only this transport descriptor as the end of its task, ask it to read through EOF, return NEEDS_INFO for the intentionally absent Context check, preserve the HUMAN lane, echo the exact source and all eight axes ${JSON.stringify(expectedAxes)}, and include the required machine projection. Return the child's final result verbatim: ${JSON.stringify(descriptor)}`);
      const evidence = reviewerResult.subagentResults;
      const childTool = selectReviewerChildTool(evidence);
      const child = childTool?.details.results[0] ?? null;
      const call = childTool?.toolCall?.arguments;
      const childHeader = child?.sessionFile ? (await import("../scripts/eval-pi-behavior.mjs")).readPiSessionHeader(child.sessionFile) : null;
      const finalResult = child && typeof child.finalOutput === "string" ? child.finalOutput : null;
      const finalEvent = Boolean(childTool && !childTool.isError && childTool.details.runId
        && isSuccessfulReviewerChild(child) && finalResult && childHeader?.id
        && fs.realpathSync(childHeader.cwd) === fs.realpathSync(reviewDirectory));
      let dispatchBinding = null;
      if (finalEvent) {
        dispatchBinding = buildReviewerDispatchBinding({
          parentSessionId: reviewerSession.identity.id,
          childRunId: childTool.details.runId,
          childSessionId: childHeader.id,
          childFileDigest: childHeader.digest,
          inputDigest: descriptor.binding.inputDigest,
          outputDigest: hash(finalResult),
          dispatchOrdinal: 1,
          totalDispatches: 1,
        });
      }
      results.set("subagent.final-result", finalEvent
        ? { name: "subagent.final-result", status: "SUPPORTED", reasonCode: "CHILD_FINAL_EVENT_PASS", evidence: activeEvidence(observed, "subagent.final-result", `${childTool.details.runId}:${childHeader.id}`) }
        : { name: "subagent.final-result", status: "BLOCKED", reasonCode: "CHILD_FINAL_EVENT_MISSING", evidence: [] });
      results.set("reviewer.one-shot-dispatch", dispatchBinding
        ? { name: "reviewer.one-shot-dispatch", status: "SUPPORTED", reasonCode: "REVIEWER_ONE_SHOT_GATE_PASS", evidence: activeEvidence(observed, "reviewer.one-shot-dispatch", dispatchBinding.digest) }
        : { name: "reviewer.one-shot-dispatch", status: "BLOCKED", reasonCode: "REVIEWER_ONE_SHOT_GATE_UNPROVEN", evidence: [] });
      let review = null;
      try { review = uniqueJsonBlock(finalResult); } catch { /* Project to BLOCKED below. */ }
      const reviewStructure = review ? await validateArtifactRuntime(review) : { ok: false };
      const hasSchema = reviewStructure.ok
        && review.reviewedAt === reviewedAt
        && JSON.stringify(canonical(review.source)) === JSON.stringify(canonical(reviewInput.source))
        && JSON.stringify(canonical(review.axes)) === JSON.stringify(canonical(expectedAxes))
        && review.graphVerdict === "NEEDS_INFO"
        && review.candidates?.length === 1
        && review.candidates[0].id === "CAPABILITY-1"
        && review.candidates[0].verdict === "NEEDS_INFO"
        && review.candidates[0].executionLane === "HUMAN"
        && JSON.stringify(canonical(review.inputBinding)) === JSON.stringify(canonical(descriptor.binding));
      let heldInputOnly = false;
      try { heldInputOnly = captureAdmissionReviewInput(reviewDirectory).binding.inputDigest === descriptor.binding.inputDigest; } catch { /* Project to BLOCKED. */ }
      const extensionPath = path.join(ROOT, "extensions", "ticket-readiness-read-guard.mjs");
      const launchExtensions = child?.launchResolvedExtensions;
      const capabilityAudit = child?.capabilityAudit;
      const isolatedTools = capabilityAudit?.effectiveTools?.length === 1 && capabilityAudit.effectiveTools[0] === "read"
        && capabilityAudit.extensionsDenied === false;
      const isolatedExtensions = launchExtensions?.disableAmbientExtensions === true
        && launchExtensions.effective?.length === 1
        && fs.realpathSync(launchExtensions.effective[0]) === fs.realpathSync(extensionPath)
        && child.runtimeAcknowledgedExtensions?.ids?.length >= 1;
      const fresh = finalEvent
        && call?.agent === "ticket-readiness-reviewer"
        && call?.context === "fresh"
        && call?.async === false
        && call?.artifacts === false
        && call?.mission === false
        && call?.acceptance === undefined
        && typeof call?.task === "string" && call.task.endsWith(JSON.stringify(descriptor))
        && child.context === "fresh"
        && JSON.stringify(child.skills) === JSON.stringify(["ticket-readiness"])
        && child.acceptance?.effectiveAcceptance?.level === "none"
        && !child.artifactPaths
        && isolatedTools && isolatedExtensions && heldInputOnly
        && childHeader?.id !== reviewerSession.identity.id
        && childHeader?.file !== reviewerSession.identity.file;
      results.set("reviewer.fresh-context", fresh
        ? { name: "reviewer.fresh-context", status: "SUPPORTED", reasonCode: "CHILD_FRESH_CONTEXT_PASS", evidence: activeEvidence(observed, "reviewer.fresh-context", `${childHeader.id}:${childHeader.digest}`) }
        : { name: "reviewer.fresh-context", status: "BLOCKED", reasonCode: "CHILD_FRESH_CONTEXT_UNPROVEN", evidence: [] });
      results.set("reviewer.schema", hasSchema
        ? { name: "reviewer.schema", status: "SUPPORTED", reasonCode: "STRICT_REVIEW_SCHEMA_PASS", evidence: activeEvidence(observed, "reviewer.schema", review.inputBinding.inputDigest) }
        : { name: "reviewer.schema", status: "BLOCKED", reasonCode: "STRICT_REVIEW_SCHEMA_FAILED", evidence: [] });
      results.set("provider.reviewer", hasSchema && fresh
        ? { name: "provider.reviewer", status: "SUPPORTED", reasonCode: "ACTIVE_REVIEWER_CHILD_PASS", evidence: activeEvidence(observed, "provider.reviewer", childTool.details.runId) }
        : { name: "provider.reviewer", status: "BLOCKED", reasonCode: "ACTIVE_REVIEWER_FAILED", evidence: [] });

      namedSession = await createPiRpcSession({
        cwd: workspace,
        launcher: observed.pi.path,
        model: `${observed.provider}/${observed.model}`,
        thinking: env.PI_TICKET_PLAN_THINKING,
        timeoutMs,
        skill: "ticket-readiness",
        tools: ["read"],
        persisted: true,
        sessionDir,
        sessionName: "capability-named",
      });
      const first = await namedSession.prompt("Reply exactly NAMED_SESSION_ONE.");
      const firstEntries = await namedSession.entries();
      const persistedIdentity = { id: namedSession.identity.id, file: namedSession.identity.file };
      await namedSession.close();
      const firstExited = !namedSession.isAlive();
      namedSession = null;
      resumedSession = await createPiRpcSession({
        cwd: workspace,
        launcher: observed.pi.path,
        model: `${observed.provider}/${observed.model}`,
        thinking: env.PI_TICKET_PLAN_THINKING,
        timeoutMs,
        skill: "ticket-readiness",
        tools: ["read"],
        persisted: true,
        sessionDir,
        resume: persistedIdentity,
      });
      const resumedEntries = await resumedSession.entries();
      const second = await resumedSession.prompt("Reply exactly NAMED_SESSION_TWO.");
      const namedOk = firstExited && first.state.sessionId === persistedIdentity.id
        && second.state.sessionId === persistedIdentity.id
        && resumedSession.identity.id === persistedIdentity.id
        && resumedSession.identity.file === fs.realpathSync(persistedIdentity.file)
        && resumedEntries.length >= firstEntries.length;
      results.set("pi.persisted-session", namedOk
        ? { name: "pi.persisted-session", status: "SUPPORTED", reasonCode: "CROSS_PROCESS_SESSION_RESUME_PASS", evidence: activeEvidence(observed, "pi.persisted-session", `${persistedIdentity.id}:${persistedIdentity.file}`) }
        : { name: "pi.persisted-session", status: "BLOCKED", reasonCode: "CROSS_PROCESS_SESSION_RESUME_FAIL", evidence: [] });
      results.set("pi.exact-id-file-resume", namedOk
        ? { name: "pi.exact-id-file-resume", status: "SUPPORTED", reasonCode: "EXACT_ID_FILE_RESUME_PASS", evidence: activeEvidence(observed, "pi.exact-id-file-resume", `${persistedIdentity.id}:${persistedIdentity.file}`) }
        : { name: "pi.exact-id-file-resume", status: "BLOCKED", reasonCode: "EXACT_ID_FILE_RESUME_FAIL", evidence: [] });
      results.set("pi.named-session", {
        name: "pi.named-session",
        status: "BLOCKED",
        reasonCode: "SESSION_NAME_NOT_RESUMABLE_BY_RUNTIME",
        evidence: namedOk ? activeEvidence(observed, "pi.named-session", "exact-id-file-only") : [],
      });
      await resumedSession.close();
      resumedSession = null;

      timeoutSession = await createPiRpcSession({
        cwd: workspace,
        launcher: observed.pi.path,
        model: `${observed.provider}/${observed.model}`,
        thinking: env.PI_TICKET_PLAN_THINKING,
        timeoutMs,
        skill: "ticket-readiness",
        tools: ["ptp_timeout_probe"],
        persisted: false,
        sessionDir: "",
        extensions: [path.join(ROOT, "extensions", "capability-timeout-probe.mjs")],
        sessionEnv: { PTP_TIMEOUT_PROBE_EVIDENCE: path.join(workspace, "timeout-probe.json") },
      });
      const timeoutParentPid = timeoutSession.pid;
      const turnTimeoutMs = Number(env.PI_TICKET_PLAN_CONTROLLED_TIMEOUT_MS ?? 30_000);
      if (!Number.isInteger(turnTimeoutMs) || turnTimeoutMs < 5_000 || turnTimeoutMs > 60_000) throw new Error("CONTROLLED_TIMEOUT_DURATION_INVALID");
      let forced = false;
      try { await timeoutSession.prompt("Call ptp_timeout_probe exactly once, wait for it, then reply TIMEOUT_PROBE_SHOULD_NOT_COMPLETE.", { turnTimeoutMs }); }
      catch (error) { forced = (error instanceof Error ? error.message : String(error)) === `PI turn timed out after ${turnTimeoutMs}ms`; }
      const abort = await timeoutSession.timeoutControl();
      await timeoutSession.close().catch(() => {});
      await timeoutSession.waitForExit().catch(() => {});
      const timeoutFile = path.join(workspace, "timeout-probe.json");
      let childEvidence = null;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        try {
          childEvidence = JSON.parse(fs.readFileSync(timeoutFile, "utf8"));
          if (childEvidence.childExited) break;
        } catch { /* Wait for the controlled tool to persist its terminal receipt. */ }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      let childAlive = true;
      if (Number.isInteger(childEvidence?.childPid)) {
        try { process.kill(childEvidence.childPid, 0); } catch { childAlive = false; }
        if (childAlive) {
          try { process.kill(childEvidence.childPid, "SIGTERM"); } catch { /* Already exited. */ }
          await new Promise((resolve) => setTimeout(resolve, 100));
          try { process.kill(childEvidence.childPid, 0); process.kill(childEvidence.childPid, "SIGKILL"); } catch { childAlive = false; }
        }
      }
      timeoutEvidence = {
        forced,
        abortAcknowledged: abort?.acknowledged === true,
        parentPid: timeoutParentPid,
        parentExited: !timeoutSession.isAlive(),
        childPid: childEvidence?.childPid ?? null,
        childAborted: childEvidence?.aborted === true,
        childExited: childEvidence?.childExited === true && !childAlive,
        evidenceDigest: childEvidence ? hash(childEvidence) : null,
      };
      timeoutSession = null;
    } catch (error) {
      const failureDigest = hash({ error: error instanceof Error ? error.message : String(error) });
      for (const name of ["pi.session", "pi.named-session", "pi.persisted-session", "pi.exact-id-file-resume", "subagent.final-result", "reviewer.one-shot-dispatch", "reviewer.fresh-context", "reviewer.schema", "tool-calling", "timeout-cancellation", "provider.reviewer"]) {
        if (results.get(name).status === "UNTESTED") results.set(name, { name, status: "BLOCKED", reasonCode: "ACTIVE_PROBE_FAILED", evidence: [{ kind: "active-probe", digest: failureDigest }] });
      }
    } finally {
      for (const session of [timeoutSession, resumedSession, namedSession, reviewerSession, toolSession]) {
        if (session) await session.close().catch(() => {});
      }
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(sessionDir, { recursive: true, force: true });
      fs.rmSync(reviewDirectory, { recursive: true, force: true });
    }
    const timeoutOk = timeoutEvidence?.forced && timeoutEvidence.abortAcknowledged
      && timeoutEvidence.parentExited && timeoutEvidence.childAborted && timeoutEvidence.childExited
      && DIGEST.test(timeoutEvidence.evidenceDigest ?? "")
      && !fs.existsSync(workspace) && !fs.existsSync(sessionDir) && !fs.existsSync(reviewDirectory);
    results.set("timeout-cancellation", timeoutOk
      ? { name: "timeout-cancellation", status: "SUPPORTED", reasonCode: "FORCED_TIMEOUT_CLEANUP_PASS", evidence: activeEvidence(observed, "timeout-cancellation", hash(timeoutEvidence)) }
      : { name: "timeout-cancellation", status: "BLOCKED", reasonCode: "FORCED_TIMEOUT_CLEANUP_FAILED", evidence: [] });
  }

  if (!observed.harness) {
    results.set("harness.readiness", { name: "harness.readiness", status: "BLOCKED", reasonCode: "HARNESS_CONFIG_MISSING", evidence: [] });
  } else if (!observed.target.startsWith("github:")) {
    results.set("harness.readiness", { name: "harness.readiness", status: "BLOCKED", reasonCode: "HARNESS_TARGET_UNSUPPORTED", evidence: [] });
  } else {
    try {
      const { runHarnessReadiness } = await import("../scripts/readiness-receipt.mjs");
      const binding = runHarnessReadiness({
        harnessCli: observed.harness.path,
        harnessConfig: observed.harness.configPath,
        repo: observed.target.slice("github:".length),
        baseSha: observed.baseSha,
        timeoutMs: Number(env.PI_TICKET_PLAN_HARNESS_PROBE_TIMEOUT_MS ?? 10 * 60 * 1000),
      });
      results.set("harness.readiness", { name: "harness.readiness", status: "SUPPORTED", reasonCode: "HARNESS_READINESS_PASS", evidence: activeEvidence(observed, "harness.readiness", binding.readiness.receiptDigest) });
    } catch (error) {
      results.set("harness.readiness", { name: "harness.readiness", status: "BLOCKED", reasonCode: "HARNESS_READINESS_FAILED", evidence: [{ kind: "active-probe", digest: hash({ error: error instanceof Error ? error.message : String(error) }) }] });
    }
  }
  return [...results.values()];
}

export async function inspectCapabilities({
  activeProbe = false,
  observer = observeStaticCapabilities,
  activeProbeRunner = defaultActiveProbe,
  env = process.env,
  clock = () => new Date().toISOString(),
  ttlMs = 60 * 60 * 1000,
} = {}) {
  const observed = observer({ env });
  const observedAt = clock();
  const capabilities = [
    staticCapability("runtime.node", observed.node, true),
    staticCapability("runtime.pi", observed.pi, true),
    staticCapability("runtime.git", observed.git, true),
    staticCapability("runtime.gh", observed.gh),
    staticCapability("runtime.docker", observed.docker),
    observed.profile.available
      ? { name: "profile.static-integrity", status: "SUPPORTED", reasonCode: "PRIVATE_PROFILE_VALID", evidence: [{ kind: "static-check", digest: observed.profile.digest }] }
      : { name: "profile.static-integrity", status: "BLOCKED", reasonCode: "PROFILE_UNAVAILABLE", evidence: [] },
    observed.protocolOk
      ? { name: "protocol.registry", status: "SUPPORTED", reasonCode: "PROTOCOL_CHECKS_PASS", evidence: configuredEvidence("protocol:verified") }
      : { name: "protocol.registry", status: "BLOCKED", reasonCode: "PROTOCOL_CHECKS_FAIL", evidence: [] },
    ...RUNTIME_NAMES.map((name) => ({
      name,
      status: "UNTESTED",
      reasonCode: activeProbe ? "ACTIVE_PROBE_PENDING" : "ACTIVE_PROBE_NOT_RUN",
      evidence: configuredEvidence(`${observed.provider}:${observed.model}:${name}`),
    })),
  ];
  if (activeProbe) {
    const results = await activeProbeRunner(observed, { env });
    const byName = new Map(results.map((item) => [item.name, item]));
    for (let index = 0; index < capabilities.length; index += 1) {
      if (byName.has(capabilities[index].name)) capabilities[index] = byName.get(capabilities[index].name);
    }
  }
  const subject = {
    target: observed.target,
    kind: "capability",
    id: `${observed.provider}/${observed.model}`,
    revision: observed.baseSha,
    digest: hash({
      target: observed.target,
      baseSha: observed.baseSha,
      provider: observed.provider,
      model: observed.model,
      profileDigest: observed.profile.digest,
      harnessDigest: observed.harness?.configDigest ?? null,
    }),
  };
  const receipt = buildCapabilityReceipt({
    subject,
    observedAt,
    expiresAt: new Date(Date.parse(observedAt) + ttlMs).toISOString(),
    pi: { path: observed.pi.path, version: observed.pi.version, digest: observed.pi.digest },
    subagent: { version: observed.profile.subagentVersion },
    provider: { name: observed.provider, model: observed.model, thinking: env.PI_TICKET_PLAN_THINKING ?? "UNCONFIGURED" },
    profileDigest: observed.profile.digest,
    harness: observed.harness ? { version: observed.harness.version, digest: observed.harness.digest, configDigest: observed.harness.configDigest } : null,
    repo: { target: observed.target, baseSha: observed.baseSha },
    capabilities,
  });
  const checked = validateCapabilityReceipt(receipt, { now: observedAt });
  if (!checked.ok) throw new Error(`INVALID_CAPABILITY_RECEIPT: ${checked.problems.map(({ code }) => code).join(",")}`);
  return receipt;
}
