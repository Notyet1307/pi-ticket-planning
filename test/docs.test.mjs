import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateDocs } from "../scripts/check-docs.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("onboarding docs preserve links, language pairs, paths, commands, and authority boundaries", () => {
  assert.deepEqual(validateDocs(root), []);
});

test("docs checker runs as a standalone CI command", () => {
  const result = spawnSync(process.execPath, [path.join(root, "scripts", "check-docs.mjs")], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "docs: ok");
});
