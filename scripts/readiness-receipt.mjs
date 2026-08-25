import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const HARNESS_READINESS_SCHEMA = "herdr-harness:project-readiness:v1";
export const ADMISSION_READINESS_SCHEMA = "pi-ticket-planning:harness-readiness:v1";
export const HARNESS_READINESS_SCHEMA_SHA256 = "381a54a79fc0118b5edfb40bc28ba1ceb1ab5109c57d4218cdbdd2ff41cde557";

const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const READINESS_TIMEOUT_MS = 45 * 60 * 1000;
export const MAX_RECEIPT_AGE_MS = 60 * 60 * 1000;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function rawDigest(value) {
  return createHash("sha256").update(JSON.stringify(canonical(value)), "utf8").digest("hex");
}

function fileDigest(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is not an object`);
  return value;
}

function exactKeys(value, expected, label) {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (keys.join("\n") !== wanted.join("\n")) throw new Error(`${label} fields are invalid`);
}

function safeText(value, max = 256) {
  return typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= max && !/[\0\r\n]/u.test(value);
}

function validTime(value) {
  return typeof value === "string" && value.length <= 64 && TIME.test(value) && Number.isFinite(Date.parse(value));
}

function validOutput(value) {
  const output = record(value, "readiness validation output");
  exactKeys(output, ["byteCount", "sha256"], "readiness validation output");
  if (!Number.isSafeInteger(output.byteCount) || output.byteCount < 0 || !DIGEST.test(output.sha256 ?? "")) {
    throw new Error("readiness validation output is invalid");
  }
  return { byteCount: output.byteCount, sha256: output.sha256 };
}

function admissionSafeInspection(value) {
  const inspection = record(value, "readiness delivery inspection");
  exactKeys(inspection, [
    "baseRefIsDefault", "repositoryAutoMerge", "pullRequestRequired", "strictRequiredStatusChecks",
    "requiredStatusChecks", "statusCheckSourcesPinned", "bypassActorsPresent", "humanApprovalRequired",
    "mergeCommitAllowed", "mergeMethodAllowed",
  ], "readiness delivery inspection");
  if (inspection.baseRefIsDefault !== true
    || inspection.repositoryAutoMerge !== true
    || inspection.pullRequestRequired !== true
    || inspection.strictRequiredStatusChecks !== true
    || !Array.isArray(inspection.requiredStatusChecks)
    || inspection.requiredStatusChecks.length < 1 || inspection.requiredStatusChecks.length > 100
    || new Set(inspection.requiredStatusChecks).size !== inspection.requiredStatusChecks.length
    || inspection.requiredStatusChecks.some((check) => !safeText(check))
    || inspection.statusCheckSourcesPinned !== true
    || inspection.bypassActorsPresent !== false
    || inspection.humanApprovalRequired !== false
    || inspection.mergeCommitAllowed !== true
    || inspection.mergeMethodAllowed !== true) throw new Error("Harness delivery-gate inspection is not Admission-safe");
  return inspection;
}

function passingReceipt(receipt) {
  if (Buffer.byteLength(JSON.stringify(receipt), "utf8") > 64 * 1024) throw new Error("Harness readiness receipt exceeds its byte budget");
  exactKeys(receipt, [
    "schema", "generatedAt", "repo", "baseRef", "baseSha", "configDigest", "ok",
    "providers", "docker", "validation", "delivery", "digest",
  ], "Harness readiness receipt");
  if (receipt.schema !== HARNESS_READINESS_SCHEMA
    || !validTime(receipt.generatedAt)
    || !REPO.test(receipt.repo ?? "")
    || !safeText(receipt.baseRef)
    || !SHA.test(receipt.baseSha ?? "")
    || !DIGEST.test(receipt.configDigest ?? "")
    || receipt.ok !== true
    || !DIGEST.test(receipt.digest ?? "")) throw new Error("Harness readiness receipt identity is invalid");
  const { digest: _digest, ...body } = receipt;
  if (rawDigest(body) !== receipt.digest) throw new Error("Harness readiness receipt digest is invalid");

  const providers = record(receipt.providers, "readiness providers");
  exactKeys(providers, ["status", "lanes", "failure"], "readiness providers");
  if (providers.status !== "passed" || JSON.stringify(providers.lanes) !== JSON.stringify(["worker", "reviewer"]) || providers.failure !== null) {
    throw new Error("Harness Provider readiness did not pass");
  }

  const docker = record(receipt.docker, "readiness Docker");
  exactKeys(docker, ["required", "status", "failure"], "readiness Docker");
  if (typeof docker.required !== "boolean"
    || docker.status !== (docker.required ? "passed" : "not-required")
    || docker.failure !== null) throw new Error("Harness Docker readiness did not pass");

  const validation = record(receipt.validation, "readiness validation");
  exactKeys(validation, [
    "status", "validationArgvDigest", "durationMs", "exitCode", "signal", "timeout",
    "relevantEnvironmentDigest", "sourceSnapshotDigest", "stdout", "stderr", "failure",
  ], "readiness validation");
  if (validation.status !== "passed"
    || !DIGEST.test(validation.validationArgvDigest ?? "")
    || !Number.isSafeInteger(validation.durationMs) || validation.durationMs < 0
    || validation.exitCode !== 0 || validation.signal !== null || validation.timeout !== false
    || !DIGEST.test(validation.relevantEnvironmentDigest ?? "")
    || !DIGEST.test(validation.sourceSnapshotDigest ?? "")
    || validation.failure !== null) throw new Error("Harness exact-base validation did not pass");
  validOutput(validation.stdout);
  validOutput(validation.stderr);

  const delivery = record(receipt.delivery, "readiness delivery gate");
  exactKeys(delivery, ["status", "autoMergeRequested", "inspection", "failure"], "readiness delivery gate");
  if (delivery.status !== "passed" || delivery.autoMergeRequested !== true || delivery.failure !== null) {
    throw new Error("Harness delivery gate did not pass");
  }
  const inspection = admissionSafeInspection(delivery.inspection);

  return { providers, docker, validation, delivery, inspection };
}

export function buildHarnessReadinessBinding(receiptValue, {
  expectedRepo,
  expectedBaseSha,
  now = new Date().toISOString(),
} = {}) {
  const receipt = record(receiptValue, "Harness readiness receipt");
  const facts = passingReceipt(receipt);
  if (receipt.repo !== expectedRepo || receipt.baseSha !== expectedBaseSha) throw new Error("Harness readiness receipt target identity differs from Admission");
  if (!validTime(now)) throw new Error("Admission readiness clock is invalid");
  const age = Date.parse(now) - Date.parse(receipt.generatedAt);
  if (age < -60_000 || age > MAX_RECEIPT_AGE_MS) throw new Error("Harness readiness receipt is outside the freshness window");
  return {
    identity: `HerdrHarness ${HARNESS_READINESS_SCHEMA}`,
    digest: `sha256:${HARNESS_READINESS_SCHEMA_SHA256}`,
    readiness: {
      schema: ADMISSION_READINESS_SCHEMA,
      observedAt: receipt.generatedAt,
      receiptDigest: `sha256:${receipt.digest}`,
      projection: {
        schema: receipt.schema,
        repo: receipt.repo,
        baseRef: receipt.baseRef,
        baseSha: receipt.baseSha,
        configDigest: receipt.configDigest,
        providers: { status: facts.providers.status, lanes: [...facts.providers.lanes] },
        docker: { required: facts.docker.required, status: facts.docker.status },
        validation: {
          status: facts.validation.status,
          validationArgvDigest: facts.validation.validationArgvDigest,
          sourceSnapshotDigest: facts.validation.sourceSnapshotDigest,
        },
        delivery: {
          status: facts.delivery.status,
          autoMergeRequested: facts.delivery.autoMergeRequested,
          inspection: {
            ...facts.inspection,
            requiredStatusChecks: [...facts.inspection.requiredStatusChecks],
          },
        },
      },
    },
  };
}

export function stableHarnessReadiness(value) {
  const harness = record(value, "Harness readiness binding");
  exactKeys(harness, ["identity", "digest", "readiness"], "Harness readiness contract");
  if (harness.identity !== `HerdrHarness ${HARNESS_READINESS_SCHEMA}`
    || harness.digest !== `sha256:${HARNESS_READINESS_SCHEMA_SHA256}`) throw new Error("Harness readiness contract identity is invalid");
  const readiness = record(harness.readiness, "Harness readiness binding");
  exactKeys(readiness, ["schema", "observedAt", "receiptDigest", "projection"], "Harness readiness binding");
  if (readiness.schema !== ADMISSION_READINESS_SCHEMA
    || !validTime(readiness.observedAt)
    || !SHA256.test(readiness.receiptDigest ?? "")) throw new Error("Harness readiness binding evidence is invalid");
  const projection = record(readiness.projection, "Harness readiness projection");
  exactKeys(projection, ["schema", "repo", "baseRef", "baseSha", "configDigest", "providers", "docker", "validation", "delivery"], "Harness readiness projection");
  if (projection.schema !== HARNESS_READINESS_SCHEMA || !REPO.test(projection.repo ?? "") || !safeText(projection.baseRef)
    || !SHA.test(projection.baseSha ?? "") || !DIGEST.test(projection.configDigest ?? "")) throw new Error("Harness readiness projection identity is invalid");
  const providers = record(projection.providers, "Harness readiness Provider projection");
  exactKeys(providers, ["status", "lanes"], "Harness readiness Provider projection");
  if (providers.status !== "passed" || JSON.stringify(providers.lanes) !== JSON.stringify(["worker", "reviewer"])) throw new Error("Harness readiness Provider projection is invalid");
  const docker = record(projection.docker, "Harness readiness Docker projection");
  exactKeys(docker, ["required", "status"], "Harness readiness Docker projection");
  if (typeof docker.required !== "boolean" || docker.status !== (docker.required ? "passed" : "not-required")) throw new Error("Harness readiness Docker projection is invalid");
  const validation = record(projection.validation, "Harness readiness validation projection");
  exactKeys(validation, ["status", "validationArgvDigest", "sourceSnapshotDigest"], "Harness readiness validation projection");
  if (validation.status !== "passed" || !DIGEST.test(validation.validationArgvDigest ?? "") || !DIGEST.test(validation.sourceSnapshotDigest ?? "")) throw new Error("Harness readiness validation projection is invalid");
  const delivery = record(projection.delivery, "Harness readiness delivery projection");
  exactKeys(delivery, ["status", "autoMergeRequested", "inspection"], "Harness readiness delivery projection");
  if (delivery.status !== "passed" || delivery.autoMergeRequested !== true) throw new Error("Harness readiness delivery projection is invalid");
  admissionSafeInspection(delivery.inspection);
  return {
    identity: harness.identity,
    digest: harness.digest,
    projection: canonical(projection),
  };
}

export function runHarnessReadiness({ harnessCli, harnessConfig, repo, baseSha, now = new Date().toISOString(), timeoutMs = READINESS_TIMEOUT_MS }) {
  if (!REPO.test(repo ?? "") || !SHA.test(baseSha ?? "")) throw new Error("Harness readiness target identity is invalid");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > READINESS_TIMEOUT_MS) throw new Error("Harness readiness timeout is invalid");
  for (const [label, value] of [["Harness CLI", harnessCli], ["Harness config", harnessConfig]]) {
    if (typeof value !== "string" || !path.isAbsolute(value)) throw new Error(`${label} path must be absolute`);
    let stat;
    try {
      stat = fs.lstatSync(value);
    } catch {
      throw new Error(`${label} is unavailable`);
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error(`${label} must be one regular file`);
  }
  if (fs.lstatSync(harnessConfig).mode & 0o077) throw new Error("Harness config must not be group/world accessible");
  const packageRoot = path.resolve(path.dirname(fs.realpathSync(harnessCli)), "../..");
  const schemaPath = path.join(packageRoot, "schemas", "project-readiness-v1.schema.json");
  const schemaStat = fs.existsSync(schemaPath) ? fs.lstatSync(schemaPath) : null;
  if (!schemaStat?.isFile() || schemaStat.isSymbolicLink() || schemaStat.nlink !== 1
    || fileDigest(schemaPath) !== HARNESS_READINESS_SCHEMA_SHA256) {
    throw new Error("Harness readiness schema differs from the supported contract");
  }
  const child = spawnSync(process.execPath, [
    fs.realpathSync(harnessCli), "readiness", "--config", fs.realpathSync(harnessConfig), "--base", baseSha, "--json",
  ], {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 128 * 1024,
    env: process.env,
  });
  if (child.error) throw new Error(child.error.code === "ETIMEDOUT" ? "Harness readiness command timed out" : "Harness readiness command could not start");
  let receipt;
  try {
    receipt = JSON.parse(child.stdout);
  } catch {
    throw new Error("Harness readiness command returned no valid JSON receipt");
  }
  const binding = buildHarnessReadinessBinding(receipt, { expectedRepo: repo, expectedBaseSha: baseSha, now });
  if (child.status !== 0) throw new Error("Harness readiness command did not pass");
  return binding;
}
