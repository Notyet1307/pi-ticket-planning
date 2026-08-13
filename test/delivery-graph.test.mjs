import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  DELIVERY_GRAPH_MARKER,
  parseDeliveryGraph,
  validateDeliveryGraph,
} from "../scripts/check-delivery-graph.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cases = JSON.parse(fs.readFileSync(path.join(root, "fixtures", "admission-cases.json"), "utf8")).graphCases;

test("delivery graph fixtures keep coverage, handoff, skeleton, and frontier fail-closed", () => {
  for (const item of cases) {
    const checked = validateDeliveryGraph(item);
    assert.equal(checked.verdict, item.expectedGraphVerdict, item.id);
    for (const code of item.expectedProblemCodes ?? []) {
      assert.equal(checked.problems.some((problem) => problem.code === code), true, `${item.id}: ${code}`);
    }
  }
});

test("delivery graph parser accepts raw JSON and one marked Markdown snapshot", () => {
  const ready = cases.find((item) => item.expectedGraphVerdict === "READY");
  assert.deepEqual(parseDeliveryGraph(JSON.stringify(ready)), ready);
  assert.deepEqual(parseDeliveryGraph(`${DELIVERY_GRAPH_MARKER}\n\n\`\`\`json\n${JSON.stringify(ready)}\n\`\`\``), ready);
  assert.throws(() => parseDeliveryGraph("# no graph"), /exactly one delivery-graph marker/);
});
