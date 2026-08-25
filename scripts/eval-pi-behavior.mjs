import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { parseCheckpoint, validateCheckpointState } from "./workflow-contract.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPORT_SCHEMA = "pi-ticket-planning:live-eval:v3";
const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls", "subagent"]);
const MULTITURN_TOOLS = new Set([...READ_ONLY_TOOLS, "bash", "edit", "write"]);
const CHINESE_STATUS_LABELS = ["当前目标：", "已经确认：", "仍然缺少：", "为什么现在不能继续：", "你只需要决定："];
const EVAL_SUITE_POLICIES = {
  release: "read-only",
  nightly: "read-only-or-observer",
  "isolated-writable": "isolated-allowlist",
};
const REQUIRED_RELEASE_COVERAGE = ["candidate-frame", "evidence-method", "solution-shaping", "human-interface", "multi-turn"];
const RELEASE_LIMITS = { cases: 22, modelTurns: 30 };

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
  return errors;
}

export function validateMultiTurnEvalFixture(fixture, existingIds = []) {
  const errors = [];
  const ids = new Set(existingIds);
  if (fixture?.version !== 1) errors.push("fixture version must be 1");
  if (!Array.isArray(fixture?.cases) || fixture.cases.length === 0) errors.push("fixture must contain cases");

  for (const item of fixture?.cases ?? []) {
    if (!item.id || ids.has(item.id)) errors.push(`${item.id || "unnamed"}: duplicate or missing id`);
    ids.add(item.id);
    if (!/^[a-z][a-z0-9-]*$/u.test(item.skill ?? "")) errors.push(`${item.id}: missing or invalid skill`);
    if (!item.files || Array.isArray(item.files) || typeof item.files !== "object") errors.push(`${item.id}: files must be an object`);
    if (!Array.isArray(item.turns) || item.turns.length < 2) errors.push(`${item.id}: multiturn case must contain at least two turns`);
    if (item.hiddenContext !== undefined || item.transcript !== undefined) errors.push(`${item.id}: hidden context or transcript is not allowed`);
    if (item.timeoutMs !== undefined && (!Number.isInteger(item.timeoutMs) || item.timeoutMs < 1)) {
      errors.push(`${item.id}: timeoutMs must be a positive integer`);
    }
    if (item.git !== undefined && item.git !== true) errors.push(`${item.id}: git must be true when present`);
    if (item.workingTreeFiles && (Array.isArray(item.workingTreeFiles) || typeof item.workingTreeFiles !== "object")) {
      errors.push(`${item.id}: workingTreeFiles must be an object`);
    }
    if (item.workingTreeFiles && !item.git) errors.push(`${item.id}: workingTreeFiles requires git: true`);
    if (item.tools && (!Array.isArray(item.tools) || item.tools.some((tool) => !MULTITURN_TOOLS.has(tool)))) {
      errors.push(`${item.id}: tools contain an unsupported eval tool`);
    }
    validateFiles(errors, item.id, item.files ?? {});
    validateFiles(errors, item.id, item.workingTreeFiles ?? {});
    validateExpected(errors, item.id, item.expected, false);
    if (item.forbiddenStrings !== undefined && (!Array.isArray(item.forbiddenStrings) || item.forbiddenStrings.some((value) => typeof value !== "string" || !value))) {
      errors.push(`${item.id}: forbiddenStrings must contain non-empty strings`);
    }

    const turnIds = new Set();
    for (const turn of Array.isArray(item.turns) ? item.turns : []) {
      const turnName = `${item.id}/${turn?.id || "unnamed"}`;
      if (!turn?.id || turnIds.has(turn.id)) errors.push(`${turnName}: duplicate or missing turn id`);
      turnIds.add(turn?.id);
      if (!turn?.prompt?.trim()) errors.push(`${turnName}: missing prompt`);
      validateExpected(errors, turnName, turn?.expected, true);
      if (turn?.allowedWrites !== undefined && (!Array.isArray(turn.allowedWrites) || turn.allowedWrites.some((relative) => !safeRelativePath(relative) || relative === ".git" || relative.startsWith(".git/")))) {
        errors.push(`${turnName}: allowedWrites must contain safe non-Git paths`);
      }
      if (turn?.expectedWrites !== undefined && (!Array.isArray(turn.expectedWrites) || turn.expectedWrites.some((relative) => !(turn.allowedWrites ?? []).includes(relative)))) {
        errors.push(`${turnName}: expectedWrites must be a subset of allowedWrites`);
      }
      if (turn?.allowedGit !== undefined && turn.allowedGit !== true) errors.push(`${turnName}: allowedGit must be true when present`);
      if (turn?.allowedGit && !item.git) errors.push(`${turnName}: allowedGit requires git: true`);
      if (turn?.allowedGit && !(item.tools ?? []).includes("bash")) errors.push(`${turnName}: allowedGit requires the bash tool`);
      if (turn?.allowedGit && !Array.isArray(turn.allowedRemoteRefs)) errors.push(`${turnName}: allowedGit requires allowedRemoteRefs`);
      if (turn?.allowedRemoteRefs !== undefined && (!Array.isArray(turn.allowedRemoteRefs) || turn.allowedRemoteRefs.some((ref) => !/^refs\/heads\/[A-Za-z0-9._/-]+$/u.test(ref)))) {
        errors.push(`${turnName}: allowedRemoteRefs must contain explicit branch refs`);
      }
      if (turn?.beforeTurn !== undefined) {
        if (!turn.beforeTurn || Array.isArray(turn.beforeTurn) || typeof turn.beforeTurn !== "object" || !turn.beforeTurn.files) {
          errors.push(`${turnName}: beforeTurn must declare files`);
        } else {
          validateFiles(errors, turnName, turn.beforeTurn.files);
        }
      }
    }

    if (item.finalArtifacts !== undefined && !Array.isArray(item.finalArtifacts)) errors.push(`${item.id}: finalArtifacts must be an array`);
    for (const artifact of Array.isArray(item.finalArtifacts) ? item.finalArtifacts : []) {
      if (!item.git) errors.push(`${item.id}: finalArtifacts require git: true`);
      if (!safeRelativePath(artifact?.path)) errors.push(`${item.id}: final artifact has unsafe path`);
      if (!/^refs\/heads\/[A-Za-z0-9._/-]+$/u.test(artifact?.ref ?? "")) errors.push(`${item.id}: final artifact has invalid ref`);
      validateExpected(errors, `${item.id}/${artifact?.ref ?? "artifact"}`, artifact?.expected, true);
    }
  }
  return errors;
}

