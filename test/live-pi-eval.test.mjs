import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { matchLiveEvalOutput, validateLiveEvalFixture } from "../scripts/eval-pi-behavior.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(fs.readFileSync(path.join(root, "fixtures", "pi-live-eval-cases.json"), "utf8"));

test("live PI eval fixture and semantic matcher are valid", () => {
  assert.deepEqual(validateLiveEvalFixture(fixture), []);
  assert.deepEqual(matchLiveEvalOutput("Checkpoint: PRODUCT/OUTCOME · R004/r1 · AWAITING_EVIDENCE", {
    mustMatch: ["PRODUCT/OUTCOME.*AWAITING_EVIDENCE"],
    mustNotMatch: ["ACHIEVED$"],
  }), []);
  assert.equal(matchLiveEvalOutput("Checkpoint: PRODUCT/OUTCOME · R004/r1 · ACHIEVED", {
    mustMatch: ["AWAITING_EVIDENCE"],
    mustNotMatch: ["ACHIEVED$"],
  }).length, 2);
});
