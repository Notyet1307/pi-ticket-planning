import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashText } from "./check-delivery-graph.mjs";

export const DELIVERY_GATE_PLAN_SCHEMA = "pi-ticket-planning:delivery-gate-plan:v1";
export const DELIVERY_GATE_RESULT_SCHEMA = "pi-ticket-planning:delivery-gate-result:v1";
export const MANAGED_WORKFLOW_PATH = ".github/workflows/herdr-delivery-gate.yml";
export const MANAGED_CHECK_NAME = "herdr-delivery-gate";
export const MANAGED_RULESET_NAME = "pi-ticket-planning-delivery-gate";
export const CHECKOUT_ACTION_SHA = "11d5960a326750d5838078e36cf38b85af677262";

const PLAN_KINDS = ["WORKFLOW_BOOTSTRAP", "GITHUB_ENFORCEMENT"];
const SHA = /^[a-f0-9]{40}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const SAFE_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/;
const SAFE_BRANCH = /^[A-Za-z0-9._/-]{1,128}$/;

function issue(code, subject) {
  return subject ? { code, subject } : { code };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

export function deliveryGateFingerprint(value) {
  return hashText(JSON.stringify(canonical(value)));
}

function approvalProjection(plan) {
  return {
    schema: plan.schema,
    kind: plan.kind,
    repo: plan.repo,
    branch: plan.branch,
    source: plan.source,
    workflow: plan.workflow,
    repositorySettings: plan.repositorySettings,
    ruleset: plan.ruleset,
    operations: plan.operations,
  };
}

function finalizePlan(plan) {
  const finalized = { ...plan, planFingerprint: deliveryGateFingerprint(approvalProjection(plan)) };
  if (Buffer.byteLength(JSON.stringify(finalized), "utf8") > 256 * 1024) throw new Error("delivery-gate Plan exceeds its byte budget");
  return finalized;
}

function same(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function safeError(value) {
  return String(value ?? "unknown error")
    .replace(/\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]+/gu, "[redacted]")
    .replace(/Bearer\s+\S+/giu, "Bearer [redacted]")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/giu, "$1[redacted]@")
    .replace(/([?&](?:access_token|token|key)=)[^&\s]+/giu, "$1[redacted]")
    .replace(/[\0\r\n]+/gu, " ")
    .slice(0, 500);
}

function safeRelativePath(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && SAFE_PATH.test(value) && !value.includes("//");
}

