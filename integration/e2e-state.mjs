import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { assertDisposableGitHubAppAuthorization } from "./github-app-auth.mjs";

const MAX_STATE_BYTES = 64 * 1024;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`;
}

function stateProjection(value) {
  const { digest: _digest, ...projection } = value;
  return projection;
}

export function e2eLabel(runId) {
  return `ptp-e2e-${createHash("sha256").update(runId).digest("hex").slice(0, 20)}`;
}

export function recoveryCommand(repo, runId) {
  return `npm run e2e:cleanup -- --state "$PTP_E2E_STATE" --repo ${repo} --run-id ${runId}`;
}

export function validateE2ECleanupTarget({ env, actor, repository, topics }) {
  const actors = new Set((env.E2E_ACTOR_ALLOWLIST ?? "").split(",").map((value) => value.trim()).filter(Boolean));
  const allowlist = new Set((env.E2E_ALLOWLIST ?? "").split(",").map((value) => value.trim()).filter(Boolean));
  const repo = env.E2E_REPO;
  if (!allowlist.has(repo) || !actors.has(actor) || env.E2E_NO_PRODUCTION_REMOTE !== "1"
    || repo === env.GITHUB_REPOSITORY || env.E2E_REPO_TOPIC === undefined || !topics.includes(env.E2E_REPO_TOPIC)
    || repository?.default_branch !== env.E2E_DEFAULT_BRANCH || !repository?.has_issues || repository.archived || repository.disabled) {
    throw new Error("E2E_CLEANUP_TARGET_GUARD_FAILED");
  }
  return true;
}

export function e2eControlMarker(runId) {
  return `<!-- ptp-e2e-control:${runId} -->`;
}

export function e2eControlTitle(runId) {
  return `[ptp-e2e:${runId}] CONTROL`;
}

export function validateE2EState(value) {
  const keys = ["actor", "cleanupAt", "controlIssue", "digest", "label", "repo", "resourceTag", "resources", "runId", "schema", "startedAt", "status"].sort().join("\n");
  if (!value || Object.keys(value).sort().join("\n") !== keys
    || value.schema !== "pi-ticket-planning:e2e-state:v1"
    || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.repo ?? "")
    || typeof value.runId !== "string" || !value.runId
    || value.resourceTag !== `ptp-e2e:${value.runId}` || value.label !== e2eLabel(value.runId)
    || typeof value.actor !== "string" || !value.actor
    || !Number.isFinite(Date.parse(value.startedAt)) || !["ACTIVE", "CLEANUP_COMMITTING", "COMPLETE"].includes(value.status)
    || (value.controlIssue !== null && (!Number.isInteger(value.controlIssue) || value.controlIssue < 1))
    || (value.status !== "ACTIVE") !== Number.isFinite(Date.parse(value.cleanupAt))
    || !Array.isArray(value.resources) || value.resources.length > 1000
    || value.digest !== digest(stateProjection(value))) throw new Error("E2E_STATE_INVALID");
  const markers = new Set();
  const numbers = new Set();
  for (const resource of value.resources) {
    if (!resource || Object.keys(resource).sort().join("\n") !== ["actor", "createdAt", "marker", "number", "titles"].sort().join("\n")
      || typeof resource.marker !== "string" || !resource.marker.startsWith(`<!-- ${value.resourceTag}:`)
      || !Array.isArray(resource.titles) || resource.titles.length === 0 || new Set(resource.titles).size !== resource.titles.length
      || resource.titles.some((title) => typeof title !== "string" || !title)
      || (resource.number !== null && (!Number.isInteger(resource.number) || resource.number < 1))
      || (resource.number === null ? resource.actor !== null || resource.createdAt !== null : typeof resource.actor !== "string" || !Number.isFinite(Date.parse(resource.createdAt)))) throw new Error("E2E_STATE_RESOURCE_INVALID");
    if (markers.has(resource.marker) || resource.number !== null && numbers.has(resource.number)) throw new Error("E2E_STATE_RESOURCE_DUPLICATE");
    markers.add(resource.marker);
    if (resource.number !== null) numbers.add(resource.number);
  }
  return value;
}

function statePath(file) {
  if (!path.isAbsolute(file ?? "")) throw new Error("E2E_STATE_PATH_INVALID");
  const parent = fs.realpathSync(path.dirname(path.resolve(file)));
  const metadata = fs.lstatSync(parent);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o022)) throw new Error("E2E_STATE_DIRECTORY_UNSAFE");
  return path.join(parent, path.basename(file));
}

export function loadE2EState(file) {
  const resolved = statePath(file);
  const metadata = fs.lstatSync(resolved);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || (metadata.mode & 0o777) !== 0o600 || metadata.size > MAX_STATE_BYTES) throw new Error("E2E_STATE_FILE_UNSAFE");
  return validateE2EState(JSON.parse(fs.readFileSync(resolved, "utf8")));
}

export function persistE2EState(value, file) {
  const resolved = statePath(file);
  const next = { ...structuredClone(value), digest: digest(stateProjection(value)) };
  validateE2EState(next);
  if (Buffer.byteLength(JSON.stringify(next)) > MAX_STATE_BYTES) throw new Error("E2E_STATE_TOO_LARGE");
  if (fs.existsSync(resolved)) {
    const current = loadE2EState(resolved);
    if (current.repo !== next.repo || current.runId !== next.runId || current.status === "COMPLETE" && next.status !== "COMPLETE") throw new Error("E2E_STATE_DRIFT");
  }
  const temporary = `${resolved}.tmp-${process.pid}`;
  const descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(next, null, 2)}\n`);
    fs.fsyncSync(descriptor);
  } finally { fs.closeSync(descriptor); }
  fs.renameSync(temporary, resolved);
  const directory = fs.openSync(path.dirname(resolved), fs.constants.O_RDONLY);
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  return next;
}

