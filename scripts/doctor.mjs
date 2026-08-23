import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectGitHubDeliveryGate } from "./delivery-gate.mjs";

export const PACKAGE_ROOT = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));

const MIN_NODE = [22, 16, 0];
const COMMAND_TIMEOUT_MS = 15_000;
const POLICY_CANDIDATES = ["AGENTS.override.md", "AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"];
const DELIVERY_FILES = [
  "docs/agents/delivery-gate.md",
  "docs/agents/issue-tracker.md",
  "docs/agents/triage-labels.md",
];
const LABEL_ROLES = ["needs-triage", "needs-info", "ready-for-agent", "ready-for-human", "wontfix"];

export function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    timeout: options.timeout ?? COMMAND_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null,
  };
}

export function diagnose({
  packageRoot = PACKAGE_ROOT,
  targetDir = process.cwd(),
  env = process.env,
  runner = runCommand,
  nodeVersion = process.versions.node,
} = {}) {
  const checks = [];
  const add = (section, status, label, detail = "", fix = "") => {
    checks.push({ section, status, label, detail, fix });
  };
  const invoke = (command, args, options = {}) => safeRun(runner, command, args, {
    cwd: options.cwd ?? targetDir,
    env: options.env ?? env,
    timeout: options.timeout,
  });
  const packageJson = readJson(path.join(packageRoot, "package.json"));
  const upstreamLock = readJson(path.join(packageRoot, "upstream-lock.json"));
  const profileDir = path.resolve(env.PI_TICKET_PLAN_PROFILE_DIR ?? path.join(os.homedir(), ".pi", "ticket-planning"));
  const launcher = path.resolve(env.PI_TICKET_PLAN_LAUNCHER ?? path.join(os.homedir(), ".local", "bin", "pi-ticket-plan"));
  const piBin = env.PI_TICKET_PLAN_PI_BIN ?? "pi";

  if (compareVersions(nodeVersion, MIN_NODE.join(".")) >= 0) {
    add("Installation", "PASS", "Node.js", `${nodeVersion} (required >= ${MIN_NODE.join(".")})`);
  } else {
    add("Installation", "FAIL", "Node.js", `${nodeVersion} is below ${MIN_NODE.join(".")}`, "Install Node.js >= 22.16.0, then rerun doctor");
  }

  const pi = invoke(piBin, ["--version"]);
  const piReady = succeeded(pi);
  if (piReady) add("Installation", "PASS", "PI", firstLine(pi.stdout));
  else add("Installation", "FAIL", "PI", failureDetail(pi), "Install PI and ensure `pi` is on PATH");

  const profile = inspectProfileSource({ packageRoot, profileDir, launcher });
  if (profile.ok) {
    add("Installation", "PASS", "Profile loads current checkout", packageRoot);
  } else {
    add("Installation", "FAIL", "Profile loads current checkout", profile.detail, `Run: ${shellQuote(path.join(packageRoot, "install.sh"))}`);
  }

  if (piReady && profile.ok) {
    const profileCheck = invoke(process.execPath, [path.join(packageRoot, "scripts", "check-profile.mjs")], {
      env: {
        ...env,
        PI_TICKET_PLAN_PROFILE_DIR: profileDir,
        PI_TICKET_PLAN_LAUNCHER: launcher,
      },
    });
    if (succeeded(profileCheck)) {
      add("Installation", "PASS", "Reviewer loaded from expected path", firstLine(profileCheck.stdout));
    } else {
      add("Installation", "FAIL", "Profile and Reviewer contract", failureDetail(profileCheck), `Run: ${shellQuote(path.join(packageRoot, "install.sh"))}`);
    }
  } else {
    add("Installation", "SKIP", "Reviewer contract", "PI or current-checkout Profile is unavailable");
  }

  const pin = inspectUpstreamPin(packageJson, upstreamLock, profile.settings);
  if (pin.ok) add("Installation", "PASS", "Pinned upstream Skill commit", pin.commit);
  else add("Installation", profile.settings ? "FAIL" : "SKIP", "Pinned upstream Skill commit", pin.detail, profile.settings ? `Run: ${shellQuote(path.join(packageRoot, "install.sh"))}` : "");

  const packageHead = invoke("git", ["-C", packageRoot, "rev-parse", "HEAD"]);
  const localHead = succeeded(packageHead) ? packageHead.stdout.trim() : null;
  const dirty = invoke("git", ["-C", packageRoot, "status", "--porcelain"]);
  if (!succeeded(dirty)) {
    add("Version", "WARN", "Package checkout state", failureDetail(dirty));
  } else if (dirty.stdout.trim()) {
    add("Version", "WARN", "Package checkout state", "uncommitted changes are loaded by the installed Profile");
  } else {
    add("Version", "PASS", "Package checkout state", "clean");
  }

  const ghVersion = invoke("gh", ["--version"]);
  const ghAvailable = succeeded(ghVersion);
  if (ghAvailable) add("GitHub", "PASS", "GitHub CLI", firstLine(ghVersion.stdout));
  else add("GitHub", "FAIL", "GitHub CLI", failureDetail(ghVersion), "Install GitHub CLI and ensure `gh` is on PATH");

  const ghAuth = ghAvailable ? invoke("gh", ["auth", "status", "--hostname", "github.com"]) : null;
  const ghReady = Boolean(ghAuth && succeeded(ghAuth));
  if (ghReady) add("GitHub", "PASS", "GitHub authentication", "github.com authentication is valid");
  else if (ghAvailable) add("GitHub", "FAIL", "GitHub authentication", "authentication is unavailable or invalid", "Run: gh auth login");
  else add("GitHub", "SKIP", "GitHub authentication", "GitHub CLI is unavailable");

  const canonicalRepo = repositorySlug(typeof packageJson.repository === "string" ? packageJson.repository : packageJson.repository?.url);
  if (ghReady && canonicalRepo) {
    checkPublishedVersion({ add, invoke, packageJson, canonicalRepo, localHead });
  } else {
    add("Version", "SKIP", "Latest release and main", "GitHub authentication or canonical repository identity is unavailable");
  }

  const targetRootResult = invoke("git", ["-C", targetDir, "rev-parse", "--show-toplevel"]);
  if (!succeeded(targetRootResult)) {
    add("Target repository", "SKIP", "Delivery target", "current directory is not a Git repository", "Run doctor from the target repository");
    return checks;
  }

  const targetRoot = realpathSafe(targetRootResult.stdout.trim());
  if (targetRoot === realpathSafe(packageRoot)) {
    add("Target repository", "SKIP", "Delivery target", "the package checkout is not treated as a Harness delivery target");
    return checks;
  }

  const origin = invoke("git", ["-C", targetRoot, "remote", "get-url", "origin"]);
  if (!succeeded(origin)) {
    add("Target repository", "FAIL", "Git remote", "origin is missing", "Configure the target repository origin, then rerun doctor");
    return checks;
  }
  const targetRepo = repositorySlug(origin.stdout.trim());
  if (!targetRepo) {
    add("Target repository", "FAIL", "Git remote", `${origin.stdout.trim()} is not a GitHub repository`, "Use a GitHub remote for Harness activation");
    return checks;
  }
  if (!ghReady) {
    add("Target repository", "SKIP", "GitHub delivery readiness", "GitHub authentication is unavailable");
    return checks;
  }

  const repoView = invoke("gh", ["repo", "view", targetRepo, "--json", "nameWithOwner,defaultBranchRef,hasIssuesEnabled"]);
  const repoFacts = parseJsonResult(repoView);
  if (!repoFacts.ok) {
    add("Target repository", "FAIL", "GitHub repository", repoFacts.detail, "Verify origin and GitHub access, then rerun doctor");
    return checks;
  }
  const remoteIdentity = repoFacts.value.nameWithOwner;
  const defaultBranch = repoFacts.value.defaultBranchRef?.name;
  if (!remoteIdentity || !defaultBranch) {
    add("Target repository", "FAIL", "Git remote and default branch", "GitHub did not return a repository identity and default branch", "Configure a default branch and verify GitHub repository access");
    return checks;
  }
  if (remoteIdentity.toLowerCase() !== targetRepo.toLowerCase()) {
    add("Target repository", "FAIL", "Git remote identity", `origin resolves to ${remoteIdentity}, expected ${targetRepo}`, "Correct the target repository origin, then rerun doctor");
    return checks;
  }
  add("Target repository", "PASS", "Git remote and default branch", `${remoteIdentity} · ${defaultBranch}`);

  const remoteFiles = new Map();
  for (const relative of [...POLICY_CANDIDATES, ...DELIVERY_FILES]) {
    remoteFiles.set(relative, readRemoteFile(invoke, remoteIdentity, defaultBranch, relative));
  }
  const policyPath = POLICY_CANDIDATES.find((relative) => remoteFiles.get(relative)?.ok);
  if (!policyPath) {
    add("Target repository", "FAIL", "Accepted repository policy", `no root policy exists on ${defaultBranch}`, askYetSetupFix());
  } else {
    const policy = remoteFiles.get(policyPath).content;
    const missingPointers = DELIVERY_FILES.filter((relative) => !policy.includes(relative));
    if (missingPointers.length) {
      add("Target repository", "FAIL", "Accepted repository policy", `${policyPath} lacks ${missingPointers.join(", ")}`, askYetSetupFix());
    } else {
      add("Target repository", "PASS", "Accepted repository policy", `${policyPath} on ${defaultBranch}`);
    }
  }

  for (const relative of DELIVERY_FILES) {
    const file = remoteFiles.get(relative);
    if (file.ok) add("Target repository", "PASS", `Delivery policy file: ${relative}`, defaultBranch);
    else add("Target repository", file.notFound ? "FAIL" : "WARN", `Delivery policy file: ${relative}`, file.detail, file.notFound ? askYetSetupFix() : "");
  }

  checkLabels({
    add,
    invoke,
    repo: remoteIdentity,
    mappingText: remoteFiles.get("docs/agents/triage-labels.md")?.content,
  });

  if (repoFacts.value.hasIssuesEnabled === false) {
    add("Target repository", "FAIL", "GitHub Issues", "Issues are disabled", "Enable GitHub Issues for this repository");
    add("Target repository", "SKIP", "Sub-issue and Dependency APIs", "GitHub Issues are disabled");
  } else {
    checkIssueCapabilities({ add, invoke, repo: remoteIdentity });
  }

  checkRules({ add, invoke, repo: remoteIdentity, branch: defaultBranch });
  return checks;
}

