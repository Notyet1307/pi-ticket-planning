import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  ingestControllerCompletion,
  validateControllerCompletion,
  validateControllerPredecessorReceipt,
} from "../execution-plan/completion-ingest.mjs";
import { fingerprint } from "../execution-plan/domain.mjs";
import { controllerCompletionFixture } from "./controller-completion-fixture.mjs";

function codes(problems) { return problems.map(({ code }) => code); }
function redigest(value) {
  const { digest: _digest, ...body } = value;
  value.digest = fingerprint(body);
  return value;
}

test("Controller completion ingestion deterministically produces the only automatic predecessor receipt", () => {
  const completion = controllerCompletionFixture({ handoffDigests: [`sha256:${"8".repeat(64)}`] });
  assert.deepEqual(validateControllerCompletion(completion), []);
  const receipt = ingestControllerCompletion(completion);
  assert.deepEqual(validateControllerPredecessorReceipt(receipt), []);
  assert.deepEqual(ingestControllerCompletion(completion), receipt);
  assert.equal(receipt.controllerCompletionDigest, completion.digest);
  assert.equal(receipt.planDigest, `sha256:${completion.planDigest}`);
  assert.equal(receipt.validationDigest, `sha256:${completion.releaseValidationDigest}`);
  assert.equal(receipt.reviewResultDigest, `sha256:${completion.reviewResultDigest}`);
  assert.equal(receipt.candidateSha, completion.pullRequest.headSha);
  assert.equal(receipt.mergeSha, completion.mergedMainSha);

  const legacyBody = { schema: "pi-ticket-planning:release-predecessor-receipt:v1", releaseId: completion.releaseId, mergedMainSha: completion.mergedMainSha, handoffDigests: [], validationDigest: `sha256:${"7".repeat(64)}`, completedAt: completion.completedAt };
  assert.deepEqual(codes(validateControllerPredecessorReceipt({ ...legacyBody, digest: fingerprint(legacyBody) })), ["PREDECESSOR_COMPLETION_EXPORT_REQUIRED"]);
});

test("completion and receipt forgery fail with stable binding codes", () => {
  const completion = controllerCompletionFixture();
  const openArtifact = redigest({ ...structuredClone(completion), privatePath: "/private/job.json" });
  assert.deepEqual(codes(validateControllerCompletion(openArtifact)), ["CONTROLLER_COMPLETION_EXPORT_INVALID"]);
  const wrongCandidate = redigest({ ...structuredClone(completion), candidateSha: "4".repeat(40) });
  assert.equal(codes(validateControllerCompletion(wrongCandidate)).includes("CONTROLLER_COMPLETION_CANDIDATE_MISMATCH"), true);

  const wrongMerge = structuredClone(completion);
  wrongMerge.pullRequest.mergeSha = "5".repeat(40);
  redigest(wrongMerge);
  assert.equal(codes(validateControllerCompletion(wrongMerge)).includes("CONTROLLER_COMPLETION_MERGE_MISMATCH"), true);

  const localOnly = structuredClone(completion);
  localOnly.controllerProvenance.executionMode = "release-plan-v1-compatibility";
  const { digest: _provenanceDigest, ...provenanceBody } = localOnly.controllerProvenance;
  localOnly.controllerProvenance.digest = fingerprint(provenanceBody).slice(7);
  redigest(localOnly);
  assert.equal(codes(validateControllerCompletion(localOnly)).includes("CONTROLLER_COMPLETION_EXPORT_INVALID"), true);

  const wrongController = structuredClone(completion);
  wrongController.controllerProvenance.controller.sourceRevision = "6".repeat(40);
  const { digest: _controllerDigest, ...controllerBody } = wrongController.controllerProvenance.controller;
  wrongController.controllerProvenance.controller.digest = fingerprint(controllerBody).slice(7);
  const { digest: _wrongProvenanceDigest, ...wrongProvenanceBody } = wrongController.controllerProvenance;
  wrongController.controllerProvenance.digest = fingerprint(wrongProvenanceBody).slice(7);
  redigest(wrongController);
  assert.equal(codes(validateControllerCompletion(wrongController)).includes("CONTROLLER_COMPLETION_PROVENANCE_MISMATCH"), true);

  const receipt = ingestControllerCompletion(completion);
  const forgedValidation = redigest({ ...structuredClone(receipt), validationDigest: `sha256:${"0".repeat(64)}` });
  assert.equal(codes(validateControllerPredecessorReceipt(forgedValidation)).includes("CONTROLLER_COMPLETION_VALIDATION_MISMATCH"), true);
  const forgedCandidate = redigest({ ...structuredClone(receipt), candidateSha: "7".repeat(40) });
  assert.equal(codes(validateControllerPredecessorReceipt(forgedCandidate)).includes("CONTROLLER_COMPLETION_CANDIDATE_MISMATCH"), true);
  const forgedMerge = redigest({ ...structuredClone(receipt), mergeSha: "8".repeat(40) });
  assert.equal(codes(validateControllerPredecessorReceipt(forgedMerge)).includes("CONTROLLER_COMPLETION_MERGE_MISMATCH"), true);
  const forgedReview = redigest({ ...structuredClone(receipt), reviewResultDigest: `sha256:${"9".repeat(64)}` });
  assert.equal(codes(validateControllerPredecessorReceipt(forgedReview)).includes("CONTROLLER_COMPLETION_REVIEW_MISMATCH"), true);
  const forgedReference = redigest({ ...structuredClone(receipt), controllerCompletionDigest: `sha256:${"0".repeat(64)}` });
  assert.equal(codes(validateControllerPredecessorReceipt(forgedReference)).includes("CONTROLLER_COMPLETION_DIGEST_MISMATCH"), true);
});

