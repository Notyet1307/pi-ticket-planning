import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  if (index < 0 || !args[index + 1]) throw new Error(`--${name} is required`);
  return args[index + 1];
};
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const digest = (value) => `sha256:${crypto.createHash("sha256").update(JSON.stringify(canonical(value)), "utf8").digest("hex")}`;
const bytesHash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const run = (command, commandArgs, cwd) => {
  const result = spawnSync(command, commandArgs, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(String(result.stderr || result.stdout || `${command} failed`).trim());
  return String(result.stdout).trim();
};

const controller = fs.realpathSync(path.resolve(option("controller-root")));
if (run("git", ["status", "--porcelain=v1", "--untracked-files=all"], controller)) throw new Error("CONTROLLER_WORKTREE_DIRTY");
const commit = run("git", ["rev-parse", "HEAD^{commit}"], controller);
const identity = JSON.parse(run(process.execPath, ["--input-type=module", "-e", "import{readControllerIdentity}from'./dist/src/provenance.js';process.stdout.write(JSON.stringify(readControllerIdentity()))"], controller));
if (identity.sourceRevision !== commit) throw new Error("CONTROLLER_IDENTITY_DRIFT");
const activatedAt = new Date(run("git", ["show", "-s", "--format=%cI", commit], controller)).toISOString();
const read = (relative) => fs.readFileSync(path.join(controller, relative));
const json = (relative) => JSON.parse(read(relative).toString("utf8"));
const files = {
  plan: "schemas/release-plan-v2.schema.json",
  completionV2: "schemas/release-completion-v2.schema.json",
  completionV3: "schemas/release-completion-v3.schema.json",
  config: "schemas/controller-config.schema.json",
  historySchema: "schemas/controller-identity-history-v1.schema.json",
  history: "contracts/controller-identity-history.json",
  risk: "contracts/risk-class-registry.json",
  runtimeLock: "contracts/runtime-contract-lock.json",
};
const hashes = Object.fromEntries(Object.entries(files).map(([name, relative]) => [name, bytesHash(read(relative))]));
const controllerHistory = json(files.history);
const risk = json(files.risk);
const runtimeLock = json(files.runtimeLock);
const CONFIG_CONTRACT = "herdr-codex-controller:config:v3";
const priorTrustPath = path.join(ROOT, "compatibility", "codex-controller-trust.json");
const priorTrust = fs.existsSync(priorTrustPath) ? JSON.parse(fs.readFileSync(priorTrustPath, "utf8")) : null;
const priorLockPath = path.join(ROOT, "compatibility", "codex-controller-contract.json");
const priorLock = fs.existsSync(priorLockPath) ? JSON.parse(fs.readFileSync(priorLockPath, "utf8")) : null;
if (priorTrust) {
  const { digest: priorTrustDigest, ...priorTrustBody } = priorTrust;
  if (priorTrustDigest !== digest(priorTrustBody) || priorTrustDigest !== priorLock?.trustRegistryDigest
    || priorTrust.activeIdentityDigest !== priorLock?.identityDigest) throw new Error("PRIOR_CONTROLLER_TRUST_INVALID");
}
const qualificationCore = ({ identity, ownedSchemas, qualificationStatus, activatedAt }, historyDigest) => ({ identity, ownedSchemas, qualificationStatus, activatedAt, historyDigest });
const qualifiedEntry = (entry, historyDigest, active) => {
  const core = qualificationCore(entry, historyDigest);
  return { ...entry, historyDigest, qualificationDigest: digest(core), active };
};
const activeEntry = qualifiedEntry({
  identity,
  ownedSchemas: [
    { schema: CONFIG_CONTRACT, sha256: `sha256:${hashes.config}` },
    { schema: "herdr-codex-controller:release-completion:v3", sha256: `sha256:${hashes.completionV3}` },
    { schema: "herdr-codex-controller:release-plan:v2", sha256: `sha256:${hashes.plan}` },
  ],
  qualificationStatus: "qualified",
  activatedAt,
  revocation: null,
}, controllerHistory.digest, true);
const historyEntries = controllerHistory.entries.map((entry) => {
  const prior = priorTrust?.entries?.find((candidate) => candidate.identity?.digest === entry.identity.digest);
  if (prior && JSON.stringify(canonical(qualificationCore(prior, null))) !== JSON.stringify(canonical(qualificationCore(entry, null)))) {
    throw new Error("HISTORICAL_CONTROLLER_ENTRY_DRIFT");
  }
  const predatesHistoryBinding = entry.ownedSchemas.some(({ schema }) => schema === "herdr-codex-controller:release-completion:v2")
    && !entry.ownedSchemas.some(({ schema }) => schema === "herdr-codex-controller:release-completion:v3");
  const historyDigest = prior?.historyDigest ?? (predatesHistoryBinding ? null : undefined);
  if (historyDigest === undefined) throw new Error("HISTORICAL_CONTROLLER_SNAPSHOT_MISSING");
  return qualifiedEntry(entry, historyDigest, false);
});
if (historyEntries.some((entry) => entry.identity.digest === identity.digest)) throw new Error("ACTIVE_CONTROLLER_ALREADY_HISTORICAL");
const trustBody = {
  schema: "pi-ticket-planning:controller-trust-registry:v1",
  digestAlgorithm: "utf16-code-unit-canonical-json-v1+sha256-hex",
  activeIdentityDigest: identity.digest,
  entries: [...historyEntries, activeEntry],
};
const trust = { ...trustBody, digest: digest(trustBody) };
const lockBody = {
  schema: "pi-ticket-planning:codex-controller-contract:v2",
  repository: "https://github.com/Notyet1307/herdr-codex-controller.git",
  commit,
  sourceManifestDigest: identity.sourceManifestDigest,
  buildDigest: identity.buildDigest,
  identityDigest: identity.digest,
  releasePlanVersion: 2,
  schemaPath: files.plan,
  schemaSha256: hashes.plan,
  configVersion: 3,
  configSchemaPath: files.config,
  configSchemaSha256: hashes.config,
  completionVersion: 3,
  completionSchemaPath: files.completionV3,
  completionSchemaSha256: hashes.completionV3,
  historicalCompletionSchemas: [{ version: 2, path: files.completionV2, sha256: hashes.completionV2 }],
  controllerProvenanceVersion: 3,
  jobStateVersion: 4,
  requiredCheckContractVersion: 1,
  mergeAuthorityContract: { version: 1, mode: "controller-auto-merge", quarantine: "delete-exact-head-branch" },
  reviewPolicy: { enabled: true, blockingSeverities: ["critical", "major"] },
  controllerIdentityHistoryPath: files.history,
  controllerIdentityHistorySha256: hashes.history,
  controllerIdentityHistoryDigest: controllerHistory.digest,
  controllerIdentityHistorySchemaPath: files.historySchema,
  controllerIdentityHistorySchemaSha256: hashes.historySchema,
  controllerRuntimeContractLockPath: files.runtimeLock,
  controllerRuntimeContractLockSha256: hashes.runtimeLock,
  controllerRuntimeContractLockDigest: runtimeLock.digest,
  trustRegistryPath: "compatibility/codex-controller-trust.json",
  trustRegistryDigest: trust.digest,
  riskClassRegistryPath: files.risk,
  riskClassRegistrySha256: hashes.risk,
  riskClassRegistryDigest: risk.digest,
  riskClassRegistrySourceCommit: runtimeLock.plannerRiskRegistry.commit,
  digestAlgorithm: "utf16-code-unit-canonical-json-v1+sha256-hex",
  integrationMode: "release-plan-v2-direct",
  dispatcherQualified: false,
  operatorStartRequired: true,
};
const lock = { ...lockBody, digest: digest(lockBody) };

const outputs = new Map([
  ["compatibility/codex-controller-contract.json", `${JSON.stringify(lock, null, 2)}\n`],
  ["compatibility/codex-controller-trust.json", `${JSON.stringify(trust, null, 2)}\n`],
  ["compatibility/controller-identity-history.json", read(files.history)],
  ["schemas/herdr-codex-release-plan-v2.schema.json", read(files.plan)],
  ["schemas/herdr-codex-release-completion-v2.schema.json", read(files.completionV2)],
  ["schemas/herdr-codex-release-completion-v3.schema.json", read(files.completionV3)],
  ["schemas/herdr-codex-controller-config-v3.schema.json", read(files.config)],
  ["schemas/herdr-codex-controller-identity-history-v1.schema.json", read(files.historySchema)],
]);
if (args.includes("--write")) {
  for (const [relative, content] of outputs) {
    fs.mkdirSync(path.dirname(path.join(ROOT, relative)), { recursive: true });
    fs.writeFileSync(path.join(ROOT, relative), content);
  }
} else {
  for (const [relative, content] of outputs) {
    if (!fs.existsSync(path.join(ROOT, relative)) || !fs.readFileSync(path.join(ROOT, relative)).equals(Buffer.from(content))) {
      throw new Error(`CONTROLLER_CONTRACT_STALE:${relative}`);
    }
  }
}
