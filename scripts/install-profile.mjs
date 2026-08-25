import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UPSTREAM_SOURCE = "git:github.com/mattpocock/skills@84fdeffd12f2ee307994d1eb6feb48173b6e0502";
const SUBAGENTS_SOURCE = "npm:pi-subagents@0.42.1";

function timestamp() {
  return new Date().toISOString().replace(/[-:.]/g, "");
}

function atomicWrite(file, content, mode) {
  const temporary = `${file}.tmp-${process.pid}`;
  writeFileSync(temporary, content, { mode });
  renameSync(temporary, file);
  chmodSync(file, mode);
}

function backUp(file, backups) {
  const backup = `${file}.backup-${timestamp()}`;
  const metadata = lstatSync(file);
  if (metadata.isSymbolicLink()) symlinkSync(readlinkSync(file), backup);
  else copyFileSync(file, backup);
  backups.push(backup);
}

function mergedSettings(packageRoot, existing) {
  const template = JSON.parse(
    readFileSync(path.join(packageRoot, "profile", "settings.template.json"), "utf8"),
  );
  const packageEntry = template.packages.find((entry) => entry.source === "__PACKAGE_ROOT__");
  if (!packageEntry) throw new Error("profile template has no package-root placeholder");
  packageEntry.source = packageRoot;

  return {
    ...existing,
    ...template,
    subagents: {
      ...(existing.subagents ?? {}),
      ...template.subagents,
      agentOverrides: {
        ...(existing.subagents?.agentOverrides ?? {}),
        ...template.subagents.agentOverrides,
      },
    },
  };
}

function installLink(target, link, backups) {
  if (existsSync(link) || lstatSafe(link)) {
    if (lstatSync(link).isSymbolicLink() && path.resolve(path.dirname(link), readlinkSync(link)) === target) return;
    backUp(link, backups);
  }
  const temporary = `${link}.tmp-${process.pid}`;
  symlinkSync(target, temporary);
  renameSync(temporary, link);
}

function lstatSafe(file) {
  try {
    return lstatSync(file);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export function writeInstallation({
  packageRoot = PACKAGE_ROOT,
  profileDir,
  binDir,
  defaultProfileDir,
}) {
  const resolvedPackageRoot = path.resolve(packageRoot);
  const resolvedProfileDir = path.resolve(profileDir);
  const resolvedBinDir = path.resolve(binDir);
  const backups = [];

  mkdirSync(resolvedProfileDir, { recursive: true, mode: 0o700 });
  mkdirSync(resolvedBinDir, { recursive: true });

  const settingsFile = path.join(resolvedProfileDir, "settings.json");
  const previousText = existsSync(settingsFile) ? readFileSync(settingsFile, "utf8") : null;
  const existing = previousText === null ? {} : JSON.parse(previousText);
  const nextText = `${JSON.stringify(mergedSettings(resolvedPackageRoot, existing), null, 2)}\n`;
  if (previousText !== nextText) {
    if (previousText !== null) backUp(settingsFile, backups);
    atomicWrite(settingsFile, nextText, 0o600);
  }

  atomicWrite(
    path.join(resolvedProfileDir, "AGENTS.md"),
    readFileSync(path.join(resolvedPackageRoot, "profile", "AGENTS.md"), "utf8"),
    0o644,
  );

  const launcher = path.join(resolvedBinDir, "pi-ticket-plan");
  installLink(path.join(resolvedPackageRoot, "profile", "pi-ticket-plan"), launcher, backups);
  const controlLauncher = path.join(resolvedBinDir, "pi-ticket-planctl");
  installLink(path.join(resolvedPackageRoot, "profile", "pi-ticket-plan"), controlLauncher, backups);

  for (const name of ["auth.json", "models.json"]) {
    const source = path.join(defaultProfileDir, name);
    const destination = path.join(resolvedProfileDir, name);
    if (!lstatSafe(destination) && existsSync(source)) symlinkSync(source, destination);
  }

  return { profileDir: resolvedProfileDir, launcher, controlLauncher, backups };
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { encoding: "utf8", env, maxBuffer: 16 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || result.stdout.trim() || `${command} exited ${result.status}`);
  return result.stdout.trim();
}

function main(argv) {
  if (argv.length > 0) throw new Error("usage: ./install.sh");
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 16)) throw new Error("Node.js 22.16 or newer is required");

  const profileDir = process.env.PI_TICKET_PLAN_PROFILE_DIR ?? path.join(os.homedir(), ".pi", "ticket-planning");
  const binDir = process.env.PI_TICKET_PLAN_BIN_DIR ?? path.join(os.homedir(), ".local", "bin");
  const defaultProfileDir = process.env.PI_TICKET_PLAN_DEFAULT_PROFILE_DIR ?? path.join(os.homedir(), ".pi", "agent");
  const piBin = process.env.PI_TICKET_PLAN_PI_BIN ?? "pi";

  run(piBin, ["--version"]);
  run("git", ["--version"]);
  run("gh", ["--version"]);

  const installed = writeInstallation({ profileDir, binDir, defaultProfileDir });
  const runtimeEnv = {
    ...process.env,
    PI_CODING_AGENT_DIR: installed.profileDir,
    PI_TICKET_PLAN_PROFILE_DIR: installed.profileDir,
    PI_TICKET_PLAN_LAUNCHER: installed.launcher,
  };

  run(piBin, ["install", UPSTREAM_SOURCE], runtimeEnv);
  run(piBin, ["install", SUBAGENTS_SOURCE], runtimeEnv);
  run(piBin, ["update", "--extensions"], runtimeEnv);
  chmodSync(path.join(installed.profileDir, "settings.json"), 0o600);
  const verification = run(process.execPath, [path.join(PACKAGE_ROOT, "scripts", "check-profile.mjs")], runtimeEnv);

  console.log(`profile installed: ${installed.profileDir}`);
  console.log(`launcher installed: ${installed.launcher}`);
  console.log(`control launcher installed: ${installed.controlLauncher}`);
  for (const backup of installed.backups) console.log(`backup retained: ${backup}`);
  console.log(verification);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`ERROR ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
