import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { validatePlanningCaseBinding, verifyPlanningCaseBindings } from "../planning-case/bindings.mjs";

const TARGET = "github:acme/product";
const NOW = new Date().toISOString();
const hash = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const snapshot = { target: TARGET };

function binding(verification, overrides = {}) {
  return {
    schema: "pi-ticket-planning:planning-case-binding:v1",
    target: TARGET,
    revision: "r1",
    digest: hash("artifact"),
    producer: "test",
    observedAt: NOW,
    expiresAt: null,
    verification,
    ...overrides,
  };
}

test("Binding verifiers cover file, Git, offline, and unsafe readback", (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-binding-test-"));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const file = path.join(temporary, "source.txt");
  fs.writeFileSync(file, "source\n", { mode: 0o600 });
  const fileBinding = binding({ kind: "FILE", ref: file, digest: hash("source\n") });
  assert.deepEqual(validatePlanningCaseBinding("source", fileBinding, TARGET, { now: NOW }), []);
  assert.deepEqual(verifyPlanningCaseBindings({ source: fileBinding }, snapshot, { now: NOW }), []);
  fs.writeFileSync(file, "drift\n", { mode: 0o600 });
  assert.equal(verifyPlanningCaseBindings({ source: fileBinding }, snapshot, { now: NOW })[0].code, "BINDING_READBACK_DRIFT");
  assert.deepEqual(verifyPlanningCaseBindings({ source: fileBinding }, snapshot, { offline: true, now: NOW }), []);

  assert.equal(validatePlanningCaseBinding("missing", fileBinding, TARGET)[0].code, "INVALID_BINDING");
  assert.equal(validatePlanningCaseBinding("source", { schema: "bad" }, TARGET)[0].code, "INVALID_BINDING");
  assert.equal(validatePlanningCaseBinding("source", binding({ kind: "FILE", ref: file, digest: hash("drift\n") }, { target: "github:other/repo" }), TARGET)[0].code, "BINDING_TARGET_MISMATCH");
  const expired = binding({ kind: "FILE", ref: file, digest: hash("drift\n") }, { expiresAt: "2020-01-01T00:00:00Z" });
  assert.equal(validatePlanningCaseBinding("source", expired, TARGET, { now: NOW }).some(({ code }) => code === "BINDING_EXPIRED"), true);

  const repo = path.join(temporary, "repo");
  fs.mkdirSync(repo);
  for (const args of [["init"], ["config", "user.email", "test@example.com"], ["config", "user.name", "Test"]]) {
    assert.equal(spawnSync("git", ["-C", repo, ...args]).status, 0);
  }
  fs.writeFileSync(path.join(repo, "a.txt"), "a\n");
  assert.equal(spawnSync("git", ["-C", repo, "add", "a.txt"]).status, 0);
  assert.equal(spawnSync("git", ["-C", repo, "commit", "-m", "test"], { encoding: "utf8" }).status, 0);
  const head = spawnSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  const gitBinding = binding({ kind: "GIT", ref: repo, digest: hash(head) });
  assert.deepEqual(verifyPlanningCaseBindings({ source: gitBinding }, snapshot, { now: NOW }), []);

  const unsafeGitHub = binding({ kind: "GITHUB", ref: "unsafe", digest: hash("x") });
  assert.equal(verifyPlanningCaseBindings({ source: unsafeGitHub }, snapshot, { now: NOW }).some(({ code }) => code === "UNSAFE_BINDING_SOURCE"), true);
  const unknown = binding({ kind: "UNKNOWN", ref: file, digest: hash("x") });
  assert.equal(verifyPlanningCaseBindings({ source: unknown }, snapshot, { now: NOW }).some(({ code }) => code === "UNKNOWN_BINDING_VERIFIER"), true);

  const link = path.join(temporary, "link");
  fs.symlinkSync(file, link);
  const unsafeFile = binding({ kind: "HARNESS", ref: link, digest: hash("drift\n") });
  assert.equal(verifyPlanningCaseBindings({ source: unsafeFile }, snapshot, { now: NOW }).some(({ code }) => code === "UNSAFE_BINDING_SOURCE"), true);
});
