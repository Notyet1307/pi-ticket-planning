import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validatePiBehaviorCases } from "../scripts/check-pi-behavior-cases.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("observed PI canaries satisfy their semantic invariants", () => {
  assert.deepEqual(validatePiBehaviorCases(path.join(root, "fixtures", "pi-behavior-cases.json")), []);
});
