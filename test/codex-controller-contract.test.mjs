import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runControllerContractCanary, runControllerContractVectors } from "../scripts/canary-codex-controller-contract.mjs";
import { CONTROLLER_IDENTITY } from "./execution-plan-fixture.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const fingerprint = (value) => `sha256:${createHash("sha256").update(JSON.stringify(canonical(value)), "utf8").digest("hex")}`;

test("pinned latest Controller lock qualifies only the direct Release Plan v2 mainline", () => {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "compatibility", "codex-controller-contract.json"), "utf8"));
  const schema = fs.readFileSync(path.join(ROOT, "schemas", "herdr-codex-release-plan-v2.schema.json"));
  const completionSchema = fs.readFileSync(path.join(ROOT, "schemas", "herdr-codex-release-completion-v1.schema.json"));
  const riskRegistry = fs.readFileSync(path.join(ROOT, "contracts", "risk-class-registry.json"));
  assert.equal(lock.commit, "7fda8b75bc187b2fe9b121230ae83c85d79a3d8b");
  assert.equal(lock.commit.startsWith("ff60e69b"), false);
  assert.equal(lock.sourceManifestDigest, CONTROLLER_IDENTITY.sourceManifestDigest);
  assert.equal(lock.buildDigest, CONTROLLER_IDENTITY.buildDigest);
  assert.equal(lock.identityDigest, CONTROLLER_IDENTITY.digest);
  assert.equal(lock.schemaSha256, createHash("sha256").update(schema).digest("hex"));
  assert.equal(lock.completionSchemaSha256, createHash("sha256").update(completionSchema).digest("hex"));
  assert.equal(lock.riskClassRegistrySha256, createHash("sha256").update(riskRegistry).digest("hex"));
  assert.equal(lock.riskClassRegistryDigest, JSON.parse(riskRegistry).digest);
  assert.equal(lock.riskClassRegistrySourceCommit, "441c8f0816f145b8aa5feb0caf61584c44005fd2");
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
  const controllerCompletionSchema = path.join(controller, "schemas", "release-completion-v1.schema.json");
  const controllerRiskRegistry = path.join(controller, "contracts", "risk-class-registry.json");
  const controllerRuntimeLock = path.join(controller, "contracts", "runtime-contract-lock.json");
  const record = path.join(directory, "argv.jsonl");
  fs.mkdirSync(path.dirname(cli), { recursive: true });
  fs.mkdirSync(fixtures, { recursive: true });
  fs.mkdirSync(path.dirname(controllerSchema), { recursive: true });
  fs.mkdirSync(path.dirname(controllerRiskRegistry), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "schemas", "herdr-codex-release-plan-v2.schema.json"), controllerSchema);
  fs.copyFileSync(path.join(ROOT, "schemas", "herdr-codex-release-completion-v1.schema.json"), controllerCompletionSchema);
  fs.copyFileSync(path.join(ROOT, "contracts", "risk-class-registry.json"), controllerRiskRegistry);
  const riskClassRegistrySha256 = createHash("sha256").update(fs.readFileSync(controllerRiskRegistry)).digest("hex");
  const riskClassRegistry = JSON.parse(fs.readFileSync(controllerRiskRegistry, "utf8"));
  const riskClassRegistryDigest = riskClassRegistry.digest;
  const runtimeLockBody = {
    schema: "herdr-codex-controller:runtime-contract-lock:v1",
    plannerRiskRegistry: { repository: "https://github.com/Notyet1307/pi-ticket-planning.git", commit: "441c8f0816f145b8aa5feb0caf61584c44005fd2", path: "contracts/risk-class-registry.json", byteSha256: riskClassRegistrySha256, artifactDigest: riskClassRegistryDigest },
    artifacts: [
      { path: "contracts/risk-class-registry.json", sha256: riskClassRegistrySha256 },
      { path: "schemas/release-completion-v1.schema.json", sha256: createHash("sha256").update(fs.readFileSync(controllerCompletionSchema)).digest("hex") },
      { path: "schemas/release-plan-v2.schema.json", sha256: createHash("sha256").update(fs.readFileSync(controllerSchema)).digest("hex") },
    ],
  };
  fs.writeFileSync(controllerRuntimeLock, `${JSON.stringify({ ...runtimeLockBody, digest: fingerprint(runtimeLockBody) }, null, 2)}\n`);
  fs.writeFileSync(path.join(fixtures, "config.json"), `${JSON.stringify({ repo: "acme/product", baseRef: "main", executionMode: "release-plan-v2-direct", policy: { maxIssues: 2 }, review: { enabled: true } })}\n`);
  fs.writeFileSync(cli, `const crypto = require("node:crypto");
const fs = require("node:fs");
const args = process.argv.slice(2);
const controller = ${JSON.stringify(CONTROLLER_IDENTITY)};
const riskClasses = new Set(${JSON.stringify(riskClassRegistry.classes)});
fs.appendFileSync(process.env.TEST_CANARY_RECORD, JSON.stringify(args) + "\\n");
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(canonical(value)), "utf8").digest("hex");
if (args[0] === "config") {
  const config = JSON.parse(fs.readFileSync(args[args.indexOf("--config") + 1], "utf8"));
  console.log(JSON.stringify({ok:true,config,configDigest:digest(config),controller}));
} else if (args[0] === "plan") {
  const plan = JSON.parse(fs.readFileSync(args[args.indexOf("--plan") + 1], "utf8"));
  const top = ["id","issues","objective","parentIssue","releaseAcceptanceCriteria","reviewFocus","source","title","version"];
  const source = ["baseRef","baseSha","decisionManifestDigest","deliveryGraphDigest","dependencyHandoffDigests","parentBinding","planner","predecessorReceiptDigest","repo","specContentHash"];
  const issue = ["acceptanceCriteria","allowNoop","dependsOn","expectedBodyHash","expectedPaths","expectedTitle","integrationOnly","number","objective","oracleBindings","order","protectedPaths","replanTriggers","riskClasses","scopeBudget","suggestedValidation","waiverDigests"];
  if (Object.keys(plan).sort().join("\\n") !== top.sort().join("\\n")
    || Object.keys(plan.source ?? {}).sort().join("\\n") !== source.sort().join("\\n")
    || Object.keys(plan.issues?.[0] ?? {}).sort().join("\\n") !== issue.sort().join("\\n")) {
    console.log(JSON.stringify({ok:false,problems:[{code:"INVALID_PLAN_KEYS"}]}));
    process.exitCode = 1;
  } else { const config=JSON.parse(fs.readFileSync(args[args.indexOf("--config") + 1], "utf8")); const release=new Set((config.validation?.release??[]).map((entry)=>typeof entry==='string'?entry:entry.command)); const missing=plan.issues?.some((issue)=>issue.oracleBindings?.some((binding)=>!release.has(binding.execution.command))); const unknown=plan.issues?.some((issue)=>issue.riskClasses?.some((risk)=>!riskClasses.has(risk))); const rootWildcard=plan.issues?.some((issue)=>issue.expectedPaths?.some((value)=>value.split('/',1)[0].includes('*'))); if(missing||unknown||rootWildcard){console.error(missing?'oracle_validation_command_missing':unknown?'unknown_risk_class':'invalid_expected_path_pattern');process.exitCode=1}else{const planDigest=digest(plan);const body={version:1,controller,executionMode:config.executionMode,configDigest:digest(config),releasePlan:{version:2,digest:planDigest}};console.log(JSON.stringify({ok:true,plan,planDigest,provenance:{...body,digest:digest(body)}}));} }
} else process.exit(90);
`, { mode: 0o700 });

  for (const args of [["init", "-q"], ["config", "user.email", "contract@example.invalid"], ["config", "user.name", "Contract Test"], ["add", "."], ["commit", "-qm", "fake controller"]]) {
    const result = spawnSync("git", ["-C", controller, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  const commit = spawnSync("git", ["-C", controller, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  const schemaSha256 = createHash("sha256").update(fs.readFileSync(controllerSchema)).digest("hex");
  const completionSchemaSha256 = createHash("sha256").update(fs.readFileSync(controllerCompletionSchema)).digest("hex");
  const lock = { schema: "pi-ticket-planning:codex-controller-contract:v1", repository: "https://github.com/Notyet1307/herdr-codex-controller.git", commit, sourceManifestDigest: CONTROLLER_IDENTITY.sourceManifestDigest, buildDigest: CONTROLLER_IDENTITY.buildDigest, identityDigest: CONTROLLER_IDENTITY.digest, releasePlanVersion: 2, schemaPath: "schemas/release-plan-v2.schema.json", schemaSha256, completionSchemaPath: "schemas/release-completion-v1.schema.json", completionSchemaSha256, riskClassRegistryPath: "contracts/risk-class-registry.json", riskClassRegistrySha256, riskClassRegistryDigest, riskClassRegistrySourceCommit: "441c8f0816f145b8aa5feb0caf61584c44005fd2", digestAlgorithm: "canonical-json-v1+sha256-hex", integrationMode: "release-plan-v2-direct", dispatcherQualified: false, operatorStartRequired: true };
  const prior = process.env.TEST_CANARY_RECORD;
  process.env.TEST_CANARY_RECORD = record;
  let result;
  try { result = runControllerContractVectors({ cli, sourceConfig: path.join(fixtures, "config.json") }); }
  finally { if (prior === undefined) delete process.env.TEST_CANARY_RECORD; else process.env.TEST_CANARY_RECORD = prior; }
  assert.equal(result.status, "PASS");
  assert.equal(result.planDigest, result.plannerPlanDigest);
  assert.equal(result.controllerRevision, CONTROLLER_IDENTITY.sourceRevision);
  assert.equal(result.controllerIdentityDigest, CONTROLLER_IDENTITY.digest);
  assert.equal(result.handoffScope.dispatch, "OUT_OF_SCOPE");
  assert.equal(result.vectors.oracleValidationCommandMissing, "REJECTED");
  assert.equal(result.vectors.rootWildcardExpectedPath, "REJECTED");
  assert.equal(result.vectors.unknownRiskClass, "REJECTED");
  assert.equal(result.freshCases["c2-stale-base-a"], "EXECUTION_BASE_DRIFT");
  assert.equal(result.freshCases["c2-fresh-base-b"], "PASS");
  assert.equal(result.freshCases["verifier-byte-drift"], "ORACLE_VERIFIER_BINDING_DRIFT");
  const calls = fs.readFileSync(record, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(calls.some(([first, second]) => `${first}:${second}` === "config:validate"), true);
  assert.equal(calls.some(([first, second]) => `${first}:${second}` === "plan:validate"), true);
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

  fs.copyFileSync(path.join(ROOT, "schemas", "herdr-codex-release-plan-v2.schema.json"), controllerSchema);
  fs.appendFileSync(controllerCompletionSchema, "\n");
  for (const args of [["add", controllerSchema, controllerCompletionSchema], ["commit", "-qm", "drift completion schema"]]) {
    const committed = spawnSync("git", ["-C", controller, ...args], { encoding: "utf8" });
    assert.equal(committed.status, 0, committed.stderr);
  }
  const completionDriftCommit = spawnSync("git", ["-C", controller, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  const completionDriftSha256 = createHash("sha256").update(fs.readFileSync(controllerCompletionSchema)).digest("hex");
  assert.throws(() => runControllerContractCanary({ controllerRoot: controller, lock: { ...lock, commit: completionDriftCommit, completionSchemaSha256: completionDriftSha256 } }), /CONTROLLER_COMPLETION_SCHEMA_DRIFT/);

  fs.copyFileSync(path.join(ROOT, "schemas", "herdr-codex-release-completion-v1.schema.json"), controllerCompletionSchema);
  fs.appendFileSync(controllerRiskRegistry, "\n");
  for (const args of [["add", controllerCompletionSchema, controllerRiskRegistry], ["commit", "-qm", "drift risk registry"]]) {
    const committed = spawnSync("git", ["-C", controller, ...args], { encoding: "utf8" });
    assert.equal(committed.status, 0, committed.stderr);
  }
  const riskDriftCommit = spawnSync("git", ["-C", controller, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  const riskDriftSha256 = createHash("sha256").update(fs.readFileSync(controllerRiskRegistry)).digest("hex");
  assert.throws(() => runControllerContractCanary({ controllerRoot: controller, lock: { ...lock, commit: riskDriftCommit, riskClassRegistrySha256: riskDriftSha256 } }), /CONTROLLER_RISK_CLASS_REGISTRY_DRIFT/);
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
