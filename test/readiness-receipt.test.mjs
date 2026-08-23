import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ADMISSION_READINESS_SCHEMA,
  HARNESS_READINESS_SCHEMA_SHA256,
  buildHarnessReadinessBinding,
  runHarnessReadiness,
  stableHarnessReadiness,
} from "../scripts/readiness-receipt.mjs";

const repo = "owner/repo";
const baseSha = "a".repeat(40);
const emptyDigest = createHash("sha256").update("").digest("hex");
const now = new Date().toISOString();

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function receipt(overrides = {}) {
  const body = {
    schema: "herdr-harness:project-readiness:v1",
    generatedAt: now,
    repo,
    baseRef: "main",
    baseSha,
    configDigest: "b".repeat(64),
    ok: true,
    providers: { status: "passed", lanes: ["worker", "reviewer"], failure: null },
    docker: { required: true, status: "passed", failure: null },
    validation: {
      status: "passed",
      validationArgvDigest: "c".repeat(64),
      durationMs: 123,
      exitCode: 0,
      signal: null,
      timeout: false,
      relevantEnvironmentDigest: "d".repeat(64),
      sourceSnapshotDigest: "e".repeat(64),
      stdout: { byteCount: 0, sha256: emptyDigest },
      stderr: { byteCount: 0, sha256: emptyDigest },
      failure: null,
    },
    delivery: {
      status: "passed",
      autoMergeRequested: true,
      inspection: {
        baseRefIsDefault: true,
        repositoryAutoMerge: true,
        pullRequestRequired: true,
        strictRequiredStatusChecks: true,
        requiredStatusChecks: ["herdr-delivery-gate"],
        statusCheckSourcesPinned: true,
        bypassActorsPresent: false,
        humanApprovalRequired: false,
        mergeCommitAllowed: true,
        mergeMethodAllowed: true,
      },
      failure: null,
    },
    ...overrides,
  };
  return { ...body, digest: digest(body) };
}

test("passing Harness receipt becomes a stable Admission projection", () => {
  const binding = buildHarnessReadinessBinding(receipt(), { expectedRepo: repo, expectedBaseSha: baseSha, now });

  assert.equal(binding.readiness.schema, ADMISSION_READINESS_SCHEMA);
  assert.equal(binding.digest, `sha256:${HARNESS_READINESS_SCHEMA_SHA256}`);
  assert.equal(binding.readiness.projection.validation.status, "passed");
  assert.equal("durationMs" in binding.readiness.projection.validation, false);
  assert.equal(JSON.stringify(binding).includes("relevantEnvironmentDigest"), false);
  assert.equal(JSON.stringify(binding).includes("stdout"), false);
});

test("volatile receipt evidence changes do not change the stable projection", () => {
  const first = buildHarnessReadinessBinding(receipt(), { expectedRepo: repo, expectedBaseSha: baseSha, now });
  const laterTime = new Date(Date.parse(now) + 1_000).toISOString();
  const secondReceipt = receipt({ generatedAt: laterTime });
  secondReceipt.validation.durationMs = 999;
  const { digest: _old, ...secondBody } = secondReceipt;
  secondReceipt.digest = digest(secondBody);
  const second = buildHarnessReadinessBinding(secondReceipt, { expectedRepo: repo, expectedBaseSha: baseSha, now: laterTime });

  assert.deepEqual(stableHarnessReadiness(first), stableHarnessReadiness(second));
  assert.notEqual(first.readiness.receiptDigest, second.readiness.receiptDigest);
});

test("receipt digest, identity, freshness, fields, and gate all fail closed", () => {
  const badDigest = receipt();
  badDigest.digest = "f".repeat(64);
  assert.throws(() => buildHarnessReadinessBinding(badDigest, { expectedRepo: repo, expectedBaseSha: baseSha, now }), /digest is invalid/);

  const extra = receipt();
  extra.rawOutput = "secret";
  const { digest: _extraDigest, ...extraBody } = extra;
  extra.digest = digest(extraBody);
  assert.throws(() => buildHarnessReadinessBinding(extra, { expectedRepo: repo, expectedBaseSha: baseSha, now }), /fields are invalid/);

  const bypass = receipt();
  bypass.delivery.inspection.bypassActorsPresent = true;
  const { digest: _bypassDigest, ...bypassBody } = bypass;
  bypass.digest = digest(bypassBody);
  assert.throws(() => buildHarnessReadinessBinding(bypass, { expectedRepo: repo, expectedBaseSha: baseSha, now }), /not Admission-safe/);

  assert.throws(() => buildHarnessReadinessBinding(receipt(), { expectedRepo: "other/repo", expectedBaseSha: baseSha, now }), /target identity differs/);
  assert.throws(() => buildHarnessReadinessBinding(receipt(), {
    expectedRepo: repo,
    expectedBaseSha: baseSha,
    now: new Date(Date.parse(now) + 61 * 60 * 1_000).toISOString(),
  }), /freshness window/);
});

test("a self-consistent binding cannot weaken the stable delivery projection", () => {
  const binding = buildHarnessReadinessBinding(receipt(), { expectedRepo: repo, expectedBaseSha: baseSha, now });
  binding.readiness.projection.delivery.inspection.bypassActorsPresent = true;
  assert.throws(() => stableHarnessReadiness(binding), /not Admission-safe/);
});

test("readiness runner verifies the colocated schema and private config before consuming JSON", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pi-ticket-readiness-"));
  try {
    const harnessCli = path.join(root, "dist", "src", "cli.js");
    const schemaPath = path.join(root, "schemas", "project-readiness-v1.schema.json");
    const harnessConfig = path.join(root, "project.harness.json");
    mkdirSync(path.dirname(harnessCli), { recursive: true });
    mkdirSync(path.dirname(schemaPath), { recursive: true });
    writeFileSync(schemaPath, readFileSync(path.resolve("schemas/project-readiness-v1.schema.json")));
    writeFileSync(harnessConfig, "{}\n", { mode: 0o600 });
    chmodSync(harnessConfig, 0o600);
    writeFileSync(harnessCli, [
      `process.stdout.write(${JSON.stringify(JSON.stringify(receipt()))});`,
    ].join("\n"));

    const binding = runHarnessReadiness({ harnessCli, harnessConfig, repo, baseSha, now });
    assert.equal(binding.readiness.projection.repo, repo);

    const cli = spawnSync(process.execPath, [
      path.resolve("scripts/admit.mjs"), "readiness",
      "--repo", repo,
      "--base", baseSha,
      "--harness-cli", harnessCli,
      "--harness-config", harnessConfig,
    ], { encoding: "utf8" });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(JSON.parse(cli.stdout).readiness.projection.baseSha, baseSha);

    chmodSync(harnessConfig, 0o644);
    assert.throws(() => runHarnessReadiness({ harnessCli, harnessConfig, repo, baseSha, now }), /must not be group\/world accessible/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
