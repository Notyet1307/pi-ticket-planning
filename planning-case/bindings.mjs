import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { validateCapabilityReceipt } from "../capabilities/doctor.mjs";
import { validateOutcomeReceipt } from "../outcome/ingest.mjs";
import { validateArtifact } from "../protocol/kernel.mjs";
import { validateReviewerDispatchBinding } from "../extensions/reviewer-one-shot-gate.mjs";
import { stableHarnessReadiness } from "../scripts/readiness-receipt.mjs";

const NAMES = new Set(["source", "release", "spec", "graph", "policy", "harness", "capability", "outcome", "session", "reviewer"]);

function hash(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function stableGitHubProjection(ref, value) {
  if (!/^repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/git\/ref\/.+$/.test(ref)
    || !value || typeof value !== "object" || Array.isArray(value)
    || typeof value.ref !== "string" || !value.ref.startsWith("refs/")
    || !value.object || !["commit", "tag", "tree", "blob"].includes(value.object.type)
    || !/^[a-f0-9]{40,64}$/.test(value.object.sha ?? "")) throw new Error("GITHUB_BINDING_RESPONSE_INVALID");
  return { ref: value.ref, object: { type: value.object.type, sha: value.object.sha } };
}

export function githubBindingDigest(ref, value) {
  return hash(JSON.stringify(canonical(stableGitHubProjection(ref, value))));
}

function stableGitHubIssueProjection(ref, value) {
  if (!/^repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/[1-9][0-9]*$/.test(ref)
    || !value || typeof value !== "object" || Array.isArray(value)
    || String(value.number) !== ref.split("/").at(-1)) throw new Error("GITHUB_ISSUE_BINDING_RESPONSE_INVALID");
  const labels = (value.labels ?? []).map((label) => typeof label === "string" ? label : label.name);
  const controlled = labels.filter((label) => ["needs-triage", "needs-info", "ready-for-agent", "ready-for-human"].includes(label)).sort();
  return { number: String(value.number), title: value.title ?? "", body: value.body ?? "", state: String(value.state ?? "").toLowerCase(), controlledLabels: controlled };
}

export function githubIssueBindingDigest(ref, value) {
  return hash(JSON.stringify(canonical(stableGitHubIssueProjection(ref, value))));
}

function safeSessionFile(file, sessionId) {
  const requested = path.resolve(file);
  const requestedMetadata = fs.lstatSync(requested);
  if (!requestedMetadata.isFile() || requestedMetadata.isSymbolicLink() || requestedMetadata.nlink !== 1 || (requestedMetadata.mode & 0o077) !== 0) {
    throw new Error("UNSAFE_SESSION_BINDING_SOURCE");
  }
  const resolved = fs.realpathSync(requested);
  const header = JSON.parse(fs.readFileSync(resolved, "utf8").split("\n", 1)[0]);
  if (header?.id !== sessionId) throw new Error("SESSION_BINDING_ID_MISMATCH");
  return { file: resolved, digest: hash(fs.readFileSync(resolved)) };
}

export function buildPlanningSessionBinding(value) {
  const session = safeSessionFile(value.sessionFile, value.sessionId);
  const binding = {
    schema: "pi-ticket-planning:planning-session-binding:v1",
    target: value.target,
    revision: value.revision,
    baseSha: value.baseSha,
    sessionId: value.sessionId,
    sessionFile: session.file,
    sessionFileDigest: session.digest,
    provider: value.provider,
    model: value.model,
    profileDigest: value.profileDigest,
    observedAt: value.observedAt ?? new Date().toISOString(),
  };
  if (!validateArtifact(binding).ok) throw new Error("PLANNING_SESSION_BINDING_INVALID");
  return binding;
}

function problem(code, subject) {
  return subject === undefined ? { code } : { code, subject };
}

function currentDigest(verification, execute = spawnSync) {
  if (verification.kind === "FILE" || verification.kind === "HARNESS") {
    const metadata = fs.lstatSync(verification.ref);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) throw new Error("UNSAFE_BINDING_SOURCE");
    return hash(fs.readFileSync(verification.ref));
  }
  if (verification.kind === "GIT") {
    const run = execute("git", ["-C", verification.ref, "rev-parse", "HEAD"], { encoding: "utf8", timeout: 15_000 });
    if (run.status !== 0) throw new Error("BINDING_READBACK_FAILED");
    return hash(run.stdout.trim());
  }
  if (verification.kind === "GITHUB") {
    if (!/^repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[^\u0000\r\n]+)?$/.test(verification.ref)) throw new Error("UNSAFE_BINDING_SOURCE");
    const run = execute("gh", ["api", verification.ref], { encoding: "utf8", timeout: 30_000 });
    if (run.status !== 0) throw new Error("BINDING_READBACK_FAILED");
    let response;
    try { response = JSON.parse(run.stdout); } catch { throw new Error("GITHUB_BINDING_RESPONSE_INVALID"); }
    return githubBindingDigest(verification.ref, response);
  }
  if (verification.kind === "GITHUB_ISSUE") {
    if (!/^repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/[1-9][0-9]*$/.test(verification.ref)) throw new Error("UNSAFE_BINDING_SOURCE");
    const run = execute("gh", ["api", verification.ref], { encoding: "utf8", timeout: 30_000 });
    if (run.status !== 0) throw new Error("BINDING_READBACK_FAILED");
    let response;
    try { response = JSON.parse(run.stdout); } catch { throw new Error("GITHUB_ISSUE_BINDING_RESPONSE_INVALID"); }
    return githubIssueBindingDigest(verification.ref, response);
  }
  throw new Error("UNKNOWN_BINDING_VERIFIER");
}

