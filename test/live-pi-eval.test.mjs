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
  combineLiveEvalFixtures,
  evaluateCaseGate,
  matchChineseAskYetCard,
  matchLiveEvalOutput,
  runLivePiEval,
  selectLiveEvalCases,
  summarizeLiveEvalAttempts,
  validateLiveEvalFixture,
  validateMultiTurnEvalFixture,
} from "../scripts/eval-pi-behavior.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(fs.readFileSync(path.join(root, "fixtures", "pi-live-eval-cases.json"), "utf8"));
const multiFixture = JSON.parse(fs.readFileSync(path.join(root, "fixtures", "pi-multiturn-eval-cases.json"), "utf8"));

test("live PI eval fixture and semantic matcher are valid", () => {
  assert.deepEqual(validateLiveEvalFixture(fixture), []);
  assert.equal(fixture.cases.find(({ id }) => id === "lifecycle-admission-stops-for-confirmation").timeoutMs, 300_000);
  const invalidTimeout = structuredClone(fixture);
  invalidTimeout.cases[0].timeoutMs = 0;
  assert.match(validateLiveEvalFixture(invalidTimeout).join("\n"), /timeoutMs must be a positive integer/u);
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
  for (const decision of ["负责人的提交决定", "你对该修订的明确提交决定"]) {
    assert.deepEqual(matchLiveEvalOutput([
      "已经确认：行为已批准，因此走标准路径。",
      `仍然缺少：一个精确的精简发布修订，以及${decision}。`,
    ].join("\n"), standard.expected), []);
  }
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
  for (const boundary of ["尚无发布、启用或结果证据", "尚未发布或进入成效评估", "不代表已发布或结果达成"]) {
    assert.deepEqual(matchLiveEvalOutput([
      `已经确认：工程交付完成，但${boundary}。`,
      "仍然缺少：移除父项的 ready-for-agent 标签。",
      "Checkpoint: DELIVERY/EXECUTION · R003/r1 · DELIVERED",
    ].join("\n"), delivered.expected), []);
  }
});

test("readiness live fixture supplies the exact fresh-review facts", () => {
  const readiness = fixture.cases.find(({ id }) => id === "lifecycle-candidate-passes-readiness");
  const bundle = readiness.files["tracker/review-bundle.md"];
  assert.match(bundle, /Review timestamp: 2026-08-16T14:12:00Z/u);
  assert.match(bundle, /The approved enum is exactly dependency, test, infrastructure, or unsupported/u);
  assert.match(bundle, /Primary command: `npm test -- build-failure-v1`/u);
  assert.match(bundle, /Current blockers: none/u);
  assert.doesNotMatch(bundle, /public classify/u);
});