function repositorySlug(value) {
  const text = String(value ?? "").trim().replace(/\.git$/u, "");
  return text.match(/github\.com(?::|\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/u)?.[1] ?? null;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    input: options.input,
    encoding: "utf8",
    timeout: options.timeout ?? 30_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw new Error(safeError(result.error.message));
  if (result.status !== 0) throw new Error(safeError((result.stderr || result.stdout).trim() || `${command} exited ${result.status}`));
  return result.stdout ?? "";
}

function git(repoRoot, args) {
  return run("git", ["-C", repoRoot, ...args]).trim();
}

function ghJson(args, input) {
  const stdout = run("gh", args, { input: input === undefined ? undefined : JSON.stringify(input) });
  return stdout.trim() ? JSON.parse(stdout) : null;
}

function exactRepositoryRoot(repoRoot) {
  const resolved = fs.realpathSync(path.resolve(repoRoot));
  if (fs.realpathSync(git(resolved, ["rev-parse", "--show-toplevel"])) !== resolved) {
    throw new Error("repo path must be the exact Git root");
  }
  return resolved;
}

export function renderManagedWorkflow(branch, validationScript) {
  if (!safeRelativePath(validationScript)) throw new Error("validation script must be a safe repository-relative path");
  if (typeof branch !== "string" || !SAFE_BRANCH.test(branch) || branch.includes("//")) throw new Error("default branch is invalid");
  return [
    `# pi-ticket-planning:delivery-gate:v1 validation-script=${validationScript}`,
    "name: Herdr delivery gate",
    "",
    "on:",
    "  pull_request:",
    "  push:",
    "    branches:",
    `      - ${branch}`,
    "",
    "permissions:",
    "  contents: read",
    "",
    "jobs:",
    `  ${MANAGED_CHECK_NAME}:`,
    `    name: ${MANAGED_CHECK_NAME}`,
    "    runs-on: ubuntu-latest",
    "    timeout-minutes: 60",
    "    steps:",
    `      - uses: actions/checkout@${CHECKOUT_ACTION_SHA}`,
    "      - name: Verify",
    `        run: ./${validationScript}`,
    "",
  ].join("\n");
}

function managedWorkflowIdentity(content, branch) {
  const marker = content.match(/^# pi-ticket-planning:delivery-gate:v1 validation-script=([^\r\n]+)$/mu);
  if (!marker || !safeRelativePath(marker[1])) throw new Error("managed delivery-gate workflow marker is missing or invalid");
  if (content !== renderManagedWorkflow(branch, marker[1])) throw new Error("managed delivery-gate workflow differs from the v1 template");
  return { path: MANAGED_WORKFLOW_PATH, validationScript: marker[1], digest: hashText(content) };
}

export function inspectWorkflowTarget({ repoRoot, validationScript }) {
  const root = exactRepositoryRoot(repoRoot);
  if (!safeRelativePath(validationScript)) throw new Error("validation script must be a safe repository-relative path");
  const origin = repositorySlug(git(root, ["remote", "get-url", "origin"]));
  if (!origin) throw new Error("origin must resolve to a GitHub OWNER/REPO");
  const repository = ghJson(["repo", "view", origin, "--json", "nameWithOwner,defaultBranchRef"]);
  const repo = repository?.nameWithOwner;
  const branch = repository?.defaultBranchRef?.name;
  if (!SAFE_REPO.test(repo ?? "") || !branch) throw new Error("GitHub repository identity or default branch is unavailable");
  if (repo.toLowerCase() !== origin.toLowerCase()) throw new Error("origin and GitHub repository identity differ");
  const remote = ghJson(["api", `repos/${repo}/commits/${encodeURIComponent(branch)}`]);
  const baseSha = remote?.sha;
  const headSha = git(root, ["rev-parse", "HEAD"]);
  if (!SHA.test(baseSha ?? "") || headSha !== baseSha) throw new Error("workflow bootstrap must start at the current remote default-branch HEAD");

  const scriptPath = path.resolve(root, validationScript);
  const relative = path.relative(root, scriptPath);
  if (relative !== validationScript || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("validation script escaped the repository");
  const stat = fs.lstatSync(scriptPath);
  if (!stat.isFile() || stat.isSymbolicLink() || !(stat.mode & 0o111)) throw new Error("validation script must be a regular executable file");
  git(root, ["ls-files", "--error-unmatch", "--", validationScript]);
  const treeEntry = git(root, ["ls-tree", "HEAD", "--", validationScript]);
  if (!treeEntry.startsWith("100755 blob ") || !treeEntry.endsWith(`\t${validationScript}`)) {
    throw new Error("validation script must be executable in the tracked HEAD");
  }
  const worktreeScript = fs.readFileSync(scriptPath, "utf8");
  const trackedScript = run("git", ["-C", root, "show", `HEAD:${validationScript}`]);
  if (Buffer.byteLength(worktreeScript, "utf8") > 256 * 1024 || worktreeScript.includes("\0") || trackedScript !== worktreeScript) {
    throw new Error("validation script must match its tracked HEAD blob");
  }

  const content = renderManagedWorkflow(branch, validationScript);
  const workflowPath = path.join(root, MANAGED_WORKFLOW_PATH);
  let currentDigest = null;
  if (fs.existsSync(workflowPath)) {
    const workflowStat = fs.lstatSync(workflowPath);
    if (!workflowStat.isFile() || workflowStat.isSymbolicLink()) throw new Error("managed workflow path is not a regular file");
    const existing = fs.readFileSync(workflowPath, "utf8");
    if (existing !== content) throw new Error("managed workflow path already contains different content");
    currentDigest = hashText(existing);
  }
  return {
    repo,
    branch,
    baseSha,
    validationScript: { path: validationScript, digest: hashText(worktreeScript) },
    workflow: {
      path: MANAGED_WORKFLOW_PATH,
      beforeDigest: currentDigest,
      afterDigest: hashText(content),
      content,
    },
  };
}

export function buildWorkflowPlan(snapshot) {
  return finalizePlan({
    schema: DELIVERY_GATE_PLAN_SCHEMA,
    kind: "WORKFLOW_BOOTSTRAP",
    repo: snapshot.repo,
    branch: snapshot.branch,
    source: {
      baseSha: snapshot.baseSha,
      validationScript: snapshot.validationScript,
    },
    workflow: snapshot.workflow,
    repositorySettings: null,
    ruleset: null,
    operations: [{
      kind: "write_file",
      path: snapshot.workflow.path,
      beforeDigest: snapshot.workflow.beforeDigest,
      afterDigest: snapshot.workflow.afterDigest,
    }],
    recovery: { strategy: "roll-forward", rollback: "Remove only the uncommitted managed workflow file before publication." },
  });
}

export function createWorkflowAdapter({ repoRoot, plan }) {
  return {
    read() {
      return inspectWorkflowTarget({ repoRoot, validationScript: plan.source.validationScript.path });
    },
    writeWorkflow(content) {
      const root = exactRepositoryRoot(repoRoot);
      const target = path.join(root, MANAGED_WORKFLOW_PATH);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, { flag: "wx", mode: 0o600 });
    },
  };
}

export function renderManagedRuleset(branch, integrationId) {
  if (!Number.isInteger(integrationId) || integrationId < 1) throw new Error("GitHub Actions integration id is invalid");
  if (typeof branch !== "string" || !SAFE_BRANCH.test(branch) || branch.includes("//")) throw new Error("default branch is invalid");
  return {
    name: MANAGED_RULESET_NAME,
    target: "branch",
    enforcement: "active",
    bypass_actors: [],
    conditions: { ref_name: { exclude: [], include: [`refs/heads/${branch}`] } },
    rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      {
        type: "pull_request",
        parameters: {
          allowed_merge_methods: ["merge"],
          dismiss_stale_reviews_on_push: false,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_approving_review_count: 0,
          required_review_thread_resolution: false,
          required_reviewers: [],
          require_extra_approval_for_unattributed_changes: true,
        },
      },
      {
        type: "required_status_checks",
        parameters: {
          do_not_enforce_on_create: false,
          required_status_checks: [{ context: MANAGED_CHECK_NAME, integration_id: integrationId }],
          strict_required_status_checks_policy: true,
        },
      },
    ],
  };
}

function rulesetProjection(value) {
  if (!value) return null;
  return {
    name: value.name,
    target: value.target,
    enforcement: value.enforcement,
    bypass_actors: value.bypass_actors ?? [],
    conditions: value.conditions,
    rules: value.rules,
  };
}

function decodeContent(response) {
  if (response?.type !== "file" || response.encoding !== "base64" || typeof response.content !== "string") {
    throw new Error("managed workflow is unavailable on the remote default branch");
  }
  return Buffer.from(response.content.replace(/\s/gu, ""), "base64").toString("utf8");
}

function effectiveGateFromRaw(repository, rawRules, rulesetDetails) {
  if (!repository || !Array.isArray(rawRules) || rawRules.length > 100) throw new Error("effective GitHub delivery gate is malformed");
  const checks = new Set();
  let sourcesPinned = true;
  let strict = false;
  let pullRequest = false;
  let humanApproval = false;
  let mergeMethod = true;
  let bypass = false;
  for (const raw of rawRules) {
    if (!raw || typeof raw !== "object") throw new Error("effective branch rule is malformed");
    if (raw.type === "required_status_checks") {
      if (!Number.isInteger(raw.ruleset_id) || raw.ruleset_id < 1 || rulesetDetails.get(raw.ruleset_id)?.enforcement !== "active") {
        throw new Error("effective required checks are not owned by one readable active ruleset");
      }
      const parameters = raw.parameters;
      if (!parameters || typeof parameters !== "object" || typeof parameters.strict_required_status_checks_policy !== "boolean") {
        throw new Error("effective required-check parameters are malformed");
      }
      const entries = parameters.required_status_checks;
      if (!Array.isArray(entries) || entries.length > 100) throw new Error("effective required checks are malformed");
      strict ||= parameters.strict_required_status_checks_policy;
      for (const entry of entries) {
        if (typeof entry?.context !== "string" || !entry.context || Buffer.byteLength(entry.context, "utf8") > 256 || /[\0\r\n]/u.test(entry.context)) {
          throw new Error("effective required check context is malformed");
        }
        checks.add(entry.context);
        if (checks.size > 100) throw new Error("effective required checks exceed the safety limit");
        if (!Number.isInteger(entry.integration_id) || entry.integration_id < 1) sourcesPinned = false;
      }
    }
    if (raw.type === "pull_request") {
      if (!Number.isInteger(raw.ruleset_id) || raw.ruleset_id < 1 || rulesetDetails.get(raw.ruleset_id)?.enforcement !== "active") {
        throw new Error("effective pull request rule is not owned by one readable active ruleset");
      }
      pullRequest = true;
      const parameters = raw.parameters ?? {};
      if (!Number.isInteger(parameters.required_approving_review_count) || parameters.required_approving_review_count < 0
        || !Array.isArray(parameters.required_reviewers) || parameters.required_reviewers.length > 100
        || typeof parameters.require_code_owner_review !== "boolean"
        || typeof parameters.require_last_push_approval !== "boolean"
        || !Array.isArray(parameters.allowed_merge_methods)
        || parameters.allowed_merge_methods.some((method) => !["merge", "squash", "rebase"].includes(method))) {
        throw new Error("effective pull request parameters are malformed");
      }
      humanApproval ||= parameters.required_approving_review_count > 0
        || parameters.require_code_owner_review
        || parameters.require_last_push_approval
        || parameters.required_reviewers.length > 0;
      mergeMethod &&= parameters.allowed_merge_methods.includes("merge");
    }
    if (Number.isInteger(raw.ruleset_id)) {
      const actors = rulesetDetails.get(raw.ruleset_id)?.bypass_actors;
      if (!Array.isArray(actors) || actors.length > 100) throw new Error("effective ruleset bypass actors are malformed");
      bypass ||= actors.length > 0;
    }
  }
  return {
    repositoryAutoMerge: repository.allow_auto_merge === true,
    pullRequestRequired: pullRequest,
    strictRequiredStatusChecks: strict,
    requiredStatusChecks: [...checks].sort(),
    statusCheckSourcesPinned: checks.size > 0 && sourcesPinned,
    bypassActorsPresent: bypass,
    humanApprovalRequired: humanApproval,
    mergeCommitAllowed: repository.allow_merge_commit === true,
    mergeMethodAllowed: pullRequest && mergeMethod,
  };
}

export function inspectGitHubDeliveryGate({ repo, branch, api = (endpoint) => ghJson(["api", endpoint]) }) {
  if (!SAFE_REPO.test(repo ?? "") || typeof branch !== "string" || !branch) throw new Error("repository and branch are required");
  const repository = api(`repos/${repo}`);
  const rules = api(`repos/${repo}/rules/branches/${encodeURIComponent(branch)}`);
  if (!Array.isArray(rules)) throw new Error("effective branch rules are unavailable");
  const ids = [...new Set(rules.flatMap((rule) => Number.isInteger(rule?.ruleset_id) ? [rule.ruleset_id] : []))];
  const details = new Map(ids.map((id) => [id, api(`repos/${repo}/rulesets/${id}`)]));
  return effectiveGateFromRaw(repository, rules, details);
}

function gateReady(gate) {
  return gate.repositoryAutoMerge
    && gate.pullRequestRequired
    && gate.strictRequiredStatusChecks
    && gate.requiredStatusChecks.includes(MANAGED_CHECK_NAME)
    && gate.statusCheckSourcesPinned
    && !gate.bypassActorsPresent
    && !gate.humanApprovalRequired
    && gate.mergeCommitAllowed
    && gate.mergeMethodAllowed;
}

export function inspectEnforcementTarget({ repo }) {
  if (!SAFE_REPO.test(repo ?? "")) throw new Error("repo must be OWNER/REPO");
  const repository = ghJson(["api", `repos/${repo}`]);
  const branch = repository?.default_branch;
  if (!branch || !SAFE_BRANCH.test(branch) || branch.includes("//")) throw new Error("default branch is unavailable");
  const commit = ghJson(["api", `repos/${repo}/commits/${encodeURIComponent(branch)}`]);
  if (!SHA.test(commit?.sha ?? "")) throw new Error("default-branch commit is unavailable");
  let workflowResponse;
  try {
    workflowResponse = ghJson(["api", `repos/${repo}/contents/${MANAGED_WORKFLOW_PATH}?ref=${encodeURIComponent(branch)}`]);
  } catch {
    throw new Error("managed delivery-gate workflow is unavailable on the current default branch");
  }
  const workflow = managedWorkflowIdentity(decodeContent(workflowResponse), branch);
  const checksResponse = ghJson(["api", `repos/${repo}/commits/${commit.sha}/check-runs?per_page=100`]);
  if (!Array.isArray(checksResponse?.check_runs) || checksResponse.total_count > 100) throw new Error("default-branch check runs are unavailable or excessive");
  const checks = checksResponse.check_runs.filter((check) => check?.name === MANAGED_CHECK_NAME && check?.app?.slug === "github-actions");
  if (checks.length !== 1 || checks[0].status !== "completed" || checks[0].conclusion !== "success" || !Number.isInteger(checks[0].app?.id)) {
    throw new Error("managed delivery-gate check has not succeeded once on the current default branch");
  }

  const summaries = ghJson(["api", `repos/${repo}/rulesets?includes_parents=false&per_page=100`]);
  if (!Array.isArray(summaries) || summaries.length >= 100) throw new Error("repository rulesets are unavailable or excessive");
  const matches = summaries.filter((ruleset) => ruleset?.name === MANAGED_RULESET_NAME);
  if (matches.length > 1) throw new Error("managed ruleset identity is ambiguous");
  const currentRuleset = matches.length === 1
    ? ghJson(["api", `repos/${repo}/rulesets/${matches[0].id}`])
    : null;
  const desired = renderManagedRuleset(branch, checks[0].app.id);
  const effective = inspectGitHubDeliveryGate({ repo, branch });
  if (currentRuleset === null
    && (effective.bypassActorsPresent || effective.humanApprovalRequired || (effective.pullRequestRequired && !effective.mergeMethodAllowed))) {
    throw new Error("an existing effective rule conflicts with unattended Harness auto-merge");
  }
  return {
    repo,
    branch,
    defaultSha: commit.sha,
    workflow,
    check: { name: MANAGED_CHECK_NAME, integrationId: checks[0].app.id, headSha: commit.sha },
    repositorySettings: {
      before: { allowAutoMerge: repository.allow_auto_merge === true, allowMergeCommit: repository.allow_merge_commit === true },
      after: { allowAutoMerge: true, allowMergeCommit: true },
    },
    ruleset: {
      id: currentRuleset?.id ?? null,
      before: rulesetProjection(currentRuleset),
      after: desired,
    },
    effective,
  };
}

export function buildEnforcementPlan(snapshot) {
  return finalizePlan({
    schema: DELIVERY_GATE_PLAN_SCHEMA,
    kind: "GITHUB_ENFORCEMENT",
    repo: snapshot.repo,
    branch: snapshot.branch,
    source: {
      baseSha: snapshot.defaultSha,
      workflow: snapshot.workflow,
      check: snapshot.check,
    },
    workflow: null,
    repositorySettings: snapshot.repositorySettings,
    ruleset: snapshot.ruleset,
    operations: [
      { kind: "ruleset", before: snapshot.ruleset.before, after: snapshot.ruleset.after },
      { kind: "repository_settings", before: snapshot.repositorySettings.before, after: snapshot.repositorySettings.after },
    ],
    recovery: { strategy: "roll-forward", rollback: "Disable Harness autoMerge; keep CI and branch protection active." },
  });
}

export function createEnforcementAdapter({ repo }) {
  return {
    read() {
      return inspectEnforcementTarget({ repo });
    },
    setRepositorySettings(value) {
      ghJson(["api", "--method", "PATCH", `repos/${repo}`, "--input", "-"], {
        allow_auto_merge: value.allowAutoMerge,
        allow_merge_commit: value.allowMergeCommit,
      });
    },
    putRuleset(id, value) {
      ghJson(["api", "--method", id === null ? "POST" : "PUT", id === null ? `repos/${repo}/rulesets` : `repos/${repo}/rulesets/${id}`, "--input", "-"], value);
    },
  };
}

export function validateDeliveryGatePlan(plan) {
  const problems = [];
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return { ok: false, problems: [issue("INVALID_PLAN")] };
  if (plan.schema !== DELIVERY_GATE_PLAN_SCHEMA) problems.push(issue("UNSUPPORTED_PLAN"));
  if (!PLAN_KINDS.includes(plan.kind)) problems.push(issue("INVALID_PLAN_KIND"));
  if (!SAFE_REPO.test(plan.repo ?? "") || !SAFE_BRANCH.test(plan.branch ?? "") || plan.branch.includes("//") || !SHA.test(plan.source?.baseSha ?? "")) problems.push(issue("INVALID_PLAN_IDENTITY"));
  if (!SHA256.test(plan.planFingerprint ?? "") || deliveryGateFingerprint(approvalProjection(plan)) !== plan.planFingerprint) {
    problems.push(issue("PLAN_FINGERPRINT_MISMATCH"));
  }
  if (plan.kind === "WORKFLOW_BOOTSTRAP") {
    let expectedContent = null;
    try {
      expectedContent = renderManagedWorkflow(plan.branch, plan.source?.validationScript?.path);
    } catch {
      // Report the fixed plan-shape problem below.
    }
    if (plan.operations?.length !== 1 || plan.operations[0]?.kind !== "write_file"
      || plan.workflow?.path !== MANAGED_WORKFLOW_PATH
      || plan.workflow?.content !== expectedContent
      || hashText(plan.workflow?.content ?? "") !== plan.workflow?.afterDigest
      || plan.operations[0].afterDigest !== plan.workflow.afterDigest
      || plan.operations[0].beforeDigest !== plan.workflow.beforeDigest
      || (plan.workflow.beforeDigest !== null && !SHA256.test(plan.workflow.beforeDigest))
      || !safeRelativePath(plan.source?.validationScript?.path)
      || !SHA256.test(plan.source?.validationScript?.digest ?? "")) problems.push(issue("INVALID_WORKFLOW_PLAN"));
  }
  if (plan.kind === "GITHUB_ENFORCEMENT") {
    let expectedRuleset = null;
    try {
      expectedRuleset = renderManagedRuleset(plan.branch, plan.source?.check?.integrationId);
    } catch {
      // Report the fixed plan-shape problem below.
    }
    const expectedRepository = { allowAutoMerge: true, allowMergeCommit: true };
    if (plan.operations?.length !== 2
      || plan.operations[0]?.kind !== "ruleset"
      || plan.operations[1]?.kind !== "repository_settings"
      || plan.ruleset?.after?.name !== MANAGED_RULESET_NAME
      || !same(plan.ruleset?.after, expectedRuleset)
      || !same(plan.repositorySettings?.after, expectedRepository)
      || !same(plan.operations[0]?.before, plan.ruleset?.before)
      || !same(plan.operations[0]?.after, expectedRuleset)
      || !same(plan.operations[1]?.before, plan.repositorySettings?.before)
      || !same(plan.operations[1]?.after, expectedRepository)
      || plan.source?.workflow?.path !== MANAGED_WORKFLOW_PATH
      || !safeRelativePath(plan.source?.workflow?.validationScript)
      || !SHA256.test(plan.source?.workflow?.digest ?? "")
      || plan.source?.check?.name !== MANAGED_CHECK_NAME
      || plan.source?.check?.headSha !== plan.source.baseSha
      || !Number.isInteger(plan.source?.check?.integrationId)) problems.push(issue("INVALID_ENFORCEMENT_PLAN"));
  }
  return { ok: problems.length === 0, problems };
}

function result(status, plan, changed = [], recovered = [], problems = []) {
  return {
    schema: DELIVERY_GATE_RESULT_SCHEMA,
    status,
    planFingerprint: plan?.planFingerprint ?? null,
    changed,
    recovered,
    problems,
  };
}

function workflowState(plan, state) {
  if (state.repo !== plan.repo || state.branch !== plan.branch || state.baseSha !== plan.source.baseSha
    || !same(state.validationScript, plan.source.validationScript)) return "conflict";
  const current = state.workflow.beforeDigest;
  if (current === plan.workflow.afterDigest) return "after";
  if (current === plan.workflow.beforeDigest) return "before";
  return "conflict";
}

function enforcementIdentity(plan, state) {
  return state.repo === plan.repo
    && state.branch === plan.branch
    && state.defaultSha === plan.source.baseSha
    && same(state.workflow, plan.source.workflow)
    && same(state.check, plan.source.check);
}

export function applyDeliveryGatePlan(plan, adapter, { expectedFingerprint } = {}) {
  const checked = validateDeliveryGatePlan(plan);
  if (!checked.ok) return result("CONFLICT", plan, [], [], checked.problems);
  if (expectedFingerprint !== plan.planFingerprint) return result("CONFLICT", plan, [], [], [issue("EXPECTED_FINGERPRINT_MISMATCH")]);
  let state;
  try {
    state = adapter.read();
  } catch (error) {
    return result("CONFLICT", plan, [], [], [issue("READ_FAILED", safeError(error.message))]);
  }

  if (plan.kind === "WORKFLOW_BOOTSTRAP") {
    const status = workflowState(plan, state);
    if (status === "conflict") return result("CONFLICT", plan, [], [], [issue("WORKFLOW_STATE_DRIFT")]);
    if (status === "after") return result("COMPLETE", plan, [], ["write_file"]);
    let writeError = null;
    try {
      adapter.writeWorkflow(plan.workflow.content);
    } catch (error) {
      writeError = error;
    }
    try {
      state = adapter.read();
    } catch (error) {
      return result("PARTIAL", plan, [], [], [issue("WORKFLOW_READ_AFTER_WRITE_FAILED", safeError(error.message))]);
    }
    return workflowState(plan, state) === "after"
      ? result("COMPLETE", plan, writeError ? [] : ["write_file"], writeError ? ["write_file"] : [])
      : result("PARTIAL", plan, [], [], [issue("WORKFLOW_WRITE_NOT_CONFIRMED", writeError ? safeError(writeError.message) : undefined)]);
  }

  if (!enforcementIdentity(plan, state)) return result("CONFLICT", plan, [], [], [issue("ENFORCEMENT_SOURCE_DRIFT")]);
  const changed = [];
  const recovered = [];
  const rulesetStatus = same(state.ruleset.before, plan.ruleset.after)
    ? "after"
    : same(state.ruleset.before, plan.ruleset.before) ? "before" : "conflict";
  if (rulesetStatus === "conflict") {
    return result(changed.length + recovered.length > 0 ? "PARTIAL" : "CONFLICT", plan, changed, recovered, [issue("RULESET_DRIFT")]);
  }
  if (rulesetStatus === "after") recovered.push("ruleset");
  else {
    let writeError = null;
    try {
      adapter.putRuleset(state.ruleset.id, plan.ruleset.after);
    } catch (error) {
      writeError = error;
    }
    try {
      state = adapter.read();
    } catch (error) {
      return result("PARTIAL", plan, changed, recovered, [issue("RULESET_READ_AFTER_WRITE_FAILED", safeError(error.message))]);
    }
    if (!enforcementIdentity(plan, state) || !same(state.ruleset.before, plan.ruleset.after)) {
      return result("PARTIAL", plan, changed, recovered, [issue("RULESET_WRITE_NOT_CONFIRMED", writeError ? safeError(writeError.message) : undefined)]);
    }
    (writeError ? recovered : changed).push("ruleset");
  }

  const repositoryStatus = same(state.repositorySettings.before, plan.repositorySettings.after)
    ? "after"
    : same(state.repositorySettings.before, plan.repositorySettings.before) ? "before" : "conflict";
  if (repositoryStatus === "conflict") {
    return result(changed.length + recovered.length > 0 ? "PARTIAL" : "CONFLICT", plan, changed, recovered, [issue("REPOSITORY_SETTINGS_DRIFT")]);
  }
  if (repositoryStatus === "after") recovered.push("repository_settings");
  else {
    let writeError = null;
    try {
      adapter.setRepositorySettings(plan.repositorySettings.after);
    } catch (error) {
      writeError = error;
    }
    try {
      state = adapter.read();
    } catch (error) {
      return result("PARTIAL", plan, changed, recovered, [issue("REPOSITORY_SETTINGS_READ_AFTER_WRITE_FAILED", safeError(error.message))]);
    }
    if (!enforcementIdentity(plan, state) || !same(state.repositorySettings.before, plan.repositorySettings.after)) {
      return result("PARTIAL", plan, changed, recovered, [issue("REPOSITORY_SETTINGS_WRITE_NOT_CONFIRMED", writeError ? safeError(writeError.message) : undefined)]);
    }
    (writeError ? recovered : changed).push("repository_settings");
  }
  return gateReady(state.effective)
    ? result("COMPLETE", plan, changed, recovered)
    : result(changed.length + recovered.length > 0 ? "PARTIAL" : "CONFLICT", plan, changed, recovered, [issue("EFFECTIVE_GATE_NOT_READY")]);
}

function readJson(file, label) {
  if (!file) throw new Error(`${label} is required`);
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

function writeJson(file, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (file) fs.writeFileSync(path.resolve(file), text, { mode: 0o600 });
  else process.stdout.write(text);
}

function options(argv) {
  const parsed = new Map();
  const allowed = new Set(["--repo-path", "--validation-script", "--repo", "--out", "--plan", "--expected-fingerprint"]);
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined) throw new Error("delivery-gate options must be --name value pairs");
    if (!allowed.has(name)) throw new Error(`unknown delivery-gate option ${name}`);
    if (parsed.has(name)) throw new Error(`duplicate delivery-gate option ${name}`);
    parsed.set(name, value);
  }
  return parsed;
}

