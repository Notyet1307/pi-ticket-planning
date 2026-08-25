import assert from "node:assert/strict";
import test from "node:test";

import { runBenchmark } from "../benchmark/benchmark.mjs";

test("benchmark reports graph and Planning Case scaling without external calls", () => {
  const report = runBenchmark({ ticketSizes: [10, 50], caseSizes: [2, 5] });
  assert.equal(report.schema, "pi-ticket-planning:benchmark-report:v1");
  assert.deepEqual(report.graph.map(({ size }) => size), [10, 50]);
  assert.deepEqual(report.cases.map(({ size }) => size), [2, 5]);
  assert.equal(report.metrics.githubApiCalls, 0);
  assert.equal(report.metrics.modelTurns, 0);
  assert.equal(report.regressions, false);
});
