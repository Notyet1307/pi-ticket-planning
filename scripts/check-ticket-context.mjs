import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateArtifact } from "../protocol/kernel.mjs";

export const TICKET_CONTEXT_SCHEMA = "pi-ticket-planning:ticket-context-check:v1";
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const EXACT_GIT_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const BROAD_PURPOSE = /^(?:read\s+(?:the\s+)?(?:repo(?:sitory)?|codebase|docs\/?|all\s+adrs?)|inspect\s+(?:the\s+)?(?:repo(?:sitory)?|codebase))\.?$/iu;
const NON_AUTHORITY_PATH_SEGMENTS = new Set(["draft", "drafts", "example", "examples", "fixture", "fixtures", "historical", "history"]);

function issue(code, subject) {
  return subject ? { code, subject } : { code };
}

function hashText(value) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digestProjection(result) {
  return {
    schema: result.schema,
    ok: result.ok,
    verdict: result.verdict,
    baseSha: result.baseSha,
    bodyHash: result.bodyHash,
    anchorCount: result.anchorCount,
    anchors: result.anchors,
    problems: result.problems,
  };
}

export function ticketContextDigest(result) {
  return hashText(JSON.stringify(canonical(digestProjection(result))));
}

export function buildTicketContextResult({ baseSha, body, anchors = [], problems = [] }) {
  if (typeof body !== "string") throw new TypeError("ticket body must be a string");
  const result = {
    schema: TICKET_CONTEXT_SCHEMA,
    ok: problems.length === 0,
    verdict: problems.length === 0 ? "PASS" : "FAIL",
    baseSha,
    bodyHash: hashText(body),
    anchorCount: anchors.length,
    anchors,
    problems,
  };
  return { ...result, digest: ticketContextDigest(result) };
}

function runGit(repo, args) {
  const run = spawnSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  return {
    ok: !run.error && run.status === 0,
    stdout: run.stdout?.trim() ?? "",
  };
}

function resolveBase(repo, base, problems) {
  if (!path.isAbsolute(repo ?? "")) {
    problems.push(issue("REPOSITORY_PATH_NOT_ABSOLUTE"));
    return undefined;
  }
  try {
    if (!fs.statSync(repo).isDirectory()) throw new Error("not a directory");
  } catch {
    problems.push(issue("INVALID_REPOSITORY_PATH"));
    return undefined;
  }
  if (!runGit(repo, ["rev-parse", "--is-inside-work-tree"]).ok) {
    problems.push(issue("REPOSITORY_NOT_GIT"));
    return undefined;
  }
  if (!EXACT_GIT_SHA.test(base ?? "")) {
    problems.push(issue("INVALID_BASE_SHA"));
    return undefined;
  }
  const resolved = runGit(repo, ["rev-parse", "--verify", `${base}^{commit}`]);
  if (!resolved.ok || resolved.stdout !== base) {
    problems.push(issue("BASE_NOT_COMMIT", base));
    return undefined;
  }
  return resolved.stdout;
}

