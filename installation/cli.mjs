import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { controlMetadata } from "../planning-case/cli.mjs";
import { resultEnvelope } from "../planning-case/result.mjs";
import { loadProtocol } from "../protocol/kernel.mjs";
import { managedProfileFiles } from "../scripts/install-profile.mjs";
import { applyInstallation, applyRollback, planMigrate, planRollback, planUpdate } from "./manager.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sourceMetadata() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const git = spawnSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" });
  const protocol = loadProtocol();
  return {
    packageVersion: pkg.version,
    sourceCommit: git.status === 0 ? git.stdout.trim() : "UNTESTED",
    nodeVersion: process.version,
    piVersion: "UNTESTED",
    subagentVersion: "0.42.1",
    upstreamSkillCommit: pkg.mattpocockUpstream.commit,
    protocolVersions: Object.fromEntries(protocol.registry.artifacts.map((artifact) => [artifact.name, artifact.currentMajor])),
  };
}

function parse(argv) {
  const [command, ...rest] = argv;
  if (!["update", "migrate", "rollback"].includes(command)) throw new Error("INVALID_INSTALLATION_COMMAND");
  const options = new Map();
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!["--dry-run", "--apply", "--json", "--to"].includes(token) || options.has(token)) throw new Error("INVALID_INSTALLATION_OPTION");
    if (token === "--to") {
      if (!rest[index + 1] || rest[index + 1].startsWith("--")) throw new Error("MISSING_INSTALLATION_ID");
      options.set(token, rest[++index]);
    } else options.set(token, true);
  }
  if (options.has("--dry-run") && options.has("--apply")) throw new Error("CONFLICTING_INSTALLATION_MODE");
  if (command === "rollback" && !options.has("--to")) throw new Error("ROLLBACK_TARGET_REQUIRED");
  if (command !== "rollback" && options.has("--to")) throw new Error("INVALID_INSTALLATION_OPTION");
  return { command, options };
}

function summary(plan) {
  return {
    operation: plan.operation,
    dryRun: plan.dryRun,
    status: plan.status,
    installationId: plan.manifest?.installationId ?? null,
    files: (plan.files ?? []).map(({ path: relativePath, mode }) => ({ path: relativePath, mode })),
    conflicts: plan.conflicts ?? [],
    rollbackTo: plan.rollbackTo ?? null,
  };
}

export function runInstallationCli(argv, {
  env = process.env,
  clock = () => new Date(),
  correlationId = `C-install-${process.pid}`,
} = {}) {
  let commandName = "installation.invalid";
  try {
    const parsed = parse(argv);
    commandName = `installation.${parsed.command}`;
    const profileDir = path.resolve(env.PI_TICKET_PLAN_PROFILE_DIR ?? path.join(os.homedir(), ".pi", "ticket-planning"));
    let plan;
    if (parsed.command === "rollback") plan = planRollback({ profileDir, to: parsed.options.get("--to"), clock });
    else {
      const options = { profileDir, files: managedProfileFiles({ profileDir }), metadata: sourceMetadata(), clock };
      plan = parsed.command === "update" ? planUpdate(options) : planMigrate(options);
    }
    if (!plan.ok) {
      return {
        exitCode: 1,
        envelope: resultEnvelope({
          command: commandName,
          status: "CONFLICT",
          data: { plan: summary(plan) },
          problems: [{ code: plan.status === "UNINSTALLED" ? "INSTALLATION_NOT_FOUND" : "MANAGED_PROFILE_DRIFT" }],
          recovery: null,
          meta: controlMetadata({ clock: () => clock().toISOString(), correlationId }),
        }),
      };
    }
    const applied = parsed.options.has("--apply")
      ? (parsed.command === "rollback" ? applyRollback(plan) : applyInstallation(plan))
      : null;
    return {
      exitCode: 0,
      envelope: resultEnvelope({
        command: commandName,
        status: "COMPLETE",
        data: { plan: summary(applied ?? plan), applied: applied?.applied === true },
        problems: [],
        recovery: null,
        meta: controlMetadata({ clock: () => clock().toISOString(), correlationId }),
      }),
    };
  } catch (error) {
    const code = /^[A-Z][A-Z0-9_]+$/.test(error?.message ?? "") ? error.message : "INSTALLATION_OPERATION_FAILED";
    return {
      exitCode: 1,
      envelope: resultEnvelope({
        command: commandName,
        status: "INVALID",
        data: {},
        problems: [{ code }],
        recovery: null,
        meta: controlMetadata({ clock: () => clock().toISOString(), correlationId }),
      }),
    };
  }
}
