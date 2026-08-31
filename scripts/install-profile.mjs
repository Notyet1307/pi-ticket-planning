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
import { digest } from "../installation/manager.mjs";
import { configuredSubagentSource, runtimeMetadata } from "../installation/build-metadata.mjs";
import { loadProtocol } from "../protocol/kernel.mjs";

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_METADATA = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"));
const PROFILE_TEMPLATE = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, "profile", "settings.template.json"), "utf8"));
const UPSTREAM_SOURCE = `git:github.com/mattpocock/skills@${PACKAGE_METADATA.mattpocockUpstream.commit}`;
const SUBAGENTS_SOURCE = configuredSubagentSource(PACKAGE_ROOT);
const FFF_SOURCE = PROFILE_TEMPLATE.packages.find((entry) => /^npm:@ff-labs\/pi-fff@[0-9]+\.[0-9]+\.[0-9]+$/.test(entry?.source ?? ""))?.source;
const TODO_SOURCE = PROFILE_TEMPLATE.packages.find((entry) => /^npm:@juicesharp\/rpiv-todo@[0-9]+\.[0-9]+\.[0-9]+$/.test(entry?.source ?? ""))?.source;
const REVIEWER_READ_GUARD = path.join("extensions", "ticket-readiness-read-guard.mjs");
const REVIEWER_AGENT = path.join("agents", "ticket-readiness-reviewer.md");

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
  const merged = {
    ...existing,
    ...template,
  };
  delete merged.subagents;
  return merged;
}