function extractAnchors(body, problems) {
  const headings = [...body.matchAll(/^## Context anchors[ \t]*$/gm)];
  if (headings.length === 0) return [];
  if (headings.length > 1) problems.push(issue("DUPLICATE_CONTEXT_ANCHORS_SECTION"));

  const heading = headings[0];
  const start = heading.index + heading[0].length;
  const nextHeading = body.slice(start).match(/^## (?!#)/m);
  const section = body.slice(start, nextHeading ? start + nextHeading.index : body.length);
  const lines = section.split(/\r?\n/u).filter((line) => line.trim().length > 0);
  if (lines.length === 0) problems.push(issue("EMPTY_CONTEXT_ANCHORS_SECTION"));

  const anchors = [];
  for (const line of lines) {
    const match = line.match(/^- `([^`\r\n]+)`[ \t]+—[ \t]+(.+?)[ \t]*$/u);
    if (!match || !match[2].trim()) {
      problems.push(issue("INVALID_CONTEXT_ANCHOR", line.trim()));
      continue;
    }
    anchors.push({ path: match[1], purpose: match[2].trim() });
  }
  return anchors;
}

function validAnchorPath(anchorPath) {
  return anchorPath.length > 0
    && !path.posix.isAbsolute(anchorPath)
    && !path.win32.isAbsolute(anchorPath)
    && !anchorPath.includes("\\")
    && !anchorPath.split("/").includes("..")
    && !/[*?[\]{}]/u.test(anchorPath)
    && ![".", "docs", "docs/"].includes(anchorPath)
    && path.posix.normalize(anchorPath) === anchorPath;
}

function nonAuthorityAnchorPath(anchorPath) {
  return anchorPath.split("/").some((segment) => NON_AUTHORITY_PATH_SEGMENTS.has(segment.toLowerCase()));
}

export function checkTicketContext({ repo, base, body }) {
  const problems = [];
  if (typeof body !== "string" || body.trim().length === 0 || body.includes("\0")) {
    problems.push(issue("INVALID_TICKET_BODY"));
  }
  const sourceBody = typeof body === "string" ? body : "";
  const resolvedBase = resolveBase(repo, base, problems);
  const parsed = extractAnchors(sourceBody, problems);
  if (parsed.length > 5) problems.push(issue("TOO_MANY_CONTEXT_ANCHORS", String(parsed.length)));

  const anchors = [];
  const seen = new Set();
  for (const anchor of parsed) {
    if (seen.has(anchor.path)) problems.push(issue("DUPLICATE_CONTEXT_ANCHOR", anchor.path));
    seen.add(anchor.path);
    if (!validAnchorPath(anchor.path)) {
      problems.push(issue("INVALID_CONTEXT_ANCHOR_PATH", anchor.path));
      continue;
    }
    if (nonAuthorityAnchorPath(anchor.path)) {
      problems.push(issue("DISALLOWED_CONTEXT_ANCHOR_SOURCE", anchor.path));
      continue;
    }
    if (BROAD_PURPOSE.test(anchor.purpose)) {
      problems.push(issue("BROAD_CONTEXT_ANCHOR_PURPOSE", anchor.path));
    }
    if (!resolvedBase) continue;
    const object = runGit(repo, ["cat-file", "-t", `${resolvedBase}:${anchor.path}`]);
    if (!object.ok) {
      problems.push(issue("CONTEXT_ANCHOR_NOT_FOUND", anchor.path));
      continue;
    }
    if (object.stdout !== "blob") {
      problems.push(issue("CONTEXT_ANCHOR_NOT_BLOB", anchor.path));
      continue;
    }
    const blob = runGit(repo, ["rev-parse", "--verify", `${resolvedBase}:${anchor.path}`]);
    if (!blob.ok) {
      problems.push(issue("CONTEXT_ANCHOR_NOT_FOUND", anchor.path));
      continue;
    }
    anchors.push({ path: anchor.path, blobSha: blob.stdout, purpose: anchor.purpose });
  }

  return buildTicketContextResult({
    baseSha: resolvedBase ?? (typeof base === "string" ? base : ""),
    body: sourceBody,
    anchors,
    problems,
  });
}

export function validateTicketContextResult(result) {
  const problems = [];
  if (!result || typeof result !== "object" || Array.isArray(result)) return [issue("INVALID_CONTEXT_CHECK_RESULT")];
  try {
    problems.push(...validateArtifact(result).problems);
  } catch {
    problems.push(issue("INVALID_CONTEXT_CHECK_RESULT"));
  }
  if (result.schema !== TICKET_CONTEXT_SCHEMA) problems.push(issue("INVALID_CONTEXT_CHECK_SCHEMA"));
  if (!EXACT_GIT_SHA.test(result.baseSha ?? "")) problems.push(issue("INVALID_CONTEXT_CHECK_BASE_SHA"));
  if (!SHA256.test(result.bodyHash ?? "")) problems.push(issue("INVALID_CONTEXT_CHECK_BODY_HASH"));
  if (!Array.isArray(result.anchors) || result.anchors.some((anchor) => (
    typeof anchor?.path !== "string" || !EXACT_GIT_SHA.test(anchor?.blobSha ?? "")
    || typeof anchor?.purpose !== "string" || !anchor.purpose.trim()
  ))) problems.push(issue("INVALID_CONTEXT_CHECK_ANCHORS"));
  if (!Number.isInteger(result.anchorCount) || result.anchorCount !== result.anchors?.length) {
    problems.push(issue("INVALID_CONTEXT_CHECK_ANCHOR_COUNT"));
  }
  if (!Array.isArray(result.problems) || result.problems.some((problem) => typeof problem?.code !== "string" || !problem.code)) {
    problems.push(issue("INVALID_CONTEXT_CHECK_PROBLEMS"));
  }
  const expectedOk = Array.isArray(result.problems) && result.problems.length === 0;
  if (result.ok !== expectedOk || result.verdict !== (expectedOk ? "PASS" : "FAIL")) {
    problems.push(issue("INVALID_CONTEXT_CHECK_VERDICT"));
  }
  if (!SHA256.test(result.digest ?? "") || ticketContextDigest(result) !== result.digest) {
    problems.push(issue("CONTEXT_CHECK_DIGEST_MISMATCH"));
  }
  return problems;
}

export function validateCandidateContextChecks({ candidates, baseSha, contextChecks }) {
  const problems = [];
  if (!Array.isArray(contextChecks)) return [issue("MISSING_CONTEXT_CHECKS")];
  const candidateList = Array.isArray(candidates) ? candidates : [];
  const expectedIds = candidateList.map(({ id }) => String(id));
  const checksById = new Map();
  for (const item of contextChecks) {
    const id = typeof item?.candidateId === "string" ? item.candidateId : "";
    if (!id) {
      problems.push(issue("INVALID_CONTEXT_CHECK_CANDIDATE"));
      continue;
    }
    if (checksById.has(id)) problems.push(issue("DUPLICATE_CONTEXT_CHECK", id));
    checksById.set(id, item.result);
    if (!expectedIds.includes(id)) problems.push(issue("UNEXPECTED_CONTEXT_CHECK", id));
  }
  for (const candidate of candidateList) {
    const id = String(candidate.id);
    const result = checksById.get(id);
    if (!result) {
      problems.push(issue("MISSING_CONTEXT_CHECK", id));
      continue;
    }
    for (const problem of validateTicketContextResult(result)) {
      problems.push(issue(problem.code, `${id}${problem.subject ? `:${problem.subject}` : ""}`));
    }
    if (result.verdict !== "PASS" || result.ok !== true) problems.push(issue("CONTEXT_CHECK_FAILED", id));
    if (typeof candidate.body !== "string" || result.bodyHash !== hashText(candidate.body)) {
      problems.push(issue("CONTEXT_CHECK_BODY_HASH_MISMATCH", id));
    }
    if (result.baseSha !== baseSha) problems.push(issue("CONTEXT_CHECK_BASE_SHA_MISMATCH", id));
    if (typeof candidate.body === "string") {
      const projectionProblems = [];
      const parsed = extractAnchors(candidate.body, projectionProblems);
      if (parsed.length > 5) projectionProblems.push(issue("TOO_MANY_CONTEXT_ANCHORS"));
      const seen = new Set();
      for (const anchor of parsed) {
        if (seen.has(anchor.path)) projectionProblems.push(issue("DUPLICATE_CONTEXT_ANCHOR"));
        seen.add(anchor.path);
        if (!validAnchorPath(anchor.path) || nonAuthorityAnchorPath(anchor.path) || BROAD_PURPOSE.test(anchor.purpose)) {
          projectionProblems.push(issue("INVALID_CONTEXT_ANCHOR_PROJECTION"));
        }
      }
      const projected = Array.isArray(result.anchors)
        ? result.anchors.map(({ path: anchorPath, purpose }) => ({ path: anchorPath, purpose }))
        : [];
      if (projectionProblems.length > 0 || JSON.stringify(projected) !== JSON.stringify(parsed)) {
        problems.push(issue("CONTEXT_CHECK_BODY_PROJECTION_MISMATCH", id));
      }
    }
  }
  return problems;
}

export function verifyCandidateContextChecks({ repositoryPath, candidates, baseSha, contextChecks }) {
  const candidateList = Array.isArray(candidates) ? candidates : [];
  const problems = validateCandidateContextChecks({ candidates: candidateList, baseSha, contextChecks });
  const suppliedById = new Map((Array.isArray(contextChecks) ? contextChecks : []).map((item) => [item?.candidateId, item?.result]));

  for (const candidate of candidateList) {
    const id = String(candidate.id);
    const actual = checkTicketContext({ repo: repositoryPath, base: baseSha, body: candidate.body });
    if (!actual.ok) {
      problems.push(issue("CONTEXT_CHECK_RECHECK_FAILED", `${id}:${actual.problems.map(({ code }) => code).join(",")}`));
    }
    if (JSON.stringify(canonical(actual)) !== JSON.stringify(canonical(suppliedById.get(id)))) {
      problems.push(issue("CONTEXT_CHECK_RESULT_MISMATCH", id));
    }
  }
  return problems;
}

function parseOptions(argv) {
  const options = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("options must be --name value pairs");
    options.set(key.slice(2), value);
  }
  return options;
}

const ownPath = fs.realpathSync(fileURLToPath(import.meta.url));
if (process.argv[1] && fs.realpathSync(process.argv[1]) === ownPath) {
  try {
    const argv = process.argv.slice(2);
    if (argv.length === 0) {
      const root = path.resolve(path.dirname(ownPath), "..");
      const head = runGit(root, ["rev-parse", "HEAD"]);
      if (!head.ok) throw new Error("package HEAD is unavailable");
      const smoke = checkTicketContext({ repo: root, base: head.stdout, body: "# Ticket Context checker self-check\n" });
      if (!smoke.ok) throw new Error(`self-check failed: ${smoke.problems.map(({ code }) => code).join(",")}`);
      console.log("ticket context checker: ok");
      process.exit(0);
    }
    const options = parseOptions(argv);
    if (!options.has("repo") || !options.has("base") || !options.has("input") || options.size !== 3) {
      throw new Error("usage: --repo ABSOLUTE_PATH --base EXACT_SHA --input FILE_OR_DASH");
    }
    const body = options.get("input") === "-"
      ? fs.readFileSync(0, "utf8")
      : fs.readFileSync(path.resolve(options.get("input")), "utf8");
    const checked = checkTicketContext({ repo: options.get("repo"), base: options.get("base"), body });
    console.log(JSON.stringify(checked, null, 2));
    if (!checked.ok) process.exitCode = 1;
  } catch (error) {
    console.error(`ERROR ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  }
}