export function renderDoctor(checks) {
  const readiness = doctorReadiness(checks);
  const lines = [
    "pi-ticket-plan doctor",
    `Readiness: Planning ${readiness.planning} · Admission ${readiness.admission} · Release ${readiness.release}`,
  ];
  const sections = [...new Set(checks.map((check) => check.section))];
  for (const section of sections) {
    lines.push("", section);
    for (const check of checks.filter((item) => item.section === section)) {
      lines.push(`${check.status.padEnd(5)} ${check.label}${check.detail ? ` — ${sanitize(check.detail)}` : ""}`);
      if (check.fix) lines.push(`FIX  ${check.fix}`);
    }
  }
  const counts = new Map(["PASS", "FAIL", "WARN", "SKIP"].map((status) => [status, 0]));
  for (const check of checks) counts.set(check.status, (counts.get(check.status) ?? 0) + 1);
  lines.push("", `Summary: ${[...counts].map(([status, count]) => `${count} ${status}`).join(" · ")}`);
  return lines.join("\n");
}

export function doctorReadiness(checks) {
  return {
    planning: readinessFor(checks, ["Installation"]),
    admission: readinessFor(checks, ["Installation", "GitHub", "Target repository"]),
    release: readinessFor(checks, ["Installation", "Version"]),
  };
}

