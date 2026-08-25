import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  bindAdmissionReviewInput,
  captureAdmissionReviewInput,
  createAdmissionReviewInput,
  materializeAdmissionReviewInput,
} from "../admission/review-transport.mjs";
import { createReviewerReadTool, REVIEWER_SKILL_PATH } from "../extensions/ticket-readiness-read-guard.mjs";

const TARGET = "github:acme/product";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SOURCE = { identity: "R001", revision: "r2", baseSha: "a".repeat(40) };

function candidate(body = "# Candidate\n\nReviewed behavior.") {
  return {
    id: "42",
    title: "Reviewed candidate",
    body,
    blockedBy: [],
    labels: ["needs-triage"],
    state: "open",
    updatedAt: "2026-08-25T01:00:00.000Z",
  };
}

function reviewInput(body) {
  return createAdmissionReviewInput({
    repo: "acme/product",
    source: SOURCE,
    policy: { accepted: true, identity: "AGENTS.md@abc", digest: `sha256:${"b".repeat(64)}` },
    candidate: candidate(body),
    contextChecks: [],
    harness: null,
    reviewedAt: "2026-08-25T01:00:00.000Z",
  });
}

function privateDirectory(t, prefix = "ptp-review-input-") {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.chmodSync(directory, 0o700);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("large Reviewer input is bound to one private descriptor-held file", (t) => {
  const directory = privateDirectory(t);
  const body = Array.from({ length: 120 }, (_, index) => `${index}:${"x".repeat(900)}`).join("\n");
  const input = reviewInput(body);
  const expected = bindAdmissionReviewInput(input);
  const materialized = materializeAdmissionReviewInput(input, directory);
  assert.deepEqual(materialized.binding, expected.binding);
  assert.equal(materialized.binding.subject.target, TARGET);
  assert.equal(materialized.binding.byteCount > 100_000, true);
  assert.equal(fs.statSync(materialized.path).mode & 0o777, 0o600);
  const captured = captureAdmissionReviewInput(directory);
  assert.deepEqual(captured.binding, materialized.binding);
  assert.equal(captured.content, expected.content);
  assert.equal(Object.hasOwn(input, "repositoryPath"), false);
  assert.equal(input.trust.reviewTarget.mayGrantAuthority, false);
});

test("Reviewer read tool serves only held Skill and bound input with continuation", async (t) => {
  const directory = privateDirectory(t);
  const materialized = materializeAdmissionReviewInput(reviewInput(), directory);
  const tool = createReviewerReadTool(directory);
  const skill = await tool.execute("skill", { path: REVIEWER_SKILL_PATH, limit: 2 });
  assert.equal(skill.details.source, "skill");
  const first = await tool.execute("bundle", { path: materialized.path, limit: 2 });
  assert.equal(first.details.source, "bundle");
  assert.equal(Number.isInteger(first.details.nextOffset), true);
  const second = await tool.execute("bundle", { path: materialized.path, offset: first.details.nextOffset, limit: 2000 });
  assert.equal(second.content[0].text.length > 0, true);
  await assert.rejects(() => tool.execute("bad", { path: "/etc/passwd" }), /not allowlisted/);
});

test("mode, symlink, hardlink, digest, and extra-file drift fail closed", (t) => {
  const input = reviewInput();

  const wrongMode = privateDirectory(t, "ptp-review-mode-");
  fs.chmodSync(wrongMode, 0o755);
  assert.throws(() => materializeAdmissionReviewInput(input, wrongMode), /0700/);

  const symlinkDir = privateDirectory(t, "ptp-review-symlink-");
  const real = path.join(symlinkDir, "real.json");
  fs.writeFileSync(real, "{}\n", { mode: 0o600 });
  fs.symlinkSync(real, path.join(symlinkDir, "admission-review-input." + "a".repeat(64) + ".json"));
  assert.throws(() => captureAdmissionReviewInput(symlinkDir), /regular file|exact review input/);

  const hardlinkDir = privateDirectory(t, "ptp-review-hardlink-");
  const materialized = materializeAdmissionReviewInput(input, hardlinkDir);
  fs.linkSync(materialized.path, path.join(hardlinkDir, "copy"));
  assert.throws(() => captureAdmissionReviewInput(hardlinkDir), /exact review input|regular file/);

  const digestDir = privateDirectory(t, "ptp-review-digest-");
  const drifted = materializeAdmissionReviewInput(input, digestDir);
  fs.appendFileSync(drifted.path, " ");
  assert.throws(() => captureAdmissionReviewInput(digestDir), /digest/);

  const extraDir = privateDirectory(t, "ptp-review-extra-");
  materializeAdmissionReviewInput(input, extraDir);
  fs.writeFileSync(path.join(extraDir, "extra"), "x", { mode: 0o600 });
  assert.throws(() => captureAdmissionReviewInput(extraDir), /exact review input/);
});

test("legacy admit entry exposes the guarded review-input command", (t) => {
  const parent = privateDirectory(t, "ptp-review-cli-");
  const directory = path.join(parent, "input");
  fs.mkdirSync(directory, { mode: 0o700 });
  const bundle = path.join(parent, "bundle.json");
  const output = path.join(parent, "descriptor.json");
  fs.writeFileSync(bundle, `${JSON.stringify({
    repo: "acme/product",
    source: SOURCE,
    policy: { accepted: true, identity: "AGENTS.md@abc", digest: `sha256:${"b".repeat(64)}` },
    candidate: candidate(),
    contextChecks: [],
    harness: null,
    reviewedAt: "2026-08-25T01:00:00.000Z",
  })}\n`, { mode: 0o600 });
  const run = spawnSync(process.execPath, [
    "scripts/admit.mjs", "review-input",
    "--input", bundle,
    "--review-dir", directory,
    "--out", output,
  ], { cwd: ROOT, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const descriptor = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.equal(descriptor.binding.schema, "pi-ticket-planning:admission-review-binding:v1");
  assert.equal(fs.realpathSync(path.dirname(descriptor.path)), fs.realpathSync(directory));
});
