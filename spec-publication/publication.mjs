import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { canonical, fingerprint, safeError } from "../admission/domain.mjs";
import { projectSpec } from "../protocol/projections.mjs";
import { githubIssueBindingDigest } from "../planning-case/bindings.mjs";
import {
  DELIVERY_GRAPH_MARKER,
  DELIVERY_GRAPH_MARKER_V1,
  DELIVERY_RELEASE_GRAPH_MARKER,
  EXECUTABLE_DELIVERY_SPEC_MARKER,
  ROADMAP_GRAPH_MARKER,
  ROADMAP_PARENT_MARKER,
} from "../scripts/check-delivery-graph.mjs";
import {
  createFactAttestation,
  evaluateMutation,
  producerAttestationSource,
  validateArtifact,
  validateFactAttestation,
} from "../protocol/kernel.mjs";

export const SPEC_PUBLICATION_PLAN_SCHEMA = "pi-ticket-planning:spec-publication-plan:v1";
const CONTROLLED_LABELS = new Set(["needs-triage", "needs-info", "ready-for-agent", "ready-for-human"]);
const CHECKS = ["sourceReadback", "policyAndAdrs", "tracker", "structure", "scenarios", "releaseSignals", "walkingSkeleton", "unresolvedDecisions"];
const SHA = /^[a-f0-9]{40,64}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const REQUIRED_SECTIONS = ["Source", "Problem statement", "Delivery outcome", "Behavioral scenarios", "Release signal mapping", "Walking skeleton target", "Decisions", "Verification strategy", "Constraints and dependencies", "Out of scope", "Unresolved decisions"];
const ACCEPTED_ADR_STATUS = /(?:Status\**:?\s*ACCEPTED|状态\**[：:]?\s*已接受)/iu;

function exactUtf8(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value ?? "");
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new Error("SPEC_DRAFT_NOT_UTF8"); }
}

function problem(code) { return { code }; }
export function digestBytes(value) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }

function exactContext(context) {
  if (!context || typeof context !== "object" || !/^PC-[A-Za-z0-9._-]{1,96}$/.test(context.caseId ?? "") || !REPO.test(context.repo ?? "")) throw new Error("INVALID_SPEC_PUBLICATION_CONTEXT");
  const source = context.source;
  if (!source || source.status !== "COMMITTED" || !source.identity || !source.revision || !source.baseRef || !SHA.test(source.baseSha ?? "")
    || !source.path || source.path.startsWith("/") || source.path.split(/[\\/]/u).includes("..")
    || !DIGEST.test(source.blobDigest ?? "") || !DIGEST.test(source.digest ?? "")) throw new Error("INVALID_SPEC_PUBLICATION_SOURCE");
  const policy = context.policy;
  if (!policy?.accepted || !policy.identity || !policy.path || policy.path.startsWith("/") || policy.path.split(/[\\/]/u).includes("..") || !DIGEST.test(policy.digest ?? "")) throw new Error("INVALID_SPEC_PUBLICATION_POLICY");
  const adrs = context.adrs;
  if (!Array.isArray(adrs) || adrs.some((adr) => !adr?.accepted || !adr.identity || !adr.path || adr.path.startsWith("/") || adr.path.split(/[\\/]/u).includes("..") || !DIGEST.test(adr.digest ?? ""))) throw new Error("INVALID_SPEC_PUBLICATION_ADRS");
  const tracker = context.tracker;
  if (tracker?.kind !== "GITHUB" || tracker.repo !== context.repo || tracker.configured !== true
    || !Array.isArray(tracker.labels) || !tracker.labels.includes("needs-triage")
    || !tracker.issueTracker?.path || tracker.issueTracker.path.startsWith("/") || tracker.issueTracker.path.split(/[\\/]/u).includes("..") || !DIGEST.test(tracker.issueTracker.digest ?? "")
    || !tracker.triageLabels?.path || tracker.triageLabels.path.startsWith("/") || tracker.triageLabels.path.split(/[\\/]/u).includes("..") || !DIGEST.test(tracker.triageLabels.digest ?? "")) throw new Error("INVALID_SPEC_PUBLICATION_TRACKER");
  return {
    caseId: context.caseId,
    repo: context.repo,
    source: structuredClone(source),
    policy: structuredClone(policy),
    adrs: structuredClone(adrs),
    tracker: structuredClone(tracker),
  };
}

