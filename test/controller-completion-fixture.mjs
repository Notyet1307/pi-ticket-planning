import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ingestControllerCompletion } from "../execution-plan/completion-ingest.mjs";
import { fingerprint } from "../execution-plan/domain.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCK = JSON.parse(fs.readFileSync(path.join(ROOT, "compatibility", "codex-controller-contract.json"), "utf8"));
const TRUST = JSON.parse(fs.readFileSync(path.join(ROOT, "compatibility", "codex-controller-trust.json"), "utf8"));

function hexDigest(value) { return fingerprint(value).slice(7); }
function withDigest(body) { return { ...body, digest: hexDigest(body) }; }

function provenanceFixture({ controller, repo, planDigest, version }) {
  const binary = {
    configuredPathDigest: fingerprint("fixture-codex-configured-path"),
    realPathDigest: fingerprint("fixture-codex-real-path"),
    byteCount: 1024,
    sha256: fingerprint("fixture-codex-bytes"),
    versionOutput: "codex fixture 1.0.0",
  };
  const executionRuntime = withDigest({
    version: 1,
    binary,
    fixedPolicyDigest: hexDigest("fixture-fixed-policy"),
    profilesDisabled: true,
  });
  const remoteIdentity = withDigest({
    version: 1,
    remote: "origin",
    repo: repo.toLowerCase(),
    fetchUrl: `https://github.com/${repo.toLowerCase()}.git`,
    pushUrl: `https://github.com/${repo.toLowerCase()}.git`,
    fetchTransport: "https",
    pushTransport: "https",
  });
  const validationSandbox = withDigest({
    version: 1,
    provider: "codex-permission-profile",
    binary,
    policyDigest: hexDigest("fixture-validation-policy"),
  });
  const requiredCheckContractDigest = hexDigest({ repo, requiredChecks: ["verify"] });
  const body = {
    version,
    controller: structuredClone(controller),
    executionRuntime,
    remoteIdentity,
    validationSandbox,
    ...(version === 3 ? {
      requiredCheckContractDigest,
      mergeAuthorityDigest: hexDigest("fixture-merge-authority"),
      identityHistoryDigest: LOCK.controllerIdentityHistoryDigest,
    } : {}),
    executionMode: "release-plan-v2-direct",
    configDigest: hexDigest({ repo, baseRef: "main" }),
    releasePlan: { version: 2, digest: planDigest },
  };
  return { provenance: withDigest(body), requiredCheckContractDigest };
}

function completionFixture(entry, version, {
  releaseId = "r1-c1-r1",
  repo = "Notyet1307/example",
  baseRef = "main",
  sourceBaseSha = "1".repeat(40),
  candidateSha = "2".repeat(40),
  mergedMainSha = "3".repeat(40),
  handoffDigests = [],
  issueNumber = 1,
} = {}) {
  const planDigest = hexDigest({ releaseId, sourceBaseSha, candidateSha });
  const { provenance, requiredCheckContractDigest } = provenanceFixture({ controller: entry.identity, repo, planDigest, version });
  const schema = `herdr-codex-controller:release-completion:v${version}`;
  const body = {
    schema,
    releaseId,
    repo,
    baseRef,
    planDigest,
    sourceBaseSha,
    candidateSha,
    issueCommits: [{ issueNumber, sha: candidateSha }],
    releaseValidationDigest: hexDigest({ releaseId, kind: "validation" }),
    reviewResultDigest: hexDigest({ releaseId, kind: "review" }),
    pullRequest: { number: 1, headRef: `agent/${releaseId.toLowerCase()}`, headSha: candidateSha, baseRef, mergeSha: mergedMainSha, mergedAt: "2026-08-29T00:09:00.000Z" },
    requiredChecks: ["verify"],
    mergedMainSha,
    dependencyHandoffDigests: [...handoffDigests],
    controllerProvenance: provenance,
    completedAt: "2026-08-29T00:10:00.000Z",
    ...(version === 3 ? {
      digestAlgorithm: TRUST.digestAlgorithm,
      schemaSha256: entry.ownedSchemas.find((owned) => owned.schema === schema).sha256,
      requiredCheckContractDigest,
    } : {}),
  };
  return { ...body, digest: fingerprint(body) };
}

export function controllerCompletionFixture(options = {}) {
  return completionFixture(TRUST.entries.find((entry) => entry.active), 3, options);
}

export function historicalControllerCompletionFixture(options = {}) {
  return completionFixture(TRUST.entries.find((entry) => !entry.active), 2, options);
}

export function predecessorReceiptFixture(options = {}) {
  return ingestControllerCompletion(controllerCompletionFixture(options));
}