export function managedProfileFiles({ packageRoot = PACKAGE_ROOT, profileDir }) {
  const resolvedPackageRoot = path.resolve(packageRoot);
  const resolvedProfileDir = path.resolve(profileDir);
  const settingsFile = path.join(resolvedProfileDir, "settings.json");
  const existing = existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, "utf8")) : {};
  return [
    { path: "settings.json", content: `${JSON.stringify(mergedSettings(resolvedPackageRoot, existing), null, 2)}\n`, mode: 0o600 },
    { path: "AGENTS.md", content: readFileSync(path.join(resolvedPackageRoot, "profile", "AGENTS.md"), "utf8"), mode: 0o644 },
    { path: REVIEWER_AGENT, content: readFileSync(path.join(resolvedPackageRoot, REVIEWER_AGENT), "utf8"), mode: 0o644 },
  ];
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
  clock = () => new Date(),
  sourceMetadata = {},
  writeManifest = true,
}) {
  const resolvedPackageRoot = path.resolve(packageRoot);
  const resolvedProfileDir = path.resolve(profileDir);
  const resolvedBinDir = path.resolve(binDir);
  const backups = [];
  const reviewerReadGuard = path.join(resolvedPackageRoot, REVIEWER_READ_GUARD);
  const guardStat = lstatSafe(reviewerReadGuard);
  if (!guardStat?.isFile() || guardStat.isSymbolicLink()) throw new Error("reviewer read guard is unavailable");

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
  mkdirSync(path.join(resolvedProfileDir, "agents"), { recursive: true, mode: 0o700 });
  atomicWrite(
    path.join(resolvedProfileDir, REVIEWER_AGENT),
    readFileSync(path.join(resolvedPackageRoot, REVIEWER_AGENT), "utf8"),
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

  const packageMetadata = JSON.parse(readFileSync(path.join(resolvedPackageRoot, "package.json"), "utf8"));
  const buildMetadata = runtimeMetadata({ root: resolvedPackageRoot });
  const installedFiles = [settingsFile, path.join(resolvedProfileDir, "AGENTS.md"), path.join(resolvedProfileDir, REVIEWER_AGENT)].map((file) => ({
    path: path.relative(resolvedProfileDir, file),
    digest: digest(readFileSync(file)),
    mode: lstatSync(file).mode & 0o777,
  }));
  const manifest = {
    schema: "pi-ticket-planning:installation-manifest:v1",
    installationId: sourceMetadata.installationId ?? `I-${clock().toISOString().replace(/[-:.TZ]/g, "")}`,
    packageVersion: sourceMetadata.packageVersion ?? packageMetadata.version,
    sourceCommit: sourceMetadata.sourceCommit ?? buildMetadata.sourceCommit,
    installedAt: clock().toISOString(),
    nodeVersion: sourceMetadata.nodeVersion ?? process.versions.node,
    piVersion: sourceMetadata.piVersion ?? "UNTESTED",
    subagentVersion: sourceMetadata.subagentVersion ?? buildMetadata.subagentVersion,
    upstreamSkillCommit: sourceMetadata.upstreamSkillCommit ?? packageMetadata.mattpocockUpstream?.commit ?? "UNTESTED",
    profileDigest: digest(JSON.stringify(installedFiles)),
    protocolVersions: sourceMetadata.protocolVersions
      ?? Object.fromEntries(loadProtocol().registry.artifacts.map((artifact) => [artifact.name, artifact.currentMajor])),
    installedFiles,
    backups: backups.map((backup) => {
      const metadata = lstatSync(backup);
      return {
        path: path.resolve(backup),
        digest: metadata.isSymbolicLink() ? digest(`link:${readlinkSync(backup)}`) : digest(readFileSync(backup)),
        mode: metadata.mode & 0o777,
      };
    }),
  };
  if (writeManifest) finalizeInstallation({ profileDir: resolvedProfileDir, manifest });

  return { profileDir: resolvedProfileDir, launcher, controlLauncher, backups, manifest };
}

export function finalizeInstallation({ profileDir, manifest }) {
  const resolvedProfileDir = path.resolve(profileDir);
  for (const record of manifest.installedFiles) {
    const file = path.join(resolvedProfileDir, record.path);
    const metadata = lstatSync(file);
    if (!metadata.isFile() || metadata.isSymbolicLink() || digest(readFileSync(file)) !== record.digest || (metadata.mode & 0o777) !== record.mode) {
      throw new Error(`installed file verification failed: ${record.path}`);
    }
  }
  atomicWrite(path.join(resolvedProfileDir, "installation.json"), `${JSON.stringify(manifest, null, 2)}\n`, 0o600);
  return manifest;
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

  const piVersion = run(piBin, ["--version"]);
  run("git", ["--version"]);
  run("gh", ["--version"]);
  const buildMetadata = runtimeMetadata({ root: PACKAGE_ROOT });

  const installed = writeInstallation({
    profileDir,
    binDir,
    defaultProfileDir,
    sourceMetadata: {
      sourceCommit: buildMetadata.sourceCommit,
      nodeVersion: process.version,
      piVersion,
      subagentVersion: buildMetadata.subagentVersion,
    },
    writeManifest: false,
  });
  const runtimeEnv = {
    ...process.env,
    PI_CODING_AGENT_DIR: installed.profileDir,
    PI_TICKET_PLAN_PROFILE_DIR: installed.profileDir,
    PI_TICKET_PLAN_LAUNCHER: installed.launcher,
  };

  run(piBin, ["install", UPSTREAM_SOURCE], runtimeEnv);
  run(piBin, ["install", SUBAGENTS_SOURCE], runtimeEnv);
  if (!FFF_SOURCE) throw new Error("pi-fff source is unavailable");
  run(piBin, ["install", FFF_SOURCE], runtimeEnv);
  if (!TODO_SOURCE) throw new Error("rpiv-todo source is unavailable");
  run(piBin, ["install", TODO_SOURCE], runtimeEnv);
  run(piBin, ["update", "--extensions"], runtimeEnv);
  chmodSync(path.join(installed.profileDir, "settings.json"), 0o600);
  const verification = run(process.execPath, [path.join(PACKAGE_ROOT, "scripts", "check-profile.mjs")], runtimeEnv);
  finalizeInstallation({ profileDir: installed.profileDir, manifest: installed.manifest });

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