function scenarios(draft) {
  const ids = [...draft.matchAll(/^### (S[1-9][0-9]*):/gmu)].map((match) => match[1]);
  if (ids.length === 0 || new Set(ids).size !== ids.length) throw new Error("SPEC_SCENARIO_CHECK_FAILED");
  return ids;
}

function section(draft, name, next) {
  const start = draft.indexOf(`## ${name}`);
  const end = next ? draft.indexOf(`## ${next}`, start + 1) : draft.length;
  return start >= 0 && end > start ? draft.slice(start, end) : "";
}

function deterministicChecks(context, draft, scenarioIds) {
  const positions = REQUIRED_SECTIONS.map((name) => [...draft.matchAll(new RegExp(`^## ${name}$`, "gmu"))].map((match) => match.index));
  if (positions.some((matches) => matches.length !== 1) || positions.some((matches, index) => index > 0 && matches[0] <= positions[index - 1][0])) throw new Error("SPEC_STRUCTURE_CHECK_FAILED");
  const source = section(draft, "Source", "Problem statement");
  const adrLabel = (adr) => path.basename(adr.path).match(/\d{4}/u)?.[0] ? `ADR-${path.basename(adr.path).match(/\d{4}/u)[0]}` : path.basename(adr.path);
  if (!source.includes(`${context.source.identity}/${context.source.revision}`) || !source.includes(context.source.baseSha)
    || !source.includes(path.basename(context.policy.path)) || context.adrs.some((adr) => !source.includes(adrLabel(adr)))) throw new Error("SPEC_SOURCE_CHECK_FAILED");
  const mapping = section(draft, "Release signal mapping", "Walking skeleton target");
  const skeleton = section(draft, "Walking skeleton target", "Decisions");
  if (scenarioIds.some((id) => !new RegExp(`\\b${id}\\b`, "u").test(mapping))) throw new Error("SPEC_RELEASE_SIGNAL_CHECK_FAILED");
  if (scenarioIds.some((id) => !new RegExp(`\\b${id}\\b`, "u").test(skeleton))) throw new Error("SPEC_WALKING_SKELETON_CHECK_FAILED");
  const unresolved = section(draft, "Unresolved decisions", null);
  if (!unresolved.trim() || /\bTBD\b|OPEN[ _-]?DECISION|待定|未决问题/iu.test(unresolved)) throw new Error("SPEC_UNRESOLVED_DECISION_CHECK_FAILED");
  return Object.fromEntries(CHECKS.map((name) => [name, "PASS"]));
}

function issueTitle(draft) {
  const title = /^# (.+)$/mu.exec(draft)?.[1]?.trim();
  if (!title || title.length > 256 || /[\u0000\r\n]/u.test(title)) throw new Error("SPEC_TITLE_INVALID");
  return title;
}

function bodyWithMarker(draft, marker) {
  if ([
    EXECUTABLE_DELIVERY_SPEC_MARKER,
    ROADMAP_PARENT_MARKER,
    ROADMAP_GRAPH_MARKER,
    DELIVERY_RELEASE_GRAPH_MARKER,
    DELIVERY_GRAPH_MARKER,
    DELIVERY_GRAPH_MARKER_V1,
  ].some((value) => draft.includes(value))) {
    throw new Error("SPEC_PARENT_KIND_MARKER_CONFLICT");
  }
  return `${draft}${draft.endsWith("\n") ? "\n" : "\n\n"}${EXECUTABLE_DELIVERY_SPEC_MARKER}\n${marker}\n`;
}

function artifactPath(value) {
  if (typeof value !== "string" || !path.isAbsolute(value) || /[\u0000\r\n]/u.test(value)) throw new Error("INVALID_SPEC_PUBLICATION_ARTIFACT_PATH");
  return path.resolve(value);
}

export function buildSpecPublicationPlan({ context, draftBytes, artifacts }) {
  const exact = exactContext(context);
  const draft = exactUtf8(draftBytes);
  if (!draft || draft.includes("\u0000")) throw new Error("SPEC_DRAFT_INVALID");
  if (!artifacts || !DIGEST.test(artifacts.contextDigest ?? "")) throw new Error("INVALID_SPEC_PUBLICATION_ARTIFACTS");
  const contextPath = artifactPath(artifacts.contextPath);
  const draftPath = artifactPath(artifacts.draftPath);
  const planPath = artifactPath(artifacts.planPath);
  if (new Set([contextPath, draftPath, planPath]).size !== 3) throw new Error("INVALID_SPEC_PUBLICATION_ARTIFACTS");
  const draftDigest = digestBytes(Buffer.from(draft, "utf8"));
  const markerId = fingerprint({ caseId: exact.caseId, repo: exact.repo, source: exact.source, draftDigest }).slice("sha256:".length);
  const marker = `<!-- pi-ticket-planning:spec-publication:v1:${markerId} -->`;
  const body = bodyWithMarker(draft, marker);
  const scenarioIds = scenarios(draft);
  const base = {
    schema: SPEC_PUBLICATION_PLAN_SCHEMA,
    ...exact,
    draftDigest,
    artifacts: {
      context: { path: contextPath, digest: artifacts.contextDigest, evidenceId: `spec-publication-context-${markerId.slice(0, 24)}` },
      draft: { path: draftPath, digest: draftDigest, evidenceId: `spec-publication-draft-${markerId.slice(0, 24)}` },
      plan: { path: planPath, evidenceId: `spec-publication-plan-${markerId.slice(0, 24)}` },
    },
    checks: deterministicChecks(exact, draft, scenarioIds),
    scenarioIds,
    issue: { title: issueTitle(draft), body, bodyDigest: digestBytes(Buffer.from(body, "utf8")), marker, labels: ["needs-triage"] },
    writeSet: [{ operation: "CREATE_ISSUE", resource: "DELIVERY_SPEC_PARENT", labels: ["needs-triage"] }],
  };
  return { ...base, planFingerprint: fingerprint(base) };
}

function git(repositoryPath, args, execute = spawnSync) {
  const run = execute("git", ["-C", repositoryPath, ...args], { encoding: null, timeout: 30_000, maxBuffer: 32 * 1024 * 1024 });
  if (run.status !== 0) throw new Error("SPEC_GIT_READBACK_FAILED");
  return Buffer.isBuffer(run.stdout) ? run.stdout : Buffer.from(run.stdout ?? "");
}

function githubRemoteRepo(remote) {
  const scp = /^(?:git@)?github\.com:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/u.exec(remote);
  if (scp) return scp[1];
  try {
    const parsed = new URL(remote);
    if (parsed.hostname.toLowerCase() !== "github.com") return null;
    return parsed.pathname.replace(/^\//u, "").replace(/\.git$/u, "");
  } catch {
    return null;
  }
}

export function verifySpecPublicationContext({ context, repositoryPath, adapter, execute = spawnSync }) {
  const exact = exactContext(context);
  const root = path.resolve(repositoryPath ?? "");
  const metadata = fs.lstatSync(root);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("SPEC_REPOSITORY_UNSAFE");
  const base = git(root, ["rev-parse", exact.source.baseRef], execute).toString("utf8").trim();
  if (base !== exact.source.baseSha) throw new Error("SPEC_SOURCE_BASE_DRIFT");
  const remote = git(root, ["config", "--get", "remote.origin.url"], execute).toString("utf8").trim();
  if (githubRemoteRepo(remote) !== exact.repo) throw new Error("SPEC_REPOSITORY_IDENTITY_DRIFT");
  const blob = (source) => git(root, ["show", `${exact.source.baseSha}:${source.path}`], execute);
  if (digestBytes(blob(exact.source)) !== exact.source.blobDigest) throw new Error("SPEC_SOURCE_BLOB_DRIFT");
  if (digestBytes(blob(exact.policy)) !== exact.policy.digest) throw new Error("SPEC_POLICY_DRIFT");
  for (const adr of exact.adrs) {
    const bytes = blob(adr);
    if (digestBytes(bytes) !== adr.digest || !ACCEPTED_ADR_STATUS.test(bytes.toString("utf8"))) throw new Error("SPEC_ADR_DRIFT");
  }
  const issueTracker = blob(exact.tracker.issueTracker);
  const triageLabels = blob(exact.tracker.triageLabels);
  if (digestBytes(issueTracker) !== exact.tracker.issueTracker.digest || !/Issue tracker:\s*GitHub/iu.test(issueTracker.toString("utf8"))) throw new Error("SPEC_TRACKER_CONFIG_DRIFT");
  if (digestBytes(triageLabels) !== exact.tracker.triageLabels.digest || !/needs-triage/u.test(triageLabels.toString("utf8"))) throw new Error("SPEC_TRACKER_LABEL_CONFIG_DRIFT");
  if (!adapter?.hasLabel || adapter.hasLabel("needs-triage") !== true) throw new Error("SPEC_TRACKER_LABEL_MISSING");
  return exact;
}

export function validateSpecPublicationPlan(plan) {
  const problems = [];
  let structural;
  try { structural = validateArtifact(plan); } catch { structural = { ok: false, problems: [problem("INVALID_SPEC_PUBLICATION_PLAN")] }; }
  if (!structural.ok) problems.push(...structural.problems);
  if (plan?.planFingerprint !== fingerprint((({ planFingerprint, ...body }) => body)(plan ?? {}))) problems.push(problem("SPEC_PUBLICATION_FINGERPRINT_MISMATCH"));
  if (plan?.draftDigest && plan?.issue?.bodyDigest !== digestBytes(Buffer.from(plan.issue.body ?? "", "utf8"))) problems.push(problem("SPEC_PUBLICATION_BODY_DIGEST_MISMATCH"));
  if (plan?.issue?.marker && !plan.issue.body?.endsWith(`${plan.issue.marker}\n`)) problems.push(problem("SPEC_PUBLICATION_MARKER_MISMATCH"));
  if (JSON.stringify(plan?.issue?.labels) !== JSON.stringify(["needs-triage"]) || JSON.stringify(plan?.writeSet) !== JSON.stringify([{ operation: "CREATE_ISSUE", resource: "DELIVERY_SPEC_PARENT", labels: ["needs-triage"] }])) problems.push(problem("SPEC_PUBLICATION_WRITE_SET_INVALID"));
  return { ok: problems.length === 0, problems };
}

function regularBytes(file) {
  const metadata = fs.lstatSync(file);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) throw new Error("SPEC_PUBLICATION_ARTIFACT_UNSAFE");
  return fs.readFileSync(file);
}

function exactArtifactFiles(plan) {
  const contextBytes = regularBytes(plan.artifacts.context.path);
  const draftBytes = regularBytes(plan.artifacts.draft.path);
  const planBytes = regularBytes(plan.artifacts.plan.path);
  if (digestBytes(contextBytes) !== plan.artifacts.context.digest || digestBytes(draftBytes) !== plan.artifacts.draft.digest) throw new Error("SPEC_PUBLICATION_ARTIFACT_DRIFT");
  let context;
  let readPlan;
  try { context = JSON.parse(contextBytes); readPlan = JSON.parse(planBytes); } catch { throw new Error("SPEC_PUBLICATION_ARTIFACT_INVALID"); }
  if (!same(readPlan, plan) || !validateSpecPublicationPlan(readPlan).ok) throw new Error("SPEC_PUBLICATION_PLAN_DRIFT");
  return { context, contextBytes, draftBytes, planBytes };
}

function artifactEvidence(plan, files, observedAt) {
  return [
    { id: plan.artifacts.context.evidenceId, kind: "spec-publication-context", ref: plan.artifacts.context.path, digest: digestBytes(files.contextBytes), observedAt },
    { id: plan.artifacts.draft.evidenceId, kind: "spec-publication-draft", ref: plan.artifacts.draft.path, digest: digestBytes(files.draftBytes), observedAt },
    { id: plan.artifacts.plan.evidenceId, kind: "spec-publication-plan", ref: plan.artifacts.plan.path, digest: digestBytes(files.planBytes), observedAt },
  ];
}

export function recordSpecPublicationArtifacts({ plan, store, clock = () => new Date().toISOString() }) {
  const checked = validateSpecPublicationPlan(plan);
  if (!checked.ok) throw new Error(checked.problems[0]?.code ?? "INVALID_SPEC_PUBLICATION_PLAN");
  const files = exactArtifactFiles(plan);
  const target = `github:${plan.repo}`;
  let snapshot = store.get({ caseId: plan.caseId, target });
  for (const evidence of artifactEvidence(plan, files, clock())) {
    const existing = snapshot.evidence.find(({ id }) => id === evidence.id);
    if (existing && (existing.kind !== evidence.kind || existing.ref !== evidence.ref || existing.digest !== evidence.digest)) throw new Error("SPEC_PUBLICATION_EVIDENCE_CONFLICT");
    if (!existing) {
      store.record({ caseId: plan.caseId, target, type: "EVIDENCE_RECORDED", data: { evidence } });
      snapshot = store.get({ caseId: plan.caseId, target });
    }
  }
  return artifactEvidence(plan, files, snapshot.evidence.find(({ id }) => id === plan.artifacts.plan.evidenceId)?.observedAt ?? clock());
}

function loadRecordedPublicationInputs(plan, snapshot) {
  const files = exactArtifactFiles(plan);
  const expected = artifactEvidence(plan, files, null);
  for (const evidence of expected) {
    const recorded = snapshot.evidence.find(({ id }) => id === evidence.id);
    if (!recorded || recorded.kind !== evidence.kind || recorded.ref !== evidence.ref || recorded.digest !== evidence.digest) throw new Error("SPEC_PUBLICATION_EVIDENCE_MISSING");
  }
  return { context: files.context, draftBytes: files.draftBytes };
}

export function verifyRecordedSpecPublicationArtifacts({ plan, store }) {
  const snapshot = store.get({ caseId: plan.caseId, target: `github:${plan.repo}` });
  loadRecordedPublicationInputs(plan, snapshot);
  return true;
}

export function createSpecPublicationApproval({ plan, correlationId, observedAt }) {
  const checked = validateSpecPublicationPlan(plan);
  if (!checked.ok || !/^C-[A-Za-z0-9._-]+$/.test(correlationId ?? "") || !Number.isFinite(Date.parse(observedAt))) throw new Error("INVALID_SPEC_PUBLICATION_APPROVAL_INPUT");
  return createFactAttestation({
    id: `F-human-spec-publication-${correlationId.slice(2)}`,
    fact: "human.specPublication",
    value: true,
    subject: { target: `github:${plan.repo}`, kind: "spec-publication-plan", id: plan.planFingerprint, revision: plan.source.revision, digest: plan.planFingerprint },
    source: producerAttestationSource("spec-publication-operator", "spec-publication-cli"),
    observedAt,
    expiresAt: new Date(Date.parse(observedAt) + 60 * 60 * 1000).toISOString(),
    evidence: { kind: "operator", ref: `case:${plan.caseId}:spec-publication.apply`, digest: plan.planFingerprint },
  });
}

function normalizedIssue(issue) {
  if (!issue) return null;
  return {
    number: String(issue.number),
    title: issue.title ?? "",
    body: issue.body ?? "",
    labels: (issue.labels ?? []).map((label) => typeof label === "string" ? label : label.name),
    state: String(issue.state ?? "").toLowerCase(),
    updatedAt: issue.updatedAt ?? issue.updated_at,
  };
}

export function verifySpecIssueExactReadback({ issue, plan }) {
  issue = normalizedIssue(issue);
  if (!issue || !/^[1-9][0-9]*$/.test(issue.number) || !issue.updatedAt || issue.state !== "open" || issue.title !== plan.issue.title || issue.body !== plan.issue.body) return [problem("SPEC_ISSUE_READBACK_MISMATCH")];
  return [];
}

export function verifySpecNeedsTriageOnly({ issue }) {
  issue = normalizedIssue(issue);
  const controlled = issue?.labels.filter((label) => CONTROLLED_LABELS.has(label)).sort() ?? [];
  return JSON.stringify(controlled) === JSON.stringify(["needs-triage"]) ? [] : [problem("SPEC_ISSUE_LABEL_MISMATCH")];
}

function runGhJson(args, input) {
  const run = spawnSync("gh", args, { encoding: "utf8", input: input === undefined ? undefined : JSON.stringify(input), timeout: 30_000, maxBuffer: 32 * 1024 * 1024 });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(safeError(run.stderr.trim()) || `gh exited ${run.status}`);
  return run.stdout.trim() ? JSON.parse(run.stdout) : null;
}

export function createGitHubSpecPublicationAdapter({ repo, runJson = runGhJson }) {
  if (!REPO.test(repo ?? "")) throw new Error("INVALID_SPEC_PUBLICATION_REPO");
  const read = (number) => normalizedIssue(runJson(["api", `repos/${repo}/issues/${number}`]));
  return {
    hasLabel(name) {
      const label = runJson(["api", `repos/${repo}/labels/${encodeURIComponent(name)}`]);
      return label?.name === name;
    },
    findByMarker(marker) {
      const pages = runJson(["api", "--paginate", "--slurp", `repos/${repo}/issues?state=all&per_page=100`]);
      if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) throw new Error("SPEC_ISSUE_LIST_INVALID");
      return pages.flat().filter((issue) => !issue.pull_request && typeof issue.body === "string" && issue.body.includes(marker)).map(normalizedIssue);
    },
    createIssue({ title, body, labels }) {
      return normalizedIssue(runJson(["api", "--method", "POST", `repos/${repo}/issues`, "--input", "-"], { title, body, labels }));
    },
    readIssue: read,
  };
}

function matchingFact(snapshot, name, subject, now) {
  const matches = snapshot.facts.filter((fact) => fact.fact === name && Object.entries(subject).every(([key, value]) => fact.subject?.[key] === value));
  if (matches.length === 0 || matches.some((fact) => fact.value !== true || !validateFactAttestation(fact, { now }).ok)) throw new Error(`SPEC_PUBLICATION_FACT_INVALID:${name}`);
  return matches.at(-1);
}

function same(left, right) { return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right)); }

