import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HEX, canonical, fingerprint, releasePlanDigest } from "./domain.mjs";
import { assertCanonicalPrivateExistingFile } from "./private-paths.mjs";

const MAX_OUTPUT = 1024 * 1024;
const REVISION = /^[a-f0-9]{40}$/;
const DIRECT_MODE = "release-plan-v2-direct";
const CONTRACT_LOCK = JSON.parse(fs.readFileSync(new URL("../compatibility/codex-controller-contract.json", import.meta.url), "utf8"));

function invoke(cli, args, { timeout = 15_000, input, failureCode = "CONTROLLER_COMMAND_FAILED", nodeArgs = [] } = {}) {
  const run = spawnSync(process.execPath, [...nodeArgs, cli, ...args], { encoding: "utf8", input, timeout, maxBuffer: MAX_OUTPUT, shell: false });
  if (run.error?.code === "ETIMEDOUT") throw new Error("CONTROLLER_TIMEOUT");
  if (run.error?.code === "ENOBUFS") throw new Error("CONTROLLER_OUTPUT_TOO_LARGE");
  if (run.error || run.signal || run.status !== 0) throw new Error(failureCode);
  try { return JSON.parse(run.stdout); } catch { throw new Error("CONTROLLER_INVALID_JSON"); }
}

function digest(value, name) {
  if (typeof value !== "string" || !HEX.test(value)) throw new Error(`CONTROLLER_INVALID_${name}`);
  return value;
}

function same(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function exactObject(value, keys, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join("\n") !== [...keys].sort().join("\n")) throw new Error(`CONTROLLER_INVALID_${name}`);
  return value;
}

function controllerIdentity(value) {
  const identity = exactObject(value, ["version", "sourceRevision", "sourceManifestDigest", "buildDigest", "digest"], "IDENTITY");
  const { digest: identityDigest, ...body } = identity;
  if (identity.version !== 1 || !REVISION.test(identity.sourceRevision ?? "")
    || digest(identity.sourceManifestDigest, "SOURCE_MANIFEST_DIGEST") !== identity.sourceManifestDigest
    || digest(identity.buildDigest, "BUILD_DIGEST") !== identity.buildDigest
    || digest(identityDigest, "IDENTITY_DIGEST") !== fingerprint(body).slice("sha256:".length)) throw new Error("CONTROLLER_INVALID_IDENTITY");
  if (identity.sourceRevision !== CONTRACT_LOCK.commit || identity.sourceManifestDigest !== CONTRACT_LOCK.sourceManifestDigest
    || identity.buildDigest !== CONTRACT_LOCK.buildDigest || identity.digest !== CONTRACT_LOCK.identityDigest) throw new Error("CONTROLLER_CONTRACT_DRIFT");
  return identity;
}

function controllerProvenance(value) {
  const provenance = exactObject(value, ["version", "controller", "executionMode", "configDigest", "releasePlan", "digest"], "PROVENANCE");
  const releasePlan = exactObject(provenance.releasePlan, ["version", "digest"], "PROVENANCE");
  const { digest: provenanceDigest, ...body } = provenance;
  controllerIdentity(provenance.controller);
  if (provenance.version !== 1 || provenance.executionMode !== DIRECT_MODE || releasePlan.version !== 2
    || digest(provenance.configDigest, "CONFIG_DIGEST") !== provenance.configDigest
    || digest(releasePlan.digest, "PLAN_DIGEST") !== releasePlan.digest
    || digest(provenanceDigest, "PROVENANCE_DIGEST") !== fingerprint(body).slice("sha256:".length)) throw new Error("CONTROLLER_INVALID_PROVENANCE");
  return provenance;
}

function configIdentity(file) {
  assertCanonicalPrivateExistingFile(file, "CONTROLLER_CONFIG", { mode: 0o600 });
  const stat = fs.statSync(file, { bigint: true });
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
}

