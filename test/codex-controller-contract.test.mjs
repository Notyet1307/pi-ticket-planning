import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("Codex Controller contract canary compares positive, extra-key, and missing-key vectors without execution commands", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fake-codex-controller-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const controller = path.join(directory, "controller");
  const cli = path.join(controller, "dist", "src", "cli.js");
  const fixtures = path.join(controller, "fixtures");
  const record = path.join(directory, "argv.jsonl");
  fs.mkdirSync(path.dirname(cli), { recursive: true });
  fs.mkdirSync(fixtures, { recursive: true });
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
  const expected = ["id","issues","objective","parentIssue","releaseAcceptanceCriteria","reviewFocus","source","title","version"];
  if (Object.keys(plan).sort().join("\\n") !== expected.sort().join("\\n")) {
    console.log(JSON.stringify({ok:false,problems:[{code:"INVALID_PLAN_KEYS"}]}));
    process.exitCode = 1;
  } else console.log(JSON.stringify({ok:true,plan,planDigest:digest(plan)}));
} else process.exit(90);
`, { mode: 0o700 });

  const result = spawnSync(process.execPath, ["scripts/canary-codex-controller-contract.mjs", "--controller-root", controller], {
    cwd: ROOT,
    env: { ...process.env, TEST_CANARY_RECORD: record },
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "PASS");
  const calls = fs.readFileSync(record, "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(calls.map(([first, second]) => `${first}:${second}`), [
    "config:validate",
    "plan:validate",
    "plan:validate",
    "plan:validate",
  ]);
  assert.equal(calls.flat().some((value) => /^(doctor|start|run|step)$/.test(value)), false);
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
