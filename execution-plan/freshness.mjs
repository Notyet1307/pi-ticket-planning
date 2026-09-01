import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { validateArtifact } from "../protocol/kernel.mjs";
import { validatePredecessorReceipt, validateSpecAcceptance } from "../scripts/check-delivery-graph.mjs";
import { readRegularBaseFile, validateTicketContract } from "../scripts/check-ticket-contract.mjs";
import { canonical, fingerprint, hashText } from "./domain.mjs";

const SHA = /^[a-f0-9]{40}$/u;
const ORACLE_CODES = /^(?:MISSING_ORACLE_BINDING|ORACLE_|INVALID_ORACLE_|MISSING_PROTECTED_ORACLE_PATH|PROTECTED_PATH_IN_EXPECTED_WRITE_SET)/u;

function same(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function digestBytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function exactDigest(value) {
  const { digest, ...body } = value ?? {};
  return digest === fingerprint(body);
}

function stableError(code) {
  throw new Error(code);
}

function runGit(repo, args) {
  const run = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
  return { ok: !run.error && !run.signal && run.status === 0, stdout: run.stdout ?? "" };
}

function repositoryDirectory(repo) {
  try { return path.isAbsolute(repo ?? "") && fs.statSync(repo).isDirectory(); }
  catch { return false; }
}

export function gitRemoteBase({ repositoryPath: repo, remote = "origin", baseRef }) {
  if (!repositoryDirectory(repo)
    || !/^[A-Za-z0-9._-]{1,100}$/u.test(remote ?? "")
    || !/^[A-Za-z0-9._/-]{1,300}$/u.test(baseRef ?? "") || baseRef.includes("..")) stableError("EXECUTION_BASE_DRIFT");
  const ref = baseRef.startsWith("refs/heads/") ? baseRef : `refs/heads/${baseRef}`;
  const read = runGit(repo, ["ls-remote", "--exit-code", remote, ref]);
  const fields = read.stdout.trim().split(/\s+/u);
  if (!read.ok || fields.length !== 2 || !SHA.test(fields[0] ?? "") || fields[1] !== ref) stableError("EXECUTION_BASE_DRIFT");
  const local = runGit(repo, ["rev-parse", "--verify", `${fields[0]}^{commit}`]);
  if (!local.ok || local.stdout.trim() !== fields[0]) stableError("EXECUTION_BASE_DRIFT");
  return fields[0];
}

function githubRemoteBase({ repo, baseRef }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repo ?? "")
    || !/^[A-Za-z0-9._/-]{1,300}$/u.test(baseRef ?? "") || baseRef.includes("..")) stableError("EXECUTION_BASE_DRIFT");
  const ref = baseRef.startsWith("refs/heads/") ? baseRef.slice("refs/heads/".length) : baseRef;
  const run = spawnSync("gh", ["api", `repos/${repo}/git/ref/heads/${encodeURIComponent(ref)}`], { encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 });
  let value;
  try { value = JSON.parse(run.stdout); } catch { stableError("EXECUTION_BASE_DRIFT"); }
  const sha = value?.object?.sha;
  if (run.error || run.signal || run.status !== 0 || !SHA.test(sha ?? "")) stableError("EXECUTION_BASE_DRIFT");
  return sha;
}

export function isGitAncestor(repo, from, to) {
  return SHA.test(from ?? "") && SHA.test(to ?? "") && runGit(repo, ["merge-base", "--is-ancestor", from, to]).ok;
}

function boundBytes(repo, baseSha, binding, code) {
  if (!binding || binding.baseSha !== baseSha) stableError(code);
  const bytes = readRegularBaseFile(repo, baseSha, binding.path);
  if (!bytes || bytes.length !== binding.byteCount || digestBytes(bytes) !== binding.sha256) stableError(code);
  return bytes;
}

function boundJson(repo, baseSha, binding, expected, code) {
  let value;
  try { value = JSON.parse(boundBytes(repo, baseSha, binding, code).toString("utf8")); }
  catch { stableError(code); }
  if (!same(value, expected)) stableError(code);
  return value;
}

