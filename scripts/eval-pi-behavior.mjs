import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { parseCheckpoint, validateCheckpointState } from "./workflow-contract.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_SCHEMA = "pi-ticket-planning:live-eval:v1";
const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls", "subagent"]);

export function validateLiveEvalFixture(fixture) {
  const errors = [];
  const ids = new Set();
  if (fixture?.version !== 1) errors.push("fixture version must be 1");
  if (!Array.isArray(fixture?.cases) || fixture.cases.length === 0) errors.push("fixture must contain cases");

  for (const item of fixture?.cases ?? []) {
    if (!item.id || ids.has(item.id)) errors.push(`${item.id || "unnamed"}: duplicate or missing id`);
    ids.add(item.id);
    if (!/^[a-z][a-z0-9-]*$/u.test(item.skill ?? "")) errors.push(`${item.id}: missing or invalid skill`);
    if (!item.prompt?.trim()) errors.push(`${item.id}: missing prompt`);
    if (!item.files || Array.isArray(item.files) || typeof item.files !== "object") {
      errors.push(`${item.id}: files must be an object`);
    }
    if (item.workingTreeFiles && (Array.isArray(item.workingTreeFiles) || typeof item.workingTreeFiles !== "object")) {
      errors.push(`${item.id}: workingTreeFiles must be an object`);
    }
    if (item.tools && (!Array.isArray(item.tools) || item.tools.some((tool) => !READ_ONLY_TOOLS.has(tool)))) {
      errors.push(`${item.id}: tools must contain only read-only eval tools`);
    }
    if (item.timeoutMs !== undefined && (!Number.isInteger(item.timeoutMs) || item.timeoutMs < 1)) {
      errors.push(`${item.id}: timeoutMs must be a positive integer`);
    }
    if (item.git !== undefined && item.git !== true) errors.push(`${item.id}: git must be true when present`);
    if (item.workingTreeFiles && !item.git) errors.push(`${item.id}: workingTreeFiles requires git: true`);
    for (const files of [item.files ?? {}, item.workingTreeFiles ?? {}]) {
      for (const [relative, content] of Object.entries(files)) {
        if (!safeRelativePath(relative)) errors.push(`${item.id}: unsafe workspace path ${relative}`);
        if (typeof content !== "string") errors.push(`${item.id}: ${relative} content must be a string`);
      }
    }
    for (const field of ["mustMatch", "mustNotMatch"]) {
      if (!Array.isArray(item.expected?.[field])) errors.push(`${item.id}: expected.${field} must be an array`);
      for (const pattern of item.expected?.[field] ?? []) {
        try {
          new RegExp(pattern, "isu");
        } catch (error) {
          errors.push(`${item.id}: invalid ${field} pattern ${pattern}: ${error.message}`);
        }
      }
    }
  }
  if (!Array.isArray(fixture?.releaseGateCases) || fixture.releaseGateCases.length === 0) {
    errors.push("fixture must contain releaseGateCases");
  } else {
    if (new Set(fixture.releaseGateCases).size !== fixture.releaseGateCases.length) errors.push("releaseGateCases must be unique");
    for (const id of fixture.releaseGateCases) {
      if (!ids.has(id)) errors.push(`releaseGateCases contains unknown case ${id}`);
    }
  }
  return errors;
}

export function matchLiveEvalOutput(output, expected) {
  const errors = [];
  for (const pattern of expected.mustMatch ?? []) {
    if (!new RegExp(pattern, "isu").test(output)) errors.push(`output lacks /${pattern}/`);
  }
  for (const pattern of expected.mustNotMatch ?? []) {
    if (new RegExp(pattern, "isu").test(output)) errors.push(`output contains forbidden /${pattern}/`);
  }
  return errors;
}

