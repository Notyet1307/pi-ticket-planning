import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createPiRpcSession, readPiSessionHeader } from "../scripts/eval-pi-behavior.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

test("Pi RPC preserves child tool evidence and resumes by exact session file", async (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-rpc-fake-"));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const launcher = path.join(temporary, "fake-pi.mjs");
  fs.writeFileSync(launcher, `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
const args = process.argv.slice(2);
const value = (name) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const sessionDir = value("--session-dir") || path.dirname(value("--session") || path.join(process.cwd(), "session.jsonl"));
fs.mkdirSync(sessionDir, { recursive: true });
const sessionFile = value("--session") || path.join(sessionDir, "parent.jsonl");
const childFile = path.join(sessionDir, "child.jsonl");
if (!fs.existsSync(sessionFile)) fs.writeFileSync(sessionFile, JSON.stringify({ type: "session", id: "session-parent", cwd: process.cwd() }) + "\\n");
if (!fs.existsSync(childFile)) fs.writeFileSync(childFile, JSON.stringify({ type: "session", id: "session-child", cwd: process.cwd() }) + "\\n");
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const command = JSON.parse(line);
  if (command.type === "get_commands") send({ type: "response", id: command.id, success: true, data: { commands: [{ name: "skill:ticket-readiness", source: "skill", sourceInfo: { path: process.env.PTP_TEST_SKILL_PATH } }] } });
  else if (command.type === "get_state") send({ type: "response", id: command.id, success: true, data: { sessionId: "session-parent", sessionFile, sessionName: "capability" } });
  else if (command.type === "prompt") {
    send({ type: "response", id: command.id, success: true, data: {} });
    if (command.message === "hang") return;
    send({ type: "message_end", message: { role: "assistant", content: [{ type: "toolCall", id: "tool-1", name: "subagent", arguments: { agent: "ticket-readiness-reviewer" } }] } });
    send({ type: "message_end", message: { role: "toolResult", toolName: "subagent", toolCallId: "tool-1", details: { runId: "run-1", mode: "single", results: [{ index: 0, agent: "ticket-readiness-reviewer", sessionFile: childFile, finalOutput: "{}", structuredOutput: {}, exitCode: 0, processSignal: null, timedOut: false, interrupted: false }] } } });
    send({ type: "agent_settled" });
  } else if (command.type === "get_last_assistant_text") send({ type: "response", id: command.id, success: true, data: { text: "done" } });
  else if (command.type === "get_entries") send({ type: "response", id: command.id, success: true, data: { entries: [{ type: "session", id: "session-parent" }, { type: "message", id: "persisted" }] } });
  else if (command.type === "get_session_stats") send({ type: "response", id: command.id, success: true, data: { toolCalls: 1, tokens: { total: 10 }, contextUsage: { tokens: 5 } } });
  else if (command.type === "abort") send({ type: "response", id: command.id, success: true, data: { aborted: true } });
});
`, { mode: 0o755 });

  const oldSkillPath = process.env.PTP_TEST_SKILL_PATH;
  process.env.PTP_TEST_SKILL_PATH = path.join(ROOT, "skills", "ticket-readiness", "SKILL.md");
  t.after(() => { if (oldSkillPath === undefined) delete process.env.PTP_TEST_SKILL_PATH; else process.env.PTP_TEST_SKILL_PATH = oldSkillPath; });
  const sessionDir = path.join(temporary, "sessions");
  const first = await createPiRpcSession({
    cwd: temporary, launcher, model: "test/model", thinking: "high", timeoutMs: 5_000,
    skill: "ticket-readiness", tools: ["read", "subagent"], persisted: true, sessionDir, sessionName: "capability",
  });
  const result = await first.prompt("probe");
  assert.equal(result.subagentResults[0].details.runId, "run-1");
  assert.equal(result.subagentResults[0].details.results[0].agent, "ticket-readiness-reviewer");
  assert.equal(readPiSessionHeader(result.subagentResults[0].details.results[0].sessionFile).id, "session-child");
  assert.equal((await first.entries()).some(({ id }) => id === "persisted"), true);
  assert.equal((await first.stats()).contextUsage.tokens, 5);
  const resume = { id: first.identity.id, file: first.identity.file };
  await first.close();
  assert.equal(first.isAlive(), false);

  const second = await createPiRpcSession({
    cwd: temporary, launcher, model: "test/model", thinking: "high", timeoutMs: 5_000,
    skill: "ticket-readiness", tools: ["read"], persisted: true, sessionDir, resume,
  });
  assert.deepEqual(second.identity.id, resume.id);
  assert.equal((await second.entries()).some(({ id }) => id === "persisted"), true);
  assert.deepEqual(await second.abort(), { aborted: true });
  await second.close();

  const timeout = await createPiRpcSession({
    cwd: temporary, launcher, model: "test/model", thinking: "high", timeoutMs: 5_000,
    skill: "ticket-readiness", tools: ["read"], persisted: false, sessionDir: "",
  });
  await assert.rejects(() => timeout.prompt("hang", { turnTimeoutMs: 20 }), /PI turn timed out after 20ms/);
  assert.deepEqual(await timeout.timeoutControl(), { attempted: true, acknowledged: true, responseSuccess: true, error: null });
  await timeout.close();
  assert.equal(timeout.isAlive(), false);
});