function readinessFor(checks, sections) {
  const relevant = checks.filter(({ section }) => sections.includes(section));
  if (relevant.some(({ status }) => status === "FAIL")) return "BLOCKED";
  if (relevant.some(({ status }) => status === "WARN")) return "WARN";
  if (relevant.length === 0 || relevant.every(({ status }) => status === "SKIP")) return "NOT_CHECKED";
  return "READY";
}

function checkPublishedVersion({ add, invoke, packageJson, canonicalRepo, localHead }) {
  const release = invoke("gh", ["api", `repos/${canonicalRepo}/releases/latest`, "--jq", ".tag_name"]);
  if (!succeeded(release)) {
    add("Version", isNotFound(release) ? "WARN" : "SKIP", "Latest package release", failureDetail(release));
  } else {
    const latest = release.stdout.trim();
    const installed = `v${packageJson.version}`;
    const comparison = compareVersions(installed, latest);
    if (comparison === 0) add("Version", "PASS", "Installed package release", installed);
    else if (comparison < 0) add("Version", "WARN", "Installed package release", `${installed} is behind ${latest}`, `Update the package checkout to ${latest}, then rerun install.sh`);
    else add("Version", "WARN", "Installed package release", `${installed} is newer than published ${latest}`);
  }

  const branchResult = invoke("gh", ["api", `repos/${canonicalRepo}`, "--jq", ".default_branch"]);
  if (!succeeded(branchResult) || !localHead) {
    add("Version", "SKIP", "Package checkout vs main", !localHead ? "package HEAD is unavailable" : failureDetail(branchResult));
    return;
  }
  const branch = branchResult.stdout.trim();
  const remoteHeadResult = invoke("gh", ["api", `repos/${canonicalRepo}/commits/${encodeURIComponent(branch)}`, "--jq", ".sha"]);
  if (!succeeded(remoteHeadResult)) {
    add("Version", "SKIP", "Package checkout vs main", failureDetail(remoteHeadResult));
    return;
  }
  const remoteHead = remoteHeadResult.stdout.trim();
  if (localHead === remoteHead) {
    add("Version", "PASS", "Package checkout vs main", `${branch}@${shortSha(remoteHead)}`);
    return;
  }

  const comparisonResult = invoke("gh", ["api", `repos/${canonicalRepo}/compare/${localHead}...${remoteHead}`]);
  const comparison = parseJsonResult(comparisonResult);
  if (!comparison.ok) {
    add("Version", "WARN", "Package checkout vs main", `HEAD ${shortSha(localHead)} differs from ${branch}@${shortSha(remoteHead)}`);
    return;
  }
  const facts = comparison.value;
  if (facts.status === "ahead") {
    add("Version", "WARN", "Package checkout vs main", `checkout is behind ${branch} by ${facts.ahead_by ?? "unknown"} commit(s)`);
  } else if (facts.status === "behind") {
    add("Version", "WARN", "Package checkout vs main", `checkout is ahead of ${branch} by ${facts.behind_by ?? "unknown"} commit(s)`);
  } else {
    add("Version", "WARN", "Package checkout vs main", `checkout and ${branch} have ${facts.status ?? "different"} histories`);
  }
}

