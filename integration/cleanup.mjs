import path from "node:path";
import { spawnSync } from "node:child_process";

import { cleanupPersistedE2E, validateE2ECleanupTarget } from "./e2e-state.mjs";

const options = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  if (!process.argv[index]?.startsWith("--") || !process.argv[index + 1] || options.has(process.argv[index])) throw new Error("INVALID_E2E_CLEANUP_OPTION");
  options.set(process.argv[index], process.argv[index + 1]);
}
for (const name of ["--state", "--repo", "--run-id"]) if (!options.has(name)) throw new Error("MISSING_E2E_CLEANUP_OPTION");
const allowlist = new Set((process.env.E2E_ALLOWLIST ?? "").split(",").map((value) => value.trim()).filter(Boolean));
if (!allowlist.has(options.get("--repo"))) throw new Error("E2E_REPO_NOT_ALLOWLISTED");
const gh = (endpoint) => {
  const result = spawnSync("gh", ["api", endpoint], { encoding: "utf8", timeout: 30_000 });
  if (result.status !== 0) throw new Error("GITHUB_API_FAILED");
  return JSON.parse(result.stdout);
};
const actor = gh("user").login;
const repository = gh(`repos/${options.get("--repo")}`);
const topics = gh(`repos/${options.get("--repo")}/topics`).names ?? [];
validateE2ECleanupTarget({ env: { ...process.env, E2E_REPO: options.get("--repo") }, actor, repository, topics });
const stateFile = path.resolve(options.get("--state"));
const result = cleanupPersistedE2E({ file: stateFile, repo: options.get("--repo"), runId: options.get("--run-id") });
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (result.status !== "PASS") process.exitCode = 1;
