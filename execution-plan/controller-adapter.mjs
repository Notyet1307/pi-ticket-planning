import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HEX, canonical } from "./domain.mjs";

const MAX_OUTPUT = 1024 * 1024;

function trustedLexicalPath(value) {
  const requested = path.resolve(value);
  const aliases = [...new Set([os.tmpdir(), "/tmp", "/var"].map((entry) => path.resolve(entry)))]
    .filter((entry) => fs.existsSync(entry))
    .sort((left, right) => right.length - left.length);
  const alias = aliases.find((entry) => requested === entry || requested.startsWith(`${entry}${path.sep}`));
  return alias ? path.join(fs.realpathSync(alias), path.relative(alias, requested)) : requested;
}

function privateRegularFile(value, name) {
  if (!path.isAbsolute(value ?? "")) throw new Error(`${name}_MUST_BE_ABSOLUTE`);
  const resolved = fs.realpathSync(value);
  if (resolved !== trustedLexicalPath(value)) throw new Error(`${name}_PATH_CONTAINS_SYMLINK`);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error(`${name}_MUST_BE_REGULAR_FILE`);
  if (name === "CONTROLLER_CONFIG" && (stat.mode & 0o077) !== 0) throw new Error("CONTROLLER_CONFIG_MUST_BE_PRIVATE");
  return resolved;
}

function invoke(cli, args, { timeout = 15_000, input } = {}) {
  const run = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", input, timeout, maxBuffer: MAX_OUTPUT, shell: false });
  if (run.error) throw new Error(`CONTROLLER_${run.error.code ?? "EXEC_ERROR"}`);
  if (run.signal || run.status !== 0) throw new Error("CONTROLLER_COMMAND_FAILED");
  try { return JSON.parse(run.stdout); } catch { throw new Error("CONTROLLER_INVALID_JSON"); }
}

function digest(value, name) {
  if (typeof value !== "string" || !HEX.test(value)) throw new Error(`CONTROLLER_INVALID_${name}`);
  return value;
}

export function createControllerAdapter({ cli, config }) {
  const controllerCli = privateRegularFile(cli, "CONTROLLER_CLI");
  const controllerConfig = privateRegularFile(config, "CONTROLLER_CONFIG");
  return {
    config() {
      const result = invoke(controllerCli, ["config", "validate", "--config", controllerConfig, "--json"]);
      if (result?.ok !== true) throw new Error("CONTROLLER_CONFIG_INVALID");
      return { config: result.config ?? result.value ?? result, configDigest: digest(result.configDigest, "CONFIG_DIGEST") };
    },
    validatePlan(plan) {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ticket-plan-"));
      const file = path.join(directory, "release-plan.json");
      try {
        fs.writeFileSync(file, `${JSON.stringify(plan)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
        fs.chmodSync(file, 0o600);
        const result = invoke(controllerCli, ["plan", "validate", "--config", controllerConfig, "--plan", file, "--json"]);
        if (result?.ok !== true) throw new Error("CONTROLLER_PLAN_INVALID");
        if (!result.plan || JSON.stringify(canonical(result.plan)) !== JSON.stringify(canonical(plan))) throw new Error("CONTROLLER_PLAN_ECHO_MISMATCH");
        return { planDigest: digest(result.planDigest, "PLAN_DIGEST"), plan: result.plan };
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    },
    doctor() {
      const result = invoke(controllerCli, ["doctor", "--config", controllerConfig, "--json"]);
      if (result?.ok !== true) throw new Error("CONTROLLER_DOCTOR_FAILED");
      return result;
    },
  };
}