function checkLabels({ add, invoke, repo, mappingText }) {
  const labelsResult = invoke("gh", ["label", "list", "--repo", repo, "--limit", "1000", "--json", "name"]);
  const labels = parseJsonResult(labelsResult);
  if (!labels.ok || !Array.isArray(labels.value)) {
    add("Target repository", "WARN", "Required delivery labels", labels.detail);
    return;
  }
  const existing = new Set(labels.value.map((label) => label.name));
  const mapping = parseLabelMapping(mappingText ?? "");
  for (const role of LABEL_ROLES) {
    const label = mapping.get(role) ?? role;
    if (existing.has(label)) add("Target repository", "PASS", `Required label: ${label}`, role);
    else add("Target repository", "FAIL", `Missing label: ${label}`, role, `Run: gh label create ${shellQuote(label)} --repo ${shellQuote(repo)}`);
  }
}

function checkIssueCapabilities({ add, invoke, repo }) {
  const issuesResult = invoke("gh", ["issue", "list", "--repo", repo, "--state", "all", "--limit", "1", "--json", "number"]);
  const issues = parseJsonResult(issuesResult);
  if (!issues.ok || !Array.isArray(issues.value)) {
    add("Target repository", "WARN", "Sub-issue and Dependency APIs", issues.detail);
    return;
  }
  const issue = issues.value[0]?.number;
  if (!issue) {
    add("Target repository", "SKIP", "Sub-issue API", "repository has no Issue for a read-only probe");
    add("Target repository", "SKIP", "Dependency API", "repository has no Issue for a read-only probe");
    return;
  }
  for (const [label, endpoint] of [
    ["Sub-issue API", `repos/${repo}/issues/${issue}/sub_issues?per_page=1`],
    ["Dependency API", `repos/${repo}/issues/${issue}/dependencies/blocked_by?per_page=1`],
  ]) {
    const result = invoke("gh", ["api", endpoint]);
    if (succeeded(result)) add("Target repository", "PASS", label, `read-only probe on #${issue}`);
    else add("Target repository", "FAIL", label, failureDetail(result), "Verify GitHub Issues read access and repository capability");
  }
}

