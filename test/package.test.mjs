import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validatePackage } from "../scripts/check-package.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("package structure and workflow references are valid", () => {
  assert.deepEqual(validatePackage(root), []);
});

test("CLI main detection accepts a symlinked checkout path", () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "pi-ticket-planning-link-"));
  const linkedRoot = path.join(temporary, "checkout");
  try {
    symlinkSync(root, linkedRoot, "dir");
    const result = spawnSync(process.execPath, [path.join(linkedRoot, "scripts", "check-package.mjs")], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "package contract: ok");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
