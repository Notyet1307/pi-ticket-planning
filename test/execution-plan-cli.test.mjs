import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateArtifact } from "../protocol/kernel.mjs";
import {
  compiledFixture,
  executionInput,
} from "./execution-plan-fixture.mjs";
import { createReadyCase } from "./execution-handoff-fixture.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function writeJson(directory, name, value) {
  const file = path.join(directory, name);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return file;
}

function controllerFiles(directory) {
  const cli = path.join(directory, "controller-cli.mjs");
  const config = path.join(directory, "controller.json");
  const record = path.join(directory, "controller-argv.jsonl");
  fs.writeFileSync(cli, `import fs from "node:fs";
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_CONTROLLER_RECORD, JSON.stringify(args) + "\\n");
if (args[0] === "config") console.log(JSON.stringify({ok:true,config:{repo:"acme/product",baseRef:"main",policy:{maxIssues:2},review:{enabled:true}},configDigest:"${"a".repeat(64)}"}));
else if (args[0] === "plan") console.log(JSON.stringify({ok:true,plan:JSON.parse(fs.readFileSync(args[args.indexOf("--plan") + 1], "utf8")),planDigest:"${"c".repeat(64)}"}));
else if (args[0] === "doctor") console.log(JSON.stringify({ok:true}));
else process.exit(9);
`, { mode: 0o700, flag: "wx" });
  fs.writeFileSync(config, "{}\n", { mode: 0o600, flag: "wx" });
  return { cli, config, record };
}

function run(args, env = {}) {
  return spawnSync(process.execPath, ["scripts/execution-plan.mjs", ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 30_000,
  });
}

test("execution-plan CLI builds, verifies, and applies through only the Controller public contract", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "execution-plan-cli-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const controller = controllerFiles(directory);
  const input = executionInput();
  const inputFile = writeJson(directory, "input.json", input);
  const planFile = path.join(directory, "handoff-plan.json");
  const env = { TEST_CONTROLLER_RECORD: controller.record };

  const built = run([
    "build", "--input", inputFile,
    "--controller-cli", controller.cli,
    "--controller-config", controller.config,
    "--out", planFile,
    "--json",
  ], env);
  assert.equal(built.status, 0, built.stderr);
  assert.equal(fs.lstatSync(planFile).mode & 0o777, 0o600);
  const plan = JSON.parse(fs.readFileSync(planFile, "utf8"));
  assert.equal(validateArtifact(plan).ok, true);

  const verified = run([
    "verify", "--plan", planFile, "--input", inputFile,
    "--controller-cli", controller.cli,
    "--controller-config", controller.config,
    "--json",
  ], env);
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).status, "READY");

  const now = new Date().toISOString();
  const stateDir = path.join(directory, "state");
  const ready = createReadyCase({ stateDir, plan, now, caseId: "PC-cli-handoff" });
  const outputDir = path.join(directory, "output");
  const applied = run([
    "apply", "--plan", planFile, "--input", inputFile,
    "--expected-fingerprint", plan.planFingerprint,
    "--case-id", ready.caseId,
    "--approval-id", ready.approval.id,
    "--controller-cli", controller.cli,
    "--controller-config", controller.config,
    "--output-dir", outputDir,
    "--json",
  ], { ...env, PI_TICKET_PLAN_STATE_DIR: stateDir });
  assert.equal(applied.status, 0, applied.stderr);
  const result = JSON.parse(applied.stdout);
  assert.equal(result.status, "COMPLETE");
  assert.match(result.nextCommand, new RegExp(controller.cli.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(result.nextCommand, new RegExp(controller.config.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(result.nextCommand, /release-plan\.json/);

  const calls = fs.readFileSync(controller.record, "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(calls.map(([first, second]) => `${first}:${second}`), [
    "config:validate", "plan:validate",
    "config:validate", "plan:validate", "doctor:--config",
    "config:validate", "plan:validate", "doctor:--config",
  ]);
  assert.equal(calls.flat().some((value) => /^(start|run|step)$/.test(value)), false);

  const forbidden = run(["build", "--input", inputFile, "--harness-cli", controller.cli, "--controller-cli", controller.cli, "--controller-config", controller.config], env);
  assert.equal(forbidden.status, 2);
  assert.match(forbidden.stderr, /UNKNOWN_OPTION:harness-cli/);
});

test("execution-plan live GitHub convenience performs reads only", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "execution-plan-live-cli-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const controller = controllerFiles(directory);
  const input = executionInput();
  const contextFile = writeJson(directory, "context.json", input);
  const reviewFile = writeJson(directory, "review.json", input.review);
  const reviewBindingFile = writeJson(directory, "review-binding.json", input.reviewBinding);
  const dispatchFile = writeJson(directory, "review-dispatch.json", input.reviewDispatchBinding);
  const planFile = path.join(directory, "live-handoff-plan.json");
  const gh = path.join(directory, "gh");
  const ghRecord = path.join(directory, "gh-argv.jsonl");
  const parent = input.parent;
  const child = input.children[0];
  fs.writeFileSync(gh, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_GH_RECORD, JSON.stringify(args) + "\\n");
if (args.includes("--method")) process.exit(90);
const endpoint = args.at(-1);
if (endpoint === "user") console.log(JSON.stringify({login:"reader"}));
else if (endpoint === "repos/acme/product/issues/100") console.log(${JSON.stringify(JSON.stringify({ number: 100, title: parent.title, body: parent.body, state: "open", updated_at: parent.updatedAt, labels: [{ name: "needs-triage" }], assignees: [] }))});
else if (endpoint === "repos/acme/product/issues/101") console.log(${JSON.stringify(JSON.stringify({ number: 101, title: child.title, body: child.body, state: "open", updated_at: child.updatedAt, labels: [{ name: "needs-triage" }], assignees: [] }))});
else if (endpoint.includes("/sub_issues")) console.log(JSON.stringify([[{number:101,assignees:[]}]]));
else if (endpoint.includes("/comments") || endpoint.includes("/dependencies/blocked_by")) console.log(JSON.stringify([[]]));
else process.exit(91);
`, { mode: 0o700, flag: "wx" });

  const result = run([
    "build", "--repo", input.repo, "--parent", input.parent.id,
    "--review", reviewFile,
    "--review-binding", reviewBindingFile,
    "--review-dispatch-binding", dispatchFile,
    "--context", contextFile,
    "--controller-cli", controller.cli,
    "--controller-config", controller.config,
    "--out", planFile,
    "--json",
  ], {
    PATH: `${directory}${path.delimiter}${process.env.PATH}`,
    TEST_GH_RECORD: ghRecord,
    TEST_CONTROLLER_RECORD: controller.record,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(validateArtifact(JSON.parse(fs.readFileSync(planFile, "utf8"))).ok, true);
  const calls = fs.readFileSync(ghRecord, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(calls.length > 0, true);
  assert.equal(calls.some((args) => args.includes("--method") || args.some((value) => /^(POST|PATCH|PUT|DELETE)$/.test(value))), false);
});

test("profile launcher dispatches execution-plan without starting PI", () => {
  const result = spawnSync(path.join(ROOT, "profile", "pi-ticket-plan"), ["execution-plan"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 15_000,
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /USAGE: execution-plan build\|verify\|apply/);
});