export function combineLiveEvalFixtures(singleTurn, multiTurn) {
  return {
    version: 1,
    cases: [...singleTurn.cases, ...multiTurn.cases],
  };
}

function modelTurnCount(item) {
  return Array.isArray(item.turns) ? item.turns.length : 1;
}

function evalTurns(item) {
  return Array.isArray(item.turns) ? item.turns : [];
}

function hasWriteBoundary(item) {
  return evalTurns(item).some((turn) => (
    (turn.allowedWrites?.length ?? 0) > 0
    || (turn.expectedWrites?.length ?? 0) > 0
    || turn.allowedGit
    || (turn.allowedRemoteRefs?.length ?? 0) > 0
  )) || (item.finalArtifacts?.length ?? 0) > 0;
}

function hasExplicitWriteAllowlist(item) {
  return evalTurns(item).some((turn) => (
    (turn.allowedWrites?.length ?? 0) > 0 || (turn.allowedRemoteRefs?.length ?? 0) > 0
  ));
}

export function evalCaseType(item) {
  if (hasWriteBoundary(item)) return "isolated-writable";
  return Array.isArray(item.turns) ? "multi-turn" : "single-turn";
}

function validateSuitePolicy(name, suite, cases) {
  const errors = [];
  if (suite?.mutationPolicy !== EVAL_SUITE_POLICIES[name]) {
    errors.push(`${name}: mutationPolicy must be ${EVAL_SUITE_POLICIES[name]}`);
  }

  if (name === "release") {
    if (!Number.isInteger(suite?.maxCases) || suite.maxCases < 1 || suite.maxCases > RELEASE_LIMITS.cases) {
      errors.push(`release: maxCases must be between 1 and ${RELEASE_LIMITS.cases}`);
    }
    if (!Number.isInteger(suite?.maxModelTurns) || suite.maxModelTurns < 1 || suite.maxModelTurns > RELEASE_LIMITS.modelTurns) {
      errors.push(`release: maxModelTurns must be between 1 and ${RELEASE_LIMITS.modelTurns}`);
    }
    const turns = cases.reduce((total, item) => total + modelTurnCount(item), 0);
    if (cases.length > (suite?.maxCases ?? 0)) errors.push(`release: ${cases.length} cases exceed maxCases ${suite?.maxCases}`);
    if (turns > (suite?.maxModelTurns ?? 0)) errors.push(`release: ${turns} model turns exceed maxModelTurns ${suite?.maxModelTurns}`);

    for (const item of cases) {
      for (const turn of evalTurns(item)) {
        if ((turn.allowedWrites?.length ?? 0) > 0) errors.push(`${item.id}: release case allows workspace writes`);
        if ((turn.expectedWrites?.length ?? 0) > 0) errors.push(`${item.id}: release case expects workspace writes`);
        if (turn.allowedGit) errors.push(`${item.id}: release case allows Git mutation`);
        if ((turn.allowedRemoteRefs?.length ?? 0) > 0) errors.push(`${item.id}: release case allows remote refs`);
        if (turn.beforeTurn?.files) errors.push(`${item.id}: release case uses Observer file injection`);
      }
      if (Object.hasOwn(item, "finalArtifacts")) errors.push(`${item.id}: release case declares finalArtifacts`);
    }
  }

  if (name === "nightly") {
    for (const item of cases) {
      if (hasWriteBoundary(item)) errors.push(`${item.id}: nightly case has an isolated writable boundary`);
    }
  }

  if (name === "isolated-writable") {
    for (const item of cases) {
      if (!hasExplicitWriteAllowlist(item)) errors.push(`${item.id}: isolated-writable case lacks an explicit write or remote-ref allowlist`);
    }
  }
  return errors;
}

