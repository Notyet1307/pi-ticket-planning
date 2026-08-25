import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  bindE2EControlIssue,
  bindE2EResource,
  cleanupPersistedE2E,
  createE2EState,
  declareE2EResource,
  e2eControlBody,
  e2eControlTitle,
  loadE2EState,
  persistE2EState,
} from "../integration/e2e-state.mjs";

function resource(runId, id) {
  return { marker: `<!-- ptp-e2e:${runId}:scenario:${id} -->`, title: `[ptp-e2e:${runId}] scenario:${id}` };
}

function fakeApi(issues) {
  let label = true;
  let mutations = 0;
  const api = (args, input, { notFound = false } = {}) => {
    const endpoint = args.find((value) => value.startsWith?.("repos/"));
    const search = args.find((value) => value.startsWith?.("search/"));
    const methodIndex = args.indexOf("--method");
    const method = methodIndex < 0 ? "GET" : args[methodIndex + 1];
    if (args[1] === "user") return { login: "tester" };
    if (search) return { items: issues.filter((issue) => issue.body?.startsWith("<!-- ptp-e2e-control:") === true) };
    if (endpoint?.includes("/labels/") && method === "GET") return label ? { name: "label" } : notFound ? null : (() => { throw new Error("404"); })();
    if (endpoint?.includes("/labels/") && method === "DELETE") { label = false; mutations += 1; return null; }
    if (args.includes("--paginate")) return [[...issues]];
    const number = Number(endpoint?.match(/\/issues\/(\d+)$/)?.[1]);
    const issue = issues.find((item) => item.number === number);
    if (method === "PATCH") {
      if (input.state !== undefined) issue.state = input.state;
      if (input.body !== undefined) issue.body = input.body;
      mutations += 1;
      return issue;
    }
    if (issue) return issue;
    throw new Error(`unexpected fake API call ${args.join(" ")}`);
  };
  return { api, get mutations() { return mutations; }, get label() { return label; } };
}

test("persisted E2E cleanup recovers an ambiguous create and is idempotent", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-e2e-state-"));
  fs.chmodSync(directory, 0o700);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "state.json");
  const runId = "run-state";
  const first = resource(runId, 1);
  const second = resource(runId, 2);
  let state = createE2EState({ repo: "acme/disposable", runId, actor: "tester", startedAt: "2026-08-26T00:00:00Z" });
  state = declareE2EResource(state, first);
  state = bindE2EResource(state, { marker: first.marker, number: 1, actor: "tester", createdAt: "2026-08-26T00:00:01Z" });
  state = declareE2EResource(state, second);
  persistE2EState(state, file);
  const issues = [first, second].map((item, index) => ({ number: index + 1, title: item.title, body: `${item.marker}\nbody`, user: { login: "tester" }, created_at: `2026-08-26T00:00:0${index + 1}Z`, state: "open" }));
  const github = fakeApi(issues);
  const result = cleanupPersistedE2E({ file, repo: "acme/disposable", runId, api: github.api, now: "2026-08-26T00:01:00Z" });
  assert.equal(result.status, "PASS");
  assert.equal(issues.every(({ state: value }) => value === "closed"), true);
  assert.equal(github.label, false);
  assert.equal(loadE2EState(file).status, "COMPLETE");
  assert.equal(cleanupPersistedE2E({ file, repo: "acme/disposable", runId, api: github.api }).status, "PASS");
});

test("cleanup refuses an untracked issue without mutating it", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-e2e-foreign-"));
  fs.chmodSync(directory, 0o700);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "state.json");
  const runId = "run-foreign";
  persistE2EState(createE2EState({ repo: "acme/disposable", runId, actor: "tester", startedAt: "2026-08-26T00:00:00Z" }), file);
  const issues = [{ number: 99, title: "foreign", body: "foreign", user: { login: "tester" }, created_at: "2026-08-26T00:00:01Z", state: "open" }];
  const github = fakeApi(issues);
  const result = cleanupPersistedE2E({ file, repo: "acme/disposable", runId, api: github.api });
  assert.equal(result.status, "FAIL");
  assert.equal(github.mutations, 0);
  assert.equal(issues[0].state, "open");
});

test("remote control issue recovers cleanup after the runner state file is lost", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-e2e-remote-"));
  fs.chmodSync(directory, 0o700);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const runId = "run-remote";
  const declared = resource(runId, 1);
  let state = createE2EState({ repo: "acme/disposable", runId, actor: "tester", startedAt: "2026-08-26T00:00:00Z" });
  state = bindE2EControlIssue(state, 10);
  state = declareE2EResource(state, declared);
  state = bindE2EResource(state, { marker: declared.marker, number: 1, actor: "tester", createdAt: "2026-08-26T00:00:01Z" });
  const seed = path.join(directory, "seed.json");
  state = persistE2EState(state, seed);
  fs.unlinkSync(seed);
  const issues = [
    { number: 10, title: e2eControlTitle(runId), body: e2eControlBody(state), user: { login: "tester" }, created_at: "2026-08-26T00:00:00Z", state: "open" },
    { number: 1, title: declared.title, body: `${declared.marker}\nbody`, user: { login: "tester" }, created_at: "2026-08-26T00:00:01Z", state: "open" },
  ];
  const github = fakeApi(issues);
  const recoveredFile = path.join(directory, "recovered.json");
  const result = cleanupPersistedE2E({ file: recoveredFile, repo: "acme/disposable", runId, api: github.api, now: "2026-08-26T00:01:00Z" });
  assert.equal(result.status, "PASS");
  assert.equal(loadE2EState(recoveredFile).status, "COMPLETE");
  assert.equal(issues.every(({ state: value }) => value === "closed"), true);
  assert.equal(github.label, false);
});
