import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ingestControllerCompletion } from "../execution-plan/completion-ingest.mjs";
import { fingerprint } from "../execution-plan/domain.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCK = JSON.parse(fs.readFileSync(path.join(ROOT, "compatibility", "codex-controller-contract.json"), "utf8"));

export function controllerCompletionFixture({
  releaseId = "r1-c1-r1",
  repo = "Notyet1307/example",
  baseRef = "main",
  sourceBaseSha = "1".repeat(40),
  candidateSha = "2".repeat(40),
  mergedMainSha = "3".repeat(40),
  handoffDigests = [],
  issueNumber = 1,
} = {}) {
  const controller = { version: 1, sourceRevision: LOCK.commit, sourceManifestDigest: LOCK.sourceManifestDigest, buildDigest: LOCK.buildDigest, digest: LOCK.identityDigest };
  const planDigest = fingerprint({ releaseId, sourceBaseSha, candidateSha }).slice(7);
  const provenanceBody = { version: 1, controller, executionMode: "release-plan-v2-direct", configDigest: fingerprint({ repo, baseRef }).slice(7), releasePlan: { version: 2, digest: planDigest } };
  const body = {
    schema: "herdr-codex-controller:release-completion:v1",
    releaseId,
    repo,
    baseRef,
    planDigest,
    sourceBaseSha,
    candidateSha,
    issueCommits: [{ issueNumber, sha: candidateSha }],
    releaseValidationDigest: fingerprint({ releaseId, kind: "validation" }).slice(7),
    reviewResultDigest: fingerprint({ releaseId, kind: "review" }).slice(7),
    pullRequest: { number: 1, headRef: `agent/${releaseId.toLowerCase()}`, headSha: candidateSha, baseRef, mergeSha: mergedMainSha, mergedAt: "2026-08-29T00:09:00.000Z" },
    requiredChecks: ["verify"],
    mergedMainSha,
    dependencyHandoffDigests: [...handoffDigests],
    controllerProvenance: { ...provenanceBody, digest: fingerprint(provenanceBody).slice(7) },
    completedAt: "2026-08-29T00:10:00.000Z",
  };
  return { ...body, digest: fingerprint(body) };
}

export function predecessorReceiptFixture(options = {}) {
  return ingestControllerCompletion(controllerCompletionFixture(options));
}