export function validateEvalSuiteManifest(manifest, fixture) {
  const errors = [];
  if (manifest?.version !== 1) errors.push("suite manifest version must be 1");
  if (!manifest?.suites || Array.isArray(manifest.suites) || typeof manifest.suites !== "object") {
    return [...errors, "suite manifest must contain suites"];
  }

  const byId = new Map();
  for (const item of fixture?.cases ?? []) {
    if (byId.has(item.id)) errors.push(`${item.id}: case id is not globally unique`);
    byId.set(item.id, item);
  }
  const memberships = new Map();
  for (const name of Object.keys(manifest.suites)) {
    if (!Object.hasOwn(EVAL_SUITE_POLICIES, name)) errors.push(`unknown suite ${name}`);
  }

  for (const name of Object.keys(EVAL_SUITE_POLICIES)) {
    const suite = manifest.suites[name];
    if (!suite || Array.isArray(suite) || typeof suite !== "object") {
      errors.push(`suite manifest lacks ${name}`);
      continue;
    }
    if (!Array.isArray(suite.caseIds) || suite.caseIds.length === 0) {
      errors.push(`${name}: caseIds must be a non-empty array`);
      continue;
    }
    if (new Set(suite.caseIds).size !== suite.caseIds.length) errors.push(`${name}: caseIds must be unique`);
    const cases = [];
    for (const id of suite.caseIds) {
      if (typeof id !== "string" || !byId.has(id)) errors.push(`${name}: unknown case ${id}`);
      else cases.push(byId.get(id));
      const current = memberships.get(id) ?? [];
      current.push(name);
      memberships.set(id, current);
    }
    errors.push(...validateSuitePolicy(name, suite, cases));
  }

  for (const [id, suites] of memberships) {
    if (suites.length > 1) errors.push(`${id}: belongs to multiple suites (${suites.join(", ")})`);
  }

  const quarantineIds = manifest.quarantine?.caseIds;
  const quarantine = new Set();
  if (!Array.isArray(quarantineIds) || typeof manifest.quarantine?.reason !== "string" || !manifest.quarantine.reason.trim()) {
    errors.push("suite manifest must declare quarantine caseIds and a reason");
  } else {
    if (new Set(quarantineIds).size !== quarantineIds.length) errors.push("quarantine: caseIds must be unique");
    for (const id of quarantineIds) {
      if (!byId.has(id)) errors.push(`quarantine: unknown case ${id}`);
      if (memberships.has(id)) errors.push(`${id}: belongs to an executable suite and quarantine`);
      quarantine.add(id);
    }
  }
  for (const id of byId.keys()) {
    if (!memberships.has(id) && !quarantine.has(id)) errors.push(`${id}: live case is unclassified`);
  }

  const releaseIds = new Set(manifest.suites.release?.caseIds ?? []);
  if (!Array.isArray(manifest.requiredReleaseCaseIds) || manifest.requiredReleaseCaseIds.length === 0) {
    errors.push("suite manifest must declare requiredReleaseCaseIds");
  } else {
    if (new Set(manifest.requiredReleaseCaseIds).size !== manifest.requiredReleaseCaseIds.length) {
      errors.push("requiredReleaseCaseIds must be unique");
    }
    for (const id of manifest.requiredReleaseCaseIds) {
      if (!byId.has(id)) errors.push(`required Release case is unknown: ${id}`);
      if (!releaseIds.has(id)) errors.push(`required Release case is missing: ${id}`);
    }
  }

  const coverage = manifest.coverage;
  if (!coverage || Array.isArray(coverage) || typeof coverage !== "object") {
    errors.push("suite manifest must declare coverage tags");
  } else {
    for (const [id, tags] of Object.entries(coverage)) {
      if (!byId.has(id)) errors.push(`coverage references unknown case ${id}`);
      if (!Array.isArray(tags) || tags.length === 0 || tags.some((tag) => typeof tag !== "string" || !tag)) {
        errors.push(`${id}: coverage tags must be non-empty strings`);
      } else if (new Set(tags).size !== tags.length) {
        errors.push(`${id}: coverage tags must be unique`);
      }
    }
    const releaseCoverage = new Set([...releaseIds].flatMap((id) => coverage[id] ?? []));
    for (const tag of REQUIRED_RELEASE_COVERAGE) {
      if (!releaseCoverage.has(tag)) errors.push(`release suite lacks ${tag} coverage`);
    }
  }

  if (![...releaseIds].some((id) => Array.isArray(byId.get(id)?.turns))) {
    errors.push("release suite lacks a real multi-turn case");
  }
  if (releaseIds.has("multiturn-validation-formal-writeback")) {
    errors.push("FORMAL writeback must not enter release");
  }
  if (!(manifest.suites["isolated-writable"]?.caseIds ?? []).includes("multiturn-validation-formal-writeback")) {
    errors.push("FORMAL writeback must remain isolated-writable");
  }
  return errors;
}

function validateFiles(errors, id, files) {
  if (Array.isArray(files) || typeof files !== "object" || files === null) {
    errors.push(`${id}: files must be an object`);
    return;
  }
  for (const [relative, content] of Object.entries(files)) {
    if (!safeRelativePath(relative)) errors.push(`${id}: unsafe workspace path ${relative}`);
    if (typeof content !== "string") errors.push(`${id}: ${relative} content must be a string`);
  }
}

