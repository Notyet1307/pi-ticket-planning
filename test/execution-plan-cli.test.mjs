import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { fingerprint, releasePlanDigest } from "../execution-plan/domain.mjs";
import { createGoalHandoffApproval } from "../planning-case/cli.mjs";
import { validateReleasePlan } from "../execution-plan/release-contract.mjs";
import { createReadyCase } from "./execution-handoff-fixture.mjs";
import { createFreshnessFixture } from "./execution-freshness-fixture.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function writeJson(directory, name, value) {
  const file = path.join(directory, name);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  return file;
}

function run(args, env = {}) {
  return spawnSync(process.execPath, ["scripts/execution-plan.mjs", ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 90_000,
  });
}

function liveFiles(directory, input) {
  return {
    context: writeJson(directory, "context.json", input),
    review: writeJson(directory, "review.json", input.review),
    reviewBinding: writeJson(directory, "review-binding.json", input.reviewBinding),
    reviewDispatch: writeJson(directory, "review-dispatch.json", input.reviewDispatchBinding),
  };
}

function githubFiles(directory, input) {
  const gh = path.join(directory, "gh");
  const record = path.join(directory, "gh-argv.jsonl");
  const parent = input.parent;
  const child = input.children[0];
  fs.writeFileSync(gh, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_GH_RECORD, JSON.stringify(args) + "\\n");
if (args.includes("--method")) process.exit(90);
const endpoint = args.at(-1);
if (endpoint === "user") console.log(JSON.stringify({login:"reader"}));
else if (endpoint === "repos/acme/product/git/ref/heads/main") console.log(JSON.stringify({object:{sha:"${input.source.baseSha}"}}));
else if (endpoint === "repos/acme/product/issues/100") console.log(${JSON.stringify(JSON.stringify({ number: 100, title: parent.title, body: parent.body, state: "open", updated_at: parent.updatedAt, labels: [{ name: "needs-triage" }], assignees: [] }))});
else if (endpoint === "repos/acme/product/issues/101") console.log(${JSON.stringify(JSON.stringify({ number: 101, title: child.title, body: child.body, state: "open", updated_at: child.updatedAt, labels: [{ name: "needs-triage" }], assignees: [] }))});
else if (endpoint.includes("/sub_issues")) console.log(JSON.stringify([[{number:101,assignees:[]}]]));
else if (endpoint.includes("/comments") || endpoint.includes("/dependencies/blocked_by")) console.log(JSON.stringify([[]]));
else process.exit(91);
`, { mode: 0o700, flag: "wx" });
  return { gh, record };
}

test("execution-plan CLI builds, verifies, and applies one semantic Plan", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "execution-plan-cli-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { input } = createFreshnessFixture(t);
  const live = liveFiles(directory, input);
  const github = githubFiles(directory, input);
  const planFile = path.join(directory, "release-plan.json");
  const env = { TEST_GH_RECORD: github.record, PATH: `${directory}${path.delimiter}${process.env.PATH}` };
  const common = ["--review", live.review, "--review-binding", live.reviewBinding, "--review-dispatch-binding", live.reviewDispatch, "--context", live.context];

  const built = run(["build", "--repo", input.repo, "--parent", input.parent.id, ...common, "--out", planFile, "--json"], env);
  assert.equal(built.status, 0, built.stderr);
  const plan = JSON.parse(fs.readFileSync(planFile, "utf8"));
  assert.deepEqual(validateReleasePlan(plan), []);
  assert.equal(fs.lstatSync(planFile).mode & 0o777, 0o600);

  const verified = run(["verify", "--plan", planFile, ...common, "--json"], env);
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).status, "READY");

  const stateDir = path.join(directory, "state");
  const ready = createReadyCase({ stateDir, plan, now: new Date().toISOString(), caseId: "PC-cli-handoff" });
  const outputDir = path.join(directory, "output");
  const controllerCli = path.join(directory, "controller-cli.js");
  const controllerConfig = path.join(directory, "controller.json");
  fs.writeFileSync(controllerCli, "// command path only\n", { mode: 0o700 });
  fs.writeFileSync(controllerConfig, "{}\n", { mode: 0o600 });
  const applied = run([
    "apply", "--plan", planFile, ...common,
    "--expected-fingerprint", fingerprint(plan), "--case-id", ready.caseId, "--approval-id", ready.approval.id,
    "--controller-cli", controllerCli, "--controller-config", controllerConfig, "--output-dir", outputDir, "--json",
  ], { ...env, PI_TICKET_PLAN_STATE_DIR: stateDir });
  assert.equal(applied.status, 0, applied.stderr);
  const result = JSON.parse(applied.stdout);
  assert.equal(result.status, "COMPLETE");
  assert.match(result.nextCommand, new RegExp(`--approve-plan '${releasePlanDigest(plan)}'`));
  assert.equal(/expected-controller|expected-config|provenance/u.test(result.nextCommand), false);
  assert.deepEqual(fs.readdirSync(outputDir), ["release-plan.json"]);
  const githubCalls = fs.readFileSync(github.record, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(githubCalls.some((args) => args.includes("--method")), false);
});

test("execution-plan CLI rejects Controller coupling and offline bypass options", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "execution-plan-options-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const inputFile = writeJson(directory, "input.json", {});
  for (const option of ["--input", "--expected-controller-revision", "--expected-controller-provenance-digest"]) {
    const result = run(["build", "--repo", "acme/product", "--parent", "100", "--context", inputFile, option, "x"]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /UNKNOWN_OPTION/);
  }
});

test("execution-plan CLI builds and applies exact local and remote Goal handoffs", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "goal-execution-plan-cli-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const { input } = createFreshnessFixture(t);
  const live = liveFiles(directory, input);
  const github = githubFiles(directory, input);
  const planFile = path.join(directory, "release-plan.json");
  const env = { TEST_GH_RECORD: github.record, PATH: `${directory}${path.delimiter}${process.env.PATH}` };
  const sshRecord = path.join(directory, "ssh-record.json");
  fs.writeFileSync(path.join(directory, "ssh"), `#!/usr/bin/env node
const fs=require("node:fs");(async()=>{let input="";for await(const chunk of process.stdin)input+=chunk;fs.writeFileSync(process.env.TEST_SSH_RECORD,JSON.stringify({args:process.argv.slice(2),input}));})();
`, { mode: 0o700 });
  env.TEST_SSH_RECORD = sshRecord;
  const common = ["--review", live.review, "--review-binding", live.reviewBinding, "--review-dispatch-binding", live.reviewDispatch, "--context", live.context];
  assert.equal(run(["build", "--repo", input.repo, "--parent", input.parent.id, ...common, "--out", planFile, "--json"], env).status, 0);
  const plan = JSON.parse(fs.readFileSync(planFile, "utf8"));
  const runners = writeJson(directory, "goal-runners.json", {
    schema: "pi-ticket-planning:goal-runner-config:v1",
    runners: [
      { ref: "local", transport: "local", host: "test.local", sshHost: null, runnerCli: "/opt/herdr/goal-cli.js", runnerConfig: "/private/goal-config.json" },
      { ref: "mac-mini", transport: "ssh", host: "mac-mini.local", sshHost: "mac-mini", runnerCli: "/opt/herdr/goal-cli.js", runnerConfig: "/private/goal-config.json" },
    ],
  });
  const unconfigured = run(["goal-build", "--plan", planFile, ...common, "--channel", "GOAL_REMOTE", "--runner-ref", "attacker.example", "--runners", runners, "--out", path.join(directory, "unconfigured.json"), "--json"], env);
  assert.equal(unconfigured.status, 2);
  assert.match(unconfigured.stderr, /GOAL_RUNNER_UNCONFIGURED/u);

  for (const [channel, runnerRef] of [["GOAL_LOCAL", "local"], ["GOAL_REMOTE", "mac-mini"]]) {
    const handoffFile = path.join(directory, `${channel}.json`);
    const built = run(["goal-build", "--plan", planFile, ...common, "--channel", channel, "--runner-ref", runnerRef, "--runners", runners, "--out", handoffFile, "--json"], env);
    assert.equal(built.status, 0, built.stderr);
    const buildResult = JSON.parse(built.stdout);
    const handoff = JSON.parse(fs.readFileSync(handoffFile, "utf8"));
    assert.equal(buildResult.handoffFingerprint, fingerprint(handoff));
    assert.equal(handoff.channel, channel);
    assert.equal(handoff.planDigest, releasePlanDigest(plan));

    const stateDir = path.join(directory, `state-${channel}`);
    const ready = createReadyCase({ stateDir, plan, now: new Date().toISOString(), caseId: `PC-${channel.toLowerCase().replaceAll("_", "-")}` });
    const approval = createGoalHandoffApproval({ handoff, caseId: ready.caseId, correlationId: `C-${channel.toLowerCase()}`, observedAt: new Date().toISOString(), revision: ready.subject.revision });
    ready.store.addApproval({ caseId: ready.caseId, target: ready.target, approval });
    const outputDir = path.join(directory, `output-${channel}`);
    const applied = run([
      "goal-apply", "--handoff", handoffFile, ...common,
      "--expected-fingerprint", fingerprint(handoff), "--case-id", ready.caseId, "--approval-id", approval.id,
      "--runners", runners, "--output-dir", outputDir, "--json",
    ], { ...env, PI_TICKET_PLAN_STATE_DIR: stateDir });
    assert.equal(applied.status, 0, applied.stderr);
    const result = JSON.parse(applied.stdout);
    assert.equal(result.status, "COMPLETE");
    assert.deepEqual(fs.readdirSync(outputDir), ["goal-handoff.json"]);
    if (channel === "GOAL_LOCAL") {
      assert.match(result.nextCommand, /--handoff '.*goal-handoff\.json'/u);
      assert.equal(result.nextCommand.startsWith("ssh "), false);
    } else {
      assert.match(result.nextCommand, /^ssh 'mac-mini' /u);
      assert.match(result.nextCommand, /--handoff -/u);
      assert.match(result.nextCommand, /< '.*goal-handoff\.json'$/u);
      const launched = spawnSync("/bin/sh", ["-c", result.nextCommand], { cwd: directory, env: { ...process.env, ...env }, encoding: "utf8" });
      assert.equal(launched.status, 0, launched.stderr);
      const observed = JSON.parse(fs.readFileSync(sshRecord, "utf8"));
      assert.equal(observed.args[0], "mac-mini");
      assert.equal(observed.args.length, 2);
      assert.match(observed.args[1], /node '\/opt\/herdr\/goal-cli\.js' start --handoff -/u);
      assert.deepEqual(JSON.parse(observed.input), handoff);
    }
  }
});

test("profile launcher dispatches execution-plan without starting PI", () => {
  const result = spawnSync(path.join(ROOT, "profile", "pi-ticket-plan"), ["execution-plan"], { cwd: ROOT, encoding: "utf8", timeout: 15_000 });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /USAGE: execution-plan build\|verify\|apply\|goal-build\|goal-apply/);
});
