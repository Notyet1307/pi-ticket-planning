import assert from "node:assert/strict";
import test from "node:test";
import { validateFrontierOrder } from "../scripts/check-frontier-order.mjs";

test("strict frontier requires every internal blocker before its dependent", () => {
  const inverted = validateFrontierOrder([
    { number: 93, blockedBy: [100, 102] },
    { number: 99, blockedBy: [] },
    { number: 100, blockedBy: [99] },
    { number: 101, blockedBy: [] },
    { number: 102, blockedBy: [101] },
  ]);
  assert.equal(inverted.ok, false);
  assert.deepEqual(
    inverted.inversions.map(({ blocker, dependent }) => [blocker, dependent]),
    [
      [100, 93],
      [102, 93],
    ],
  );

  const corrected = validateFrontierOrder([
    { number: 99, blockedBy: [] },
    { number: 100, blockedBy: [99] },
    { number: 101, blockedBy: [] },
    { number: 102, blockedBy: [101] },
    { number: 93, blockedBy: [100, 102] },
  ]);
  assert.equal(corrected.ok, true);
  assert.deepEqual(corrected.inversions, []);
});
