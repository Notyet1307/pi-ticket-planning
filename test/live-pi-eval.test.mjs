import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  hashText,
  parseDeliveryGraph,
  validateDeliveryGraph,
} from "../scripts/check-delivery-graph.mjs";
import {
  evaluateCaseGate,
  matchChineseAskYetCard,
  matchLiveEvalOutput,
  selectLiveEvalCases,
  summarizeLiveEvalAttempts,
  validateLiveEvalFixture,
} from "../scripts/eval-pi-behavior.mjs";

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

  const card = [
    "当前目标：确认是否继续 R004。",
    "已经确认：证据窗口尚未结束，将继续完整验证路径。",
    "仍然缺少：五次真实观察。",
    "为什么现在不能继续：当前没有足够结果证据。",
    "你只需要决定：无需决定；系统下次会重新读取观察结果。",
    "",
    "Checkpoint: PRODUCT/OUTCOME · R004/r1 · AWAITING_EVIDENCE",
  ].join("\n");
  assert.deepEqual(matchChineseAskYetCard(card), []);
  assert.equal(matchChineseAskYetCard(`${card}\nNeed: more evidence`).length, 2);
  assert.match(matchChineseAskYetCard(card.replace("仍然缺少：", "Research Handoff:\n仍然缺少：")).join("\n"), /unexpected top-level card content/u);

  const invalidCheckpoint = card.replace("PRODUCT/OUTCOME", "TRIAGE/MADE_UP");
  assert.match(matchChineseAskYetCard(invalidCheckpoint).join("\n"), /invalid Checkpoint/u);
});

test("live PI reports distinguish semantic, infrastructure, and per-case success rates", () => {
  const summary = summarizeLiveEvalAttempts([
    { caseId: "frame", skill: "ask-yet", status: "PASS" },
    { caseId: "frame", skill: "ask-yet", status: "SEMANTIC_FAIL" },
    { caseId: "admission", skill: "admit-ticket", status: "INFRA_FAIL" },
  ]);
  assert.equal(summary.total, 3);
  assert.equal(summary.passed, 1);
  assert.equal(summary.semanticFailed, 1);
  assert.equal(summary.infraFailed, 1);
  assert.equal(summary.successRate, 1 / 3);
  assert.deepEqual(summary.cases, [
    { id: "frame", skill: "ask-yet", attempts: 2, passed: 1, successRate: 1 / 2 },
    { id: "admission", skill: "admit-ticket", attempts: 1, passed: 0, successRate: 0 },
  ]);
});

test("release suite is pinned and accepts a recovered flaky case", () => {
  const selected = selectLiveEvalCases(fixture, { suite: "release" });
  assert.deepEqual(selected.map(({ id }) => id), fixture.releaseGateCases);
  assert.throws(() => selectLiveEvalCases(fixture, { suite: "missing" }), /unknown suite/);

  const gate = evaluateCaseGate([
    { caseId: "frame", status: "SEMANTIC_FAIL" },
    { caseId: "frame", status: "PASS" },
    { caseId: "admission", status: "PASS" },
  ], ["frame", "admission"]);
  assert.deepEqual(gate, { passed: true, failed: [], flaky: ["frame"] });
  assert.deepEqual(evaluateCaseGate([{ caseId: "frame", status: "INFRA_FAIL" }], ["frame"]), {
    passed: false,
    failed: ["frame"],
    flaky: [],
  });
});

test("QUICK fixture accepts an equivalent Chinese standalone-ticket phrase", () => {
  const quick = fixture.cases.find(({ id }) => id === "workflow-tier-quick-local-copy");
  for (const ticketPhrase of ["形成一个独立候选后准入", "增加一个独立修正票"]) {
    assert.deepEqual(matchLiveEvalOutput([
      "已经确认：边界明确，将使用快速路径。",
      `仍然缺少：${ticketPhrase}。`,
      "Checkpoint: TRIAGE/ORIENT · NONE · ROUTED",
    ].join("\n"), quick.expected), []);
  }
});

test("STANDARD fixture accepts the Chinese Release-lite label", () => {
  const standard = fixture.cases.find(({ id }) => id === "workflow-tier-standard-known-feature");
  assert.deepEqual(matchLiveEvalOutput([
    "已经确认：行为已批准，因此走标准路径。",
    "仍然缺少：一个精确的精简发布修订，以及负责人的提交决定。",
  ].join("\n"), standard.expected), []);
});

test("DISCOVERY fixture accepts a recent concrete experience request", () => {
  const discovery = fixture.cases.find(({ id }) => id === "workflow-tier-discovery-vague-product");
  assert.deepEqual(matchLiveEvalOutput([
    "已经确认：信息不足，将使用完整发现路径。",
    "仍然缺少：一位用户最近一次真实失败的具体经历。",
    "Checkpoint: PRODUCT/FRAME · NONE · FRAME_CANDIDATE",
  ].join("\n"), discovery.expected), []);
});

test("DELIVERED fixture accepts an equivalent Chinese missing-release fact", () => {
  const delivered = fixture.cases.find(({ id }) => id === "delivered-not-released");
  assert.deepEqual(matchLiveEvalOutput([
    "已经确认：工程交付完成，但尚无发布、启用或结果证据。",
    "仍然缺少：移除父项的 ready-for-agent 标签。",
    "Checkpoint: DELIVERY/EXECUTION · R003/r1 · DELIVERED",
  ].join("\n"), delivered.expected), []);
});

test("readiness live fixture supplies the exact fresh-review facts", () => {
  const readiness = fixture.cases.find(({ id }) => id === "lifecycle-candidate-passes-readiness");
  const bundle = readiness.files["tracker/review-bundle.md"];
  assert.match(bundle, /Review timestamp: 2026-08-16T14:12:00Z/u);
  assert.match(bundle, /The approved enum is exactly dependency, test, infrastructure, or unsupported/u);
  assert.match(bundle, /Primary command: `npm test -- build-failure-v1`/u);
  assert.match(bundle, /Current blockers: none/u);
});

test("ticket-graph live fixture binds its exact Spec and candidate bodies", () => {
  const item = fixture.cases.find(({ id }) => id === "lifecycle-accepted-spec-compiles-ticket-graph");
  const spec = item.files["tracker/delivery-spec-70.md"].trimEnd();
  const snapshotText = item.files["tracker/proposed-ticket-snapshot.md"];
  const c01 = snapshotText.match(/(## C01[\s\S]*?)(?=\n## C02)/u)[1].trimEnd();
  const c02 = snapshotText.match(/(## C02[\s\S]*?)(?=\n<!-- pi-ticket-planning:delivery-graph:v2 -->)/u)[1].trimEnd();
  const graph = parseDeliveryGraph(snapshotText);

  assert.equal(graph.source.specContentHash, hashText(spec));
  assert.equal(graph.children[0].bodyHash, hashText(c01));
  assert.equal(graph.children[1].bodyHash, hashText(c02));
  assert.deepEqual(validateDeliveryGraph(graph).problems, []);
  assert.deepEqual(matchLiveEvalOutput([
    "### Scenario coverage",
    "**冻结草稿：PASS**",
    "### Walking skeleton",
    "**冻结草稿：PASS**",
    "Delivery Graph includes C01 and C02 with needs-triage; waiting for approval.",
  ].join("\n"), item.expected), []);
});