function assertCaseReleaseBinding(snapshot, plan, target) {
  const release = snapshot.bindings.release;
  if (release?.schema !== "pi-ticket-planning:release-projection:v1" || release.target !== target || release.id !== plan.source.identity
    || release.revision !== plan.source.revision || release.status !== "COMMITTED" || release.digest !== plan.source.digest
    || release.source?.ref !== plan.source.baseRef || release.source?.baseSha !== plan.source.baseSha
    || release.source?.path !== plan.source.path || release.source?.blobDigest !== plan.source.blobDigest) throw new Error("SPEC_PUBLICATION_CASE_SOURCE_MISMATCH");
}

export function createSpecAcceptanceReceipt({ plan, issue, approval }) {
  issue = normalizedIssue(issue);
  const body = {
    schema: "pi-ticket-planning:spec-acceptance:v1",
    parent: { number: Number(issue.number), title: issue.title, bodyHash: plan.issue.bodyDigest },
    source: { baseSha: plan.source.baseSha, specContentHash: plan.draftDigest },
    decision: { caseId: plan.caseId, approvalId: approval.id, acceptedAt: approval.observedAt },
  };
  const receipt = { ...body, digest: fingerprint(body) };
  if (!validateArtifact(receipt).ok) throw new Error("INVALID_SPEC_ACCEPTANCE_RECEIPT");
  return receipt;
}

