import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function lexical(value, name) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw new Error(`${name}_MUST_BE_ABSOLUTE`);
  if (path.resolve(value) !== value) throw new Error(`${name}_MUST_BE_CANONICAL`);
  return value;
}

function expectedPath(value) {
  const aliases = [...new Set([os.tmpdir(), "/tmp"].map((entry) => path.resolve(entry)))]
    .filter((entry) => fs.existsSync(entry))
    .sort((left, right) => right.length - left.length);
  const alias = aliases.find((entry) => value === entry || value.startsWith(`${entry}${path.sep}`));
  return alias ? path.join(fs.realpathSync(alias), path.relative(alias, value)) : value;
}

function existing(value, name) {
  const requested = lexical(value, name);
  let resolved;
  try { resolved = fs.realpathSync(requested); } catch { throw new Error(`${name}_NOT_FOUND`); }
  if (resolved !== expectedPath(requested)) throw new Error(`${name}_PATH_CONTAINS_SYMLINK`);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink()) throw new Error(`${name}_MUST_NOT_BE_SYMLINK`);
  return { path: resolved, stat };
}

export function assertCanonicalExistingDirectory(value, name = "DIRECTORY") {
  const found = existing(value, name);
  if (!found.stat.isDirectory()) throw new Error(`${name}_MUST_BE_DIRECTORY`);
  return found.path;
}

export function assertCanonicalPrivateExistingDirectory(value, name = "DIRECTORY") {
  const resolved = assertCanonicalExistingDirectory(value, name);
  if ((fs.lstatSync(resolved).mode & 0o077) !== 0) throw new Error(`${name}_MUST_BE_PRIVATE_DIRECTORY`);
  return resolved;
}

export function assertCanonicalPrivateExistingFile(value, name = "FILE", { mode = null } = {}) {
  const found = existing(value, name);
  if (!found.stat.isFile() || found.stat.nlink !== 1) throw new Error(`${name}_MUST_BE_REGULAR_FILE`);
  if (mode === null ? (found.stat.mode & 0o022) !== 0 : (found.stat.mode & 0o777) !== mode) {
    throw new Error(`${name}_MUST_BE_PRIVATE`);
  }
  return found.path;
}

export function assertCanonicalPrivateOutputParent(value, name = "OUTPUT_PARENT") {
  return assertCanonicalPrivateExistingDirectory(value, name);
}

export function assertCanonicalAbsentChildPath(value, name = "OUTPUT", parentName = "OUTPUT_PARENT") {
  const requested = lexical(value, name);
  const parent = assertCanonicalPrivateOutputParent(path.dirname(requested), parentName);
  const target = path.join(parent, path.basename(requested));
  if (fs.lstatSync(target, { throwIfNoEntry: false })) throw new Error(`${name}_ALREADY_EXISTS`);
  return target;
}

export function assertSameFileSystem(left, right, name = "OUTPUT_STAGING") {
  if (fs.lstatSync(left).dev !== fs.lstatSync(right).dev) throw new Error(`${name}_FILESYSTEM_MISMATCH`);
}
