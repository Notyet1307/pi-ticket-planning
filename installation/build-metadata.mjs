import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadProtocol, validateArtifact } from "../protocol/kernel.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHA = /^[a-f0-9]{40,64}$/;

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function runGit(root, args) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", timeout: 15_000 });
  if (result.status !== 0) throw new Error("SOURCE_COMMIT_UNAVAILABLE");
  return result.stdout.trim();
}

export function configuredSubagentVersion(root = ROOT) {
  const profile = JSON.parse(fs.readFileSync(path.join(root, "profile", "settings.template.json"), "utf8"));
  const source = profile.packages?.find((entry) => /^npm:pi-subagents@/.test(entry?.source ?? ""))?.source;
  const version = source?.match(/^npm:pi-subagents@(.+)$/)?.[1];
  if (!version) throw new Error("SUBAGENT_VERSION_UNAVAILABLE");
  return version;
}

export function generateBuildMetadata({
  root = ROOT,
  sourceCommit,
  buildTime = new Date().toISOString(),
} = {}) {
  const resolvedRoot = path.resolve(root);
  const pkg = JSON.parse(fs.readFileSync(path.join(resolvedRoot, "package.json"), "utf8"));
  const commit = sourceCommit ?? runGit(resolvedRoot, ["rev-parse", "HEAD"]);
  if (!SHA.test(commit)) throw new Error("SOURCE_COMMIT_UNAVAILABLE");
  const tracked = runGit(resolvedRoot, ["ls-files", "-s"]);
  const protocol = loadProtocol({ root: resolvedRoot });
  return {
    schema: "pi-ticket-planning:build-metadata:v1",
    packageVersion: pkg.version,
    sourceCommit: commit,
    treeDigest: sha256(tracked),
    buildTime,
    subagentVersion: configuredSubagentVersion(resolvedRoot),
    upstreamSkillCommit: pkg.mattpocockUpstream.commit,
    protocolVersions: Object.fromEntries(protocol.registry.artifacts.map((artifact) => [artifact.name, artifact.currentMajor])),
  };
}

export function runtimeMetadata({ root = ROOT } = {}) {
  const resolvedRoot = path.resolve(root);
  const file = path.join(resolvedRoot, "build-metadata.json");
  const metadata = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : generateBuildMetadata({ root: resolvedRoot });
  const checked = validateArtifact(metadata);
  if (!checked.ok) throw new Error("BUILD_METADATA_INVALID");
  return metadata;
}