test("completion ingestion CLI accepts only a safe public artifact and writes exact private receipt bytes", (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "completion-ingest-"));
  t.after(() => {
    try { chmodSync(path.join(root, "output"), 0o700); } catch {}
    rmSync(root, { recursive: true, force: true });
  });
  const completionPath = path.join(root, "completion.json");
  const outputRoot = path.join(root, "output");
  const outputPath = path.join(outputRoot, "predecessor.json");
  mkdirSync(outputRoot, { mode: 0o700 });
  writeFileSync(completionPath, `${JSON.stringify(controllerCompletionFixture(), null, 2)}\n`, { mode: 0o644 });
  const cli = path.resolve("execution-plan", "completion-ingest.mjs");
  const result = spawnSync(process.execPath, [cli, "--completion", completionPath, "--out", outputPath, "--json"], { cwd: path.resolve("."), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(readFileSync(outputPath, "utf8"));
  assert.deepEqual(validateControllerPredecessorReceipt(receipt), []);
  assert.equal(JSON.parse(result.stdout).digest, receipt.digest);
  assert.equal(result.stdout.includes(root), false);
  assert.equal(readFileSync(outputPath, "utf8").includes(root), false);
  assert.equal(statSync(outputPath).mode & 0o777, 0o600);

  const jobPath = path.join(root, "job.json");
  writeFileSync(jobPath, "{}\n", { mode: 0o600 });
  const rejected = spawnSync(process.execPath, [cli, "--completion", jobPath, "--out", path.join(outputRoot, "bad.json")], { cwd: path.resolve("."), encoding: "utf8" });
  assert.equal(rejected.status, 2);
  assert.match(rejected.stderr, /CONTROLLER_COMPLETION_INPUT_NOT_PUBLIC/);

  const privateCompletion = path.join(root, "private-completion.json");
  writeFileSync(privateCompletion, `${JSON.stringify(controllerCompletionFixture())}\n`, { mode: 0o600 });
  const privateResult = spawnSync(process.execPath, [cli, "--completion", privateCompletion], { cwd: path.resolve("."), encoding: "utf8" });
  assert.equal(privateResult.status, 2);
  assert.match(privateResult.stderr, /CONTROLLER_COMPLETION_INPUT_NOT_PUBLIC/);

  const link = path.join(root, "completion-link.json");
  symlinkSync(completionPath, link);
  const symlinked = spawnSync(process.execPath, [cli, "--completion", link], { cwd: path.resolve("."), encoding: "utf8" });
  assert.equal(symlinked.status, 2);
  assert.match(symlinked.stderr, /CONTROLLER_COMPLETION_INPUT_NOT_PUBLIC/);
});
