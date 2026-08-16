import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateBehaviorFixtures } from "../scripts/check-behavior-fixtures.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));

test("observed and live behavior fixtures satisfy their deterministic contracts", () => {
  assert.deepEqual(validateBehaviorFixtures(root), []);
});
