import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { generateBuildMetadata } from "../installation/build-metadata.mjs";
import { validateArtifact } from "../protocol/kernel.mjs";
import { validateCompatibilityMatrix } from "../capabilities/compatibility.mjs";
import { validateQualificationSemantics, validateReportEnvelope } from "../integration/report.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.status !== 0) throw new Error(typeof result.stderr === "string" ? result.stderr.trim() : `${command} failed`);
  return result.stdout;
}

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function objectDigest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`;
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    if (!argv[index]?.startsWith("--") || !argv[index + 1]) throw new Error("INVALID_RELEASE_ARTIFACT_OPTION");
    values.set(argv[index], argv[index + 1]);
  }
  for (const name of ["--qualification", "--proposal", "--out"]) if (!values.has(name)) throw new Error("MISSING_RELEASE_ARTIFACT_OPTION");
  return values;
}

export function buildReleaseArtifacts({ qualificationFile, proposalFile, outDir, root = ROOT } = {}) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  if (packageJson.version !== "0.5.0-beta.1") throw new Error("BETA_VERSION_REQUIRED");
  const qualification = JSON.parse(fs.readFileSync(qualificationFile, "utf8"));
  const proposal = JSON.parse(fs.readFileSync(proposalFile, "utf8"));
  if (qualification.status !== "COMPLETE" || !validateArtifact(qualification).ok || validateQualificationSemantics(qualification).length
    || !validateArtifact(proposal).ok
    || proposal.proposalDigest !== objectDigest(Object.fromEntries(Object.entries(proposal).filter(([key]) => key !== "proposalDigest")))
    || proposal.qualificationDigest !== qualification.reportDigest
    || proposal.qualificationProvenance?.repository !== qualification.repository
    || proposal.qualificationProvenance?.workflowRunId !== qualification.workflowRunId
    || proposal.qualificationProvenance?.workflowRunAttempt !== qualification.workflowRunAttempt
    || proposal.qualificationProvenance?.workflowRunUrl !== qualification.workflowRunUrl
    || proposal.qualificationProvenance?.sourceDigest !== qualification.headSha
    || !proposal.entry?.evidence?.some((item) => item.kind === "l4-qualification" && item.digest === qualification.reportDigest)) throw new Error("QUALIFICATION_ARTIFACT_INVALID");
  const head = run("git", ["rev-parse", "HEAD"], { cwd: root }).trim();
  const dirty = run("git", ["status", "--porcelain"], { cwd: root }).trim();
  const build = generateBuildMetadata({ root, sourceCommit: head });
  if (dirty || qualification.headSha !== head || qualification.packageVersion !== packageJson.version
    || qualification.treeSha !== build.treeDigest || proposal.entry.packageCommit !== head
    || !validateReportEnvelope(qualification, { tier: "L4_COMMIT_BOUND_QUALIFICATION", headSha: head, requireActions: true }).ok
    || Date.parse(proposal.entry.expiresAt) < Date.now()) throw new Error("RELEASE_COMMIT_MISMATCH");
  const matrix = JSON.parse(fs.readFileSync(path.join(root, "compatibility", "matrix.json"), "utf8"));
  const alreadyPresent = matrix.entries.some((entry) => JSON.stringify(entry) === JSON.stringify(proposal.entry));
  const releaseMatrix = alreadyPresent ? matrix : { ...matrix, entries: [...matrix.entries, proposal.entry] };
  if (proposal.entry.status !== "SUPPORTED" || proposal.entry.packageCommit !== head
    || !validateCompatibilityMatrix(releaseMatrix).ok) throw new Error("SUPPORTED_MATRIX_ENTRY_MISSING");

  const out = path.resolve(outDir);
  fs.mkdirSync(out, { recursive: true });
  const prefix = `pi-ticket-planning-${packageJson.version}`;
  const sourceArchive = path.join(out, `${prefix}-source.tar.gz`);
  run("git", ["archive", "--format=tar.gz", `--prefix=${prefix}/`, "-o", sourceArchive, "HEAD"], { cwd: root });

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-release-artifact-"));
  try {
    const sourceTar = run("git", ["archive", "--format=tar", "HEAD"], { cwd: root, encoding: null });
    const extract = spawnSync("tar", ["-xf", "-", "-C", temporary], { input: sourceTar, maxBuffer: 128 * 1024 * 1024 });
    if (extract.status !== 0) throw new Error("INSTALLABLE_ARCHIVE_STAGING_FAILED");
    fs.writeFileSync(path.join(temporary, "build-metadata.json"), `${JSON.stringify(build, null, 2)}\n`);
    fs.writeFileSync(path.join(temporary, "compatibility", "matrix.json"), `${JSON.stringify(releaseMatrix, null, 2)}\n`);
    const installable = path.join(out, `${prefix}-installable.tar.gz`);
    const packed = spawnSync("tar", ["-czf", installable, "-C", temporary, "."]);
    if (packed.status !== 0) throw new Error("INSTALLABLE_ARCHIVE_FAILED");
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }

  const sbom = path.join(out, `${prefix}.cdx.json`);
  fs.writeFileSync(sbom, run("npm", ["sbom", "--sbom-format", "cyclonedx"], { cwd: root }));
  for (const [source, name] of [
    [qualificationFile, "release-qualification.json"],
    [proposalFile, "compatibility-proposal.json"],
    [path.join(root, "docs", "migrations", "v0.4-to-v0.5.md"), "MIGRATION.md"],
    [path.join(root, "docs", "operations", "rollback.md"), "ROLLBACK.md"],
  ]) fs.copyFileSync(source, path.join(out, name));
  fs.writeFileSync(path.join(out, "compatibility-matrix.json"), `${JSON.stringify(releaseMatrix, null, 2)}\n`);
  const files = fs.readdirSync(out).filter((name) => name !== "SHA256SUMS").sort();
  fs.writeFileSync(path.join(out, "SHA256SUMS"), `${files.map((name) => `${sha256(path.join(out, name))}  ${name}`).join("\n")}\n`);
  return { out, files: [...files, "SHA256SUMS"] };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const values = parseArgs(process.argv.slice(2));
  const result = buildReleaseArtifacts({ qualificationFile: path.resolve(values.get("--qualification")), proposalFile: path.resolve(values.get("--proposal")), outDir: values.get("--out") });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