function usage() {
  return "usage: delivery-gate plan (--repo-path PATH --validation-script PATH | --repo OWNER/REPO) [--out FILE]; delivery-gate apply --plan FILE --expected-fingerprint SHA256 [--repo-path PATH] [--out FILE]";
}

const ownPath = fs.realpathSync(fileURLToPath(import.meta.url));
if (process.argv[1] && fs.realpathSync(process.argv[1]) === ownPath) {
  try {
    const [command, ...argv] = process.argv.slice(2);
    const parsed = options(argv);
    if (command === "plan") {
      const workflow = parsed.has("--repo-path") || parsed.has("--validation-script");
      if (workflow && (!parsed.has("--repo-path") || !parsed.has("--validation-script") || parsed.has("--repo") || parsed.has("--plan") || parsed.has("--expected-fingerprint"))) {
        throw new Error("workflow plan requires only --repo-path and --validation-script");
      }
      if (!workflow && (!parsed.has("--repo") || parsed.has("--plan") || parsed.has("--expected-fingerprint"))) {
        throw new Error("enforcement plan requires --repo");
      }
      const plan = workflow
        ? buildWorkflowPlan(inspectWorkflowTarget({ repoRoot: parsed.get("--repo-path"), validationScript: parsed.get("--validation-script") }))
        : buildEnforcementPlan(inspectEnforcementTarget({ repo: parsed.get("--repo") }));
      writeJson(parsed.get("--out"), plan);
    } else if (command === "apply") {
      if (!parsed.has("--plan") || !parsed.has("--expected-fingerprint") || parsed.has("--repo") || parsed.has("--validation-script")) {
        throw new Error("apply requires --plan and --expected-fingerprint");
      }
      const plan = readJson(parsed.get("--plan"), "--plan");
      const adapter = plan.kind === "WORKFLOW_BOOTSTRAP"
        ? createWorkflowAdapter({ repoRoot: parsed.get("--repo-path"), plan })
        : createEnforcementAdapter({ repo: plan.repo });
      const applied = applyDeliveryGatePlan(plan, adapter, { expectedFingerprint: parsed.get("--expected-fingerprint") });
      writeJson(parsed.get("--out"), applied);
      if (applied.status !== "COMPLETE") process.exitCode = 1;
    } else {
      throw new Error(usage());
    }
  } catch (error) {
    console.error(`FAIL: ${safeError(error.message)}`);
    console.error(usage());
    process.exitCode = 2;
  }
}
