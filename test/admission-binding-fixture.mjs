import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { fingerprint } from "../execution-plan/domain.mjs";
import { hashText } from "../scripts/check-delivery-graph.mjs";

function git(repo, args) {
  const run = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(run.stderr || run.stdout);
  return run.stdout.trim();
}

function write(repo, file, value) {
  const target = path.join(repo, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, value);
}

export function createAdmissionBindingFixture({
  registerCleanup,
  parent,
  specBody,
  caseId,
  approvalId,
  acceptedAt,
  productReleaseIdentity,
  predecessorReleaseId = "R1-C1-r1",
}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "admission-bindings-"));
  const repositoryPath = path.join(root, "repo");
  fs.mkdirSync(repositoryPath);
  git(repositoryPath, ["init", "-q"]);
  git(repositoryPath, ["config", "user.name", "Admission Binding Test"]);
  git(repositoryPath, ["config", "user.email", "admission@example.invalid"]);
  write(repositoryPath, "AGENTS.md", "policy\n");
  write(repositoryPath, "README.md", "release\n");
  write(repositoryPath, "fixtures/admission-cases.json", "{}\n");
  write(repositoryPath, "scripts/verify-protocol.mjs", "// verifier\n");
  write(repositoryPath, "package.json", `${JSON.stringify({ scripts: { "verify:protocol": "node scripts/verify-protocol.mjs" } })}\n`);
  git(repositoryPath, ["add", "."]);
  git(repositoryPath, ["commit", "-qm", "planning base"]);
  const planningBaseSha = git(repositoryPath, ["rev-parse", "HEAD"]);

  const boundFile = (identity, file) => {
    const bytes = fs.readFileSync(path.join(repositoryPath, file));
    return { identity, path: file, sha256: hashText(bytes.toString("utf8")), byteCount: bytes.length };
  };
  const acceptanceBody = {
    schema: "pi-ticket-planning:spec-acceptance:v1",
    parent: { number: Number(parent.id), title: parent.title, bodyHash: hashText(parent.body) },
    source: { baseSha: planningBaseSha, specContentHash: hashText(specBody) },
    decision: { caseId, approvalId, acceptedAt },
  };
  const specAcceptance = { ...acceptanceBody, digest: fingerprint(acceptanceBody) };
  const manifestBody = {
    schema: "pi-ticket-planning:decision-manifest:v1",
    baseSha: planningBaseSha,
    policy: boundFile("AGENTS.md", "AGENTS.md"),
    productRelease: boundFile(productReleaseIdentity, "README.md"),
    decisions: [],
    dependencyHandoffs: [],
  };
  const decisionManifest = { ...manifestBody, digest: fingerprint(manifestBody) };
  const predecessorBody = {
    schema: "pi-ticket-planning:release-predecessor-receipt:v1",
    releaseId: predecessorReleaseId,
    mergedMainSha: planningBaseSha,
    handoffDigests: [],
    validationDigest: `sha256:${"7".repeat(64)}`,
    completedAt: acceptedAt,
  };
  const predecessorReceipt = { ...predecessorBody, digest: fingerprint(predecessorBody) };
  write(repositoryPath, "evidence/spec-acceptance.json", `${JSON.stringify(specAcceptance)}\n`);
  write(repositoryPath, "evidence/decision-manifest.json", `${JSON.stringify(decisionManifest)}\n`);
  write(repositoryPath, "evidence/predecessor.json", `${JSON.stringify(predecessorReceipt)}\n`);
  git(repositoryPath, ["add", "."]);
  git(repositoryPath, ["commit", "-qm", "bound release evidence"]);
  const executionBaseSha = git(repositoryPath, ["rev-parse", "HEAD"]);

  const artifactBinding = (file) => {
    const bytes = fs.readFileSync(path.join(repositoryPath, file));
    return { path: file, baseSha: executionBaseSha, sha256: hashText(bytes.toString("utf8")), byteCount: bytes.length };
  };
  registerCleanup(() => fs.rmSync(root, { recursive: true, force: true }));
  const specAcceptanceBinding = artifactBinding("evidence/spec-acceptance.json");
  const decisionManifestBinding = artifactBinding("evidence/decision-manifest.json");
  return {
    repositoryPath,
    planningBaseSha,
    executionBaseSha,
    specAcceptance,
    specAcceptanceBinding,
    decisionManifest,
    decisionManifestBinding,
    decisionManifestDigest: decisionManifestBinding.sha256,
    predecessorReceipt,
    predecessorReceiptBinding: artifactBinding("evidence/predecessor.json"),
  };
}
