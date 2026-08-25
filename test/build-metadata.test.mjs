import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { generateBuildMetadata, runtimeMetadata } from "../installation/build-metadata.mjs";
import { buildReleaseArtifacts } from "../scripts/build-release-artifacts.mjs";
import { finalizeReport } from "../integration/report.mjs";
import { validateArtifact } from "../protocol/kernel.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

const objectDigest = (value) => `sha256:${createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`;
const digest = (character) => `sha256:${character.repeat(64)}`;

test("build metadata keeps the control CLI working without a Git worktree", (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-no-git-"));
  const archive = path.join(temporary, "archive");
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  fs.cpSync(ROOT, archive, {
    recursive: true,
    filter: (source) => !source.split(path.sep).includes(".git"),
  });
  const metadata = generateBuildMetadata({ root: ROOT, buildTime: "2026-08-26T00:00:00Z" });
  fs.writeFileSync(path.join(archive, "build-metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o644 });
  assert.deepEqual(runtimeMetadata({ root: archive }), metadata);

  const stateDir = path.join(temporary, "state");
  const run = spawnSync(process.execPath, ["scripts/planctl.mjs", "case", "create", "--target", "github:acme/product", "--case-id", "PC-no-git", "--json"], {
    cwd: archive,
    env: { ...process.env, PI_TICKET_PLAN_STATE_DIR: stateDir },
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  const envelope = JSON.parse(run.stdout);
  assert.equal(envelope.meta.commit, metadata.sourceCommit);
  assert.equal(envelope.data.caseId, "PC-no-git");
});

test("Alpha cannot build controlled Beta release artifacts", () => {
  assert.throws(() => buildReleaseArtifacts({ qualificationFile: "missing", proposalFile: "missing", outDir: "missing" }), /BETA_VERSION_REQUIRED/);
});

test("synthetic complete evidence builds and smokes the no-Git release archive", { timeout: 60_000 }, (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-beta-artifact-test-"));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const repository = path.join(temporary, "repo");
  fs.cpSync(ROOT, repository, {
    recursive: true,
    filter(source) {
      const relative = path.relative(ROOT, source);
      return !relative.split(path.sep).some((part) => [".git", "node_modules", "artifacts"].includes(part));
    },
  });
  const pkg = JSON.parse(fs.readFileSync(path.join(repository, "package.json"), "utf8"));
  pkg.version = "0.5.0-beta.1";
  fs.writeFileSync(path.join(repository, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  const lock = JSON.parse(fs.readFileSync(path.join(repository, "package-lock.json"), "utf8"));
  lock.version = pkg.version;
  lock.packages[""].version = pkg.version;
  fs.writeFileSync(path.join(repository, "package-lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
  run("git", ["init", "-q", "-b", "main"], repository);
  run("git", ["config", "user.name", "Release Test"], repository);
  run("git", ["config", "user.email", "release-test@example.invalid"], repository);
  run("git", ["add", "--", "."], repository);
  run("git", ["commit", "-q", "-m", "Synthetic beta candidate"], repository);
  run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], repository);
  const head = run("git", ["rev-parse", "HEAD"], repository);
  const observedAt = new Date().toISOString();
  const expiresAt = new Date(Date.parse(observedAt) + 60 * 60 * 1000).toISOString();
  const build = generateBuildMetadata({ root: repository, sourceCommit: head, buildTime: observedAt });
  const tuple = { piVersion: "0.84.2", piDigest: digest("1"), subagentVersion: "0.42.1", provider: "openai-codex", model: "gpt-test", thinking: "high", profileDigest: digest("2"), harnessVersion: "1.0.0", harnessDigest: digest("3") };
  const evidenceRefs = [
    { reportId: "RPT-l2", tier: "L2_REAL_MODEL", digest: digest("4"), workflowRunUrl: "https://github.com/acme/product/actions/runs/10", file: "model-eval.json" },
    { reportId: "RPT-l3", tier: "L3_REAL_DISPOSABLE_INTEGRATION", digest: digest("5"), workflowRunUrl: "https://github.com/acme/product/actions/runs/11", file: "e2e-report.json" },
    { reportId: "openai-codex/gpt-test", tier: "ACTIVE_CAPABILITY", digest: digest("6"), workflowRunUrl: "https://github.com/acme/product/actions/runs/11", file: "capability-receipt.json" },
  ];
  const qualification = finalizeReport({
    schema: "pi-ticket-planning:release-qualification:v2",
    reportId: "RPT-release-artifact-test",
    tier: "L4_COMMIT_BOUND_QUALIFICATION",
    packageVersion: pkg.version,
    headSha: head,
    treeSha: build.treeDigest,
    workflowName: "Release qualification",
    workflowRunId: "12",
    workflowRunAttempt: 1,
    workflowRunUrl: "https://github.com/acme/product/actions/runs/12",
    repository: "acme/product",
    actor: "release-test",
    runner: "release-test",
    ...tuple,
    observedAt,
    expiresAt,
    evidenceDigests: evidenceRefs.map(({ digest: value }) => value),
    status: "COMPLETE",
    metrics: { realE2EScenarios: 61, scenarioKinds: 18, providersAndModels: 1, supportedTuples: 1, firstAttempts: 60, firstPassSuccessRate: 1, eventualSuccessRate: 1, retryRate: 0, unclassifiedInfrastructureFailures: 0, modelForbiddenWrites: 0, modelCleanupFailures: 0, unauthorizedWriteCount: 0, recoveryAttempts: 18, recoverySuccessRate: 1, cleanupSuccessRate: 1, unclassifiedFailureRate: 0, p50DurationMs: 1, p95DurationMs: 2, githubApiCalls: 100, modelTurns: 60, toolCalls: 10, contextTokens: 1000 },
    tuples: [tuple],
    evidenceRefs,
    problems: [],
  });
  assert.equal(validateArtifact(qualification).ok, true);
  const entry = { ...tuple, packageCommit: head, observedAt, expiresAt, status: "SUPPORTED", reasonCode: "COMMIT_BOUND_QUALIFICATION_COMPLETE", evidence: [{ kind: "active-capability", digest: digest("6") }, { kind: "l2-model", digest: digest("4") }, { kind: "l3-e2e", digest: digest("5") }, { kind: "l4-qualification", digest: qualification.reportDigest }] };
  const proposalBody = {
    schema: "pi-ticket-planning:compatibility-proposal:v1",
    matrixDigest: objectDigest(JSON.parse(fs.readFileSync(path.join(repository, "compatibility", "matrix.json"), "utf8"))),
    qualificationDigest: qualification.reportDigest,
    capabilityDigest: digest("6"),
    qualificationProvenance: { repository: qualification.repository, workflowRunId: qualification.workflowRunId, workflowRunAttempt: qualification.workflowRunAttempt, workflowRunUrl: qualification.workflowRunUrl, signerWorkflow: "github.com/acme/product/.github/workflows/release-qualification.yml", sourceDigest: head },
    entry,
  };
  const proposal = { ...proposalBody, proposalDigest: objectDigest(proposalBody) };
  assert.equal(validateArtifact(proposal).ok, true);
  const qualificationFile = path.join(temporary, "qualification.json");
  const proposalFile = path.join(temporary, "proposal.json");
  fs.writeFileSync(qualificationFile, `${JSON.stringify(qualification, null, 2)}\n`);
  fs.writeFileSync(proposalFile, `${JSON.stringify(proposal, null, 2)}\n`);
  const out = path.join(temporary, "dist");
  const result = buildReleaseArtifacts({ qualificationFile, proposalFile, outDir: out, root: repository });
  assert.equal(result.files.includes("SHA256SUMS"), true);
  for (const line of fs.readFileSync(path.join(out, "SHA256SUMS"), "utf8").trim().split("\n")) {
    const [expected, name] = line.split(/\s{2}/u);
    assert.equal(createHash("sha256").update(fs.readFileSync(path.join(out, name))).digest("hex"), expected);
  }
  const extracted = path.join(temporary, "extracted");
  fs.mkdirSync(extracted);
  const archive = path.join(out, `pi-ticket-planning-${pkg.version}-installable.tar.gz`);
  run("tar", ["-xzf", archive, "-C", extracted], temporary);
  assert.equal(fs.existsSync(path.join(extracted, ".git")), false);
  assert.equal(runtimeMetadata({ root: extracted }).sourceCommit, head);
  assert.equal(JSON.parse(fs.readFileSync(path.join(extracted, "compatibility", "matrix.json"), "utf8")).entries[0].packageCommit, head);
  run("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], extracted);
  const stateDir = path.join(temporary, "state");
  const smoke = spawnSync(process.execPath, ["scripts/planctl.mjs", "case", "create", "--target", "github:artifact/test", "--case-id", "PC-artifact", "--json"], { cwd: extracted, env: { ...process.env, PI_TICKET_PLAN_STATE_DIR: stateDir }, encoding: "utf8" });
  assert.equal(smoke.status, 0, smoke.stderr);
});