export function matchChineseAskYetCard(output) {
  const errors = [];
  const lines = output.split(/\r?\n/u).map((line) => line.trimEnd());
  const labels = ["当前目标：", "已经确认：", "仍然缺少：", "为什么现在不能继续：", "你只需要决定："];
  const fieldIndexes = [];

  for (const label of labels) {
    const count = lines.filter((line) => line.startsWith(label)).length;
    if (count !== 1) errors.push(`expected exactly one ${label} field, found ${count}`);
    fieldIndexes.push(lines.findIndex((line) => line.startsWith(label)));
  }
  if (!fieldIndexes.every((index, position) => index >= 0 && (position === 0 || index > fieldIndexes[position - 1]))) {
    errors.push("human status fields are out of order");
  }

  for (const prefix of ["Next:", "Need:", "Blocked:", "Workflow tier:"]) {
    if (lines.some((line) => line.startsWith(prefix))) errors.push(`obsolete status line ${prefix}`);
  }
  for (const prefix of ["Repository", "Source boundary", "Lane", "Stage", "Verdict", "仓库", "来源边界"]) {
    if (lines.some((line) => new RegExp(`^${prefix}[：:]`, "u").test(line))) {
      errors.push(`internal status field ${prefix}`);
    }
  }

  const checkpoints = lines.filter((line) => line.startsWith("Checkpoint:"));
  if (checkpoints.length !== 1) errors.push(`expected exactly one Checkpoint, found ${checkpoints.length}`);
  const checkpointIndex = lines.findIndex((line) => line.startsWith("Checkpoint:"));
  for (const line of lines.slice(0, checkpointIndex < 0 ? lines.length : checkpointIndex)) {
    if (!line.trim() || /^\s/u.test(line) || labels.some((label) => line.startsWith(label))) continue;
    errors.push(`unexpected top-level card content: ${line.slice(0, 80)}`);
  }
  const last = lines.findLast((line) => line.trim() !== "");
  if (!last?.startsWith("Checkpoint:")) errors.push("Checkpoint is not the final non-empty line");
  if (last?.startsWith("Checkpoint:")) {
    try {
      const state = parseCheckpoint(last);
      for (const problem of validateCheckpointState(state)) errors.push(`invalid Checkpoint: ${problem.code}`);
    } catch (error) {
      errors.push(`invalid Checkpoint: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return errors;
}

export function selectLiveEvalCases(fixture, { caseId, suite = "all" } = {}) {
  if (caseId) {
    const selected = fixture.cases.filter((item) => item.id === caseId);
    if (selected.length === 0) throw new Error(`unknown case ${caseId}`);
    return selected;
  }
  if (suite === "all") return fixture.cases;
  if (suite !== "release") throw new Error(`unknown suite ${suite}`);
  const byId = new Map(fixture.cases.map((item) => [item.id, item]));
  return fixture.releaseGateCases.map((id) => byId.get(id));
}

export function evaluateCaseGate(attempts, caseIds) {
  const failed = [];
  const flaky = [];
  for (const id of caseIds) {
    const caseAttempts = attempts.filter(({ caseId }) => caseId === id);
    if (!caseAttempts.some(({ status }) => status === "PASS")) failed.push(id);
    else if (caseAttempts.some(({ status }) => status !== "PASS")) flaky.push(id);
  }
  return { passed: failed.length === 0, failed, flaky };
}

export function summarizeLiveEvalAttempts(attempts) {
  const counts = { PASS: 0, SEMANTIC_FAIL: 0, INFRA_FAIL: 0 };
  const cases = new Map();
  for (const attempt of attempts) {
    counts[attempt.status] += 1;
    const current = cases.get(attempt.caseId) ?? { id: attempt.caseId, skill: attempt.skill, attempts: 0, passed: 0 };
    current.attempts += 1;
    if (attempt.status === "PASS") current.passed += 1;
    cases.set(attempt.caseId, current);
  }
  const total = attempts.length;
  return {
    total,
    passed: counts.PASS,
    semanticFailed: counts.SEMANTIC_FAIL,
    infraFailed: counts.INFRA_FAIL,
    successRate: total === 0 ? 0 : counts.PASS / total,
    cases: [...cases.values()].map((item) => ({ ...item, successRate: item.passed / item.attempts })),
  };
}

export async function runLivePiEval({ fixture, caseId, suite = "all", launcher, model, thinking, timeoutMs, repeat = 1, retryFailures = 0, requireClean = false, onProgress = () => {} }) {
  const selected = selectLiveEvalCases(fixture, { caseId, suite });
  if (!Number.isInteger(repeat) || repeat < 1) throw new Error("repeat must be a positive integer");
  if (!Number.isInteger(retryFailures) || retryFailures < 0) throw new Error("retryFailures must be a non-negative integer");
  const source = gitState();
  if (requireClean && source.dirty) throw new Error("release evaluation requires a clean package checkout");
  const attempts = [];
  const startedAt = new Date().toISOString();

  async function runAttempt(item, round) {
    const attemptStarted = Date.now();
    const caseTimeoutMs = item.timeoutMs ?? timeoutMs;
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ticket-planning-eval-"));
    let before;
    let output = "";
    let infraError = "";
    const errors = [];
    try {
      writeWorkspace(workspace, item.files);
      if (item.git) initializeGitWorkspace(workspace);
      if (item.workingTreeFiles) writeWorkspace(workspace, item.workingTreeFiles);
      before = snapshotTree(workspace);
      try {
        output = await runPiCase({
          cwd: workspace,
          launcher,
          model,
          thinking,
          timeoutMs: caseTimeoutMs,
          skill: item.skill,
          tools: item.tools ?? ["read", "grep", "find", "ls"],
          prompt: `/skill:${item.skill} ${item.prompt}`,
        });
        if (item.skill === "ask-yet") errors.push(...matchChineseAskYetCard(output));
        errors.push(...matchLiveEvalOutput(output, item.expected));
      } catch (error) {
        infraError = error instanceof Error ? error.message : String(error);
      }
      if (before && JSON.stringify(snapshotTree(workspace)) !== JSON.stringify(before)) errors.push("read-only workspace changed");
    } catch (error) {
      infraError = error instanceof Error ? error.message : String(error);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
    const status = errors.length ? "SEMANTIC_FAIL" : infraError ? "INFRA_FAIL" : "PASS";
    const attempt = {
      caseId: item.id,
      skill: item.skill,
      attempt: round,
      status,
      timeoutMs: caseTimeoutMs,
      durationMs: Date.now() - attemptStarted,
      errors: errors.length ? errors : infraError ? [infraError] : [],
    };
    if (status !== "PASS" && output) attempt.output = output;
    attempts.push(attempt);
    onProgress(`${status} ${item.id}${round > 1 ? ` [attempt ${round}]` : ""}`);
  }

  for (let round = 1; round <= repeat; round += 1) {
    for (const item of selected) await runAttempt(item, round);
  }
  for (let retry = 1; retry <= retryFailures; retry += 1) {
    const failed = new Set(evaluateCaseGate(attempts, selected.map(({ id }) => id)).failed);
    if (failed.size === 0) break;
    for (const item of selected.filter(({ id }) => failed.has(id))) await runAttempt(item, repeat + retry);
  }

  const gate = evaluateCaseGate(attempts, selected.map(({ id }) => id));
  return {
    schema: REPORT_SCHEMA,
    source,
    fixtureSha256: crypto.createHash("sha256").update(JSON.stringify(fixture)).digest("hex"),
    model,
    thinking,
    suite: caseId ? "single" : suite,
    repeat,
    retryFailures,
    startedAt,
    finishedAt: new Date().toISOString(),
    attempts,
    summary: summarizeLiveEvalAttempts(attempts),
    gate,
  };
}

async function runPiCase({ cwd, launcher, model, thinking, timeoutMs, skill, tools, prompt }) {
  const child = spawn(
    launcher,
    [
      "--mode", "rpc",
      "--no-session",
      "--offline",
      "--no-approve",
      "--no-context-files",
      "--tools", tools.join(","),
      "--model", model,
      "--thinking", thinking,
    ],
    {
      cwd,
      env: { ...process.env, PI_OFFLINE: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let stderr = "";
  let sequence = 0;
  const pending = new Map();
  const reader = readline.createInterface({ input: child.stdout });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  let settleResolve;
  let settleReject;
  const settled = new Promise((resolve, reject) => {
    settleResolve = resolve;
    settleReject = reject;
  });
  settled.catch(() => {});
  child.once("error", failPending);

  reader.on("line", (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      failPending(new Error(`PI emitted invalid JSONL: ${line}\n${error.message}`));
      return;
    }
    if (message.type === "agent_settled") settleResolve();
    if (message.type === "extension_ui_request" && message.id) {
      child.stdin.write(`${JSON.stringify({ type: "extension_ui_response", id: message.id, cancelled: true })}\n`);
    }
    if (message.type === "response" && message.id && pending.has(message.id)) {
      pending.get(message.id).resolve(message);
      pending.delete(message.id);
    }
  });

  const closed = new Promise((resolve) => {
    child.once("close", (code, signal) => {
      const error = code === 0 ? null : new Error(stderr || `PI exited ${code ?? signal}`);
      if (error) failPending(error);
      resolve({ code, signal });
    });
  });

  function failPending(error) {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
    settleReject(error);
  }

  function request(command) {
    const id = `eval-${++sequence}`;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
    });
  }

  const timer = setTimeout(() => {
    failPending(new Error(`PI case timed out after ${timeoutMs}ms`));
    child.kill("SIGTERM");
  }, timeoutMs);

  try {
    const catalog = await request({ type: "get_commands" });
    if (!catalog.success) throw new Error("PI did not return its command catalog");
    const loadedSkill = catalog.data?.commands?.find((command) => command.name === `skill:${skill}` && command.source === "skill");
    const loadedPath = loadedSkill?.sourceInfo?.path ?? loadedSkill?.path;
    const expectedPath = path.join(ROOT, "skills", skill, "SKILL.md");
    if (!loadedPath || realpathSafe(loadedPath) !== realpathSafe(expectedPath)) {
      throw new Error(`${skill} did not load from this checkout: ${loadedPath ?? "missing"}`);
    }

    const accepted = await request({ type: "prompt", message: prompt });
    if (!accepted.success) throw new Error(`PI rejected prompt: ${JSON.stringify(accepted)}`);
    await settled;
    const last = await request({ type: "get_last_assistant_text" });
    if (!last.success || typeof last.data?.text !== "string") throw new Error("PI returned no final assistant text");
    child.stdin.end();
    const result = await closed;
    if (result.code !== 0) throw new Error(stderr || `PI exited ${result.code ?? result.signal}`);
    return last.data.text;
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && !child.killed) child.kill("SIGTERM");
    reader.close();
  }
}

function safeRelativePath(relative) {
  return Boolean(relative) && !path.isAbsolute(relative) && !relative.split(/[\\/]/).includes("..");
}

function writeWorkspace(root, files) {
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

function initializeGitWorkspace(root) {
  const env = {
    ...process.env,
    GIT_AUTHOR_DATE: "2026-08-18T00:00:00Z",
    GIT_COMMITTER_DATE: "2026-08-18T00:00:00Z",
  };
  const steps = [
    ["init", "-q", "-b", "main"],
    ["add", "--", "."],
    ["-c", "user.name=PI Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgSign=false", "commit", "-q", "--no-verify", "-m", "Create accepted fixture base"],
  ];
  for (const args of steps) {
    const result = spawnSync("git", args, { cwd: root, env, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || `git ${args[0]} failed`);
  }
  const remote = path.join(root, ".git", "fixture-origin.git");
  const remoteSteps = [
    ["init", "-q", "--bare", remote],
    ["remote", "add", "origin", remote],
    ["push", "-q", "-u", "origin", "main"],
  ];
  for (const args of remoteSteps) {
    const result = spawnSync("git", args, { cwd: root, env, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || `git ${args[0]} failed`);
  }
}

function snapshotTree(root) {
  const entries = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute);
      if (entry.isDirectory()) {
        entries.push([relative, "dir"]);
        visit(absolute);
      } else if (entry.isFile()) {
        entries.push([relative, crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex")]);
      } else {
        entries.push([relative, `other:${fs.readlinkSync(absolute)}`]);
      }
    }
  }
  visit(root);
  return entries;
}

function realpathSafe(value) {
  try {
    return fs.realpathSync(value);
  } catch {
    return path.resolve(value);
  }
}

function gitState() {
  const revision = spawnSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" });
  const dirty = spawnSync("git", ["-C", ROOT, "status", "--porcelain"], { encoding: "utf8" });
  return {
    revision: revision.status === 0 ? revision.stdout.trim() : "UNKNOWN",
    dirty: dirty.status !== 0 || Boolean(dirty.stdout.trim()),
  };
}

const ownPath = fs.realpathSync(fileURLToPath(import.meta.url));
if (process.argv[1] && fs.realpathSync(process.argv[1]) === ownPath) {
  const { values } = parseArgs({
    options: {
      case: { type: "string" },
      suite: { type: "string" },
      repeat: { type: "string" },
      "retry-failures": { type: "string" },
      report: { type: "string" },
      "report-only": { type: "boolean" },
      "require-clean": { type: "boolean" },
    },
    allowPositionals: false,
  });
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures", "pi-live-eval-cases.json"), "utf8"));
  const fixtureErrors = validateLiveEvalFixture(fixture);
  if (fixtureErrors.length) throw new Error(fixtureErrors.join("\n"));
  const repeat = Number(values.repeat ?? 1);
  const retryFailures = Number(values["retry-failures"] ?? 0);
  const report = await runLivePiEval({
    fixture,
    caseId: values.case,
    suite: values.suite ?? "all",
    launcher: path.resolve(process.env.PI_EVAL_LAUNCHER ?? path.join(os.homedir(), ".local", "bin", "pi-ticket-plan")),
    model: process.env.PI_EVAL_MODEL ?? "openai-codex/gpt-5.6-sol",
    thinking: process.env.PI_EVAL_THINKING ?? "high",
    timeoutMs: Number(process.env.PI_EVAL_TIMEOUT_MS ?? 180_000),
    repeat,
    retryFailures,
    requireClean: values["require-clean"],
    onProgress: (line) => console.log(line),
  });
  if (values.report) {
    const reportPath = path.resolve(values.report);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`report: ${reportPath}`);
  }
  for (const attempt of report.attempts.filter((item) => item.status !== "PASS")) {
    console.error(`${attempt.status} ${attempt.caseId} [${attempt.attempt}/${report.repeat}]: ${attempt.errors.join("; ")}`);
    if (attempt.output) console.error(`--- output ---\n${attempt.output}`);
  }
  const percent = (report.summary.successRate * 100).toFixed(1);
  console.log(`live PI behavior: ${report.summary.passed}/${report.summary.total} passed (${percent}%)`);
  if (report.gate.flaky.length > 0) console.warn(`FLAKY ${report.gate.flaky.join(",")}`);
  if (!report.gate.passed) console.error(`FAILED CASES ${report.gate.failed.join(",")}`);
  if (!values["report-only"] && !report.gate.passed) process.exitCode = 1;
}
