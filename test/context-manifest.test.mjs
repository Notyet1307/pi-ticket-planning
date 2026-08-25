import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { verifyContext } from "../scripts/verify-context.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

test("route Context Manifests stay bounded and keep Reviewer input isolated", () => {
  const result = verifyContext({ root: ROOT });
  assert.equal(result.ok, true, JSON.stringify(result.problems));
  assert.equal(result.manifests >= 4, true);
  assert.deepEqual(result.problems, []);
});

test("Context verifier rejects missing, over-budget, and author-reasoning inputs", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-context-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "context", "manifests"), { recursive: true });
  fs.mkdirSync(path.join(root, "skills", "admit-ticket"), { recursive: true });
  fs.writeFileSync(path.join(root, "skills", "admit-ticket", "SKILL.md"), "author reasoning\n");
  fs.writeFileSync(path.join(root, "large.md"), "x".repeat(100));
  fs.writeFileSync(path.join(root, "context", "manifests", "bad.json"), JSON.stringify({
    schema: "pi-ticket-planning:context-manifest:v1",
    route: "DELIVERY/ADMISSION/REVIEW_IN_PROGRESS",
    required: ["skills/admit-ticket/SKILL.md", "large.md", "missing.md"],
    optional: [],
    maxBytes: 10,
    maxEstimatedTokens: 10,
    maxDocuments: 3,
  }));
  const codes = verifyContext({ root }).problems.map(({ code }) => code);
  assert.equal(codes.includes("CONTEXT_FILE_MISSING"), true);
  assert.equal(codes.includes("CONTEXT_BYTE_BUDGET_EXCEEDED"), true);
  assert.equal(codes.includes("REVIEWER_AUTHOR_REASONING_INCLUDED"), true);
});

test("Context verifier detects local Markdown reference cycles", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-context-cycle-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "context", "manifests"), { recursive: true });
  fs.writeFileSync(path.join(root, "a.md"), "[b](b.md)\n");
  fs.writeFileSync(path.join(root, "b.md"), "[a](a.md)\n");
  fs.writeFileSync(path.join(root, "context", "manifests", "cycle.json"), JSON.stringify({
    schema: "pi-ticket-planning:context-manifest:v1",
    route: "PRODUCT/FRAME/FRAME_CANDIDATE",
    required: ["a.md", "b.md"],
    optional: [],
    maxBytes: 1000,
    maxEstimatedTokens: 1000,
    maxDocuments: 2,
  }));
  assert.equal(verifyContext({ root }).problems.some(({ code }) => code === "CONTEXT_REFERENCE_CYCLE"), true);
});