export function createE2EState({ repo, runId, actor, startedAt = new Date().toISOString() }) {
  const state = { schema: "pi-ticket-planning:e2e-state:v1", repo, runId, resourceTag: `ptp-e2e:${runId}`, label: e2eLabel(runId), actor, startedAt, status: "ACTIVE", cleanupAt: null, controlIssue: null, resources: [] };
  return { ...state, digest: digest(state) };
}

export function bindE2EControlIssue(state, number) {
  return { ...state, controlIssue: number };
}

export function e2eControlBody(state) {
  validateE2EState(state);
  return `${e2eControlMarker(state.runId)}\n\n\`\`\`json\n${JSON.stringify(state, null, 2)}\n\`\`\``;
}

function stateFromControlIssue(issue, { repo, runId, actor }) {
  const marker = e2eControlMarker(runId);
  const prefix = `${marker}\n\n\`\`\`json\n`;
  const suffix = "\n```";
  if (issue?.title !== e2eControlTitle(runId) || issue?.user?.login !== actor || !issue.body?.startsWith(prefix) || !issue.body.endsWith(suffix)) throw new Error("E2E_CONTROL_ISSUE_INVALID");
  const json = issue.body.slice(prefix.length, -suffix.length);
  const state = validateE2EState(JSON.parse(json));
  if (state.repo !== repo || state.runId !== runId || state.actor !== actor || state.controlIssue !== null && state.controlIssue !== issue.number) throw new Error("E2E_CONTROL_STATE_MISMATCH");
  return state.controlIssue === null ? bindE2EControlIssue(state, issue.number) : state;
}

export function persistRemoteE2EState(state, api) {
  if (!Number.isInteger(state.controlIssue)) throw new Error("E2E_CONTROL_ISSUE_MISSING");
  const body = e2eControlBody(state);
  api(["api", "--method", "PATCH", `repos/${state.repo}/issues/${state.controlIssue}`, "--input", "-"], { body });
  const readback = api(["api", `repos/${state.repo}/issues/${state.controlIssue}`]);
  if (readback.body !== body || readback.title !== e2eControlTitle(state.runId) || readback.user?.login !== state.actor) throw new Error("E2E_CONTROL_READBACK_FAILED");
  return state;
}

export function recoverRemoteE2EState({ repo, runId, actor, api }) {
  const marker = e2eControlMarker(runId);
  const label = e2eLabel(runId);
  const pages = api(["api", "--paginate", "--slurp", `repos/${repo}/issues?state=all&labels=${encodeURIComponent(label)}&per_page=100`]) ?? [];
  let candidates = pages.flat().filter((issue) => issue.body?.startsWith(marker) === true);
  if (candidates.length === 0) {
    const query = encodeURIComponent(`repo:${repo} is:issue in:body "${marker}"`);
    candidates = (api(["api", `search/issues?q=${query}&per_page=10`])?.items ?? []).filter((issue) => issue.body?.startsWith(marker) === true);
  }
  if (candidates.length === 0) return null;
  if (candidates.length !== 1) throw new Error("E2E_CONTROL_ISSUE_AMBIGUOUS");
  return stateFromControlIssue(candidates[0], { repo, runId, actor });
}