export function createControllerAdapter({ cli, config, nodeArgs = [] }) {
  if (!Array.isArray(nodeArgs) || nodeArgs.some((value) => typeof value !== "string")) throw new Error("CONTROLLER_INVALID_NODE_ARGS");
  const controllerCli = assertCanonicalPrivateExistingFile(cli, "CONTROLLER_CLI");
  const controllerConfig = assertCanonicalPrivateExistingFile(config, "CONTROLLER_CONFIG", { mode: 0o600 });
  const readConfig = () => {
    const before = configIdentity(controllerConfig);
    const result = invoke(controllerCli, ["config", "validate", "--config", controllerConfig, "--json"], { failureCode: "CONTROLLER_CONFIG_INVALID", nodeArgs });
    if (result?.ok !== true) throw new Error("CONTROLLER_CONFIG_INVALID");
    const after = configIdentity(controllerConfig);
    if (before !== after) throw new Error("CONTROLLER_CONFIG_DRIFT");
    const config = result.config ?? result.value ?? result;
    if (config?.executionMode !== DIRECT_MODE) throw new Error("CONTROLLER_MODE_NOT_QUALIFIED");
    return { config, configDigest: digest(result.configDigest, "CONFIG_DIGEST"), configIdentity: after, controllerIdentity: controllerIdentity(result.controller) };
  };
  return {
    config: readConfig,
    validatePlan(plan, expectedConfigDigest, expectedConfigIdentity) {
      const expectedDigest = digest(expectedConfigDigest, "CONFIG_DIGEST");
      if (typeof expectedConfigIdentity !== "string" || configIdentity(controllerConfig) !== expectedConfigIdentity) throw new Error("CONTROLLER_CONFIG_DRIFT");
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ticket-plan-"));
      const file = path.join(directory, "release-plan.json");
      try {
        fs.writeFileSync(file, `${JSON.stringify(plan)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
        fs.chmodSync(file, 0o600);
        const result = invoke(controllerCli, ["plan", "validate", "--config", controllerConfig, "--plan", file, "--json"], { failureCode: "CONTROLLER_PLAN_INVALID", nodeArgs });
        if (configIdentity(controllerConfig) !== expectedConfigIdentity) throw new Error("CONTROLLER_CONFIG_DRIFT");
        const after = readConfig();
        if (after.configDigest !== expectedDigest || after.configIdentity !== expectedConfigIdentity) throw new Error("CONTROLLER_CONFIG_DRIFT");
        if (result?.ok !== true) throw new Error("CONTROLLER_PLAN_INVALID");
        if (!result.plan || JSON.stringify(canonical(result.plan)) !== JSON.stringify(canonical(plan))) throw new Error("CONTROLLER_PLAN_ECHO_MISMATCH");
        const planDigest = digest(result.planDigest, "PLAN_DIGEST");
        const provenance = controllerProvenance(result.provenance);
        if (planDigest !== releasePlanDigest(plan) || provenance.configDigest !== expectedDigest
          || provenance.releasePlan.digest !== planDigest || !same(provenance.controller, after.controllerIdentity)) throw new Error("CONTROLLER_PROVENANCE_DRIFT");
        return { planDigest, plan: result.plan, configDigest: after.configDigest, provenance };
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    },
    doctor(expectedConfigDigest, expectedConfigIdentity, expectedControllerIdentity) {
      const expected = digest(expectedConfigDigest, "CONFIG_DIGEST");
      if (typeof expectedConfigIdentity !== "string" || configIdentity(controllerConfig) !== expectedConfigIdentity) throw new Error("CONTROLLER_CONFIG_DRIFT");
      const result = invoke(controllerCli, ["doctor", "--config", controllerConfig, "--json"], { failureCode: "CONTROLLER_DOCTOR_FAILED", nodeArgs });
      if (configIdentity(controllerConfig) !== expectedConfigIdentity) throw new Error("CONTROLLER_CONFIG_DRIFT");
      if (result?.ok !== true) throw new Error("CONTROLLER_DOCTOR_FAILED");
      if (digest(result.configDigest, "CONFIG_DIGEST") !== expected) throw new Error("CONTROLLER_DOCTOR_CONFIG_DRIFT");
      if (!same(controllerIdentity(result.controller), controllerIdentity(expectedControllerIdentity))) throw new Error("CONTROLLER_IDENTITY_DRIFT");
      return result;
    },
  };
}
