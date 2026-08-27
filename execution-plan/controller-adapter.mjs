import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HEX, canonical } from "./domain.mjs";
import { assertCanonicalPrivateExistingFile } from "./private-paths.mjs";

const MAX_OUTPUT = 1024 * 1024;

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
    return { config: result.config ?? result.value ?? result, configDigest: digest(result.configDigest, "CONFIG_DIGEST"), configIdentity: after };
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
        return { planDigest: digest(result.planDigest, "PLAN_DIGEST"), plan: result.plan, configDigest: after.configDigest };
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    },
    doctor(expectedConfigDigest, expectedConfigIdentity) {
      const expected = digest(expectedConfigDigest, "CONFIG_DIGEST");
      if (typeof expectedConfigIdentity !== "string" || configIdentity(controllerConfig) !== expectedConfigIdentity) throw new Error("CONTROLLER_CONFIG_DRIFT");
      const result = invoke(controllerCli, ["doctor", "--config", controllerConfig, "--json"], { failureCode: "CONTROLLER_DOCTOR_FAILED", nodeArgs });
      if (configIdentity(controllerConfig) !== expectedConfigIdentity) throw new Error("CONTROLLER_CONFIG_DRIFT");
      if (result?.ok !== true) throw new Error("CONTROLLER_DOCTOR_FAILED");
      if (digest(result.configDigest, "CONFIG_DIGEST") !== expected) throw new Error("CONTROLLER_DOCTOR_CONFIG_DRIFT");
      return result;
    },
  };
}