test("admission live fixture keeps candidate criteria bounded", () => {
  const admission = fixture.cases.find(({ id }) => id === "lifecycle-admission-stops-for-confirmation");
  const bundle = admission.files["tracker/admission-bundle-r006.md"];
  const counts = [...bundle.matchAll(/Acceptance criteria:\n((?:- [^\n]+\n)+)Blocked by:/gu)]
    .map(([, criteria]) => criteria.trim().split("\n").length);
  assert.deepEqual(counts, [5, 3]);
  const c02 = bundle.match(/## Candidate C02 exact body\n([\s\S]*?)\n## Exact normalized Delivery Graph JSON/u)[1];
  assert.match(c02, /dependency -> `Dependency installation failed\.`[\s\S]*unsupported -> `Unsupported build failure\.` with no link/u);
  assert.doesNotMatch(bundle, /public (?:classify|explain)|public explain-command/u);
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
  assert.deepEqual(graph.scenarios.map(({ releaseSignal }) => releaseSignal), [
    "approved frozen-log classification result with no raw log",
    "approved explanation and existing link, or unsupported no-link response, with no raw log",
  ]);
  assert.doesNotMatch(`${spec}\n${snapshotText}`, /public (?:classify|explain)|public explain-command/u);
  assert.deepEqual(validateDeliveryGraph(graph).problems, []);
  assert.deepEqual(matchLiveEvalOutput([
    "### Scenario coverage",
    "**冻结草稿：PASS**",
    "### Walking skeleton",
    "**冻结草稿：PASS**",
    "Delivery Graph includes C01 and C02 with needs-triage; waiting for approval.",
  ].join("\n"), item.expected), []);
});

test("multiturn fixture schema is globally unique and fail-closed", () => {
  assert.deepEqual(validateMultiTurnEvalFixture(multiFixture, fixture.cases.map(({ id }) => id)), []);
  assert.equal(combineLiveEvalFixtures(fixture, multiFixture).releaseGateCases.length, 14);

  const invalid = structuredClone(multiFixture);
  invalid.cases[0].id = fixture.cases[0].id;
  invalid.cases[0].turns = [
    { id: "same", prompt: "one", expected: { mustMatch: [], mustNotMatch: [] }, allowedWrites: [] },
    { id: "same", prompt: "", allowedWrites: [] },
  ];
  const problems = validateMultiTurnEvalFixture(invalid, fixture.cases.map(({ id }) => id)).join("\n");
  assert.match(problems, /duplicate or missing id/u);
  assert.match(problems, /duplicate or missing turn id/u);
  assert.match(problems, /missing prompt/u);
  assert.match(problems, /missing expected/u);

  const tooShort = structuredClone(multiFixture);
  tooShort.cases[0].turns = tooShort.cases[0].turns.slice(0, 1);
  assert.match(validateMultiTurnEvalFixture(tooShort).join("\n"), /at least two turns/u);
});

test("multiturn runner preserves order and session isolation while separating observer and model writes", async () => {
  const sessions = [];
  const evalFixture = {
    version: 1,
    releaseGateCases: ["case-a"],
    cases: [
      {
        id: "case-a",
        skill: "triage",
        files: {},
        turns: [
          { id: "a1", prompt: "first-a", expected: { mustMatch: ["first-a"], mustNotMatch: [] }, allowedWrites: [] },
          {
            id: "a2",
            prompt: "second-a",
            beforeTurn: { files: { "evidence/raw.json": "observer" } },
            expected: { mustMatch: ["second-a"], mustNotMatch: [] },
            allowedWrites: ["allowed.txt"],
            expectedWrites: ["allowed.txt"],
          },
        ],
      },
      {
        id: "case-b",
        skill: "triage",
        files: {},
        turns: [
          { id: "b1", prompt: "first-b", expected: { mustMatch: ["first-b"], mustNotMatch: [] }, allowedWrites: [] },
          { id: "b2", prompt: "second-b", expected: { mustMatch: ["second-b"], mustNotMatch: [] }, allowedWrites: [] },
        ],
      },
    ],
  };
  const report = await runLivePiEval({
    fixture: evalFixture,
    launcher: "fake",
    model: "fake",
    thinking: "off",
    timeoutMs: 1_000,
    runtime: {
      createSession: async ({ cwd, sessionDir }) => {
        const record = { id: `session-${sessions.length + 1}`, cwd, sessionDir, prompts: [] };
        sessions.push(record);
        return {
          identity: { id: record.id, file: path.join(sessionDir, "session.jsonl") },
          async prompt(message) {
            record.prompts.push(message);
            if (message === "second-a") {
              assert.equal(fs.readFileSync(path.join(cwd, "evidence", "raw.json"), "utf8"), "observer");
              fs.writeFileSync(path.join(cwd, "allowed.txt"), "model");
            }
            return message;
          },
          async close() {},
        };
      },
    },
  });

  assert.equal(report.schema, "pi-ticket-planning:live-eval:v2");
  assert.deepEqual(report.fixtureCaseIds, ["case-a", "case-b"]);
  assert.deepEqual(report.attempts.map(({ status }) => status), ["PASS", "PASS"]);
  assert.deepEqual(sessions.map(({ prompts }) => prompts), [
    ["/skill:triage first-a", "second-a"],
    ["/skill:triage first-b", "second-b"],
  ]);
  assert.notEqual(report.attempts[0].sessionIdentity, report.attempts[1].sessionIdentity);
  assert.equal(new Set(report.attempts[0].turns.map(({ sessionIdentity }) => sessionIdentity)).size, 1);
  assert.deepEqual(report.attempts[0].turns.map(({ id }) => id), ["a1", "a2"]);
  assert.deepEqual(report.attempts[0].turns[1].observerActions.mutations.paths, ["created:evidence/raw.json"]);
  assert.deepEqual(report.attempts[0].turns[1].workspaceMutations.paths, ["created:allowed.txt"]);
  assert.equal(report.attempts.every(({ cleanup }) => cleanup.session === "PASS" && cleanup.workspace === "PASS"), true);
  assert.equal(sessions.every(({ cwd, sessionDir }) => !fs.existsSync(cwd) && !fs.existsSync(sessionDir)), true);
});

test("multiturn retry restarts at turn one in a new session and stops after the failed turn", async () => {
  const sessions = [];
  const evalFixture = {
    version: 1,
    releaseGateCases: ["retry-case"],
    cases: [{
      id: "retry-case",
      skill: "triage",
      files: {},
      turns: ["one", "two", "three"].map((id) => ({
        id,
        prompt: id,
        expected: { mustMatch: [`ok-${id}`], mustNotMatch: [] },
        allowedWrites: [],
      })),
    }],
  };
  const report = await runLivePiEval({
    fixture: evalFixture,
    launcher: "fake",
    model: "fake",
    thinking: "off",
    timeoutMs: 1_000,
    retryFailures: 1,
    runtime: {
      createSession: async ({ sessionDir }) => {
        const index = sessions.length;
        const record = { id: `retry-${index}`, prompts: [] };
        sessions.push(record);
        return {
          identity: { id: record.id, file: path.join(sessionDir, "session.jsonl") },
          async prompt(message) {
            record.prompts.push(message);
            const literal = message.replace(/^\/skill:triage\s+/u, "");
            if (index === 0 && literal === "two") return "wrong";
            return `ok-${literal}`;
          },
          async close() {},
        };
      },
    },
  });

  assert.deepEqual(report.attempts.map(({ status }) => status), ["SEMANTIC_FAIL", "PASS"]);
  assert.deepEqual(sessions.map(({ prompts }) => prompts), [
    ["/skill:triage one", "two"],
    ["/skill:triage one", "two", "three"],
  ]);
  assert.notEqual(report.attempts[0].sessionIdentity, report.attempts[1].sessionIdentity);
  assert.match(report.attempts[1].retryReason, /^SEMANTIC_FAIL:/u);
  assert.deepEqual(report.gate, { passed: true, failed: [], flaky: ["retry-case"] });
});

test("multiturn runner rejects forbidden writes and strings and reports cleanup failure", async () => {
  const badFixture = {
    version: 1,
    releaseGateCases: ["bad-path"],
    cases: [
      {
        id: "bad-path",
        skill: "triage",
        files: {},
        turns: [
          { id: "write", prompt: "bad-path", expected: { mustMatch: ["ok"], mustNotMatch: [] }, allowedWrites: [] },
          { id: "never", prompt: "never", expected: { mustMatch: ["ok"], mustNotMatch: [] }, allowedWrites: [] },
        ],
      },
      {
        id: "bad-string",
        skill: "triage",
        files: {},
        forbiddenStrings: ["SECRET-FIXTURE"],
        turns: [
          { id: "secret", prompt: "bad-string", expected: { mustMatch: ["ok"], mustNotMatch: [] }, allowedWrites: ["target.txt"] },
          { id: "never", prompt: "never", expected: { mustMatch: ["ok"], mustNotMatch: [] }, allowedWrites: [] },
        ],
      },
      {
        id: "bad-ref",
        skill: "triage",
        git: true,
        tools: ["bash"],
        files: { "README.md": "fixture\n" },
        turns: [
          {
            id: "ref",
            prompt: "bad-ref",
            expected: { mustMatch: ["ok"], mustNotMatch: [] },
            allowedWrites: [],
            allowedGit: true,
            allowedRemoteRefs: ["refs/heads/approved"],
          },
          { id: "never", prompt: "never", expected: { mustMatch: ["ok"], mustNotMatch: [] }, allowedWrites: [] },
        ],
      },
    ],
  };
  const report = await runLivePiEval({
    fixture: badFixture,
    launcher: "fake",
    model: "fake",
    thinking: "off",
    timeoutMs: 1_000,
    runtime: {
      createSession: async ({ cwd, sessionDir }) => ({
        identity: { id: path.basename(cwd), file: path.join(sessionDir, "session.jsonl") },
        async prompt(message) {
          if (message.includes("bad-path")) fs.writeFileSync(path.join(cwd, "forbidden.txt"), "x");
          if (message.includes("bad-string")) fs.writeFileSync(path.join(cwd, "target.txt"), "SECRET-FIXTURE");
          if (message.includes("bad-ref")) {
            const ref = fs.readFileSync(path.join(cwd, ".git", "fixture-origin.git", "refs", "heads", "main"));
            const target = path.join(cwd, ".git", "fixture-origin.git", "refs", "heads", "unapproved");
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, ref);
          }
          return "ok";
        },
        async close() {},
      }),
    },
  });
  assert.deepEqual(
    report.attempts.map(({ status }) => status),
    ["SEMANTIC_FAIL", "SEMANTIC_FAIL", "SEMANTIC_FAIL"],
    JSON.stringify(report.attempts[2].errors),
  );
  assert.equal(report.attempts.every(({ turns }) => turns.length === 1), true);
  assert.match(report.attempts[0].errors.join("\n"), /unauthorized workspace mutation/u);
  assert.match(report.attempts[1].errors.join("\n"), /workspace contains forbidden string/u);
  assert.match(report.attempts[2].errors.join("\n"), /unauthorized remote ref mutation/u);

  const cleanupFixture = {
    version: 1,
    releaseGateCases: ["cleanup"],
    cases: [{
      id: "cleanup",
      skill: "triage",
      files: {},
      turns: [
        { id: "one", prompt: "one", expected: { mustMatch: ["ok"], mustNotMatch: [] }, allowedWrites: [] },
        { id: "two", prompt: "two", expected: { mustMatch: ["ok"], mustNotMatch: [] }, allowedWrites: [] },
      ],
    }],
  };
  const cleanupReport = await runLivePiEval({
    fixture: cleanupFixture,
    launcher: "fake",
    model: "fake",
    thinking: "off",
    timeoutMs: 1_000,
    runtime: {
      createSession: async ({ sessionDir }) => ({
        identity: { id: "cleanup", file: path.join(sessionDir, "session.jsonl") },
        async prompt() { return "ok"; },
        async close() {},
      }),
      removeTree: (target) => {
        fs.rmSync(target, { recursive: true, force: true });
        if (target.includes("pi-ticket-planning-session-")) throw new Error("injected cleanup failure");
      },
    },
  });
  assert.equal(cleanupReport.attempts[0].status, "INFRA_FAIL");
  assert.equal(cleanupReport.attempts[0].cleanup.session, "FAIL");
  assert.match(cleanupReport.attempts[0].errors.join("\n"), /cleanup failed/u);
});