function checkRules({ add, invoke, repo, branch }) {
  let gate;
  try {
    gate = inspectGitHubDeliveryGate({
      repo,
      branch,
      api(endpoint) {
        const parsed = parseJsonResult(invoke("gh", ["api", endpoint]));
        if (!parsed.ok) throw new Error(parsed.detail);
        return parsed.value;
      },
    });
  } catch (error) {
    add("Target repository", "FAIL", "Harness merge rules", error.message, `Run: pi-ticket-plan delivery-gate plan --repo ${shellQuote(repo)}`);
    return;
  }
  const missing = [];
  if (!gate.repositoryAutoMerge) missing.push("repository auto-merge");
  if (!gate.pullRequestRequired) missing.push("pull request rule");
  if (!gate.strictRequiredStatusChecks) missing.push("strict status checks");
  if (gate.requiredStatusChecks.length === 0) missing.push("required status check");
  if (!gate.statusCheckSourcesPinned) missing.push("pinned check source");
  if (gate.bypassActorsPresent) missing.push("no bypass actors");
  if (gate.humanApprovalRequired) missing.push("zero human approvals");
  if (!gate.mergeCommitAllowed || !gate.mergeMethodAllowed) missing.push("merge commit method");
  if (missing.length === 0) {
    add("Target repository", "PASS", "Harness merge rules", `${branch} · ${gate.requiredStatusChecks.join(", ")}`);
  } else {
    add("Target repository", "FAIL", "Harness merge rules", `missing ${missing.join(", ")}`, `Run: pi-ticket-plan delivery-gate plan --repo ${shellQuote(repo)}`);
  }
}

function inspectProfileSource({ packageRoot, profileDir, launcher }) {
  let settings;
  try {
    settings = readJson(path.join(profileDir, "settings.json"));
  } catch (error) {
    return { ok: false, detail: `cannot read ${path.join(profileDir, "settings.json")}: ${error.message}`, settings: null };
  }
  const packageSource = settings.packages?.find((entry) => entry?.source && realpathSafe(entry.source) === realpathSafe(packageRoot));
  if (!packageSource) return { ok: false, detail: "Profile settings do not reference the current checkout", settings };
  if (realpathSafe(launcher) !== realpathSafe(path.join(packageRoot, "profile", "pi-ticket-plan"))) {
    return { ok: false, detail: "pi-ticket-plan launcher does not resolve to the current checkout", settings };
  }
  return { ok: true, detail: "", settings };
}

function inspectUpstreamPin(packageJson, lock, settings) {
  const packageCommit = packageJson.mattpocockUpstream?.commit;
  const profileSource = settings?.packages?.find((entry) => String(entry?.source).includes("mattpocock/skills@"))?.source;
  const profileCommit = profileSource?.match(/mattpocock\/skills@([a-f0-9]{40})/u)?.[1];
  if (!settings) return { ok: false, detail: "Profile settings are unavailable" };
  if (!packageCommit || packageCommit !== lock.commit || packageCommit !== profileCommit) {
    return { ok: false, detail: "package, lock, and installed Profile upstream commits differ" };
  }
  return { ok: true, commit: packageCommit };
}

function readRemoteFile(invoke, repo, ref, relative) {
  const encoded = relative.split("/").map(encodeURIComponent).join("/");
  const result = invoke("gh", ["api", `repos/${repo}/contents/${encoded}?ref=${encodeURIComponent(ref)}`]);
  if (!succeeded(result)) return { ok: false, notFound: isNotFound(result), detail: failureDetail(result) };
  const parsed = parseJsonResult(result);
  if (!parsed.ok || parsed.value.type !== "file" || parsed.value.encoding !== "base64") {
    return { ok: false, notFound: false, detail: parsed.ok ? `unexpected GitHub content for ${relative}` : parsed.detail };
  }
  return { ok: true, content: Buffer.from(parsed.value.content.replace(/\s/gu, ""), "base64").toString("utf8") };
}

