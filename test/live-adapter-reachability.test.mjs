import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { bindAdmissionReviewInput } from "../admission/review-transport.mjs";
import { buildCapabilityReceipt } from "../capabilities/doctor.mjs";
import { buildReviewerDispatchBinding } from "../extensions/reviewer-one-shot-gate.mjs";
import { expectedConfirmation, runIntegrationE2E } from "../integration/e2e.mjs";
import { createLiveAdapter } from "../integration/live-adapter.mjs";
import { verifyDisposableGitHubAppAuth, writeGitHubAppCredentialBinding } from "../integration/github-app-auth.mjs";
import {
  bindE2EControlIssue,
  bindE2EResource,
  cleanupPersistedE2E,
  createE2EState,
  declareE2EResource,
  e2eControlBody,
  e2eControlTitle,
  persistE2EState,
} from "../integration/e2e-state.mjs";
import { buildPlanningSessionBinding } from "../planning-case/bindings.mjs";
import { validateArtifact } from "../protocol/kernel.mjs";
import { parseChildTicket } from "../execution-plan/markdown.mjs";
import { ticketReviewProjection } from "../scripts/check-ticket-contract.mjs";
import { qualifiedCapability } from "./capability-fixture.mjs";
import { harnessReadiness } from "./readiness-fixture.mjs";

const REPO = "acme/ptp-e2e";
const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const BASE_SHA = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
const sha = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function codedError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function deterministicReviewerRuntime() {
  return {
    async dispatch({ reviewInput, directory, receipt, source, context, fault }) {
      const faults = {
        "provider-timeout": "PROVIDER_TIMEOUT_RECOVERED",
        "subagent-no-final-text": "SUBAGENT_FINAL_MISSING",
        "named-session-missing": "SESSION_NAME_NOT_RESUMABLE_BY_RUNTIME",
      };
      if (faults[fault]) throw codedError(faults[fault]);
      const inputBinding = bindAdmissionReviewInput(reviewInput).binding;
      const review = {
        schema: "pi-ticket-planning:admission-review:v1",
        reviewer: "ticket-readiness-reviewer",
        reviewedAt: reviewInput.reviewedAt,
        source: structuredClone(source),
        axes: Object.fromEntries(["candidateReadiness", "contextQuality", "deliveryGraph", "scenarioCoverage", "walkingSkeleton", "strictFrontier", "executionLane", "inputBinding"].map((name) => [name, "PASS"])),
        graphVerdict: "READY",
        candidates: [{
          id: reviewInput.reviewTarget.candidate.id,
          verdict: "READY",
          executionLane: "AGENT",
          ...ticketReviewProjection({ parsed: parseChildTicket(reviewInput.reviewTarget.candidate.body) }),
        }],
        inputBinding,
      };
      if (fault === "reviewer-schema-error") review.schema = "pi-ticket-planning:admission-review:v999";
      if (fault === "reviewer-empty-axis") delete review.axes.candidateReadiness;
      let reviewOk = false;
      try { reviewOk = validateArtifact(review).ok; } catch { /* Expected for an injected unknown schema. */ }
      if (!reviewOk) throw codedError(fault === "reviewer-empty-axis" ? "REVIEWER_AXIS_EMPTY" : "REVIEWER_SCHEMA_INVALID");
      const sessionId = `parent-${context.runId}-${context.ordinal}`;
      const sessionFile = path.join(directory, "parent-session.jsonl");
      fs.writeFileSync(sessionFile, `${JSON.stringify({ id: sessionId, cwd: directory })}\n`, { mode: 0o600 });
      const output = JSON.stringify(review);
      return {
        review,
        dispatchBinding: buildReviewerDispatchBinding({
          parentSessionId: sessionId,
          childRunId: `run-${context.runId}-${context.ordinal}`,
          childSessionId: `child-${context.runId}-${context.ordinal}`,
          childFileDigest: sha("child-file"),
          inputDigest: inputBinding.inputDigest,
          outputDigest: sha(output),
          dispatchOrdinal: 1,
          totalDispatches: 1,
        }),
        sessionBinding: buildPlanningSessionBinding({
          target: `github:${context.repo}`,
          revision: source.revision,
          baseSha: source.baseSha,
          sessionId,
          sessionFile,
          provider: receipt.provider.name,
          model: receipt.provider.model,
          profileDigest: receipt.profileDigest,
        }),
        modelTurns: 1,
        toolCalls: 1,
      };
    },
  };
}

