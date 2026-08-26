import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildPlanningSessionBinding,
  githubBindingDigest,
  validatePlanningCaseBinding,
  verifyPlanningCaseBindings,
} from "../planning-case/bindings.mjs";
import { buildOutcomeReceipt } from "../outcome/ingest.mjs";
import { qualifiedCapability } from "./capability-fixture.mjs";
import { harnessReadiness } from "./readiness-fixture.mjs";

const TARGET = "github:acme/product";
const NOW = new Date().toISOString();
const hash = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const snapshot = { target: TARGET };

function binding(verification, overrides = {}) {
  return {
    schema: "pi-ticket-planning:planning-case-binding:v1",
    target: TARGET,
    revision: "r1",
    baseSha: "a".repeat(40),
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

test("GitHub Binding hashes a validated stable projection", () => {
  const ref = "repos/acme/product/git/ref/heads/main";
  const response = { url: "volatile", ref: "refs/heads/main", node_id: "extra", object: { url: "volatile", sha: "a".repeat(40), type: "commit" } };
  const expected = githubBindingDigest(ref, response);
  assert.equal(githubBindingDigest(ref, { object: { type: "commit", sha: "a".repeat(40) }, ref: "refs/heads/main", extra: true }), expected);
  const github = binding({ kind: "GITHUB", ref, digest: expected });
  const execute = () => ({ status: 0, stdout: JSON.stringify(response), stderr: "" });
  assert.deepEqual(verifyPlanningCaseBindings({ source: github }, snapshot, { now: NOW, execute }), []);
  assert.equal(verifyPlanningCaseBindings({ source: github }, snapshot, { now: NOW, execute: () => ({ status: 0, stdout: "{}", stderr: "" }) })[0].code, "GITHUB_BINDING_RESPONSE_INVALID");
});

test("Planning Case session Binding preserves exact ID, file digest, provider, model, and profile", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-session-binding-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "session.jsonl");
  fs.writeFileSync(file, `${JSON.stringify({ id: "session-1", cwd: directory })}\n`, { mode: 0o600 });
  const session = buildPlanningSessionBinding({
    target: TARGET,
    revision: "r1",
    baseSha: "a".repeat(40),
    sessionId: "session-1",
    sessionFile: file,
    provider: "openai-codex",
    model: "gpt-test",
    profileDigest: hash("profile"),
    observedAt: NOW,
  });
  assert.deepEqual(validatePlanningCaseBinding("session", session, TARGET, { now: NOW }), []);
  assert.deepEqual(verifyPlanningCaseBindings({ session }, snapshot, { now: NOW }), []);
  fs.appendFileSync(file, "drift\n");
  assert.equal(verifyPlanningCaseBindings({ session }, snapshot, { now: NOW })[0].code, "BINDING_READBACK_DRIFT");
});

test("cross-Binding target, revision, and base relationships fail closed", () => {
  const source = binding({ kind: "GITHUB", ref: "repos/acme/product/git/ref/heads/main", digest: hash("source") });
  const release = binding({ kind: "GITHUB", ref: "repos/acme/product/git/ref/heads/main", digest: hash("release") });
  assert.deepEqual(verifyPlanningCaseBindings({ source, release }, snapshot, { offline: true, now: NOW }), []);
  const drift = { ...release, revision: "r2" };
  assert.equal(verifyPlanningCaseBindings({ source, release: drift }, snapshot, { offline: true, now: NOW })[0].code, "CROSS_BINDING_REVISION_MISMATCH");
  assert.equal(verifyPlanningCaseBindings({ source, release: { ...release, baseSha: "b".repeat(40) } }, snapshot, { offline: true, now: NOW })[0].code, "CROSS_BINDING_BASE_MISMATCH");
  assert.equal(verifyPlanningCaseBindings({ source, release: { ...release, target: "github:acme/other" } }, snapshot, { offline: true, now: NOW })[0].code, "CROSS_BINDING_TARGET_MISMATCH");
});

test("all release/source/spec/graph/policy/harness/capability/outcome Bindings share one target, revision, and base", () => {
  const baseSha = "a".repeat(40);
  const generic = binding({ kind: "GITHUB", ref: "repos/acme/product/git/ref/heads/main", digest: hash("stable") }, { revision: baseSha, baseSha });
  const harness = harnessReadiness("acme/product", baseSha, { observedAt: NOW });
  const capability = qualifiedCapability("acme/product", baseSha, harness, NOW).receipt;
  const outcome = buildOutcomeReceipt({
    id: "OR-binding-relation",
    subject: { target: TARGET, kind: "ticket", id: "42", revision: baseSha, digest: hash("subject") },
    baseSha,
    source: { kind: "harness", producer: "herdr-harness", producerVersion: "test", producerDigest: hash("harness") },
    observedAt: NOW,
    status: "ACHIEVED",
    evidence: [{ kind: "terminal", ref: "job:42", digest: hash("terminal") }],
  });
  const bindings = { source: generic, release: generic, spec: generic, graph: generic, policy: generic, harness, capability, outcome };
  assert.deepEqual(verifyPlanningCaseBindings(bindings, snapshot, { offline: true, now: NOW }), []);
  assert.equal(verifyPlanningCaseBindings({ ...bindings, outcome: { ...outcome, baseSha: "b".repeat(40) } }, snapshot, { offline: true, now: NOW })[0].code, "CROSS_BINDING_BASE_MISMATCH");
});