function parseLabelMapping(text) {
  const mapping = new Map();
  for (const role of LABEL_ROLES) {
    const match = text.match(new RegExp(`\\|\\s*\`${escapeRegex(role)}\`\\s*\\|\\s*\`([^\`]+)\``, "u"));
    if (match) mapping.set(role, match[1].trim());
  }
  return mapping;
}

function parseJsonResult(result) {
  if (!succeeded(result)) return { ok: false, detail: failureDetail(result) };
  try {
    return { ok: true, value: JSON.parse(result.stdout) };
  } catch (error) {
    return { ok: false, detail: `invalid JSON: ${error.message}` };
  }
}

function safeRun(runner, command, args, options) {
  try {
    return runner(command, args, options);
  } catch (error) {
    return { status: null, stdout: "", stderr: "", error };
  }
}

function succeeded(result) {
  return result && !result.error && result.status === 0;
}

function failureDetail(result) {
  if (!result) return "not run";
  if (result.error?.code === "ETIMEDOUT") return "command timed out";
  if (result.error?.code === "ENOENT") return "command not found";
  return firstLine(result.stderr) || firstLine(result.stdout) || result.error?.message || `command exited ${result.status}`;
}

function firstLine(value) {
  return String(value ?? "").split(/\r?\n/u).map((line) => line.trim()).find(Boolean) ?? "";
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function realpathSafe(value) {
  if (!value) return null;
  try {
    return fs.realpathSync(value);
  } catch {
    return path.resolve(value);
  }
}

function repositorySlug(value) {
  const text = String(value ?? "").trim().replace(/\.git$/u, "");
  const match = text.match(/github\.com(?::|\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/u);
  return match?.[1] ?? null;
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return left === right ? 0 : 1;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

function parseVersion(value) {
  const match = String(value).match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u);
  return match ? match.slice(1).map(Number) : null;
}

function isNotFound(result) {
  return /(?:HTTP\s+404|404\s+Not Found)/iu.test(`${result?.stderr ?? ""}\n${result?.stdout ?? ""}`);
}

function sanitize(value) {
  return String(value)
    .replace(/\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]+/gu, "[redacted]")
    .replace(/Bearer\s+\S+/giu, "Bearer [redacted]")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/giu, "$1[redacted]@")
    .replace(/([?&](?:access_token|token|key)=)[^&\s]+/giu, "$1[redacted]")
    .replace(/\s+/gu, " ")
    .slice(0, 240);
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function shortSha(value) {
  return String(value).slice(0, 8);
}

function askYetSetupFix() {
  return "Run: pi-ticket-plan -p '/skill:ask-yet 修复当前仓库交付配置'";
}

function usage() {
  return "Usage: pi-ticket-plan doctor [--require planning|admission|release|all]\n\nRuns all read-only checks. By default only planning readiness controls the exit code.";
}

const ownPath = fs.realpathSync(fileURLToPath(import.meta.url));
if (process.argv[1] && fs.realpathSync(process.argv[1]) === ownPath) {
  const args = process.argv.slice(2);
  if (args.length === 1 && ["-h", "--help"].includes(args[0])) {
    console.log(usage());
  } else {
    const requireIndex = args.indexOf("--require");
    const required = requireIndex === -1 ? "planning" : args[requireIndex + 1];
    if ((requireIndex !== -1 && args.length !== 2) || !["planning", "admission", "release", "all"].includes(required)) {
      console.error(usage());
      process.exitCode = 2;
    } else {
      const checks = diagnose();
      const readiness = doctorReadiness(checks);
      console.log(renderDoctor(checks));
      const blocked = required === "all"
        ? Object.values(readiness).includes("BLOCKED")
        : readiness[required] === "BLOCKED";
      if (blocked) process.exitCode = 1;
    }
  }
}
