import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import {
  buildTicketContextResult,
  checkTicketContext,
  verifyCandidateContextChecks,
} from "../scripts/check-ticket-context.mjs";

const repository = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ticket-context-"));

function git(...args) {
  const run = spawnSync("git", args, { cwd: repository, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.trim();
}

function write(relative, content) {
  const target = path.join(repository, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function ticket(entries) {
  if (entries === undefined) return "# Ticket\n\nImplement the accepted behavior.\n";
  return `# Ticket\n\nImplement the accepted behavior.\n\n## Context anchors\n\n${entries.join("\n")}\n`;
}

function codes(result) {
  return result.problems.map(({ code }) => code);
}

git("init", "-b", "main");
git("config", "user.name", "Ticket Context Test");
git("config", "user.email", "ticket-context@example.invalid");
for (let index = 1; index <= 6; index += 1) write(`src/file-${index}.mjs`, `export const value = ${index};\n`);
write("test/behavior.test.mjs", "// primary behavior check\n");
write("docs/adr/0001-owner.md", "# ADR\n\nStatus: ACCEPTED\n");
write("docs/historical/plan.md", "# Historical plan\n");
write("fixtures/example.json", "{}\n");
write("examples/sample.md", "# Example\n");
write("drafts/plan.md", "# Draft\n");
git("add", "src", "test", "docs", "fixtures", "examples", "drafts");
git("commit", "-m", "base one");
const baseOne = git("rev-parse", "HEAD");
write("src/file-1.mjs", "export const value = 101;\n");
git("add", "src/file-1.mjs");
git("commit", "-m", "base two");
const baseTwo = git("rev-parse", "HEAD");

after(() => fs.rmSync(repository, { recursive: true, force: true }));

test("no Context anchors is valid", () => {
  const result = checkTicketContext({ repo: repository, base: baseOne, body: ticket() });
  assert.equal(result.ok, true);
  assert.equal(result.anchorCount, 0);
  assert.deepEqual(result.anchors, []);
});

test("two exact reviewed-base anchors are valid", () => {
  const result = checkTicketContext({
    repo: repository,
    base: baseOne,
    body: ticket([
      "- `src/file-1.mjs` — Locate the current behavior entry point.",
      "- `test/behavior.test.mjs` — Run the primary behavioral verification.",
    ]),
  });
  assert.equal(result.ok, true);
  assert.equal(result.anchorCount, 2);
  assert.deepEqual(result.anchors.map(({ path: anchorPath }) => anchorPath), ["src/file-1.mjs", "test/behavior.test.mjs"]);
  assert.match(result.anchors[0].blobSha, /^[a-f0-9]{40,64}$/u);
});

test("a missing anchor and a directory anchor fail closed", () => {
  const missing = checkTicketContext({
    repo: repository,
    base: baseOne,
    body: ticket(["- `src/missing.mjs` — Locate the missing entry point."]),
  });
  assert.equal(codes(missing).includes("CONTEXT_ANCHOR_NOT_FOUND"), true);

  const directory = checkTicketContext({
    repo: repository,
    base: baseOne,
    body: ticket(["- `src` — Locate the implementation directory."]),
  });
  assert.equal(codes(directory).includes("CONTEXT_ANCHOR_NOT_BLOB"), true);
});

test("absolute, parent-traversal, and glob anchors are rejected", () => {
  for (const anchorPath of ["/tmp/file.mjs", "src/../test/behavior.test.mjs", "src/*.mjs"]) {
    const result = checkTicketContext({
      repo: repository,
      base: baseOne,
      body: ticket([`- \`${anchorPath}\` — Locate an entry point.`]),
    });
    assert.equal(codes(result).includes("INVALID_CONTEXT_ANCHOR_PATH"), true, anchorPath);
  }
});

test("duplicate anchors and entries without a purpose are rejected", () => {
  const duplicate = checkTicketContext({
    repo: repository,
    base: baseOne,
    body: ticket([
      "- `src/file-1.mjs` — Locate the entry point.",
      "- `src/file-1.mjs` — Locate the same entry point.",
    ]),
  });
  assert.equal(codes(duplicate).includes("DUPLICATE_CONTEXT_ANCHOR"), true);

  const noPurpose = checkTicketContext({
    repo: repository,
    base: baseOne,
    body: ticket(["- `src/file-1.mjs` —"]),
  });
  assert.equal(codes(noPurpose).includes("INVALID_CONTEXT_ANCHOR"), true);
});

test("more than five anchors and broad read-docs instructions are rejected", () => {
  const tooMany = checkTicketContext({
    repo: repository,
    base: baseOne,
    body: ticket(Array.from({ length: 6 }, (_, index) => (
      `- \`src/file-${index + 1}.mjs\` — Locate entry point ${index + 1}.`
    ))),
  });
  assert.equal(codes(tooMany).includes("TOO_MANY_CONTEXT_ANCHORS"), true);

  const broad = checkTicketContext({
    repo: repository,
    base: baseOne,
    body: ticket(["- `docs/adr/0001-owner.md` — read docs/"]),
  });
  assert.equal(codes(broad).includes("BROAD_CONTEXT_ANCHOR_PURPOSE"), true);
});

test("historical, example, fixture, and draft sources cannot be Context anchors", () => {
  for (const anchorPath of [
    "docs/historical/plan.md",
    "fixtures/example.json",
    "examples/sample.md",
    "drafts/plan.md",
  ]) {
    const result = checkTicketContext({
      repo: repository,
      base: baseOne,
      body: ticket([`- \`${anchorPath}\` — Locate a supporting source.`]),
    });
    assert.equal(codes(result).includes("DISALLOWED_CONTEXT_ANCHOR_SOURCE"), true, anchorPath);
  }
});

test("body hash and digest are stable for exact inputs", () => {
  const body = ticket(["- `src/file-1.mjs` — Locate the current behavior entry point."]);
  const first = checkTicketContext({ repo: repository, base: baseOne, body });
  const second = checkTicketContext({ repo: repository, base: baseOne, body });
  assert.equal(first.bodyHash, second.bodyHash);
  assert.equal(first.digest, second.digest);
});

test("a base change changes the result and its anchored blob", () => {
  const body = ticket(["- `src/file-1.mjs` — Locate the current behavior entry point."]);
  const first = checkTicketContext({ repo: repository, base: baseOne, body });
  const second = checkTicketContext({ repo: repository, base: baseTwo, body });
  assert.notEqual(first.baseSha, second.baseSha);
  assert.notEqual(first.anchors[0].blobSha, second.anchors[0].blobSha);
  assert.notEqual(first.digest, second.digest);
});

test("Admission binding rejects missing, failed, body-drifted, and base-drifted checks", () => {
  const body = ticket();
  const candidate = { id: "C01", body };
  const pass = checkTicketContext({ repo: repository, base: baseOne, body });
  assert.deepEqual(verifyCandidateContextChecks({
    repositoryPath: repository,
    candidates: [candidate],
    baseSha: baseOne,
    contextChecks: [{ candidateId: "C01", result: pass }],
  }), []);

  assert.equal(verifyCandidateContextChecks({ repositoryPath: repository, candidates: [candidate], baseSha: baseOne }).some(({ code }) => code === "MISSING_CONTEXT_CHECKS"), true);
  const failed = buildTicketContextResult({ baseSha: baseOne, body, problems: [{ code: "CONTEXT_ANCHOR_NOT_FOUND" }] });
  assert.equal(verifyCandidateContextChecks({
    repositoryPath: repository,
    candidates: [candidate],
    baseSha: baseOne,
    contextChecks: [{ candidateId: "C01", result: failed }],
  }).some(({ code }) => code === "CONTEXT_CHECK_FAILED"), true);
  assert.equal(verifyCandidateContextChecks({
    repositoryPath: repository,
    candidates: [{ id: "C01", body: `${body}drift` }],
    baseSha: baseOne,
    contextChecks: [{ candidateId: "C01", result: pass }],
  }).some(({ code }) => code === "CONTEXT_CHECK_BODY_HASH_MISMATCH"), true);
  assert.equal(verifyCandidateContextChecks({
    repositoryPath: repository,
    candidates: [candidate],
    baseSha: baseTwo,
    contextChecks: [{ candidateId: "C01", result: pass }],
  }).some(({ code }) => code === "CONTEXT_CHECK_BASE_SHA_MISMATCH"), true);

  const malformed = structuredClone(pass);
  malformed.anchors = {};
  assert.equal(verifyCandidateContextChecks({
    repositoryPath: repository,
    candidates: [candidate],
    baseSha: baseOne,
    contextChecks: [{ candidateId: "C01", result: malformed }],
  }).some(({ code }) => code === "INVALID_CONTEXT_CHECK_ANCHORS"), true);
});

test("Admission rejects a self-consistent PASS with a forged anchor blob", () => {
  const body = ticket(["- `src/missing-at-base.mjs` — Locate the behavior entry point."]);
  const forged = buildTicketContextResult({
    baseSha: baseOne,
    body,
    anchors: [{
      path: "src/missing-at-base.mjs",
      blobSha: "b".repeat(40),
      purpose: "Locate the behavior entry point.",
    }],
  });
  const problems = verifyCandidateContextChecks({
    repositoryPath: repository,
    candidates: [{ id: "C01", body }],
    baseSha: baseOne,
    contextChecks: [{ candidateId: "C01", result: forged }],
  });
  assert.equal(problems.some(({ code }) => code === "CONTEXT_CHECK_RECHECK_FAILED"), true);
  assert.equal(problems.some(({ code }) => code === "CONTEXT_CHECK_RESULT_MISMATCH"), true);
});

test("current implementation and COMMITTED target behavior are not mechanically treated as a conflict", () => {
  const body = [
    "# Batch creation",
    "",
    "## Starting state",
    "The reviewed-base implementation creates one record per request.",
    "",
    "## What to build",
    "The COMMITTED Release requires one request to create a bounded batch.",
  ].join("\n");
  assert.equal(checkTicketContext({ repo: repository, base: baseOne, body }).ok, true);
});