function specProjection(plan, issue, approval) {
  issue = normalizedIssue(issue);
  const ref = `repos/${plan.repo}/issues/${issue.number}`;
  return {
    ...projectSpec({
    target: `github:${plan.repo}`,
    id: issue.number,
    revision: plan.source.revision,
    baseSha: plan.source.baseSha,
    source: { target: `github:${plan.repo}`, kind: "github-issue", id: issue.number, revision: issue.updatedAt, digest: plan.issue.bodyDigest },
    scenarioIds: plan.scenarioIds,
      bytes: plan.issue.body,
      acceptance: createSpecAcceptanceReceipt({ plan, issue, approval }),
    }),
    verification: { kind: "GITHUB_ISSUE", ref, digest: githubIssueBindingDigest(ref, issue) },
  };
}

export function applySpecPublication({ plan, current, preflight, adapter, store, caseId, approvalId, expectedFingerprint, clock = () => new Date().toISOString() }) {
  const checked = validateSpecPublicationPlan(plan);
  if (!checked.ok) throw new Error(checked.problems[0]?.code ?? "INVALID_SPEC_PUBLICATION_PLAN");
  if (expectedFingerprint !== plan.planFingerprint) throw new Error("EXPECTED_FINGERPRINT_MISMATCH");
  if (caseId !== plan.caseId) throw new Error("SPEC_PUBLICATION_CASE_MISMATCH");
  if (typeof preflight !== "function") throw new Error("SPEC_PUBLICATION_PREFLIGHT_REQUIRED");
  const now = clock();
  const target = `github:${plan.repo}`;
  const resumed = store.resume({ caseId, target });
  if (resumed.mode !== "ONLINE" || resumed.mutationScopes?.planningPublication?.allowed !== true) throw new Error("SPEC_PUBLICATION_RESUME_REQUIRED");
  let snapshot = store.get({ caseId, target });
  assertCaseReleaseBinding(snapshot, plan, target);
  const recorded = loadRecordedPublicationInputs(plan, snapshot);
  if (current && (!same(current.context, recorded.context) || !Buffer.from(current.draftBytes).equals(recorded.draftBytes))) throw new Error("SPEC_PUBLICATION_DRIFT");
  const verifiedContext = preflight({ context: recorded.context, plan });
  const rebuilt = buildSpecPublicationPlan({
    context: verifiedContext,
    draftBytes: recorded.draftBytes,
    artifacts: { contextPath: plan.artifacts.context.path, contextDigest: plan.artifacts.context.digest, draftPath: plan.artifacts.draft.path, planPath: plan.artifacts.plan.path },
  });
  if (rebuilt.planFingerprint !== plan.planFingerprint) throw new Error("SPEC_PUBLICATION_DRIFT");
  const approvals = [...snapshot.approvals.pending, ...snapshot.approvals.consumed];
  const approval = approvals.find(({ id }) => id === approvalId);
  const matches = approvals.filter((item) => item.fact === "human.specPublication" && item.subject?.digest === plan.planFingerprint);
  const approvalSubject = { target, kind: "spec-publication-plan", id: plan.planFingerprint, revision: plan.source.revision, digest: plan.planFingerprint };
  if (!approval || matches.length !== 1 || approval.fact !== "human.specPublication" || !same(approval.subject, approvalSubject)
    || !validateFactAttestation(approval).ok) throw new Error("INVALID_SPEC_PUBLICATION_APPROVAL");
  const preAccepted = snapshot.checkpoint.stage === "SPEC" && snapshot.checkpoint.verdict === "SPEC_ACCEPTED";
  const preInProgress = snapshot.checkpoint.stage === "SPEC" && snapshot.checkpoint.verdict === "SPEC_IN_PROGRESS";
  if ((!preAccepted && !preInProgress) || snapshot.checkpoint.subject?.target !== target || snapshot.checkpoint.subject?.id !== plan.source.identity
    || snapshot.checkpoint.subject?.revision !== plan.source.revision || snapshot.checkpoint.subject?.digest !== plan.source.digest) throw new Error("INVALID_SPEC_PUBLICATION_CHECKPOINT");
  if (snapshot.approvals.consumed.some(({ id }) => id === approvalId) && !preAccepted) throw new Error("SPEC_PUBLICATION_APPROVAL_CONFLICT");
  if (snapshot.approvals.pending.some(({ id }) => id === approvalId) && !validateFactAttestation(approval, { now }).ok) throw new Error("INVALID_SPEC_PUBLICATION_APPROVAL");
  if (!adapter?.findByMarker || !adapter?.createIssue || !adapter?.readIssue) throw new Error("SPEC_PUBLICATION_ADAPTER_REQUIRED");

  let pendingTransition = null;
  if (preInProgress) {
    const mutationId = `spec-publication-apply:${plan.planFingerprint}`;
    const baseFacts = ["human.commitment", "release.persisted", "release.accepted", "git.deliveryBase"].map((name) => matchingFact(snapshot, name, snapshot.checkpoint.subject, now));
    const policy = createFactAttestation({ id: `F-policy-accepted-${plan.planFingerprint.slice(-12)}`, fact: "policy.accepted", value: true, subject: snapshot.checkpoint.subject, source: producerAttestationSource("git-policy-check", "git-policy-check"), observedAt: now, expiresAt: null, evidence: { kind: "artifact", ref: plan.policy.identity, digest: plan.policy.digest } });
    const validated = createFactAttestation({ id: `F-spec-validated-${plan.planFingerprint.slice(-12)}`, fact: "spec.validated", value: true, subject: snapshot.checkpoint.subject, source: producerAttestationSource("spec-publication-check", "spec-publication-plan"), observedAt: now, expiresAt: null, mutationId, evidence: { kind: "artifact", ref: plan.planFingerprint, digest: plan.issue.bodyDigest } });
    const proposed = { schema: "pi-ticket-planning:checkpoint:v2", lane: "DELIVERY", stage: "SPEC", verdict: "SPEC_ACCEPTED", subject: snapshot.checkpoint.subject };
    const facts = [...baseFacts, policy, validated, approval];
    const evaluated = evaluateMutation({ mutation: "specPublication.apply", actor: "spec-publication-apply", transition: { current: snapshot.checkpoint, proposed, approvalSubject }, facts, consumedApprovalIds: snapshot.approvals.consumed.map(({ id }) => id), consumedFactIds: snapshot.consumedFactIds, mutationId, now });
    if (!evaluated.allowed) throw new Error(evaluated.problems[0]?.code ?? "SPEC_PUBLICATION_NOT_ALLOWED");
    pendingTransition = { mutationId, baseFacts, policy, validated, proposed };
  }

  const found = adapter.findByMarker(plan.issue.marker);
  if (!Array.isArray(found) || found.length > 1) throw new Error("SPEC_PUBLICATION_DUPLICATE_OR_INVALID");
  let issue = found[0] ?? null;
  if (!issue && (preAccepted || snapshot.bindings.spec !== null)) throw new Error("SPEC_PUBLICATION_OUTPUT_MISSING");
  if (!issue) {
    if (!validateFactAttestation(approval, { now: clock() }).ok) throw new Error("INVALID_SPEC_PUBLICATION_APPROVAL");
    issue = adapter.createIssue({ title: plan.issue.title, body: plan.issue.body, labels: plan.issue.labels });
  }
  issue = adapter.readIssue(issue?.number);
  const issueProblems = [...verifySpecIssueExactReadback({ issue, plan }), ...verifySpecNeedsTriageOnly({ issue })];
  if (issueProblems.length) throw new Error(issueProblems[0].code);
  const projection = specProjection(plan, issue, approval);

  snapshot = store.get({ caseId, target });
  if (snapshot.bindings.spec === null) store.bind({ caseId, target, name: "spec", binding: projection });
  else if (!same(snapshot.bindings.spec, projection)) throw new Error("SPEC_PUBLICATION_BINDING_CONFLICT");
  snapshot = store.get({ caseId, target });

  const accepted = snapshot.checkpoint.stage === "SPEC" && snapshot.checkpoint.verdict === "SPEC_ACCEPTED"
    && snapshot.checkpoint.subject?.target === target && snapshot.checkpoint.subject?.id === plan.source.identity
    && snapshot.checkpoint.subject?.revision === plan.source.revision && snapshot.checkpoint.subject?.digest === plan.source.digest;
  if (!accepted) {
    if (snapshot.checkpoint.stage !== "SPEC" || snapshot.checkpoint.verdict !== "SPEC_IN_PROGRESS"
      || snapshot.checkpoint.subject?.target !== target || snapshot.checkpoint.subject?.id !== plan.source.identity
      || snapshot.checkpoint.subject?.revision !== plan.source.revision || snapshot.checkpoint.subject?.digest !== plan.source.digest) throw new Error("INVALID_SPEC_PUBLICATION_CHECKPOINT");
    if (!pendingTransition) throw new Error("SPEC_PUBLICATION_PREFLIGHT_MISSING");
    const persisted = createFactAttestation({ id: `F-spec-persisted-${plan.planFingerprint.slice(-12)}`, fact: "spec.persisted", value: true, subject: snapshot.checkpoint.subject, source: producerAttestationSource("spec-tracker-api", "spec-publication-github-adapter"), observedAt: now, expiresAt: null, evidence: { kind: "tracker", ref: `github:${plan.repo}#${normalizedIssue(issue).number}`, digest: plan.issue.bodyDigest } });
    store.transition({ caseId, target, checkpoint: pendingTransition.proposed, facts: [...pendingTransition.baseFacts, pendingTransition.policy, pendingTransition.validated, persisted], mutationId: pendingTransition.mutationId, nextAction: { kind: "SKILL", command: null, skill: "to-tickets", requiredInputs: ["accepted Delivery Spec"], blockingFacts: [], contextRoute: "DELIVERY/SPEC/SPEC_ACCEPTED", reasonCode: "DELIVERY_SPEC_READY_FOR_TICKETS" } });
  }

  snapshot = store.get({ caseId, target });
  const finalIssue = adapter.readIssue(issue.number);
  const preConsume = [
    ...verifySpecIssueExactReadback({ issue: finalIssue, plan }),
    ...verifySpecNeedsTriageOnly({ issue: finalIssue }),
    snapshot.checkpoint.verdict === "SPEC_ACCEPTED" && same(snapshot.bindings.spec, projection) ? null : problem("SPEC_PUBLICATION_CASE_MISMATCH"),
  ].filter(Boolean);
  if (preConsume.length) throw new Error(preConsume[0].code);
  if (snapshot.approvals.pending.some(({ id }) => id === approvalId)) store.consumeApproval({ caseId, target, approvalId });
  const final = store.get({ caseId, target });
  if (final.approvals.consumed.filter(({ id }) => id === approvalId).length !== 1 || final.approvals.pending.some(({ id }) => id === approvalId)) throw new Error("APPROVAL_NOT_SINGLE_CONSUMED");
  return { status: "COMPLETE", issue: normalizedIssue(issue), spec: projection, acceptance: projection.acceptance, planFingerprint: plan.planFingerprint };
}
