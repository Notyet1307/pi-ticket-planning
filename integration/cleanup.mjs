import path from "node:path";
import { spawnSync } from "node:child_process";

import { cleanupPersistedE2E, validateE2ECleanupTarget } from "./e2e-state.mjs";
import { repositoryFromRemote, verifyDisposableGitHubAppAuth } from "./github-app-auth.mjs";

const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  if (!process.argv[index]?.startsWith("--") || !process.argv[index + 1] || options.has(process.argv[index])) throw new Error("INVALID_E2E_CLEANUP_OPTION");
  options.set(process.argv[index], process.argv[index + 1]);
}
for (const name of ["--state", "--repo", "--run-id"]) if (!options.has(name)) throw new Error("MISSING_E2E_CLEANUP_OPTION");
const allowlist = new Set((process.env.E2E_ALLOWLIST ?? "").split(",").map((value) => value.trim()).filter(Boolean));
if (!allowlist.has(options.get("--repo"))) throw new Error("E2E_REPO_NOT_ALLOWLISTED");
let authorized = false;
const gh = (args, input, { notFound = false } = {}) => {
  const methodIndex = args.indexOf("--method");
  const method = methodIndex < 0 ? "GET" : args[methodIndex + 1];
  if (method !== "GET" && !authorized) throw new Error("DISPOSABLE_APP_AUTH_REQUIRED");
  const result = spawnSync("gh", args, { encoding: "utf8", input: input === undefined ? undefined : JSON.stringify(input), timeout: 60_000, maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) {
    if (notFound && /(?:HTTP\s+)?404\b/.test(result.stderr)) return null;
    throw new Error("GITHUB_API_FAILED");
  }
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
};
const remote = spawnSync("git", ["remote", "get-url", "origin"], { encoding: "utf8", timeout: 15_000 });
const auth = verifyDisposableGitHubAppAuth({ env: process.env, repo: options.get("--repo"), sourceRepo: repositoryFromRemote(remote.stdout.trim()), api: gh });
authorized = true;
const actor = auth.actor;
const repository = gh(["api", `repos/${options.get("--repo")}`]);
const topics = gh(["api", `repos/${options.get("--repo")}/topics`]).names ?? [];
validateE2ECleanupTarget({ env: { ...process.env, E2E_REPO: options.get("--repo") }, actor, repository, topics });
const stateFile = path.resolve(options.get("--state"));
const result = cleanupPersistedE2E({ file: stateFile, repo: options.get("--repo"), runId: options.get("--run-id"), actor, api: gh, githubAppAuthorization: auth.authorization, githubAppEvidence: auth.evidence });
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (result.status !== "PASS") process.exitCode = 1;