function validateExpected(errors, id, expected, required) {
  if (required && (!expected || typeof expected !== "object")) {
    errors.push(`${id}: missing expected`);
    return;
  }
  if (!expected) return;
  for (const field of ["mustMatch", "mustNotMatch"]) {
    if (!Array.isArray(expected[field])) errors.push(`${id}: expected.${field} must be an array`);
    for (const pattern of expected[field] ?? []) {
      try {
        new RegExp(pattern, "isu");
      } catch (error) {
        errors.push(`${id}: invalid ${field} pattern ${pattern}: ${error.message}`);
      }
    }
  }
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

export function matchAskYetResponse(output) {
  const lines = output.split(/\r?\n/u).map((line) => line.trimEnd());
  if (CHINESE_STATUS_LABELS.some((label) => lines.some((line) => line.startsWith(label)))) {
    return matchChineseAskYetCard(output);
  }
  return matchAskYetCheckpoint(lines);
}

export function matchChineseAskYetCard(output) {
  const errors = [];
  const lines = output.split(/\r?\n/u).map((line) => line.trimEnd());
  const fieldIndexes = [];

  for (const label of CHINESE_STATUS_LABELS) {
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

  const checkpointIndex = lines.findIndex((line) => line.startsWith("Checkpoint:"));
  for (const line of lines.slice(0, checkpointIndex < 0 ? lines.length : checkpointIndex)) {
    if (!line.trim() || /^\s/u.test(line) || CHINESE_STATUS_LABELS.some((label) => line.startsWith(label))) continue;
    errors.push(`unexpected top-level card content: ${line.slice(0, 80)}`);
  }
  errors.push(...matchAskYetCheckpoint(lines));

  return errors;
}

function matchAskYetCheckpoint(lines) {
  const errors = [];
  const last = lines.findLast((line) => line.trim() !== "");
  const checkpoints = lines.filter((line) => line.startsWith("Checkpoint:"));
  if (checkpoints.length !== 1) errors.push(`expected exactly one Checkpoint, found ${checkpoints.length}`);
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

export function selectLiveEvalCases(fixture, { caseId, suite = "all", suiteManifest } = {}) {
  if (caseId) {
    const selected = fixture.cases.filter((item) => item.id === caseId);
    if (selected.length === 0) throw new Error(`unknown case ${caseId}`);
    return selected;
  }
  if (suite === "all") return fixture.cases;
  if (!Object.hasOwn(EVAL_SUITE_POLICIES, suite)) throw new Error(`unknown suite ${suite}`);
  const suiteCaseIds = suiteManifest?.suites?.[suite]?.caseIds;
  if (!Array.isArray(suiteCaseIds)) throw new Error(`unknown suite ${suite}`);
  const byId = new Map(fixture.cases.map((item) => [item.id, item]));
  return suiteCaseIds.map((id) => {
    const item = byId.get(id);
    if (!item) throw new Error(`${suite}: unknown case ${id}`);
    return item;
  });
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

export async function runLivePiEval({
  fixture,
  suiteManifest,
  caseId,
  suite = "all",
  launcher,
  model,
  thinking,
  timeoutMs,
  repeat = 1,
  retryFailures = 0,
  requireClean = false,
  onProgress = () => {},
  runtime = {},
}) {
  const selected = selectLiveEvalCases(fixture, { caseId, suite, suiteManifest });
  if (!caseId && suite !== "all") {
    const suiteErrors = validateSuitePolicy(suite, suiteManifest.suites[suite], selected);
    if (suiteErrors.length) throw new Error(suiteErrors.join("\n"));
  }
  if (!Number.isInteger(repeat) || repeat < 1) throw new Error("repeat must be a positive integer");
  if (!Number.isInteger(retryFailures) || retryFailures < 0) throw new Error("retryFailures must be a non-negative integer");
  const source = gitState();
  if (requireClean && source.dirty) throw new Error("release evaluation requires a clean package checkout");
  const createSession = runtime.createSession ?? createPiRpcSession;
  const makeTempDir = runtime.makeTempDir ?? ((prefix) => fs.mkdtempSync(prefix));
  const removeTree = runtime.removeTree ?? ((target) => fs.rmSync(target, { recursive: true, force: true }));
  const attempts = [];
  const startedAt = new Date().toISOString();

  async function runAttempt(item, round, retryReason = "") {
    const attemptStarted = Date.now();
    const caseTimeoutMs = item.timeoutMs ?? timeoutMs;
    const isMultiturn = Array.isArray(item.turns);
    const workspace = makeTempDir(path.join(os.tmpdir(), "pi-ticket-planning-eval-"));
    const sessionRoot = isMultiturn ? makeTempDir(path.join(os.tmpdir(), "pi-ticket-planning-session-")) : "";
    const turns = isMultiturn
      ? item.turns
      : [{ id: "response", prompt: item.prompt, expected: item.expected, allowedWrites: [] }];
    const turnReports = [];
    const outputs = [];
    const allMutations = [];
    let infraError = "";
    const errors = [];
    let session;
    let sessionIdentity = "UNAVAILABLE";
    const cleanup = {
      session: isMultiturn ? "PENDING" : "NOT_APPLICABLE",
      workspace: "PENDING",
    };
    try {
      writeWorkspace(workspace, item.files);
      if (item.git) initializeGitWorkspace(workspace);
      if (item.workingTreeFiles) writeWorkspace(workspace, item.workingTreeFiles);
      if (turns.some(({ allowedGit }) => allowedGit)) assertIsolatedOrigin(workspace);
      session = await createSession({
        cwd: workspace,
        launcher,
        model,
        thinking,
        timeoutMs: caseTimeoutMs,
        skill: item.skill,
        tools: item.tools ?? ["read", "grep", "find", "ls"],
        persisted: isMultiturn,
        sessionDir: sessionRoot,
        sessionName: `eval-${item.id}-${round}`,
      });
      sessionIdentity = redactSessionIdentity(session.identity);

      for (const [index, turn] of turns.entries()) {
        let output = "";
        let observerMutations = [];
        let modelMutations = [];
        let remoteMutations = [];
        let remoteArtifactPaths = [];
        const turnErrors = [];
        try {
          if (turn.beforeTurn?.files) {
            const beforeObserver = snapshotTree(workspace);
            writeWorkspace(workspace, turn.beforeTurn.files);
            observerMutations = diffSnapshots(beforeObserver, snapshotTree(workspace));
          }
          const beforeModel = snapshotTree(workspace);
          const beforeRemoteRefs = item.git ? snapshotOriginRefs(workspace) : [];
          const message = index === 0 ? `/skill:${item.skill} ${turn.prompt}` : turn.prompt;
          const response = await session.prompt(message);
          output = typeof response === "string" ? response : response.text;
          if (typeof output !== "string") throw new Error("PI returned no final assistant text");
          outputs.push(output);
          if (item.skill === "ask-yet") turnErrors.push(...matchAskYetResponse(output));
          turnErrors.push(...matchLiveEvalOutput(output, turn.expected));

          modelMutations = diffSnapshots(beforeModel, snapshotTree(workspace));
          remoteMutations = item.git ? diffSnapshots(beforeRemoteRefs, snapshotOriginRefs(workspace)) : [];
          allMutations.push(...modelMutations);
          const allowedWrites = new Set(turn.allowedWrites ?? []);
          for (const mutation of modelMutations) {
            if (mutation.path.startsWith(".git/") && turn.allowedGit) continue;
            if (allowedWrites.has(mutation.path)) continue;
            turnErrors.push(`unauthorized workspace mutation: ${mutation.path}`);
          }
          const allowedRemoteRefs = new Set(turn.allowedRemoteRefs ?? []);
          for (const mutation of remoteMutations) {
            if (!allowedRemoteRefs.has(mutation.path)) {
              turnErrors.push("unauthorized remote ref mutation: " + mutation.path);
              continue;
            }
            const changes = diffOriginChanges(workspace, mutation.path);
            const changedPaths = changes.map(({ path: relative }) => relative);
            remoteArtifactPaths.push(...changedPaths);
            for (const relative of changedPaths) {
              if (!allowedWrites.has(relative)) turnErrors.push("unauthorized remote artifact path: " + relative);
            }
            turnErrors.push(...findForbiddenStringsInOrigin(
              workspace,
              mutation.path,
              changes.filter(({ status }) => status !== "D").map(({ path: relative }) => relative),
              item.forbiddenStrings ?? [],
            ));
          }
          const changedPaths = new Set(modelMutations.map(({ path: relative }) => relative));
          for (const relative of turn.expectedWrites ?? []) {
            if (!changedPaths.has(relative)) turnErrors.push(`expected workspace write missing: ${relative}`);
          }
          turnErrors.push(...findForbiddenStrings(workspace, item.forbiddenStrings ?? []));
        } catch (error) {
          infraError = error instanceof Error ? error.message : String(error);
        }

        const turnStatus = infraError ? "INFRA_FAIL" : turnErrors.length ? "SEMANTIC_FAIL" : "PASS";
        turnReports.push({
          id: turn.id,
          index: index + 1,
          status: turnStatus,
          outputExcerpt: excerpt(output),
          errors: infraError ? [infraError] : turnErrors,
          observerActions: {
            files: Object.keys(turn.beforeTurn?.files ?? {}),
            mutations: summarizeMutations(observerMutations),
          },
          workspaceMutations: summarizeMutations(modelMutations),
          remoteRefMutations: summarizeMutations(remoteMutations),
          remoteArtifactPaths: [...new Set(remoteArtifactPaths)].sort(),
          sessionIdentity,
        });
        if (infraError) break;
        if (turnErrors.length) {
          errors.push(...turnErrors.map((error) => `${turn.id}: ${error}`));
          break;
        }
      }

      if (!infraError && errors.length === 0 && turnReports.length === turns.length) {
        if (isMultiturn && item.expected) errors.push(...matchLiveEvalOutput(outputs.join("\n\n"), item.expected));
        for (const artifact of item.finalArtifacts ?? []) {
          try {
            const content = readOriginArtifact(workspace, artifact.ref, artifact.path);
            errors.push(...matchLiveEvalOutput(content, artifact.expected).map((error) => `${artifact.ref}:${artifact.path}: ${error}`));
          } catch (error) {
            errors.push(`${artifact.ref}:${artifact.path}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
    } catch (error) {
      infraError = error instanceof Error ? error.message : String(error);
    } finally {
      if (session) {
        try {
          await session.close();
        } catch (error) {
          infraError ||= error instanceof Error ? error.message : String(error);
        }
      }
      if (isMultiturn) cleanup.session = cleanupPath(sessionRoot, removeTree);
      cleanup.workspace = cleanupPath(workspace, removeTree);
      if (cleanup.session === "FAIL" || cleanup.workspace === "FAIL") infraError ||= "eval cleanup failed";
    }
    const status = infraError ? "INFRA_FAIL" : errors.length ? "SEMANTIC_FAIL" : "PASS";
    const attempt = {
      caseId: item.id,
      caseType: evalCaseType(item),
      skill: item.skill,
      attempt: round,
      status,
      timeoutMs: caseTimeoutMs,
      durationMs: Date.now() - attemptStarted,
      errors: [...errors, ...(infraError ? [infraError] : [])],
      sessionIdentity,
      turns: turnReports,
      workspaceMutations: summarizeMutations(allMutations),
      cleanup,
    };
    if (retryReason) attempt.retryReason = retryReason;
    if (status !== "PASS" && outputs.length) attempt.output = outputs.join("\n\n--- next turn ---\n\n");
    attempts.push(attempt);
    onProgress(`${status} ${item.id}${round > 1 ? ` [attempt ${round}]` : ""}`);
  }

  for (let round = 1; round <= repeat; round += 1) {
    for (const item of selected) await runAttempt(item, round);
  }
  for (let retry = 1; retry <= retryFailures; retry += 1) {
    const failed = new Set(evaluateCaseGate(attempts, selected.map(({ id }) => id)).failed);
    if (failed.size === 0) break;
    for (const item of selected.filter(({ id }) => failed.has(id))) {
      const previous = attempts.findLast(({ caseId: id }) => id === item.id);
      await runAttempt(item, repeat + retry, `${previous.status}: ${previous.errors.join("; ")}`);
    }
  }

  const gate = evaluateCaseGate(attempts, selected.map(({ id }) => id));
  const evaluatedFixture = { version: fixture.version, cases: selected };
  const caseIds = selected.map(({ id }) => id);
  return {
    schema: REPORT_SCHEMA,
    source,
    fixtureSha256: crypto.createHash("sha256").update(JSON.stringify(evaluatedFixture)).digest("hex"),
    caseSetSha256: crypto.createHash("sha256").update(JSON.stringify(caseIds)).digest("hex"),
    fixtureCaseIds: caseIds,
    caseCount: selected.length,
    modelTurns: selected.reduce((total, item) => total + modelTurnCount(item), 0),
    caseTypes: selected.map((item) => ({ id: item.id, type: evalCaseType(item) })),
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

export async function createPiRpcSession({ cwd, launcher, model, thinking, timeoutMs, skill, tools, persisted, sessionDir, sessionName }) {
  if (persisted) fs.mkdirSync(sessionDir, { recursive: true });
  const child = spawn(
    launcher,
    [
      "--mode", "rpc",
      ...(persisted ? ["--session-dir", sessionDir, "--name", sessionName] : ["--no-session"]),
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
  let settleWaiter = null;
  let terminalError = null;
  let closedResult = null;
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.once("error", failPending);

  const stopReading = attachJsonlLineReader(child.stdout, (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      failPending(new Error(`PI emitted invalid JSONL: ${line}\n${error.message}`));
      return;
    }
    if (message.type === "agent_settled" && settleWaiter) {
      settleWaiter.resolve();
      settleWaiter = null;
    }
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
      closedResult = { code, signal };
      resolve(closedResult);
    });
  });

  function failPending(error) {
    terminalError ??= error;
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
    if (settleWaiter) {
      settleWaiter.reject(error);
      settleWaiter = null;
    }
  }

  function request(command) {
    const id = `eval-${++sequence}`;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
    });
  }

  const terminate = () => {
    if (child.exitCode === null && !child.killed) child.kill("SIGTERM");
  };
  const timed = (promise, label) => withTimeout(promise, timeoutMs, () => {
    const error = new Error(`${label} timed out after ${timeoutMs}ms`);
    failPending(error);
    terminate();
    return error;
  });

  let identity;
  try {
    const catalog = await timed(request({ type: "get_commands" }), "PI command catalog");
    if (!catalog.success) throw new Error("PI did not return its command catalog");
    const loadedSkill = catalog.data?.commands?.find((command) => command.name === `skill:${skill}` && command.source === "skill");
    const loadedPath = loadedSkill?.sourceInfo?.path ?? loadedSkill?.path;
    const expectedPath = path.join(ROOT, "skills", skill, "SKILL.md");
    if (!loadedPath || realpathSafe(loadedPath) !== realpathSafe(expectedPath)) {
      throw new Error(`${skill} did not load from this checkout: ${loadedPath ?? "missing"}`);
    }

    const initialState = await timed(request({ type: "get_state" }), "PI session state");
    if (!initialState.success || !initialState.data?.sessionId) throw new Error("PI returned no session identity");
    if (persisted) assertSessionPath(initialState.data.sessionFile, sessionDir);
    identity = {
      id: initialState.data.sessionId,
      file: initialState.data.sessionFile ?? "",
      name: initialState.data.sessionName ?? sessionName,
    };
  } catch (error) {
    terminate();
    await withTimeout(closed, 5_000, () => {
      if (child.exitCode === null) child.kill("SIGKILL");
    }).catch(() => {});
    stopReading();
    throw error;
  }
  let closedByClient = false;

  return {
    identity,
    async prompt(message) {
      if (terminalError) throw terminalError;
      if (settleWaiter) throw new Error("PI session already has a prompt in flight");
      const settled = new Promise((resolve, reject) => { settleWaiter = { resolve, reject }; });
      settled.catch(() => {});
      const accepted = await timed(request({ type: "prompt", message }), "PI prompt acceptance");
      if (!accepted.success) {
        settleWaiter = null;
        throw new Error(`PI rejected prompt: ${JSON.stringify(accepted)}`);
      }
      await timed(settled, "PI turn");
      const last = await timed(request({ type: "get_last_assistant_text" }), "PI assistant response");
      const state = await timed(request({ type: "get_state" }), "PI session state");
      if (!last.success || typeof last.data?.text !== "string") throw new Error("PI returned no final assistant text");
      if (!state.success || state.data?.sessionId !== identity.id) throw new Error("PI session identity changed during case");
      if (persisted) assertSessionPath(state.data.sessionFile, sessionDir);
      return { text: last.data.text, state: state.data };
    },
    async close() {
      if (closedByClient) return;
      closedByClient = true;
      if (child.exitCode === null && !child.stdin.destroyed) child.stdin.end();
      const result = closedResult ?? await withTimeout(closed, 5_000, terminate);
      stopReading();
      if (result.code !== 0) throw terminalError ?? new Error(stderr || `PI exited ${result.code ?? result.signal}`);
    },
  };
}

function attachJsonlLineReader(stream, onLine) {
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  const emit = (line) => onLine(line.endsWith("\r") ? line.slice(0, -1) : line);
  const onData = (chunk) => {
    buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
    for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
      emit(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
    }
  };
  const onEnd = () => {
    buffer += decoder.end();
    if (buffer) emit(buffer);
    buffer = "";
  };
  stream.on("data", onData);
  stream.on("end", onEnd);
  return () => {
    stream.off("data", onData);
    stream.off("end", onEnd);
  };
}

function withTimeout(promise, timeoutMs, onTimeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      let error;
      try {
        error = onTimeout();
      } catch (cause) {
        error = cause;
      }
      reject(error instanceof Error ? error : new Error(`operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function assertSessionPath(sessionFile, sessionDir) {
  if (!sessionFile || !isWithin(sessionDir, sessionFile)) throw new Error(`PI session escaped isolated directory: ${sessionFile ?? "missing"}`);
}

function redactSessionIdentity(identity) {
  if (!identity) return "UNAVAILABLE";
  const raw = typeof identity === "string" ? identity : `${identity.id ?? ""}\n${identity.file ?? ""}`;
  return `session:${crypto.createHash("sha256").update(raw).digest("hex").slice(0, 12)}`;
}

function excerpt(output, limit = 1_200) {
  if (!output || output.length <= limit) return output;
  return `${output.slice(0, 800)}\n…<truncated>…\n${output.slice(-350)}`;
}

function diffSnapshots(before, after) {
  const oldEntries = new Map(before);
  const newEntries = new Map(after);
  const paths = [...new Set([...oldEntries.keys(), ...newEntries.keys()])].sort();
  const changes = [];
  for (const relative of paths) {
    const oldValue = oldEntries.get(relative);
    const newValue = newEntries.get(relative);
    if (oldValue === newValue) continue;
    changes.push({
      path: relative,
      kind: oldValue === undefined ? "created" : newValue === undefined ? "deleted" : "modified",
    });
  }
  return changes;
}

function summarizeMutations(mutations) {
  const summary = { count: mutations.length, created: 0, modified: 0, deleted: 0, paths: [] };
  for (const mutation of mutations) summary[mutation.kind] += 1;
  summary.paths = mutations.slice(0, 20).map(({ kind, path: relative }) => `${kind}:${relative}`);
  return summary;
}

function findForbiddenStrings(root, forbiddenStrings) {
  if (forbiddenStrings.length === 0) return [];
  const found = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      if (!entry.isFile()) continue;
      const content = fs.readFileSync(absolute);
      for (const value of forbiddenStrings) {
        if (content.includes(Buffer.from(value))) {
          const fingerprint = crypto.createHash("sha256").update(value).digest("hex").slice(0, 8);
          found.push(`workspace contains forbidden string ${fingerprint} in ${path.relative(root, absolute)}`);
        }
      }
    }
  }
  visit(root);
  return found;
}

function findForbiddenStringsInOrigin(root, ref, paths, forbiddenStrings) {
  if (forbiddenStrings.length === 0) return [];
  const found = [];
  for (const relative of paths) {
    const content = readOriginArtifact(root, ref, relative);
    for (const value of forbiddenStrings) {
      if (!content.includes(value)) continue;
      const fingerprint = crypto.createHash("sha256").update(value).digest("hex").slice(0, 8);
      found.push(`remote artifact contains forbidden string ${fingerprint} in ${ref}:${relative}`);
    }
  }
  return found;
}

function cleanupPath(target, removeTree) {
  try {
    removeTree(target);
    return fs.existsSync(target) ? "FAIL" : "PASS";
  } catch {
    return "FAIL";
  }
}

function isWithin(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isolatedOriginPath(root) {
  const result = spawnSync("git", ["remote", "get-url", "origin"], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || "git remote get-url origin failed");
  const remote = result.stdout.trim();
  if (!remote || remote.includes("://") || /^[^/]+@[^:]+:/u.test(remote)) throw new Error("eval Git origin is not a local path");
  const absolute = path.resolve(root, remote);
  if (!isWithin(root, absolute)) throw new Error("eval Git origin escaped the isolated workspace");
  return absolute;
}

function assertIsolatedOrigin(root) {
  const origin = isolatedOriginPath(root);
  if (!fs.statSync(origin).isDirectory()) throw new Error("eval Git origin is not a local bare repository");
}

function readOriginArtifact(root, ref, relative) {
  const origin = isolatedOriginPath(root);
  const result = spawnSync("git", ["--git-dir", origin, "show", `${ref}:${relative}`], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `cannot read ${ref}:${relative}`);
  return result.stdout;
}

function snapshotOriginRefs(root) {
  const origin = isolatedOriginPath(root);
  const result = spawnSync("git", ["--git-dir", origin, "for-each-ref", "--format=%(refname) %(objectname)"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || "cannot read eval origin refs");
  const refs = result.stdout.trim() ? result.stdout.trim().split("\n").map((line) => {
    const separator = line.indexOf(" ");
    return [line.slice(0, separator), line.slice(separator + 1)];
  }) : [];
  refs.push(["HEAD", fs.readFileSync(path.join(origin, "HEAD"), "utf8").trim()]);
  return refs.sort(([left], [right]) => left.localeCompare(right));
}

function diffOriginChanges(root, targetRef) {
  const origin = isolatedOriginPath(root);
  const result = spawnSync(
    "git",
    ["--git-dir", origin, "diff", "--name-status", "--no-renames", "-z", "refs/heads/main", targetRef, "--"],
    { encoding: null },
  );
  if (result.status !== 0) throw new Error(result.stderr?.toString() || "cannot diff " + targetRef);
  const fields = result.stdout.toString("utf8").split("\0").filter(Boolean);
  if (fields.length % 2 !== 0) throw new Error("invalid remote diff output for " + targetRef);
  const changes = [];
  for (let index = 0; index < fields.length; index += 2) {
    const [status, relative] = fields.slice(index, index + 2);
    if (!/^[ACDMTUXB]$/u.test(status) || !safeRelativePath(relative)) {
      throw new Error("invalid remote diff entry for " + targetRef);
    }
    changes.push({ status, path: relative });
  }
  return changes;
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
    ["config", "user.name", "PI Fixture"],
    ["config", "user.email", "fixture@example.invalid"],
    ["config", "commit.gpgSign", "false"],
    ["add", "--", "."],
    ["commit", "-q", "--no-verify", "-m", "Create accepted fixture base"],
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
    ["--git-dir", remote, "symbolic-ref", "HEAD", "refs/heads/main"],
    ["remote", "set-head", "origin", "-a"],
    ["fetch", "-q", "origin"],
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
      help: { type: "boolean" },
      suite: { type: "string" },
      repeat: { type: "string" },
      "retry-failures": { type: "string" },
      report: { type: "string" },
      "report-only": { type: "boolean" },
      "require-clean": { type: "boolean" },
    },
    allowPositionals: false,
  });
  if (values.help) {
    console.log(`Usage: npm run eval:pi -- [options]

  --suite <release|nightly|isolated-writable>
  --case <id>
  --repeat <count>
  --retry-failures <count>
  --report <path>
  --report-only
  --require-clean`);
    process.exit(0);
  }
  const singleTurnFixture = JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures", "pi-live-eval-cases.json"), "utf8"));
  const multiTurnFixture = JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures", "pi-multiturn-eval-cases.json"), "utf8"));
  const suiteManifest = JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures", "pi-eval-suites.json"), "utf8"));
  const fixture = combineLiveEvalFixtures(singleTurnFixture, multiTurnFixture);
  const fixtureErrors = [
    ...validateLiveEvalFixture(singleTurnFixture),
    ...validateMultiTurnEvalFixture(multiTurnFixture, singleTurnFixture.cases.map(({ id }) => id)),
    ...validateEvalSuiteManifest(suiteManifest, fixture),
  ];
  if (fixtureErrors.length) throw new Error(fixtureErrors.join("\n"));
  const repeat = Number(values.repeat ?? 1);
  const retryFailures = Number(values["retry-failures"] ?? 0);
  const report = await runLivePiEval({
    fixture,
    suiteManifest,
    caseId: values.case,
    suite: values.suite ?? "release",
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
  console.log(`suite: ${report.suite} · ${report.caseCount} cases · ${report.modelTurns} model turns · sha256:${report.caseSetSha256}`);
  const percent = (report.summary.successRate * 100).toFixed(1);
  console.log(`live PI behavior: ${report.summary.passed}/${report.summary.total} passed (${percent}%)`);
  if (report.gate.flaky.length > 0) console.warn(`FLAKY ${report.gate.flaky.join(",")}`);
  if (!report.gate.passed) console.error(`FAILED CASES ${report.gate.failed.join(",")}`);
  if (!values["report-only"] && !report.gate.passed) process.exitCode = 1;
}
