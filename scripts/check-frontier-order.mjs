import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function parsePositiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("usage: --repo OWNER/REPO --parent NUMBER");
    values.set(key.slice(2), value);
  }

  const repo = values.get("repo");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo ?? "")) {
    throw new Error("repo must be OWNER/REPO");
  }

  return { repo, parent: parsePositiveInteger(values.get("parent"), "parent") };
}

function readPages(endpoint) {
  const run = spawnSync("gh", ["api", "--paginate", "--slurp", endpoint], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error(run.stderr.trim() || `gh api exited ${run.status}`);

  const pages = JSON.parse(run.stdout);
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
    throw new Error(`unexpected GitHub response for ${endpoint}`);
  }
  return pages.flat();
}

export function validateFrontierOrder(children) {
  if (!Array.isArray(children) || children.length === 0) throw new Error("delivery map has no native children");

  const positions = new Map();
  children.forEach((child, index) => {
    const number = parsePositiveInteger(child.number, "child number");
    if (positions.has(number)) throw new Error(`duplicate child #${number}`);
    positions.set(number, index + 1);
  });

  const inversions = [];
  let internalEdges = 0;
  children.forEach((child, index) => {
    for (const rawBlocker of child.blockedBy ?? []) {
      const blocker = parsePositiveInteger(rawBlocker, `blocker for #${child.number}`);
      const blockerPosition = positions.get(blocker);
      if (blockerPosition === undefined) continue;
      internalEdges += 1;
      const dependentPosition = index + 1;
      if (blockerPosition >= dependentPosition) {
        inversions.push({
          blocker,
          blockerPosition,
          dependent: child.number,
          dependentPosition,
        });
      }
    }
  });

  return {
    ok: inversions.length === 0,
    childOrder: children.map((child) => child.number),
    internalEdges,
    inversions,
  };
}

export function readGitHubFrontierGraph(repo, parent) {
  const children = readPages(`repos/${repo}/issues/${parent}/sub_issues?per_page=100`);
  return children.map((child) => ({
    number: child.number,
    blockedBy: readPages(
      `repos/${repo}/issues/${child.number}/dependencies/blocked_by?per_page=100`,
    ).map((blocker) => blocker.number),
  }));
}

const ownPath = realpathSync(fileURLToPath(import.meta.url));
if (process.argv[1] && realpathSync(process.argv[1]) === ownPath) {
  try {
    const { repo, parent } = parseArgs(process.argv.slice(2));
    const result = validateFrontierOrder(readGitHubFrontierGraph(repo, parent));
    console.log(JSON.stringify({ repo, parent, verdict: result.ok ? "PASS" : "FAIL", ...result }, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(`ERROR ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
