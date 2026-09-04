import fs from "node:fs";
import path from "node:path";
import { fingerprint } from "./domain.mjs";
import { assertCanonicalPrivateExistingFile } from "./private-paths.mjs";

const TOKEN = /^[a-z0-9._-]{1,80}$/u;
const HOST = /^(?!-)[A-Za-z0-9._-]{1,253}$/u;

export function loadGoalRunnerConfig(file) {
  const source = assertCanonicalPrivateExistingFile(path.resolve(file), "GOAL_RUNNER_CONFIG", { mode: 0o600 });
  let value;
  try { value = JSON.parse(fs.readFileSync(source, "utf8")); }
  catch { throw new Error("INVALID_GOAL_RUNNER_CONFIG"); }
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join("\n") !== "runners\nschema"
    || value.schema !== "pi-ticket-planning:goal-runner-config:v1"
    || !Array.isArray(value.runners) || value.runners.length === 0 || value.runners.length > 32) {
    throw new Error("INVALID_GOAL_RUNNER_CONFIG");
  }
  const runners = value.runners.map(validateRunner);
  if (new Set(runners.map(({ ref }) => ref)).size !== runners.length) throw new Error("DUPLICATE_GOAL_RUNNER_REF");
  return { schema: value.schema, runners };
}

export function resolveGoalRunner(config, { channel, runnerRef }) {
  if (!config || !Array.isArray(config.runners)) throw new Error("INVALID_GOAL_RUNNER_CONFIG");
  const runner = config.runners.find(({ ref }) => ref === runnerRef);
  if (!runner) throw new Error("GOAL_RUNNER_UNCONFIGURED");
  if (channel === "GOAL_LOCAL" && (runner.ref !== "local" || runner.transport !== "local" || runner.sshHost !== null)) {
    throw new Error("GOAL_LOCAL_RUNNER_INVALID");
  }
  if (channel === "GOAL_REMOTE" && (runner.transport !== "ssh" || runner.sshHost === null)) {
    throw new Error("GOAL_REMOTE_RUNNER_INVALID");
  }
  if (!["GOAL_LOCAL", "GOAL_REMOTE"].includes(channel)) throw new Error("INVALID_GOAL_CHANNEL");
  return { ...runner, digest: fingerprint(runner) };
}

function validateRunner(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join("\n") !== "host\nref\nrunnerCli\nrunnerConfig\nsshHost\ntransport"
    || !TOKEN.test(value.ref ?? "") || !HOST.test(value.host ?? "")
    || !["local", "ssh"].includes(value.transport)
    || (value.sshHost !== null && !HOST.test(value.sshHost ?? ""))
    || typeof value.runnerCli !== "string" || !path.isAbsolute(value.runnerCli) || value.runnerCli.length > 4096
    || typeof value.runnerConfig !== "string" || !path.isAbsolute(value.runnerConfig) || value.runnerConfig.length > 4096
    || /[\u0000\r\n]/u.test(`${value.runnerCli}${value.runnerConfig}`)) {
    throw new Error("INVALID_GOAL_RUNNER_CONFIG");
  }
  return {
    ref: value.ref,
    transport: value.transport,
    host: value.host,
    sshHost: value.sshHost,
    runnerCli: value.runnerCli,
    runnerConfig: value.runnerConfig,
  };
}
