import { spawnSync } from "node:child_process";
import { PLAN_KINDS, safeError, sameValues } from "./domain.mjs";
import { controlledLabels } from "./recovery.mjs";

function runGhJson(args, input) {
  const run = spawnSync("gh", args, {
    encoding: "utf8",
    input: input === undefined ? undefined : JSON.stringify(input),
    maxBuffer: 32 * 1024 * 1024,
  });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(safeError(run.stderr.trim()) || `gh exited ${run.status}`);
  return run.stdout.trim() ? JSON.parse(run.stdout) : undefined;
}

export function createGitHubAdapter({ repo, kind = "DELIVERY_GRAPH", target, context, runJson = runGhJson }) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo ?? "")) throw new Error("repo must be OWNER/REPO");
  if (!PLAN_KINDS.includes(kind)) throw new Error(`unsupported Admission kind ${kind}`);
  const targetId = String(target);
  if (!/^[1-9][0-9]*$/.test(targetId)) throw new Error("target must be a positive GitHub Issue number");
  let actorLogin;

  function authenticatedLogin() {
    if (actorLogin !== undefined) return actorLogin;
    try { actorLogin = runJson(["api", "user"])?.login ?? null; } catch { actorLogin = null; }
    return actorLogin;
  }

  function readPages(endpoint) {
    const pages = runJson(["api", "--paginate", "--slurp", endpoint]);
    if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) throw new Error(`unexpected GitHub response for ${endpoint}`);
    return pages.flat();
  }

  function blockers(issueId) {
    return readPages(`repos/${repo}/issues/${issueId}/dependencies/blocked_by?per_page=100`)
      .map(({ number }) => String(number));
  }

  function readIssue(issueId, { includeComments = true, includeBlockers = false } = {}) {
    const data = runJson(["api", `repos/${repo}/issues/${issueId}`]);
    return {
      id: String(data.number),
      title: data.title ?? "",
      body: data.body ?? "",
      labels: (data.labels ?? []).map((label) => typeof label === "string" ? label : label.name),
      state: data.state,
      updatedAt: data.updated_at,
      blockedBy: includeBlockers ? blockers(issueId) : [],
      assignees: (data.assignees ?? []).map(({ login }) => login),
      comments: includeComments
        ? readPages(`repos/${repo}/issues/${issueId}/comments?per_page=100`).map(({ body, user, performed_via_github_app: app }) => ({
            body,
            author: user?.login ?? null,
            app: app?.slug ?? null,
            authorVerified: Boolean(user?.login && authenticatedLogin() === user.login),
          }))
        : [],
    };
  }

  function childRefs() {
    return readPages(`repos/${repo}/issues/${targetId}/sub_issues?per_page=100`);
  }

  return {
    read() {
      if (kind === "STANDALONE") {
        return structuredClone({ ...context, candidate: readIssue(targetId, { includeBlockers: true }) });
      }
      const parent = readIssue(targetId);
      const children = childRefs().map((reference) => readIssue(reference.number, { includeBlockers: true }));
      return structuredClone({ ...context, parent, children });
    },
    readIssue(issueId) {
      return readIssue(issueId, { includeBlockers: kind === "STANDALONE" || String(issueId) !== targetId });
    },
    readClaims() {
      if (kind === "STANDALONE") {
        return readIssue(targetId, { includeComments: false }).assignees.length > 0 ? [targetId] : [];
      }
      return childRefs()
        .filter((reference) => (reference.assignees ?? []).length > 0)
        .map((reference) => String(reference.number));
    },
    addComment(issueId, body) {
      runJson(["api", "--method", "POST", `repos/${repo}/issues/${issueId}/comments`, "--input", "-"], { body });
    },
    setControlledLabels(issueId, desiredControlled, expectedControlled) {
      const currentIssue = readIssue(issueId, { includeComments: false });
      const currentControlled = controlledLabels(currentIssue.labels);
      if (sameValues(currentControlled, desiredControlled)) return;
      const allowed = new Set([...expectedControlled, ...desiredControlled]);
      if (!currentControlled.every((label) => allowed.has(label))) throw new Error(`controlled labels changed for #${issueId}`);
      for (const label of currentControlled.filter((value) => !desiredControlled.includes(value))) {
        runJson(["api", "--method", "DELETE", `repos/${repo}/issues/${issueId}/labels/${encodeURIComponent(label)}`]);
      }
      const latest = controlledLabels(readIssue(issueId, { includeComments: false }).labels);
      const additions = desiredControlled.filter((label) => !latest.includes(label));
      if (additions.length > 0) {
        runJson(["api", "--method", "POST", `repos/${repo}/issues/${issueId}/labels`, "--input", "-"], { labels: additions });
      }
    },
  };
}
