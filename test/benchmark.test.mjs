import assert from "node:assert/strict";
import test from "node:test";

import { runBenchmark } from "../benchmark/benchmark.mjs";

test("benchmark reports graph and Planning Case scaling without external calls", () => {
  const times = [0n, 1_000_000n, 0n, 5_000_000n, 0n, 2_000_000n, 0n, 5_000_000n];
  const report = runBenchmark({ ticketSizes: [10, 50], caseSizes: [2, 5], clock: () => times.shift() });
  assert.equal(report.schema, "pi-ticket-planning:benchmark-report:v1");
  assert.deepEqual(report.graph.map(({ size }) => size), [10, 50]);
  assert.deepEqual(report.graph.map(({ durationMs }) => durationMs), [1, 5]);
  assert.deepEqual(report.cases.map(({ size }) => size), [2, 5]);
  assert.equal(report.metrics.githubApiCalls, 0);
  assert.equal(report.metrics.modelTurns, 0);
  assert.equal(report.regressions, false);
});
