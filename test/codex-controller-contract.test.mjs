import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runControllerContractVectors } from "../scripts/canary-codex-controller-contract.mjs";
import { fingerprint } from "../execution-plan/domain.mjs";
import { validateArtifact } from "../protocol/kernel.mjs";
import {
  CONTROLLER_IDENTITY,
  controllerBinding,
  controllerProvenance,
  executionInput,
} from "./execution-plan-fixture.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

test("pinned merged Controller A+B lock and trust registry qualify only direct v2 with provenance/completion v3", () => {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "compatibility", "codex-controller-contract.json"), "utf8"));
  const trust = JSON.parse(fs.readFileSync(path.join(ROOT, "compatibility", "codex-controller-trust.json"), "utf8"));
  const history = fs.readFileSync(path.join(ROOT, "compatibility", "controller-identity-history.json"));
  const read = (file) => fs.readFileSync(path.join(ROOT, "schemas", file));
  const { digest, ...body } = lock;

  assert.equal(validateArtifact(lock).ok, true);
  assert.equal(validateArtifact(trust).ok, true);
  assert.equal(lock.commit, "4d6295af2f1533a8fee5ffe1d420241bc1f5bcba");
  assert.deepEqual(CONTROLLER_IDENTITY, { version: 1, sourceRevision: lock.commit, sourceManifestDigest: lock.sourceManifestDigest, buildDigest: lock.buildDigest, digest: lock.identityDigest });
  assert.equal(digest, fingerprint(body));
  assert.equal(lock.schemaSha256, sha256(read("herdr-codex-release-plan-v2.schema.json")));
  assert.equal(lock.completionSchemaSha256, sha256(read("herdr-codex-release-completion-v3.schema.json")));
  assert.equal(lock.historicalCompletionSchemas[0].sha256, sha256(read("herdr-codex-release-completion-v2.schema.json")));
  assert.equal(lock.configSchemaSha256, sha256(read("herdr-codex-controller-config-v3.schema.json")));
  assert.equal(lock.controllerIdentityHistorySchemaSha256, sha256(read("herdr-codex-controller-identity-history-v1.schema.json")));
  assert.equal(lock.controllerIdentityHistorySha256, sha256(history));
  assert.equal(lock.controllerIdentityHistoryDigest, JSON.parse(history).digest);
  assert.equal(lock.trustRegistryDigest, trust.digest);
  assert.equal(trust.activeIdentityDigest, lock.identityDigest);
  assert.equal(trust.entries.some((entry) => !entry.active && entry.identity.sourceRevision === "1d532133657e763f8e50429774eabf01c45f98e9"), true);
  assert.equal(lock.controllerProvenanceVersion, 3);
  assert.equal(lock.jobStateVersion, 4);
  assert.equal(lock.completionVersion, 3);
  assert.deepEqual(lock.mergeAuthorityContract, { version: 1, mode: "controller-auto-merge", quarantine: "delete-exact-head-branch" });
  assert.equal(lock.integrationMode, "release-plan-v2-direct");
  assert.equal(lock.dispatcherQualified, false);
  assert.equal(lock.operatorStartRequired, true);
});

test("fake Controller exercises fixed contract vectors without execution commands", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fake-codex-controller-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const cli = path.join(directory, "controller-cli.mjs");
  const configPath = path.join(directory, "controller.json");
  const record = path.join(directory, "argv.jsonl");
  const binding = controllerBinding(executionInput());
  binding.config.repo = "acme/product";
  binding.config.validation.release = [];
  const provenanceTemplate = controllerProvenance("a".repeat(64), "c".repeat(64));
  fs.writeFileSync(configPath, `${JSON.stringify(binding.config)}\n`, { mode: 0o600 });
  fs.writeFileSync(cli, `import crypto from "node:crypto";
import fs from "node:fs";
const args = process.argv.slice(2);
const controller = ${JSON.stringify(CONTROLLER_IDENTITY)};
const provenanceTemplate = ${JSON.stringify(provenanceTemplate)};
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const digest = (value) => crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const config = JSON.parse(fs.readFileSync(args[args.indexOf("--config") + 1], "utf8"));
fs.appendFileSync(process.env.TEST_CANARY_RECORD, JSON.stringify(args) + "\\n");
if (args[0] === "config") console.log(JSON.stringify({ok:true,config,configDigest:digest(config),controller}));
else if (args[0] === "plan") {
  const plan = JSON.parse(fs.readFileSync(args[args.indexOf("--plan") + 1], "utf8"));
  const top = ["id","issues","objective","parentIssue","releaseAcceptanceCriteria","reviewFocus","source","title","version"];
  const source = ["baseRef","baseSha","decisionManifestDigest","deliveryGraphDigest","dependencyHandoffDigests","parentBinding","planner","predecessorReceiptDigest","repo","specContentHash"];
  const issue = ["acceptanceCriteria","allowNoop","dependsOn","expectedBodyHash","expectedPaths","expectedTitle","integrationOnly","number","objective","oracleBindings","order","protectedPaths","replanTriggers","riskClasses","scopeBudget","suggestedValidation","waiverDigests"];
  const release = new Set((config.validation?.release ?? []).map((entry) => typeof entry === "string" ? entry : entry.command));
  const invalid = Object.keys(plan).sort().join() !== top.sort().join()
    || Object.keys(plan.source ?? {}).sort().join() !== source.sort().join()
    || Object.keys(plan.issues?.[0] ?? {}).sort().join() !== issue.sort().join()
    || plan.issues?.some((item) => item.oracleBindings?.some((oracle) => !release.has(oracle.execution.command)))
    || plan.issues?.some((item) => item.riskClasses?.some((risk) => risk !== "AUTHORITY_BOUNDARY"))
    || plan.issues?.some((item) => item.expectedPaths?.some((value) => value.split("/", 1)[0].includes("*")));
  if (invalid) process.exit(1);
  const planDigest = digest(plan);
  const { digest: _digest, ...template } = provenanceTemplate;
  const body = { ...template, configDigest: digest(config), releasePlan: { version: 2, digest: planDigest } };
  console.log(JSON.stringify({ok:true,plan,planDigest,provenance:{...body,digest:digest(body)}}));
} else process.exit(90);
`, { mode: 0o700 });

  const prior = process.env.TEST_CANARY_RECORD;
  process.env.TEST_CANARY_RECORD = record;
  let result;
  try { result = runControllerContractVectors({ cli, sourceConfig: configPath }); }
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
  const calls = fs.readFileSync(record, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(calls.some(([first, second]) => `${first}:${second}` === "config:validate"), true);
  assert.equal(calls.some(([first, second]) => `${first}:${second}` === "plan:validate"), true);
  assert.equal(calls.flat().some((value) => /^(doctor|start|run|step|dispatch)$/u.test(value)), false);
});

test("Codex Controller contract canary fails closed when the checkout is absent", () => {
  const missing = path.join(os.tmpdir(), `missing-controller-${process.pid}`);
  const result = spawnSync(process.execPath, ["scripts/canary-codex-controller-contract.mjs", "--controller-root", missing], { cwd: ROOT, encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /CONTROLLER_UNAVAILABLE/);
});