function deterministicHarnessRuntime(readiness) {
  return {
    async readiness() { return structuredClone(readiness); },
    async execute({ repo, issue }) {
      return { claimDetection: true, terminalOutcome: true, status: "done", evidenceDigests: [sha(`${repo}:${issue}:done`)] };
    },
  };
}

function successfulExecution({ installationRepo = REPO, installationStatus = 0, remote = "https://github.com/source/project.git\n", topics = ["ptp-e2e"], defaultBranch = "main" } = {}) {
  const issues = new Map();
  const comments = new Map();
  const repositoryLabels = new Set(["needs-triage", "ready-for-agent"]);
  const deletedLabels = new Set();
  let nextIssue = 1;
  let nextComment = 1;
  let writes = 0;
  const result = (value) => ({ status: 0, stdout: value === undefined ? "" : JSON.stringify(value), stderr: "" });
  const notFound = () => ({ status: 1, stdout: "", stderr: "HTTP 404" });
  const issueFor = (number) => {
    const issue = issues.get(Number(number));
    assert.ok(issue, `missing issue ${number}`);
    return issue;
  };

  return {
    get writes() { return writes; },
    get issues() { return issues; },
    run(command, args, options = {}) {
      if (command === "git") return { status: 0, stdout: remote, stderr: "" };
      assert.equal(command, "gh");
      const methodIndex = args.indexOf("--method");
      const method = methodIndex < 0 ? "GET" : args[methodIndex + 1];
      const endpoint = args.find((value) => value.startsWith("repos/") || value.startsWith("installation/"));
      const input = options.input ? JSON.parse(options.input) : undefined;
      if (method !== "GET") writes += 1;
      if (endpoint === "installation/repositories?per_page=100") return installationStatus === 0
        ? result([{ total_count: 1, repositories: [{ full_name: installationRepo }] }])
        : { status: installationStatus, stdout: "", stderr: "HTTP 403" };
      if (endpoint === undefined) return result({ login: "ptp-e2e[bot]" });
      if (endpoint === `repos/${REPO}`) return result({ has_issues: true, archived: false, disabled: false, default_branch: defaultBranch });
      if (endpoint === `repos/${REPO}/topics`) return result({ names: topics });
      const repositoryLabel = endpoint.match(new RegExp(`^repos/${REPO}/labels/(.+)$`));
      if (repositoryLabel) {
        const name = decodeURIComponent(repositoryLabel[1]);
        if (method === "DELETE") { repositoryLabels.delete(name); deletedLabels.add(name); return result(null); }
        if (deletedLabels.has(name)) return notFound();
        repositoryLabels.add(name);
        return result({ name });
      }
      if (endpoint === `repos/${REPO}/labels` && method === "POST") {
        repositoryLabels.add(input.name);
        return result({ name: input.name });
      }
      if (endpoint === `repos/${REPO}/issues` && method === "POST") {
        const issue = { ...input, labels: (input.labels ?? []).map((name) => ({ name })), assignees: [], number: nextIssue++, state: "open", user: { login: "ptp-e2e[bot]" }, performed_via_github_app: { slug: "ptp-e2e", permissions: { metadata: "read", issues: "write" } }, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
        issues.set(issue.number, issue);
        return result(issue);
      }
      const listed = endpoint.match(new RegExp(`^repos/${REPO}/issues\\?state=all&labels=([^&]+)&per_page=100$`));
      if (listed) {
        const label = decodeURIComponent(listed[1]);
        return result([[...issues.values()].filter((issue) => issue.labels.some(({ name }) => name === label))]);
      }
      const blockers = endpoint.match(new RegExp(`^repos/${REPO}/issues/(\\d+)/dependencies/blocked_by\\?per_page=100$`));
      if (blockers) return result([[]]);
      const commentPages = endpoint.match(new RegExp(`^repos/${REPO}/issues/(\\d+)/comments\\?per_page=100$`));
      if (commentPages) return result([[...comments.values()].filter((comment) => comment.issue === Number(commentPages[1]))]);
      const commentWrite = endpoint.match(new RegExp(`^repos/${REPO}/issues/(\\d+)/comments$`));
      if (commentWrite && method === "POST") {
        const comment = { id: nextComment++, issue: Number(commentWrite[1]), body: input.body, user: { login: "ptp-e2e[bot]" }, performed_via_github_app: { slug: "ptp-e2e" } };
        comments.set(comment.id, comment);
        return result(comment);
      }
      const commentRead = endpoint.match(new RegExp(`^repos/${REPO}/issues/comments/(\\d+)$`));
      if (commentRead) return result(comments.get(Number(commentRead[1])));
      const issueLabel = endpoint.match(new RegExp(`^repos/${REPO}/issues/(\\d+)/labels(?:/(.+))?$`));
      if (issueLabel) {
        const issue = issueFor(issueLabel[1]);
        if (method === "PUT") issue.labels = input.labels.map((name) => ({ name }));
        if (method === "POST") {
          const names = new Set(issue.labels.map(({ name }) => name));
          for (const name of input.labels) names.add(name);
          issue.labels = [...names].map((name) => ({ name }));
        }
        if (method === "DELETE") issue.labels = issue.labels.filter(({ name }) => name !== decodeURIComponent(issueLabel[2]));
        return result(issue.labels);
      }
      const issueRead = endpoint.match(new RegExp(`^repos/${REPO}/issues/(\\d+)$`));
      if (issueRead) {
        const issue = issueFor(issueRead[1]);
        if (method === "PATCH") {
          Object.assign(issue, input);
          if (input.assignees) issue.assignees = input.assignees.map((login) => ({ login }));
          issue.updated_at = new Date().toISOString();
        }
        return result(issue);
      }
      assert.fail(`unexpected endpoint ${endpoint}`);
    },
  };
}

function liveFixture(t, { harnessSupported = true, execution } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-live-adapter-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const observedAt = new Date(Date.now() - 1_000).toISOString();
  const readiness = harnessReadiness(REPO, BASE_SHA, { observedAt });
  let { receipt } = qualifiedCapability(REPO, BASE_SHA, readiness, observedAt);
  if (!harnessSupported) {
    receipt = buildCapabilityReceipt({
      ...receipt,
      capabilities: receipt.capabilities.map((item) => item.name === "harness.readiness"
        ? { ...item, status: "BLOCKED", reasonCode: "HARNESS_READINESS_FAILED", evidence: [] }
        : item),
    });
  }
  const receiptFile = path.join(directory, "capability.json");
  fs.writeFileSync(receiptFile, JSON.stringify(receipt), { mode: 0o600 });
  const authBinding = path.join(directory, "github-app-binding.json");
  writeGitHubAppCredentialBinding({ file: authBinding, token: "installation-token", appSlug: "ptp-e2e", installationId: "123", targetRepo: REPO });
  return {
    env: {
      GH_TOKEN: "installation-token",
      PTP_E2E_GITHUB_APP_BINDING: authBinding,
      PTP_CAPABILITY_RECEIPT: receiptFile,
      PTP_E2E_STATE: path.join(directory, "state.json"),
      PTP_E2E_SOURCE_PATH: ROOT,
      E2E_REPO: REPO,
      E2E_ALLOWLIST: REPO,
      E2E_ACTOR_ALLOWLIST: "ptp-e2e[bot]",
      E2E_REPO_TOPIC: "ptp-e2e",
      E2E_DEFAULT_BRANCH: "main",
      E2E_NO_PRODUCTION_REMOTE: "1",
    },
    execute: execution ?? successfulExecution(),
    readiness,
  };
}

test("preflight readiness permits setup before final harness evidence", async (t) => {
  const fixture = liveFixture(t);
  const adapter = createLiveAdapter({ env: fixture.env, execute: fixture.execute.run });
  const result = await adapter.preflight({ repo: REPO, runId: "reachability", resourceTag: "ptp-e2e:reachability" });

  assert.equal(result.harnessEvidence.status, "PARTIAL");
  assert.equal(result.harnessEvidence.final.claimDetection, false);
  assert.equal(result.harnessEvidence.final.terminalOutcome, false);
  assert.equal(result.setup.status, "PASS");
  assert.ok(fixture.execute.writes > 0);
});

test("target topic or default-branch mismatch is rejected before setup writes", async (t) => {
  for (const execution of [successfulExecution({ topics: ["wrong"] }), successfulExecution({ defaultBranch: "develop" })]) {
    const fixture = liveFixture(t, { execution });
    const result = await createLiveAdapter({ env: fixture.env, execute: execution.run }).preflight({ repo: REPO, runId: "guard-mismatch", resourceTag: "ptp-e2e:guard-mismatch" });
    assert.equal(result.setup.status, "NOT_RUN");
    assert.equal(execution.writes, 0);
  }
});

test("failed readiness and missing credentials perform no external writes", async (t) => {
  const readinessFailure = liveFixture(t, { harnessSupported: false });
  const blocked = await createLiveAdapter({ env: readinessFailure.env, execute: readinessFailure.execute.run }).preflight({ repo: REPO, runId: "blocked", resourceTag: "ptp-e2e:blocked" });
  assert.equal(blocked.setup.status, "NOT_RUN");
  assert.equal(readinessFailure.execute.writes, 0);

  const missingCredential = liveFixture(t);
  delete missingCredential.env.GH_TOKEN;
  await assert.rejects(() => createLiveAdapter({ env: missingCredential.env, execute: missingCredential.execute.run }).preflight({ repo: REPO, runId: "no-token", resourceTag: "ptp-e2e:no-token" }), /DISPOSABLE_APP_AUTH_TARGET_INVALID/);
  assert.equal(missingCredential.execute.writes, 0);
});

test("source token, wrong target, and production repository fail before the first write", async (t) => {
  const sourceToken = liveFixture(t);
  sourceToken.env.GH_TOKEN = "source-workflow-token";
  await assert.rejects(() => createLiveAdapter({ env: sourceToken.env, execute: sourceToken.execute.run }).preflight({ repo: REPO, runId: "source-token", resourceTag: "ptp-e2e:source-token" }), /DISPOSABLE_APP_TOKEN_BINDING_MISMATCH/);
  assert.equal(sourceToken.execute.writes, 0);
  for (const [name, execution] of [
    ["unscoped-token", successfulExecution({ installationStatus: 1 })],
    ["wrong-target", successfulExecution({ installationRepo: "acme/other" })],
    ["production", successfulExecution({ remote: `https://github.com/${REPO}.git\n` })],
  ]) {
    const fixture = liveFixture(t, { execution });
    await assert.rejects(() => createLiveAdapter({ env: fixture.env, execute: execution.run }).preflight({ repo: REPO, runId: name, resourceTag: `ptp-e2e:${name}` }));
    assert.equal(execution.writes, 0, name);
  }
});

test("GitHub App report evidence contains identity and target but never the token", async (t) => {
  const fixture = liveFixture(t);
  const result = await createLiveAdapter({ env: fixture.env, execute: fixture.execute.run }).preflight({ repo: REPO, runId: "auth-report", resourceTag: "ptp-e2e:auth-report" });
  assert.equal(result.githubAppEvidence.appSlug, "ptp-e2e");
  assert.equal(result.githubAppEvidence.targetRepo, REPO);
  assert.doesNotMatch(JSON.stringify(result.githubAppEvidence), /installation-token/);

  const forged = liveFixture(t);
  const binding = JSON.parse(fs.readFileSync(forged.env.PTP_E2E_GITHUB_APP_BINDING, "utf8"));
  binding.appSlug = "forged-app";
  fs.writeFileSync(forged.env.PTP_E2E_GITHUB_APP_BINDING, JSON.stringify(binding), { mode: 0o600 });
  await assert.rejects(() => createLiveAdapter({ env: forged.env, execute: forged.execute.run }).preflight({ repo: REPO, runId: "forged-app", resourceTag: "ptp-e2e:forged-app" }), /DISPOSABLE_APP_TOKEN_BINDING_MISMATCH/);
  assert.equal(forged.execute.writes, 0);
});

test("real Live Adapter path produces all 61 executions and converges final Harness evidence", { timeout: 120_000 }, async (t) => {
  const fixture = liveFixture(t);
  const runId = "real-adapter-61";
  Object.assign(fixture.env, {
    PI_TICKET_PLAN_E2E: "1",
    E2E_REPO: REPO,
    E2E_ALLOWLIST: REPO,
    E2E_CONFIRM_WRITE: expectedConfirmation({ repo: REPO, runId }),
    E2E_ACTOR_ALLOWLIST: "ptp-e2e[bot]",
    E2E_REPO_TOPIC: "ptp-e2e",
    E2E_DEFAULT_BRANCH: "main",
    E2E_NO_PRODUCTION_REMOTE: "1",
  });
  const adapter = createLiveAdapter({
    env: fixture.env,
    execute: fixture.execute.run,
    reviewerRuntime: deterministicReviewerRuntime(),
    harnessRuntime: deterministicHarnessRuntime(fixture.readiness),
    cleanupRecovery: async () => true,
  });
  const report = await runIntegrationE2E({ env: fixture.env, runId, adapter });

  assert.equal(report.metrics.executions, 61);
  assert.equal(report.scenarios.some(({ status }) => status === "UNTESTED"), false);
  assert.equal(report.scenarios.filter(({ scenarioId }) => scenarioId === "success").every(({ status }) => status === "PASS"), true, JSON.stringify(report.scenarios.filter(({ scenarioId }) => scenarioId === "success")));
  assert.equal(report.scenarios.filter(({ scenarioId }) => scenarioId === "named-session-missing").every(({ status }) => status === "EXPECTED_BLOCK"), true, JSON.stringify(report.scenarios.filter(({ scenarioId }) => scenarioId === "named-session-missing")));
  assert.equal(report.providerEvidence.namedSession, false);
  assert.equal(report.providerEvidence.exactIdFileResume, true);
  assert.equal(report.harnessEvidence.status, "PASS");
  assert.equal(report.harnessEvidence.final.claimDetection, true);
  assert.equal(report.harnessEvidence.final.terminalOutcome, true);
  assert.equal(report.status, "COMPLETE", JSON.stringify(report.scenarios.map(({ scenarioId, expectedExternalWrites, status, reasonCode, metrics }) => ({ scenarioId, expectedExternalWrites, status, reasonCode, actual: metrics.externalWrites }))));
});

test("an interrupted cleanup is recovered by another process from remote control state", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-cleanup-process-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const stateFile = path.join(directory, "state.json");
  const remoteFile = path.join(directory, "remote.json");
  const runId = "cleanup-process";
  const actor = "ptp-e2e[bot]";
  const startedAt = new Date().toISOString();
  const marker = `<!-- ptp-e2e:${runId}:cleanup-failure:1 -->`;
  const title = `[ptp-e2e:${runId}] cleanup-failure:1`;
  let state = createE2EState({ repo: REPO, runId, actor, startedAt });
  state = bindE2EControlIssue(state, 1);
  state = declareE2EResource(state, { marker, title });
  state = bindE2EResource(state, { marker, number: 2, actor, createdAt: startedAt });
  state = persistE2EState(state, stateFile);
  const remote = {
    label: true,
    issues: [
      { number: 1, title: e2eControlTitle(runId), body: e2eControlBody(state), state: "open", user: { login: actor }, created_at: startedAt, labels: [{ name: state.label }] },
      { number: 2, title, body: `${marker}\n\nprobe`, state: "open", user: { login: actor }, created_at: startedAt, labels: [{ name: state.label }] },
    ],
  };
  fs.writeFileSync(remoteFile, JSON.stringify(remote), { mode: 0o600 });
  const authFile = path.join(directory, "auth.json");
  writeGitHubAppCredentialBinding({ file: authFile, token: "installation-token", appSlug: "ptp-e2e", installationId: "123", targetRepo: REPO });
  const auth = verifyDisposableGitHubAppAuth({
    env: { GH_TOKEN: "installation-token", PTP_E2E_GITHUB_APP_BINDING: authFile, GITHUB_REPOSITORY: "acme/source" },
    repo: REPO,
    sourceRepo: "acme/source",
    api: () => [{ repositories: [{ full_name: REPO }] }],
  });
  const interruptedApi = (args) => {
    const endpoint = args.find((value) => value.startsWith("repos/"));
    if (args.includes("--method")) throw codedError("CLEANUP_INTERRUPTED");
    if (endpoint.includes("issues?state=all")) return [remote.issues];
    const number = Number(endpoint.match(/\/issues\/(\d+)$/)?.[1]);
    if (number) return remote.issues.find((issue) => issue.number === number);
    return { name: state.label };
  };
  assert.throws(() => cleanupPersistedE2E({ file: stateFile, repo: REPO, runId, actor, api: interruptedApi, githubAppAuthorization: auth.authorization, githubAppEvidence: auth.evidence }), /CLEANUP_INTERRUPTED/);
  fs.unlinkSync(stateFile);

  const moduleUrl = pathToFileURL(path.join(ROOT, "integration", "e2e-state.mjs")).href;
  const authModuleUrl = pathToFileURL(path.join(ROOT, "integration", "github-app-auth.mjs")).href;
  const script = `
    import fs from "node:fs";
    const [moduleUrl, authModuleUrl, stateFile, remoteFile, authFile, repo, runId, actor] = process.argv.slice(1);
    const { cleanupPersistedE2E } = await import(moduleUrl);
    const { verifyDisposableGitHubAppAuth } = await import(authModuleUrl);
    let remote = JSON.parse(fs.readFileSync(remoteFile, "utf8"));
    const save = () => fs.writeFileSync(remoteFile, JSON.stringify(remote));
    const api = (args, input, options = {}) => {
      const methodAt = args.indexOf("--method");
      const method = methodAt < 0 ? "GET" : args[methodAt + 1];
      const endpoint = args.find((value) => value.startsWith("repos/") || value.startsWith("search/"));
      if (args.includes("installation/repositories?per_page=100")) return [{ repositories: [{ full_name: repo }] }];
      if (endpoint.includes("issues?state=all")) return [remote.issues];
      const issueNumber = Number(endpoint.match(/\\/issues\\/(\\d+)$/)?.[1]);
      if (issueNumber) {
        const issue = remote.issues.find((value) => value.number === issueNumber);
        if (method === "PATCH") Object.assign(issue, input);
        save();
        return issue;
      }
      if (endpoint.includes("/labels/")) {
        if (method === "DELETE") { remote.label = false; save(); return null; }
        if (!remote.label && options.notFound) return null;
        return remote.label ? { name: endpoint.split("/").at(-1) } : null;
      }
      throw new Error("unexpected child endpoint " + endpoint);
    };
    const auth = verifyDisposableGitHubAppAuth({ env: { GH_TOKEN: "installation-token", PTP_E2E_GITHUB_APP_BINDING: authFile, GITHUB_REPOSITORY: "acme/source" }, repo, sourceRepo: "acme/source", api });
    const result = cleanupPersistedE2E({ file: stateFile, repo, runId, actor, api, githubAppAuthorization: auth.authorization, githubAppEvidence: auth.evidence });
    process.stdout.write(JSON.stringify(result));
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script, moduleUrl, authModuleUrl, stateFile, remoteFile, authFile, REPO, runId, actor], { encoding: "utf8", timeout: 30_000 });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(JSON.parse(child.stdout).status, "PASS");
  const recovered = JSON.parse(fs.readFileSync(remoteFile, "utf8"));
  assert.equal(recovered.label, false);
  assert.equal(recovered.issues.every(({ state: issueState }) => issueState === "closed"), true);
});