export function validatePlanningCaseBinding(name, binding, target, { now = new Date().toISOString() } = {}) {
  const problems = [];
  if (!NAMES.has(name) || !binding || typeof binding !== "object" || Array.isArray(binding)) return [problem("INVALID_BINDING", name)];
  if (name !== "harness") {
    try {
      const structural = validateArtifact(binding);
      problems.push(...structural.problems);
    } catch {
      problems.push(problem("INVALID_BINDING", name));
      return problems;
    }
  }
  const harnessTarget = binding.readiness?.projection?.repo ? `github:${binding.readiness.projection.repo}` : undefined;
  const bindingTarget = binding.target ?? binding.subject?.target ?? harnessTarget;
  if (name !== "reviewer" && bindingTarget !== target) problems.push(problem("BINDING_TARGET_MISMATCH", name));
  if (binding.expiresAt && Date.parse(now) > Date.parse(binding.expiresAt)) problems.push(problem("BINDING_EXPIRED", name));
  if (name === "capability") problems.push(...validateCapabilityReceipt(binding, { now }).problems);
  if (name === "outcome") problems.push(...validateOutcomeReceipt(binding).problems);
  if (name === "session" && binding.schema !== "pi-ticket-planning:planning-session-binding:v1") problems.push(problem("SESSION_BINDING_INVALID"));
  if (name === "reviewer") problems.push(...(() => { try { return validateReviewerDispatchBinding(binding).problems; } catch { return [problem("REVIEWER_DISPATCH_BINDING_INVALID")]; } })());
  if (name === "harness") {
    try { stableHarnessReadiness(binding); } catch { problems.push(problem("HARNESS_BINDING_INVALID")); }
  }
  return problems;
}

function relation(name, binding) {
  if (binding.schema === "pi-ticket-planning:planning-case-binding:v1") return { name, target: binding.target, revision: binding.revision, base: binding.baseSha };
  if (binding.schema === "pi-ticket-planning:release-projection:v1") return { name, target: binding.target, revision: binding.revision, base: binding.source.baseSha };
  if (binding.schema === "pi-ticket-planning:spec-projection:v1") return { name, target: binding.target, revision: binding.revision, base: binding.baseSha };
  if (name === "harness" && binding.readiness?.projection?.repo) return { name, target: `github:${binding.readiness.projection.repo}`, revision: binding.readiness.projection.baseSha, base: binding.readiness.projection.baseSha };
  if (name === "capability" && binding.repo?.target && binding.subject?.revision) return { name, target: binding.repo.target, revision: binding.subject.revision, base: binding.repo.baseSha };
  if (name === "outcome" && binding.subject?.target) return { name, target: binding.subject.target, revision: binding.subject.revision, base: binding.baseSha };
  return null;
}

function relationProblems(bindings) {
  const relations = Object.entries(bindings).filter(([name, value]) => !["session", "reviewer"].includes(name) && value !== null).map(([name, value]) => relation(name, value)).filter(Boolean);
  if (relations.length < 2) return [];
  const problems = [];
  for (const field of ["target", "revision", "base"]) {
    const values = new Set(relations.map((item) => item[field]));
    if (values.size > 1) problems.push(problem(`CROSS_BINDING_${field.toUpperCase()}_MISMATCH`, relations.map((item) => `${item.name}:${item[field]}`).join(",")));
  }
  return problems;
}

export function verifyPlanningCaseBindings(bindings, snapshot, { offline = false, now = new Date().toISOString(), execute = spawnSync } = {}) {
  const problems = relationProblems(bindings);
  for (const [name, binding] of Object.entries(bindings)) {
    if (binding === null) continue;
    problems.push(...validatePlanningCaseBinding(name, binding, snapshot.target, { now }));
    if (offline) continue;
    if (name === "session") {
      try {
        const current = safeSessionFile(binding.sessionFile, binding.sessionId);
        if (current.digest !== binding.sessionFileDigest) problems.push(problem("BINDING_READBACK_DRIFT", name));
      } catch (error) {
        problems.push(problem(error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "BINDING_READBACK_FAILED", name));
      }
      continue;
    }
    if (name === "reviewer") continue;
    if (name === "spec" && binding.schema === "pi-ticket-planning:spec-projection:v1" && binding.verification) {
      try {
        if (currentDigest(binding.verification, execute) !== binding.verification.digest) problems.push(problem("BINDING_READBACK_DRIFT", name));
      } catch (error) {
        problems.push(problem(error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "BINDING_READBACK_FAILED", name));
      }
      continue;
    }
    if (binding.schema !== "pi-ticket-planning:planning-case-binding:v1") continue;
    try {
      if (currentDigest(binding.verification, execute) !== binding.verification.digest) problems.push(problem("BINDING_READBACK_DRIFT", name));
    } catch (error) {
      problems.push(problem(error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "BINDING_READBACK_FAILED", name));
    }
  }
  return problems;
}
