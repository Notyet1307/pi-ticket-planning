import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateLiveEvalFixture, validateMultiTurnEvalFixture } from "./eval-pi-behavior.mjs";

export function validateBehaviorFixtures(root) {
  const observedFile = path.join(root, "fixtures", "pi-behavior-cases.json");
  const errors = validateObservedBehaviorCases(observedFile);
  const live = JSON.parse(fs.readFileSync(path.join(root, "fixtures", "pi-live-eval-cases.json"), "utf8"));
  const multi = JSON.parse(fs.readFileSync(path.join(root, "fixtures", "pi-multiturn-eval-cases.json"), "utf8"));
  const observed = JSON.parse(fs.readFileSync(observedFile, "utf8"));
  const singleIds = [...(observed.cases ?? []), ...(live.cases ?? [])].map(({ id }) => id);
  const liveById = new Map(live.cases.map((item) => [item.id, item]));
  const multiById = new Map(multi.cases.map((item) => [item.id, item]));
  for (const id of [
    "human-interface-candidate-choice-natural",
    "human-interface-interview-consent-natural",
    "human-interface-explicit-status-uses-card",
    "human-interface-nondelegable-decision-compact",
    "human-interface-exact-write-review",
  ]) {
    if (!liveById.has(id)) errors.push(`missing human-interface live case ${id}`);
  }
  for (const id of [
    "human-interface-candidate-choice-natural",
    "human-interface-interview-consent-natural",
    "human-interface-nondelegable-decision-compact",
    "human-interface-exact-write-review",
  ]) {
    if (!liveById.get(id)?.expected?.mustNotMatch?.some((pattern) => pattern.includes("当前目标：") && pattern.includes("你只需要决定："))) {
      errors.push(`${id}: natural response does not forbid the five-field card`);
    }
  }
  const statusPatterns = liveById.get("human-interface-explicit-status-uses-card")?.expected?.mustMatch?.join("\n") ?? "";
  if (!liveById.get("human-interface-explicit-status-uses-card")?.files?.["docs/product/releases/r501-handoff-check.md"]?.includes("release_id: R501")) {
    errors.push("explicit status case lacks an exact Release identity source");
  }
  for (const label of ["当前目标：", "已经确认：", "仍然缺少：", "为什么现在不能继续：", "你只需要决定："]) {
    if (!statusPatterns.includes(label)) errors.push(`explicit status case lacks ${label}`);
  }
  const progressive = multiById.get("multiturn-human-interface-progressive-status");
  if (progressive?.turns?.map(({ id }) => id).join(" -> ") !== "dialogue -> status -> resume") {
    errors.push("progressive human-interface case must switch dialogue -> status -> resume in one session");
  }
  return [
    ...errors,
    ...validateLiveEvalFixture(live).map((error) => `live: ${error}`),
    ...validateMultiTurnEvalFixture(multi, singleIds).map((error) => `multiturn: ${error}`),
  ];
}

function validateObservedBehaviorCases(file) {
  const fixture = JSON.parse(fs.readFileSync(file, "utf8"));
  const errors = [];
  const ids = new Set();

  for (const item of fixture.cases ?? []) {
    if (!item.id || ids.has(item.id)) errors.push(`${item.id || "unnamed"}: duplicate or missing id`);
    ids.add(item.id);
    if (!item.skill || !item.inputState || !item.observedExcerpt) errors.push(`${item.id}: incomplete case`);
    if (!Array.isArray(item.expected?.mustMatch) || item.expected.mustMatch.length === 0) {
      errors.push(`${item.id}: missing positive invariants`);
    }
    for (const text of item.expected?.mustMatch ?? []) {
      if (!item.observedExcerpt.includes(text)) errors.push(`${item.id}: observed output lacks ${text}`);
    }
    for (const text of item.expected?.mustNotMatch ?? []) {
      if (item.observedExcerpt.includes(text)) errors.push(`${item.id}: observed output contains forbidden ${text}`);
    }
    if (JSON.stringify(item.expected?.allowedWrites) !== "[]") errors.push(`${item.id}: canary was not read-only`);
  }

  for (const id of [
    "greenfield-uncommitted-stays-in-frame",
    "committed-release-auto-loads-setup-helper",
    "internal-canary-preserves-customer-evidence-boundary",
    "existing-git-unpublished-release-stays-in-frame",
    "missing-handoffs-fail-closed",
    "complete-handoffs-reach-approval-gate",
    "normalized-delivery-graph-reaches-approval-gate",
    "triage-auto-continues-to-admission",
    "fresh-reviewer-accepts-complete-execution-context",
    "fresh-reviewer-rejects-missing-execution-context"
  ]) {
    if (!ids.has(id)) errors.push(`missing observed behavior case ${id}`);
  }

  return errors;
}

const ownPath = fs.realpathSync(fileURLToPath(import.meta.url));
if (process.argv[1] && fs.realpathSync(process.argv[1]) === ownPath) {
  const root = path.resolve(path.dirname(ownPath), "..");
  const errors = validateBehaviorFixtures(root);
  if (errors.length) {
    for (const error of errors) console.error(`ERROR ${error}`);
    process.exitCode = 1;
  } else {
    console.log("behavior fixtures: ok");
  }
}