function duplicate(values) {
  return new Set(values).size !== values.length;
}

export function decisionManifestProblems(manifest) {
  const problems = [];
  try {
    const checked = validateArtifact(manifest, { identity: "pi-ticket-planning:decision-manifest:v1" });
    if (!checked.ok) return [{ code: "DECISION_MANIFEST_INVALID" }];
  } catch {
    return [{ code: "DECISION_MANIFEST_INVALID" }];
  }
  if (!exactDigest(manifest)) problems.push({ code: "DECISION_MANIFEST_DIGEST_MISMATCH" });
  const entries = [manifest.policy, manifest.productRelease, ...(manifest.decisions ?? []), ...(manifest.dependencyHandoffs ?? [])];
  if (duplicate(entries.map(({ identity }) => identity)) || duplicate(entries.map(({ path: entryPath }) => entryPath))) {
    problems.push({ code: "DECISION_MANIFEST_DUPLICATE_SOURCE" });
  }
  return problems;
}

function assertDecisionSources(repo, baseSha, manifest) {
  if (!isGitAncestor(repo, manifest.baseSha, baseSha) || decisionManifestProblems(manifest).length > 0) stableError("DECISION_MANIFEST_DRIFT");
  for (const binding of [manifest.policy, manifest.productRelease, ...manifest.decisions]) {
    const bytes = readRegularBaseFile(repo, baseSha, binding.path);
    if (!bytes || bytes.length !== binding.byteCount || digestBytes(bytes) !== binding.sha256) stableError("DECISION_MANIFEST_DRIFT");
  }
  for (const binding of manifest.dependencyHandoffs) {
    const bytes = readRegularBaseFile(repo, baseSha, binding.path);
    if (!bytes || bytes.length !== binding.byteCount || digestBytes(bytes) !== binding.sha256) stableError("DEPENDENCY_HANDOFF_DRIFT");
  }
}

function graphOf(input) {
  const graph = input?.deliveryGraph;
  if (graph?.schema !== "pi-ticket-planning:delivery-release-graph:v3") stableError("NEEDS_MIGRATION");
  return graph;
}

export function executionFreshnessProjection(input) {
  const graph = graphOf(input);
  const live = new Map((input.children ?? []).map((child) => [String(child.id), child]));
  return {
    remoteBaseSha: graph.executionBaseSha,
    parent: {
      number: Number(input.parent.id),
      title: input.parent.title,
      bodyHash: hashText(input.parent.body),
    },
    children: graph.children.map((child) => {
      const current = live.get(String(child.id));
      return { number: Number(child.id), title: current?.title ?? "", bodyHash: typeof current?.body === "string" ? hashText(current.body) : "" };
    }),
    specAcceptanceDigest: graph.specAcceptance.digest,
    decisionManifestDigest: graph.decisionManifestDigest,
    predecessorPlanDigest: graph.predecessorPlanDigest,
    predecessorReceiptDigest: graph.predecessorReceipt?.digest ?? null,
    dependencyHandoffDigests: graph.decisionManifest.dependencyHandoffs.map(({ sha256 }) => sha256),
    oracleBindingDigests: graph.children.map(({ id, oracleBindingDigest }) => ({ issue: String(id), digest: oracleBindingDigest })),
  };
}

export function freshnessDriftCode(expected, actual) {
  if (fingerprint(actual?.parent ?? null) !== fingerprint(expected?.parent ?? null)) return "PARENT_BINDING_DRIFT";
  if (fingerprint(actual?.children ?? null) !== fingerprint(expected?.children ?? null)) return "CHILD_BINDING_DRIFT";
  for (const [key, code] of [
    ["remoteBaseSha", "EXECUTION_BASE_DRIFT"],
    ["specAcceptanceDigest", "SPEC_ACCEPTANCE_DRIFT"],
    ["decisionManifestDigest", "DECISION_MANIFEST_DRIFT"],
    ["predecessorPlanDigest", "PREDECESSOR_PLAN_DRIFT"],
    ["predecessorReceiptDigest", "PREDECESSOR_RECEIPT_DRIFT"],
    ["dependencyHandoffDigests", "DEPENDENCY_HANDOFF_DRIFT"],
    ["oracleBindingDigests", "ORACLE_BINDING_DRIFT"],
  ]) if (fingerprint(actual?.[key] ?? null) !== fingerprint(expected?.[key] ?? null)) return code;
  return null;
}

