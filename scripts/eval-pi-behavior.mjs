import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function validateLiveEvalFixture(fixture) {
  const errors = [];
  const ids = new Set();
  if (fixture?.version !== 1) errors.push("fixture version must be 1");
  if (!Array.isArray(fixture?.cases) || fixture.cases.length === 0) errors.push("fixture must contain cases");

  for (const item of fixture?.cases ?? []) {
    if (!item.id || ids.has(item.id)) errors.push(`${item.id || "unnamed"}: duplicate or missing id`);
    ids.add(item.id);
    if (!item.prompt?.trim()) errors.push(`${item.id}: missing prompt`);
    if (!item.files || Array.isArray(item.files) || typeof item.files !== "object") {
      errors.push(`${item.id}: files must be an object`);
    }
    for (const [relative, content] of Object.entries(item.files ?? {})) {
      if (!safeRelativePath(relative)) errors.push(`${item.id}: unsafe workspace path ${relative}`);
      if (typeof content !== "string") errors.push(`${item.id}: ${relative} content must be a string`);
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

export async function runLivePiEval({ fixture, caseId, launcher, model, thinking, timeoutMs }) {
  const selected = caseId ? fixture.cases.filter((item) => item.id === caseId) : fixture.cases;
  if (caseId && selected.length === 0) throw new Error(`unknown case ${caseId}`);
  const failures = [];

  for (const item of selected) {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ticket-planning-eval-"));
    try {
      writeWorkspace(workspace, item.files);
      const before = snapshotTree(workspace);
      const output = await runPiCase({
        cwd: workspace,
        launcher,
        model,
        thinking,
        timeoutMs,
        prompt: `/skill:ask-yet ${item.prompt}`,
      });
      const errors = matchLiveEvalOutput(output, item.expected);
      if (JSON.stringify(snapshotTree(workspace)) !== JSON.stringify(before)) errors.push("read-only workspace changed");
      if (errors.length) {
        failures.push(`${item.id}: ${errors.join("; ")}\n--- output ---\n${output}`);
      } else {
        console.log(`PASS ${item.id}`);
      }
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  }
  return failures;
}

async function runPiCase({ cwd, launcher, model, thinking, timeoutMs, prompt }) {
  const child = spawn(
    launcher,
    [
      "--mode", "rpc",
      "--no-session",
      "--offline",
      "--no-approve",
      "--no-context-files",
      "--tools", "read,grep,find,ls",
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
    const askYet = catalog.data?.commands?.find((command) => command.name === "skill:ask-yet" && command.source === "skill");
    const loadedPath = askYet?.sourceInfo?.path ?? askYet?.path;
    const expectedPath = path.join(ROOT, "skills", "ask-yet", "SKILL.md");
    if (!loadedPath || realpathSafe(loadedPath) !== realpathSafe(expectedPath)) {
      throw new Error(`ask-yet did not load from this checkout: ${loadedPath ?? "missing"}`);
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

const ownPath = fs.realpathSync(fileURLToPath(import.meta.url));
if (process.argv[1] && fs.realpathSync(process.argv[1]) === ownPath) {
  const { values } = parseArgs({
    options: { case: { type: "string" } },
    allowPositionals: false,
  });
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures", "pi-live-eval-cases.json"), "utf8"));
  const fixtureErrors = validateLiveEvalFixture(fixture);
  if (fixtureErrors.length) throw new Error(fixtureErrors.join("\n"));
  const failures = await runLivePiEval({
    fixture,
    caseId: values.case,
    launcher: path.resolve(process.env.PI_EVAL_LAUNCHER ?? path.join(os.homedir(), ".local", "bin", "pi-ticket-plan")),
    model: process.env.PI_EVAL_MODEL ?? "openai-codex/gpt-5.6-sol",
    thinking: process.env.PI_EVAL_THINKING ?? "high",
    timeoutMs: Number(process.env.PI_EVAL_TIMEOUT_MS ?? 180_000),
  });
  if (failures.length) {
    for (const failure of failures) console.error(`FAIL ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(`live PI behavior: ok (${values.case ? 1 : fixture.cases.length} fresh processes)`);
  }
}
