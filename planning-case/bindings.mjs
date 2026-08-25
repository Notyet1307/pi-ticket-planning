import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";

import { validateCapabilityReceipt } from "../capabilities/doctor.mjs";
import { validateOutcomeReceipt } from "../outcome/ingest.mjs";
import { validateArtifact } from "../protocol/kernel.mjs";
import { stableHarnessReadiness } from "../scripts/readiness-receipt.mjs";

const NAMES = new Set(["source", "release", "spec", "graph", "policy", "harness", "capability", "outcome"]);

function hash(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function problem(code, subject) {
  return subject === undefined ? { code } : { code, subject };
}

function currentDigest(verification) {
  if (verification.kind === "FILE" || verification.kind === "HARNESS") {
    const metadata = fs.lstatSync(verification.ref);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) throw new Error("UNSAFE_BINDING_SOURCE");
    return hash(fs.readFileSync(verification.ref));
  }
  if (verification.kind === "GIT") {
    const run = spawnSync("git", ["-C", verification.ref, "rev-parse", "HEAD"], { encoding: "utf8", timeout: 15_000 });
    if (run.status !== 0) throw new Error("BINDING_READBACK_FAILED");
    return hash(run.stdout.trim());
  }
  if (verification.kind === "GITHUB") {
    if (!/^repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[^\u0000\r\n]+)?$/.test(verification.ref)) throw new Error("UNSAFE_BINDING_SOURCE");
    const run = spawnSync("gh", ["api", verification.ref], { encoding: "utf8", timeout: 30_000 });
    if (run.status !== 0) throw new Error("BINDING_READBACK_FAILED");
    return hash(run.stdout);
  }
  throw new Error("UNKNOWN_BINDING_VERIFIER");
}

export function validatePlanningCaseBinding(name, binding, target, { now = new Date().toISOString() } = {}) {
  const problems = [];
  if (!NAMES.has(name) || !binding || typeof binding !== "object" || Array.isArray(binding)) return [problem("INVALID_BINDING", name)];
  try {
    const structural = validateArtifact(binding);
    problems.push(...structural.problems);
  } catch {
    problems.push(problem("INVALID_BINDING", name));
    return problems;
  }
  const harnessTarget = binding.readiness?.projection?.repo ? `github:${binding.readiness.projection.repo}` : undefined;
  const bindingTarget = binding.target ?? binding.subject?.target ?? harnessTarget;
  if (bindingTarget !== target) problems.push(problem("BINDING_TARGET_MISMATCH", name));
  if (binding.expiresAt && Date.parse(now) > Date.parse(binding.expiresAt)) problems.push(problem("BINDING_EXPIRED", name));
  if (name === "capability") problems.push(...validateCapabilityReceipt(binding, { now }).problems);
  if (name === "outcome") problems.push(...validateOutcomeReceipt(binding).problems);
  if (name === "harness") {
    try { stableHarnessReadiness(binding); } catch { problems.push(problem("HARNESS_BINDING_INVALID")); }
  }
  return problems;
}

export function verifyPlanningCaseBindings(bindings, snapshot, { offline = false, now = new Date().toISOString() } = {}) {
  const problems = [];
  for (const [name, binding] of Object.entries(bindings)) {
    if (binding === null) continue;
    problems.push(...validatePlanningCaseBinding(name, binding, snapshot.target, { now }));
    if (offline || binding.schema !== "pi-ticket-planning:planning-case-binding:v1") continue;
    try {
      if (currentDigest(binding.verification) !== binding.verification.digest) problems.push(problem("BINDING_READBACK_DRIFT", name));
    } catch (error) {
      problems.push(problem(error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "BINDING_READBACK_FAILED", name));
    }
  }
  return problems;
}