export function assertTrackedReleaseBindings(input) {
  const graph = graphOf(input);
  const repo = input.repositoryPath;
  const current = graph.executionBaseSha;
  if (!repositoryDirectory(repo)) stableError("EXECUTION_BASE_DRIFT");
  const local = runGit(repo, ["rev-parse", "--verify", `${current}^{commit}`]);
  if (!local.ok || local.stdout.trim() !== current) stableError("EXECUTION_BASE_DRIFT");

  const acceptance = boundJson(repo, current, graph.specAcceptanceBinding, graph.specAcceptance, "SPEC_ACCEPTANCE_DRIFT");
  if (validateSpecAcceptance(acceptance).length > 0) stableError("SPEC_ACCEPTANCE_DRIFT");

  boundJson(repo, current, graph.decisionManifestBinding, graph.decisionManifest, "DECISION_MANIFEST_DRIFT");
  if (graph.decisionManifestDigest !== graph.decisionManifestBinding?.sha256) stableError("DECISION_MANIFEST_DRIFT");
  assertDecisionSources(repo, current, graph.decisionManifest);

  if (graph.releaseOrdinal === 1) {
    if (graph.predecessorPlanDigest !== null || graph.predecessorReceipt !== null || graph.predecessorReceiptBinding !== null) stableError("PREDECESSOR_RECEIPT_DRIFT");
  } else {
    const receipt = boundJson(repo, current, graph.predecessorReceiptBinding, graph.predecessorReceipt, "PREDECESSOR_RECEIPT_DRIFT");
    if (graph.executionBasePolicy !== "PREDECESSOR_MERGE_OR_DESCENDANT"
      || validatePredecessorReceipt(receipt).length > 0 || receipt.planDigest !== graph.predecessorPlanDigest
      || !isGitAncestor(repo, receipt.mergeSha, current)) stableError("PREDECESSOR_RECEIPT_DRIFT");
  }
  return true;
}

export function assertFreshExecutionInput(input, { resolveRemoteBase = githubRemoteBase } = {}) {
  const graph = graphOf(input);
  const repo = input.repositoryPath;
  if (!repositoryDirectory(repo)) stableError("EXECUTION_BASE_DRIFT");
  const current = resolveRemoteBase({ repositoryPath: repo, repo: input.repo, baseRef: input.source?.baseRef });
  if (current !== graph.executionBaseSha || current !== input.source?.baseSha) stableError("EXECUTION_BASE_DRIFT");
  if (graph.releaseOrdinal === 1 && (graph.executionBasePolicy !== "PLANNING_BASE_OR_DESCENDANT"
    || !isGitAncestor(repo, graph.planningBaseSha, current))) stableError("EXECUTION_BASE_DRIFT");
  assertTrackedReleaseBindings(input);

  const live = new Map((input.children ?? []).map((child) => [String(child.id), child]));
  for (const graphChild of graph.children) {
    const child = live.get(String(graphChild.id));
    const checked = validateTicketContract({
      repositoryPath: repo,
      baseSha: current,
      child,
      graphChild,
      graphChildren: graph.children,
    });
    const verifier = checked.problems.find(({ code }) => [
      "ORACLE_VERIFIER_MANIFEST_MISSING",
      "ORACLE_VERIFIER_BINDING_DRIFT",
      "GLOBAL_ORACLE_VERIFIER_PATH_IN_WRITE_SET",
    ].includes(code));
    if (verifier) stableError(verifier.code);
    if (checked.problems.some(({ code }) => ORACLE_CODES.test(code))) stableError("ORACLE_BINDING_DRIFT");
  }
  return executionFreshnessProjection(input);
}
