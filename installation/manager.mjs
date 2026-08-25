import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const MANIFEST = "installation.json";
const SCHEMA = "pi-ticket-planning:installation-manifest:v1";
const SAFE_ID = /^I-[A-Za-z0-9._:-]{1,126}$/;
const PRIVATE_FILES = new Set(["auth.json", "models.json"]);

export const digest = (value) => `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;

function stat(file) {
  try { return fs.lstatSync(file); } catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

function safeRelative(relative) {
  if (typeof relative !== "string" || relative.length === 0 || relative.includes("\0") || path.isAbsolute(relative)
    || relative.split(/[\\/]/u).some((part) => part === "" || part === "..") || PRIVATE_FILES.has(relative)) {
    throw new Error(`unsafe managed path: ${relative ?? ""}`);
  }
  return relative;
}

function contained(root, relative) {
  const target = path.resolve(root, safeRelative(relative));
  const relation = path.relative(path.resolve(root), target);
  if (relation.startsWith("..") || path.isAbsolute(relation)) throw new Error(`managed path escapes profile: ${relative}`);
  return target;
}

function fileRecord(file, root) {
  const metadata = stat(file);
  if (!metadata) return null;
  const relativePath = safeRelative(path.relative(root, file));
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) throw new Error(`unsafe managed file: ${relativePath}`);
  return { path: relativePath, digest: digest(fs.readFileSync(file)), mode: metadata.mode & 0o777 };
}

function privateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const metadata = fs.lstatSync(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error(`unsafe installation directory: ${directory}`);
  fs.chmodSync(directory, 0o700);
}

function atomicWrite(file, content, mode) {
  privateDirectory(path.dirname(file));
  const temporary = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  fs.writeFileSync(temporary, content, { mode, flag: "wx" });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, mode);
}

function installationId(clock) {
  return `I-${clock().toISOString().replace(/[-:.TZ]/g, "")}-${crypto.randomBytes(4).toString("hex")}`;
}

function safeRuntime(value) { return value || "UNTESTED"; }

function readManifest(file) {
  const metadata = fs.lstatSync(file);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || (metadata.mode & 0o077) !== 0) {
    throw new Error("installation manifest is unsafe");
  }
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  if (manifest?.schema !== SCHEMA || !SAFE_ID.test(manifest.installationId ?? "") || !Array.isArray(manifest.installedFiles)) {
    throw new Error("installation manifest is invalid");
  }
  return manifest;
}

export function inspectInstallation({ profileDir }) {
  const root = path.resolve(profileDir);
  const manifestFile = path.join(root, MANIFEST);
  if (!fs.existsSync(manifestFile)) return { status: "UNINSTALLED", manifest: null, conflicts: [] };
  const manifest = readManifest(manifestFile);
  const conflicts = manifest.installedFiles.flatMap((record) => {
    const actual = fileRecord(contained(root, record.path), root);
    return actual?.digest === record.digest && actual.mode === record.mode
      ? []
      : [{ path: record.path, expected: record.digest, actual: actual?.digest ?? null }];
  });
  return { status: conflicts.length ? "CONFLICT" : "INSTALLED", manifest, conflicts };
}

export function planInstallation({
  profileDir,
  files = [],
  metadata = {},
  clock = () => new Date(),
  operation = "update",
}) {
  const root = path.resolve(profileDir);
  const inspected = inspectInstallation({ profileDir: root });
  const conflicts = operation === "rollback" ? [] : inspected.conflicts;
  const seen = new Set();
  const plannedFiles = files.map(({ path: relativePath, content, mode = 0o644 }) => {
    const safePath = safeRelative(relativePath);
    if (seen.has(safePath)) throw new Error(`duplicate managed path: ${safePath}`);
    if (typeof content !== "string" && !Buffer.isBuffer(content)) throw new Error(`invalid managed content: ${safePath}`);
    if (!Number.isInteger(mode) || (mode & ~0o777) !== 0) throw new Error(`invalid managed mode: ${safePath}`);
    seen.add(safePath);
    return { path: safePath, content, mode };
  });
  const id = installationId(clock);
  const records = plannedFiles.map((file) => ({ path: file.path, digest: digest(file.content), mode: file.mode }));
  const manifest = {
    schema: SCHEMA,
    installationId: id,
    packageVersion: safeRuntime(metadata.packageVersion),
    sourceCommit: safeRuntime(metadata.sourceCommit),
    installedAt: clock().toISOString(),
    nodeVersion: safeRuntime(metadata.nodeVersion),
    piVersion: safeRuntime(metadata.piVersion),
    subagentVersion: safeRuntime(metadata.subagentVersion),
    upstreamSkillCommit: safeRuntime(metadata.upstreamSkillCommit),
    profileDigest: digest(JSON.stringify(records)),
    protocolVersions: metadata.protocolVersions ?? { installationManifest: 1 },
    installedFiles: records,
    backups: [],
  };
  return {
    operation,
    dryRun: true,
    ok: conflicts.length === 0,
    status: conflicts.length ? "CONFLICT" : "READY",
    profileDir: root,
    transactionDir: path.join(root, "installations", id),
    files: plannedFiles,
    conflicts,
    manifest,
    previousManifest: inspected.manifest,
  };
}

export function applyInstallation(plan, { failpoint } = {}) {
  if (!plan.ok) return { ...plan, applied: false };
  privateDirectory(plan.profileDir);
  privateDirectory(plan.transactionDir);
  const backups = [];
  const transactionFile = path.join(plan.transactionDir, "transaction.json");
  atomicWrite(transactionFile, `${JSON.stringify({
    operation: plan.operation,
    status: "STARTED",
    installationId: plan.manifest.installationId,
    files: plan.files.map(({ path: relativePath }) => relativePath),
  }, null, 2)}\n`, 0o600);
  for (const file of plan.files) {
    const destination = contained(plan.profileDir, file.path);
    const current = stat(destination);
    if (current) {
      if (!current.isFile() || current.isSymbolicLink() || current.nlink !== 1) throw new Error(`unsafe managed destination: ${file.path}`);
      const backup = path.join(plan.transactionDir, "backups", file.path);
      privateDirectory(path.dirname(backup));
      fs.copyFileSync(destination, backup);
      fs.chmodSync(backup, current.mode & 0o777);
      backups.push({
        path: file.path,
        backup: path.relative(plan.profileDir, backup),
        digest: digest(fs.readFileSync(destination)),
        mode: current.mode & 0o777,
      });
    }
    atomicWrite(destination, file.content, file.mode);
    const snapshot = path.join(plan.transactionDir, "files", file.path);
    atomicWrite(snapshot, file.content, file.mode);
    if (failpoint === `after:${file.path}`) throw new Error(`interrupted at ${file.path}`);
  }
  plan.manifest.backups = backups;
  atomicWrite(path.join(plan.transactionDir, "manifest.json"), `${JSON.stringify(plan.manifest, null, 2)}\n`, 0o600);
  atomicWrite(path.join(plan.profileDir, MANIFEST), `${JSON.stringify(plan.manifest, null, 2)}\n`, 0o600);
  atomicWrite(transactionFile, `${JSON.stringify({ operation: plan.operation, status: "COMPLETE", installationId: plan.manifest.installationId }, null, 2)}\n`, 0o600);
  return { ...plan, applied: true, dryRun: false, backups };
}

export function planRollback({ profileDir, to, clock = () => new Date() }) {
  const root = path.resolve(profileDir);
  const inspected = inspectInstallation({ profileDir: root });
  if (!inspected.manifest) return { operation: "rollback", dryRun: true, ok: false, status: "UNINSTALLED", files: [] };
  if (to !== undefined && !SAFE_ID.test(to)) throw new Error("invalid rollback installation id");

  let files;
  let targetManifest = null;
  let uninstall = false;
  if (to) {
    const targetDir = path.join(root, "installations", to);
    targetManifest = readManifest(path.join(targetDir, "manifest.json"));
    files = targetManifest.installedFiles.map((record) => ({
      path: record.path,
      content: fs.readFileSync(contained(path.join(targetDir, "files"), record.path)),
      mode: record.mode,
    }));
  } else {
    const restored = new Set(inspected.manifest.backups.map(({ path: relativePath }) => relativePath));
    files = inspected.manifest.backups.map(({ path: relativePath, backup, mode }) => ({
      path: relativePath,
      content: fs.readFileSync(contained(root, backup)),
      mode,
    }));
    uninstall = true;
    targetManifest = { ...inspected.manifest, installedFiles: files.map((file) => ({ path: file.path, digest: digest(file.content), mode: file.mode })) };
    targetManifest.installedFiles = targetManifest.installedFiles.filter(({ path: relativePath }) => restored.has(relativePath));
  }
  const plan = planInstallation({ profileDir: root, files, metadata: targetManifest, clock, operation: "rollback" });
  plan.previousManifest = inspected.manifest;
  plan.remove = inspected.manifest.installedFiles
    .map(({ path: relativePath }) => relativePath)
    .filter((relativePath) => !files.some((file) => file.path === relativePath));
  plan.uninstall = uninstall;
  plan.rollbackTo = to ?? null;
  return plan;
}

export function applyRollback(plan, options) {
  const result = applyInstallation(plan, options);
  if (!result.applied) return result;
  for (const relativePath of plan.remove ?? []) fs.rmSync(contained(plan.profileDir, relativePath), { force: true });
  if (plan.uninstall) fs.rmSync(path.join(plan.profileDir, MANIFEST), { force: true });
  return result;
}

export const planUpdate = (options) => planInstallation({ ...options, operation: "update" });
export const planMigrate = (options) => planInstallation({ ...options, operation: "migrate" });

export function recoverInstallation({ profileDir, transactionDir }) {
  const root = path.resolve(profileDir);
  const installations = path.join(root, "installations");
  const resolvedTransaction = path.resolve(transactionDir);
  const relation = path.relative(installations, resolvedTransaction);
  if (relation.startsWith("..") || path.isAbsolute(relation)) throw new Error("transaction escapes installation root");
  const transactionFile = path.join(resolvedTransaction, "transaction.json");
  if (!fs.existsSync(transactionFile)) return { status: "NOTHING_TO_RECOVER" };
  const transaction = JSON.parse(fs.readFileSync(transactionFile, "utf8"));
  if (transaction.status === "COMPLETE" || transaction.status === "RECOVERED") return { status: transaction.status };
  for (const relativePath of transaction.files ?? []) {
    const backup = path.join(resolvedTransaction, "backups", safeRelative(relativePath));
    const destination = contained(root, relativePath);
    if (fs.existsSync(backup)) {
      const metadata = fs.lstatSync(backup);
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("unsafe installation backup");
      fs.copyFileSync(backup, destination);
      fs.chmodSync(destination, metadata.mode & 0o777);
    } else fs.rmSync(destination, { force: true });
  }
  atomicWrite(transactionFile, `${JSON.stringify({ ...transaction, status: "RECOVERED" }, null, 2)}\n`, 0o600);
  return { status: "RECOVERED", transactionDir: resolvedTransaction };
}
