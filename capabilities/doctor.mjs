import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { validateCodeSchemaCoverage, validateProtocolRules, validateRegistry } from "../protocol/kernel.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const STATUSES = new Set(["SUPPORTED", "DEGRADED", "BLOCKED", "UNTESTED"]);
const RUNTIME_ONLY = new Set([
  "pi.arguments",
  "pi.session",
  "pi.named-session",
  "pi.persisted-session",
  "subagent.final-result",
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
  const baseSha = gitOutput(["rev-parse", "HEAD"]) || "0".repeat(40);
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
    for (const name of ["pi.session", "pi.named-session", "pi.persisted-session", "subagent.final-result", "reviewer.fresh-context", "reviewer.schema", "tool-calling", "timeout-cancellation", "provider.reviewer"]) {
      results.set(name, { name, status: "BLOCKED", reasonCode, evidence: [] });
    }
  } else {
    const timeoutMs = Number(env.PI_TICKET_PLAN_ACTIVE_PROBE_TIMEOUT_MS ?? 120_000);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 10_000 || timeoutMs > 10 * 60 * 1000) throw new Error("active probe timeout is invalid");
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-capability-workspace-"));
    const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-capability-session-"));
    const token = `TOOL_OK_${createHash("sha256").update(`${process.pid}:${Date.now()}`).digest("hex").slice(0, 12)}`;
    fs.writeFileSync(path.join(workspace, "capability-probe.txt"), `${token}\n`, { mode: 0o600 });
    let toolSession;
    let reviewerSession;
    let namedSession;
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
      results.set("subagent.final-result", typeof toolResult.text === "string" && toolResult.text.length > 0
        ? { name: "subagent.final-result", status: "SUPPORTED", reasonCode: "FINAL_TEXT_RETURNED", evidence: activeEvidence(observed, "subagent.final-result", toolResult.text) }
        : { name: "subagent.final-result", status: "BLOCKED", reasonCode: "FINAL_TEXT_MISSING", evidence: [] });
      results.set("tool-calling", toolResult.text.includes(token)
        ? { name: "tool-calling", status: "SUPPORTED", reasonCode: "READ_TOOL_PROBE_PASS", evidence: activeEvidence(observed, "tool-calling", token) }
        : { name: "tool-calling", status: "BLOCKED", reasonCode: "READ_TOOL_PROBE_FAIL", evidence: [] });

      reviewerSession = await createPiRpcSession({
        cwd: workspace,
        launcher: observed.pi.path,
        model: `${observed.provider}/${observed.model}`,
        thinking: env.PI_TICKET_PLAN_THINKING,
        timeoutMs,
        skill: "ticket-readiness",
        tools: ["read"],
        persisted: false,
        sessionDir: "",
        sessionName: "capability-reviewer",
      });
      const reviewerResult = await reviewerSession.prompt(`/skill:ticket-readiness This is a read-only capability probe. Review standalone candidate CAPABILITY-1. Its required Context check is intentionally absent, so return NEEDS_INFO, preserve the HUMAN execution lane, and include the required pi-ticket-planning:admission-review:v1 JSON projection.`);
      const fresh = reviewerSession.identity.id !== toolSession.identity.id;
      const hasSchema = reviewerResult.text.includes("pi-ticket-planning:admission-review:v1");
      results.set("reviewer.fresh-context", fresh
        ? { name: "reviewer.fresh-context", status: "SUPPORTED", reasonCode: "DISTINCT_FRESH_SESSION", evidence: activeEvidence(observed, "reviewer.fresh-context", reviewerSession.identity.id) }
        : { name: "reviewer.fresh-context", status: "BLOCKED", reasonCode: "SESSION_ID_REUSED", evidence: [] });
      results.set("reviewer.schema", hasSchema
        ? { name: "reviewer.schema", status: "SUPPORTED", reasonCode: "REVIEW_SCHEMA_RETURNED", evidence: activeEvidence(observed, "reviewer.schema", reviewerResult.text) }
        : { name: "reviewer.schema", status: "BLOCKED", reasonCode: "REVIEW_SCHEMA_MISSING", evidence: [] });
      results.set("provider.reviewer", hasSchema && fresh
        ? { name: "provider.reviewer", status: "SUPPORTED", reasonCode: "ACTIVE_REVIEWER_RETURNED", evidence: activeEvidence(observed, "provider.reviewer", reviewerResult.text) }
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
      const second = await namedSession.prompt("Reply exactly NAMED_SESSION_TWO.");
      const namedOk = first.state.sessionId === second.state.sessionId && first.state.sessionId === namedSession.identity.id;
      for (const name of ["pi.named-session", "pi.persisted-session"]) {
        results.set(name, namedOk
          ? { name, status: "SUPPORTED", reasonCode: "NAMED_SESSION_CONTINUITY_PASS", evidence: activeEvidence(observed, name, namedSession.identity.id) }
          : { name, status: "BLOCKED", reasonCode: "NAMED_SESSION_CONTINUITY_FAIL", evidence: [] });
      }
      results.set("timeout-cancellation", {
        name: "timeout-cancellation",
        status: "DEGRADED",
        reasonCode: "CANCELLATION_PASS_TIMEOUT_NOT_FORCED",
        evidence: activeEvidence(observed, "timeout-cancellation", String(timeoutMs)),
      });
    } catch (error) {
      const failureDigest = hash({ error: error instanceof Error ? error.message : String(error) });
      for (const name of ["pi.session", "pi.named-session", "pi.persisted-session", "subagent.final-result", "reviewer.fresh-context", "reviewer.schema", "tool-calling", "timeout-cancellation", "provider.reviewer"]) {
        if (results.get(name).status === "UNTESTED") results.set(name, { name, status: "BLOCKED", reasonCode: "ACTIVE_PROBE_FAILED", evidence: [{ kind: "active-probe", digest: failureDigest }] });
      }
    } finally {
      for (const session of [namedSession, reviewerSession, toolSession]) {
        if (session) await session.close().catch(() => {});
      }
      fs.rmSync(workspace, { recursive: true, force: true });
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
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
    provider: { name: observed.provider, model: observed.model },
    profileDigest: observed.profile.digest,
    harness: observed.harness,
    repo: { target: observed.target, baseSha: observed.baseSha },
    capabilities,
  });
  const checked = validateCapabilityReceipt(receipt, { now: observedAt });
  if (!checked.ok) throw new Error(`INVALID_CAPABILITY_RECEIPT: ${checked.problems.map(({ code }) => code).join(",")}`);
  return receipt;
}