export function declareE2EResource(state, { marker, title }) {
  if (state.resources.some((resource) => resource.marker === marker)) throw new Error("E2E_RESOURCE_ALREADY_DECLARED");
  return { ...state, resources: [...state.resources, { marker, titles: [title], number: null, actor: null, createdAt: null }] };
}

export function bindE2EResource(state, { marker, number, actor, createdAt }) {
  const resources = state.resources.map((resource) => resource.marker === marker ? { ...resource, number, actor, createdAt } : resource);
  if (!resources.some((resource) => resource.marker === marker && resource.number === number)) throw new Error("E2E_RESOURCE_NOT_DECLARED");
  return { ...state, resources };
}

export function allowE2EResourceTitle(state, { marker, title }) {
  const resources = state.resources.map((resource) => resource.marker === marker && !resource.titles.includes(title) ? { ...resource, titles: [...resource.titles, title] } : resource);
  return { ...state, resources };
}

function defaultApi(args, input, { notFound = false } = {}) {
  const run = spawnSync("gh", args, { encoding: "utf8", input: input === undefined ? undefined : JSON.stringify(input), timeout: 60_000, maxBuffer: 32 * 1024 * 1024 });
  if (run.status !== 0) {
    if (notFound && /(?:HTTP\s+)?404\b/.test(run.stderr)) return null;
    throw new Error("GITHUB_API_FAILED");
  }
  return run.stdout.trim() ? JSON.parse(run.stdout) : null;
}

