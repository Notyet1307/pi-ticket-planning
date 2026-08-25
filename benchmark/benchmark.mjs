import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createPlanningCaseStore } from "../planning-case/store.mjs";
import { validateDeliveryGraph } from "../scripts/check-delivery-graph.mjs";

const sha = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function graph(size) {
  const scenarios = [];
  const children = [];
  for (let index = 1; index <= size; index += 1) {
    scenarios.push({ id: `S${index}`, behavior: `Behavior ${index}`, entry: index === 1 ? "external:input" : `state-${index - 1}`, exit: `state-${index}`, releaseSignal: `signal-${index}`, smallestLoop: index === 1 });
    children.push({
      id: `C${index}`,
      title: `Ticket ${index}`,
      coverageRole: "DIRECT",
      sourceScenarios: [`S${index}`],
      blockedBy: index === 1 ? [] : [`C${index - 1}`],
      externalBlockers: [],
      bodyHash: sha(`Ticket ${index}`),
      startingState: index === 1 ? "input" : `state-${index - 1}`,
      primaryVerification: `verify-${index}`,
      executionLane: index % 7 === 0 ? "HUMAN" : "AGENT",
    });
  }
  return {
    version: 2,
    source: { identity: "benchmark-spec", revision: "r1", baseSha: "a".repeat(40), specContentHash: sha("benchmark") },
    scenarios,
    children,
    walkingSkeleton: ["C1"],
  };
}

function elapsed(start, clock) { return Number(clock() - start) / 1_000_000; }

function percentile(values, quantile) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)] ?? 0;
}

export function runBenchmark({ ticketSizes = [100, 500, 1000], caseSizes = [10, 50], clock = process.hrtime.bigint } = {}) {
  validateDeliveryGraph(graph(1));
  const cpu = process.cpuUsage();
  const memory = process.memoryUsage().heapUsed;
  const graphResults = ticketSizes.map((size) => {
    const start = clock();
    const checked = validateDeliveryGraph(graph(size));
    const durationMs = elapsed(start, clock);
    if (!checked.ok) throw new Error(`benchmark graph ${size} failed`);
    return { size, durationMs, blockedEdges: size - 1, filesystemOperations: 0 };
  });
  const caseResults = caseSizes.map((size) => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-benchmark-"));
    const store = createPlanningCaseStore({ stateDir, idGenerator: (() => { let id = 0; return () => `PC-bench-${size}-${++id}`; })() });
    const start = clock();
    for (let index = 0; index < size; index += 1) store.create({ target: `github:benchmark/repo-${index}` });
    const listed = store.list();
    const durationMs = elapsed(start, clock);
    fs.rmSync(stateDir, { recursive: true, force: true });
    if (listed.length !== size) throw new Error(`benchmark case ${size} failed`);
    return { size, durationMs, filesystemOperations: size * 8 };
  });
  const normalized = graphResults.map(({ size, durationMs }) => durationMs / size);
  const regressions = normalized.length > 1 && Math.max(...normalized) > Math.max(0.01, Math.min(...normalized) * 20);
  const durations = [...graphResults, ...caseResults].map(({ durationMs }) => durationMs);
  return {
    schema: "pi-ticket-planning:benchmark-report:v1",
    graph: graphResults,
    cases: caseResults,
    metrics: {
      p50DurationMs: percentile(durations, 0.5),
      p95DurationMs: percentile(durations, 0.95),
      cpuUserMicros: process.cpuUsage(cpu).user,
      memoryDeltaBytes: process.memoryUsage().heapUsed - memory,
      githubApiCalls: 0,
      modelTurns: 0,
      toolCalls: 0,
      contextTokens: 0,
      retryCount: 0,
    },
    regressions,
  };
}

if (process.argv[1]?.endsWith("benchmark/benchmark.mjs")) {
  const report = runBenchmark();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.regressions) process.exitCode = 1;
}
