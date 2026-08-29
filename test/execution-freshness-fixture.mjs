import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { fingerprint } from "../execution-plan/domain.mjs";
import { hashText } from "../scripts/check-delivery-graph.mjs";
import { checkTicketContext } from "../scripts/check-ticket-context.mjs";
import { parseChildTicket } from "../execution-plan/markdown.mjs";
import { attachReviewBinding } from "./review-binding-fixture.mjs";
import { executionInput } from "./execution-plan-fixture.mjs";
import {
  executionConstraints,
  graphContractFields,
  oracleBinding,
  reviewContractFields,
  ticketBody,
} from "./ticket-contract-fixture.mjs";

export function git(cwd, args) {
  const run = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  if (run.status !== 0) throw new Error(run.stderr || run.stdout);
  return run.stdout.trim();
}

function bytesBinding(repo, baseSha, identity, file) {
  const bytes = spawnSync("git", ["-C", repo, "show", `${baseSha}:${file}`], { encoding: null }).stdout;
  return { identity, path: file, sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`, byteCount: bytes.length };
}

function artifactBinding(binding, baseSha) {
  const { identity: _identity, ...artifact } = binding;
  return { path: artifact.path, baseSha, sha256: artifact.sha256, byteCount: artifact.byteCount };
}

export function write(repo, file, value) {
  const target = path.join(repo, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, value);
}

export function createFreshnessFixture(t, { downstream = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "execution-freshness-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, "repo");
  const remote = path.join(root, "remote.git");
  fs.mkdirSync(repo);
  git(root, ["init", "--bare", remote]);
  git(root, ["init", repo]);
  git(repo, ["config", "user.name", "Freshness Test"]);
  git(repo, ["config", "user.email", "freshness@example.invalid"]);
  write(repo, "AGENTS.md", "policy\n");
  write(repo, "docs/release.md", "release\n");
  write(repo, "docs/adr-1.md", "ACCEPTED decision\n");
  write(repo, "handoffs/c1.json", "handoff\n");
  write(repo, "fixtures/oracle.json", "{\"oracle\":true}\n");
  write(repo, "package.json", `${JSON.stringify({ scripts: { "verify:oracle:o01": "node --test" } })}\n`);
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "planning base"]);
  git(repo, ["branch", "-M", "main"]);
  const planningBaseSha = git(repo, ["rev-parse", "HEAD"]);
  git(repo, ["remote", "add", "origin", remote]);
  git(repo, ["push", "-u", "origin", "main"]);

  const input = executionInput();
  const specContentHash = hashText(input.parent.body);
  const acceptanceBody = { schema: "pi-ticket-planning:spec-acceptance:v1", parent: { number: Number(input.parent.id), title: input.parent.title, bodyHash: hashText(input.parent.body) }, source: { baseSha: planningBaseSha, specContentHash }, decision: { caseId: "PC-fresh", approvalId: "F-fresh", acceptedAt: "2026-08-29T00:00:00Z" } };
  const acceptance = { ...acceptanceBody, digest: fingerprint(acceptanceBody) };
  write(repo, "evidence/spec-acceptance.json", `${JSON.stringify(acceptance)}\n`);
  const handoff = bytesBinding(repo, planningBaseSha, "C1-handoff", "handoffs/c1.json");
  const policy = bytesBinding(repo, planningBaseSha, "AGENTS.md", "AGENTS.md");
  const productRelease = bytesBinding(repo, planningBaseSha, "R1/r1", "docs/release.md");
  const decision = { ...bytesBinding(repo, planningBaseSha, "ADR-1", "docs/adr-1.md"), status: "ACCEPTED" };
  const manifestBody = { schema: "pi-ticket-planning:decision-manifest:v1", baseSha: planningBaseSha, policy, productRelease, decisions: [decision], dependencyHandoffs: downstream ? [handoff] : [] };
  const decisionManifest = { ...manifestBody, digest: fingerprint(manifestBody) };
  write(repo, "evidence/decision-manifest.json", `${JSON.stringify(decisionManifest)}\n`);
  let predecessorReceipt = null;
  if (downstream) {
    const receiptBody = { schema: "pi-ticket-planning:release-predecessor-receipt:v1", releaseId: "R1-C1-r1", mergedMainSha: planningBaseSha, handoffDigests: [handoff.sha256], validationDigest: `sha256:${"7".repeat(64)}`, completedAt: "2026-08-29T00:10:00Z" };
    predecessorReceipt = { ...receiptBody, digest: fingerprint(receiptBody) };
    write(repo, "evidence/predecessor.json", `${JSON.stringify(predecessorReceipt)}\n`);
  }
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "publish handoff evidence"]);
  const executionBaseSha = git(repo, ["rev-parse", "HEAD"]);
  git(repo, ["push", "origin", "main"]);

  const binding = oracleBinding({ repo, baseSha: executionBaseSha, artifactPath: "fixtures/oracle.json", command: "npm run verify:oracle:o01" });
  const constraints = executionConstraints({ expectedPaths: ["src/change.ts"], protectedPaths: ["fixtures/oracle.json"], primaryVerificationSeams: ["Run the release scenario."] });
  input.children[0].body = ticketBody({ objective: "Build the safe release.", primaryVerification: "Run the release scenario.", binding, constraints });
  const graph = input.deliveryGraph;
  Object.assign(graph, {
    releaseId: downstream ? "R1-C2-r1" : "R1-C1-r1",
    releaseOrdinal: downstream ? 2 : 1,
    planningBaseSha,
    executionBaseSha,
    executionBasePolicy: downstream ? "PREDECESSOR_MERGE_OR_DESCENDANT" : "PLANNING_BASE_OR_DESCENDANT",
    roadmapDigest: downstream ? `sha256:${"8".repeat(64)}` : null,
    predecessorReleaseId: downstream ? "R1-C1-r1" : null,
    predecessorReceipt,
    predecessorReceiptBinding: downstream ? artifactBinding(bytesBinding(repo, executionBaseSha, "predecessor", "evidence/predecessor.json"), executionBaseSha) : null,
    specAcceptance: acceptance,
    specAcceptanceBinding: artifactBinding(bytesBinding(repo, executionBaseSha, "acceptance", "evidence/spec-acceptance.json"), executionBaseSha),
    decisionManifest,
    decisionManifestBinding: artifactBinding(bytesBinding(repo, executionBaseSha, "decision-manifest", "evidence/decision-manifest.json"), executionBaseSha),
  });
  graph.decisionManifestDigest = graph.decisionManifestBinding.sha256;
  graph.source.specContentHash = specContentHash;
  graph.children[0].bodyHash = hashText(input.children[0].body);
  Object.assign(graph.children[0], graphContractFields(input.children[0].body));
  input.repositoryPath = repo;
  input.source = { ...input.source, baseSha: executionBaseSha, baseRef: "main", remote: "origin", specContentHash };
  input.specAcceptance = structuredClone(acceptance);
  input.contextChecks = [{ candidateId: input.children[0].id, result: checkTicketContext({ repo, base: executionBaseSha, body: input.children[0].body }) }];
  input.review.source = { identity: input.source.identity, revision: input.source.revision, baseSha: executionBaseSha, specContentHash };
  input.review.candidates[0] = { id: input.children[0].id, verdict: "READY", executionLane: "AGENT", ...reviewContractFields(input.children[0].body, graph.children[0], graph.children) };
  return { input: attachReviewBinding(input), repo, remote, planningBaseSha, executionBaseSha };
}

export function advanceDependencyWithoutManifest(input, repo) {
  write(repo, "handoffs/c1.json", "changed handoff\n");
  git(repo, ["add", "handoffs/c1.json"]);
  git(repo, ["commit", "-m", "change dependency handoff"]);
  const baseSha = git(repo, ["rev-parse", "HEAD"]);
  git(repo, ["push", "origin", "main"]);
  const parsed = parseChildTicket(input.children[0].body);
  const binding = oracleBinding({ repo, baseSha, artifactPath: parsed.oracleBinding.artifact.path, command: parsed.oracleBinding.execution.command });
  input.children[0].body = input.children[0].body.replace(JSON.stringify(parsed.oracleBinding), JSON.stringify(binding));
  input.source.baseSha = baseSha;
  input.deliveryGraph.executionBaseSha = baseSha;
  input.deliveryGraph.specAcceptanceBinding.baseSha = baseSha;
  input.deliveryGraph.predecessorReceiptBinding.baseSha = baseSha;
  input.deliveryGraph.decisionManifestBinding.baseSha = baseSha;
  input.deliveryGraph.children[0].bodyHash = hashText(input.children[0].body);
  Object.assign(input.deliveryGraph.children[0], graphContractFields(input.children[0].body));
  input.contextChecks = [{ candidateId: input.children[0].id, result: checkTicketContext({ repo, base: baseSha, body: input.children[0].body }) }];
  input.review.source.baseSha = baseSha;
  input.review.candidates[0] = { id: input.children[0].id, verdict: "READY", executionLane: "AGENT", ...reviewContractFields(input.children[0].body, input.deliveryGraph.children[0], input.deliveryGraph.children) };
  return attachReviewBinding(input);
}