export function cleanupPersistedE2E({ file, repo, runId, actor, api = defaultApi, now = new Date().toISOString(), githubAppAuthorization, githubAppEvidence }) {
  assertDisposableGitHubAppAuthorization(githubAppAuthorization, githubAppEvidence, repo);
  actor ??= api(["api", "user"]).login;
  let state = fs.existsSync(file) ? loadE2EState(file) : null;
  if (state && (state.repo !== repo || state.runId !== runId || state.actor !== actor)) throw new Error("E2E_CLEANUP_IDENTITY_MISMATCH");
  if (!state || state.controlIssue === null) {
    const recovered = recoverRemoteE2EState({ repo, runId, actor, api });
    if (recovered) state = persistE2EState(recovered, file);
  }
  if (!state) {
    const label = api(["api", `repos/${repo}/labels/${encodeURIComponent(e2eLabel(runId))}`], undefined, { notFound: true });
    if (!label) return { status: "PASS", deleted: 0, remaining: 0, recoveryCommand: null, noResources: true };
    throw new Error("E2E_STATE_MISSING");
  }
  const command = recoveryCommand(repo, runId);
  if (state.status === "COMPLETE") {
    for (const resource of state.resources.filter(({ number }) => number !== null)) {
      const issue = api(["api", `repos/${repo}/issues/${resource.number}`]);
      if (issue.state !== "closed" || issue.body?.startsWith(resource.marker) !== true || issue.user?.login !== resource.actor) return { status: "FAIL", deleted: 0, remaining: 1, recoveryCommand: command };
    }
    if (state.controlIssue !== null) {
      const control = api(["api", `repos/${repo}/issues/${state.controlIssue}`]);
      if (control.state !== "closed" || control.body !== e2eControlBody(state) || control.user?.login !== state.actor) return { status: "FAIL", deleted: 0, remaining: 1, recoveryCommand: command };
    }
    const label = api(["api", `repos/${repo}/labels/${encodeURIComponent(state.label)}`], undefined, { notFound: true });
    return { status: label ? "FAIL" : "PASS", deleted: 0, remaining: label ? 1 : 0, recoveryCommand: label ? command : null };
  }
  const pages = api(["api", "--paginate", "--slurp", `repos/${repo}/issues?state=all&labels=${encodeURIComponent(state.label)}&per_page=100`]) ?? [];
  const allIssues = pages.flat();
  let control = null;
  if (state.controlIssue !== null) {
    control = api(["api", `repos/${repo}/issues/${state.controlIssue}`]);
    if (control.title !== e2eControlTitle(runId) || control.user?.login !== state.actor || control.body?.startsWith(e2eControlMarker(runId)) !== true) return { status: "FAIL", deleted: 0, remaining: 1, recoveryCommand: command };
  } else if (allIssues.some((issue) => issue.body?.startsWith(e2eControlMarker(runId)) === true)) {
    return { status: "FAIL", deleted: 0, remaining: 1, recoveryCommand: command };
  }
  const issues = state.status === "CLEANUP_COMMITTING" ? [] : allIssues.filter((issue) => issue.number !== state.controlIssue);
  const matched = new Map();
  if (state.status === "CLEANUP_COMMITTING") {
    for (const resource of state.resources.filter(({ number }) => number !== null)) {
      const issue = api(["api", `repos/${repo}/issues/${resource.number}`]);
      if (issue.state !== "closed" || issue.body?.startsWith(resource.marker) !== true || issue.user?.login !== resource.actor) return { status: "FAIL", deleted: 0, remaining: 1, recoveryCommand: command };
    }
  }
  for (const issue of issues) {
    const candidates = state.resources.filter((resource) => issue.body?.startsWith(resource.marker) === true && resource.titles.includes(issue.title));
    if (candidates.length !== 1 || issue.user?.login !== state.actor || Date.parse(issue.created_at) + 5_000 < Date.parse(state.startedAt)) return { status: "FAIL", deleted: 0, remaining: 1, recoveryCommand: command };
    const resource = candidates[0];
    if (resource.number !== null && resource.number !== issue.number || matched.has(resource.marker)) return { status: "FAIL", deleted: 0, remaining: 1, recoveryCommand: command };
    matched.set(resource.marker, issue);
  }
  if (state.status === "ACTIVE" && state.resources.some((resource) => resource.number !== null && !matched.has(resource.marker))) return { status: "FAIL", deleted: 0, remaining: 1, recoveryCommand: command };
  let deleted = 0;
  for (const [marker, issue] of matched) {
    const resource = state.resources.find((candidate) => candidate.marker === marker);
    if (resource.number === null) {
      state = bindE2EResource(state, { marker, number: issue.number, actor: issue.user.login, createdAt: issue.created_at });
      state = persistE2EState(state, file);
      if (state.controlIssue !== null) persistRemoteE2EState(state, api);
    }
    if (issue.state === "open") {
      api(["api", "--method", "PATCH", `repos/${repo}/issues/${issue.number}`, "--input", "-"], { state: "closed", state_reason: "not_planned" });
      const readback = api(["api", `repos/${repo}/issues/${issue.number}`]);
      if (readback.state !== "closed" || readback.body?.startsWith(marker) !== true) return { status: "FAIL", deleted, remaining: 1, recoveryCommand: command };
      deleted += 1;
    }
  }
  if (state.status === "ACTIVE") {
    state = persistE2EState({ ...state, status: "CLEANUP_COMMITTING", cleanupAt: now }, file);
    if (state.controlIssue !== null) persistRemoteE2EState(state, api);
  }
  if (control?.state === "open") {
    api(["api", "--method", "PATCH", `repos/${repo}/issues/${control.number}`, "--input", "-"], { state: "closed", state_reason: "not_planned" });
    const readback = api(["api", `repos/${repo}/issues/${control.number}`]);
    if (readback.state !== "closed" || readback.body?.startsWith(e2eControlMarker(runId)) !== true) return { status: "FAIL", deleted, remaining: 1, recoveryCommand: command };
    deleted += 1;
  }
  const label = api(["api", `repos/${repo}/labels/${encodeURIComponent(state.label)}`], undefined, { notFound: true });
  if (label) { api(["api", "--method", "DELETE", `repos/${repo}/labels/${encodeURIComponent(state.label)}`]); deleted += 1; }
  if (api(["api", `repos/${repo}/labels/${encodeURIComponent(state.label)}`], undefined, { notFound: true })) return { status: "FAIL", deleted, remaining: 1, recoveryCommand: command };
  state = persistE2EState({ ...state, status: "COMPLETE", cleanupAt: state.cleanupAt ?? now }, file);
  if (state.controlIssue !== null) persistRemoteE2EState(state, api);
  return { status: "PASS", deleted, remaining: 0, recoveryCommand: null, stateDigest: state.digest };
}
