import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runControllerContractCanary, runControllerContractVectors } from "../scripts/canary-codex-controller-contract.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("pinned latest Controller lock qualifies only the direct Release Plan v2 mainline", () => {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "compatibility", "codex-controller-contract.json"), "utf8"));
  const schema = fs.readFileSync(path.join(ROOT, "schemas", "herdr-codex-release-plan-v2.schema.json"));
  assert.equal(lock.commit, "b1afa0127dd0b51e210757e9baf150d2d2851326");
  assert.equal(lock.commit.startsWith("ff60e69b"), false);
  assert.equal(lock.schemaSha256, createHash("sha256").update(schema).digest("hex"));
  assert.equal(lock.digestAlgorithm, "canonical-json-v1+sha256-hex");
  assert.equal(lock.integrationMode, "release-plan-v2-direct");
  assert.equal(lock.dispatcherQualified, false);
  assert.equal(lock.operatorStartRequired, true);
});

test("fake Controller unit exercises all fixed vectors without execution commands", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fake-codex-controller-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const controller = path.join(directory, "controller");
  const cli = path.join(controller, "dist", "src", "cli.js");
  const fixtures = path.join(controller, "fixtures");
  const controllerSchema = path.join(controller, "schemas", "release-plan-v2.schema.json");
  const record = path.join(directory, "argv.jsonl");
  fs.mkdirSync(path.dirname(cli), { recursive: true });
  fs.mkdirSync(fixtures, { recursive: true });
  fs.mkdirSync(path.dirname(controllerSchema), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "schemas", "herdr-codex-release-plan-v2.schema.json"), controllerSchema);
  fs.writeFileSync(path.join(fixtures, "config.json"), `${JSON.stringify({ repo: "acme/product", baseRef: "main", policy: { maxIssues: 2 }, review: { enabled: true } })}\n`);
  fs.writeFileSync(cli, `const crypto = require("node:crypto");
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_CANARY_RECORD, JSON.stringify(args) + "\\n");
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(canonical(value)), "utf8").digest("hex");
if (args[0] === "config") {
  const config = JSON.parse(fs.readFileSync(args[args.indexOf("--config") + 1], "utf8"));
  console.log(JSON.stringify({ok:true,config,configDigest:digest(config)}));
} else if (args[0] === "plan") {
  const plan = JSON.parse(fs.readFileSync(args[args.indexOf("--plan") + 1], "utf8"));
  const top = ["id","issues","objective","parentIssue","releaseAcceptanceCriteria","reviewFocus","source","title","version"];
  const source = ["baseRef","baseSha","deliveryGraphDigest","parentBinding","planner","repo","specContentHash"];
  const issue = ["acceptanceCriteria","allowNoop","dependsOn","expectedBodyHash","expectedTitle","number","objective","order","suggestedValidation"];
  if (Object.keys(plan).sort().join("\\n") !== top.sort().join("\\n")
    || Object.keys(plan.source ?? {}).sort().join("\\n") !== source.sort().join("\\n")
    || Object.keys(plan.issues?.[0] ?? {}).sort().join("\\n") !== issue.sort().join("\\n")) {
    console.log(JSON.stringify({ok:false,problems:[{code:"INVALID_PLAN_KEYS"}]}));
    process.exitCode = 1;
  } else console.log(JSON.stringify({ok:true,plan,planDigest:digest(plan)}));
} else process.exit(90);
`, { mode: 0o700 });

  for (const args of [["init", "-q"], ["config", "user.email", "contract@example.invalid"], ["config", "user.name", "Contract Test"], ["add", "."], ["commit", "-qm", "fake controller"]]) {
    const result = spawnSync("git", ["-C", controller, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  const commit = spawnSync("git", ["-C", controller, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  const schemaSha256 = createHash("sha256").update(fs.readFileSync(controllerSchema)).digest("hex");
  const lock = { schema: "pi-ticket-planning:codex-controller-contract:v1", repository: "https://github.com/Notyet1307/herdr-codex-controller.git", commit, releasePlanVersion: 2, schemaPath: "schemas/release-plan-v2.schema.json", schemaSha256, digestAlgorithm: "canonical-json-v1+sha256-hex", integrationMode: "release-plan-v2-direct", dispatcherQualified: false, operatorStartRequired: true };
  const prior = process.env.TEST_CANARY_RECORD;
  process.env.TEST_CANARY_RECORD = record;
  let result;
  try { result = runControllerContractVectors({ cli, sourceConfig: path.join(fixtures, "config.json") }); }
  finally { if (prior === undefined) delete process.env.TEST_CANARY_RECORD; else process.env.TEST_CANARY_RECORD = prior; }
  assert.equal(result.status, "PASS");
  assert.equal(result.planDigest, result.plannerPlanDigest);
  const calls = fs.readFileSync(record, "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(calls.map(([first, second]) => `${first}:${second}`), [
    "config:validate",
    "plan:validate",
    "config:validate",
    "plan:validate",
    "plan:validate",
    "plan:validate",
    "plan:validate",
  ]);
  assert.equal(calls.flat().some((value) => /^(doctor|start|run|step|dispatch)$/.test(value)), false);

  fs.appendFileSync(controllerSchema, "\n");
  assert.throws(() => runControllerContractCanary({ controllerRoot: controller, lock }), /CONTROLLER_WORKTREE_DIRTY/);
  for (const args of [["add", controllerSchema], ["commit", "-qm", "drift schema"]]) {
    const committed = spawnSync("git", ["-C", controller, ...args], { encoding: "utf8" });
    assert.equal(committed.status, 0, committed.stderr);
  }
  const driftCommit = spawnSync("git", ["-C", controller, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  const driftSchemaSha256 = createHash("sha256").update(fs.readFileSync(controllerSchema)).digest("hex");
  assert.throws(() => runControllerContractCanary({ controllerRoot: controller, lock: { ...lock, commit: driftCommit, schemaSha256: driftSchemaSha256 } }), /CONTROLLER_SCHEMA_DRIFT/);
});

test("Codex Controller contract canary fails closed when the checkout is absent", () => {
  const missing = path.join(os.tmpdir(), `missing-controller-${process.pid}`);
  const result = spawnSync(process.execPath, ["scripts/canary-codex-controller-contract.mjs", "--controller-root", missing], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /CONTROLLER_UNAVAILABLE/);
});
