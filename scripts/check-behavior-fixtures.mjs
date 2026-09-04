import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  combineLiveEvalFixtures,
  validateEvalSuiteManifest,
  validateLiveEvalFixture,
  validateMultiTurnEvalFixture,
} from "./eval-pi-behavior.mjs";

export function validateBehaviorFixtures(root) {
  const observedFile = path.join(root, "fixtures", "pi-behavior-cases.json");
  const errors = [
    ...validateObservedBehaviorCases(observedFile),
    ...validateExecutionPlanBehaviorCases(path.join(root, "fixtures", "execution-plan-cases.json")),
    ...validateControllerPublicStatusCases(path.join(root, "fixtures", "controller-public-status-cases.json")),
  ];
  const live = JSON.parse(fs.readFileSync(path.join(root, "fixtures", "pi-live-eval-cases.json"), "utf8"));
  const multi = JSON.parse(fs.readFileSync(path.join(root, "fixtures", "pi-multiturn-eval-cases.json"), "utf8"));
  const suites = JSON.parse(fs.readFileSync(path.join(root, "fixtures", "pi-eval-suites.json"), "utf8"));
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
    "context-quality-historical-plan-not-authority",
    "context-quality-stale-root-policy-blocks",
    "context-quality-context-map-bounded",
    "context-quality-ticket-anchor-economy",
    "context-quality-old-accepted-adr-valid",
    "context-quality-current-target-not-conflict",
    "context-quality-admission-anchor-drift",
  ]) {
    if (!liveById.has(id)) errors.push(`missing Context Quality live case ${id}`);
    if (!(suites.quarantine?.caseIds ?? []).includes(id)) errors.push(`${id}: Context Quality case must remain quarantined`);
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
    ...validateEvalSuiteManifest(suites, combineLiveEvalFixtures(live, multi)).map((error) => `suites: ${error}`),
  ];
}

function validateExecutionPlanBehaviorCases(file) {
  const fixture = JSON.parse(fs.readFileSync(file, "utf8"));
  const errors = [];
  if (fixture.version !== 1 || fixture.evidenceTier !== "DETERMINISTIC_CONTRACT_FIXTURE" || !Array.isArray(fixture.cases)) {
    return ["invalid execution-plan deterministic fixture"];
  }
  const expectedIds = ["agent-only-default-handoff", "mixed-agent-human-stops-handoff", "roadmap-human-stops-handoff", "human-blocks-agent-stops-handoff", "all-human-stops-handoff", "external-blocker-stops-handoff"];
  if (fixture.cases.map(({ id }) => id).join("\n") !== expectedIds.join("\n")) errors.push("execution-plan deterministic fixture case set drifted");
  for (const item of fixture.cases) {
    const executable = (item.executionLanes ?? []).length > 0
      && item.executionLanes.every((lane) => lane === "AGENT")
      && Array.isArray(item.externalBlockers)
      && item.externalBlockers.length === 0;
    const actual = {
      status: item.artifactKind === "ROADMAP" ? "ROADMAP_NOT_EXECUTABLE" : executable ? "READY" : "CODEX_RELEASE_NOT_EXECUTABLE",
      route: executable ? "prepare-codex-release" : null,
      labelWrites: 0,
      controllerStarts: 0,
    };
    if (JSON.stringify(actual) !== JSON.stringify(item.expected)) errors.push(`${item.id}: execution-plan route projection drifted`);
  }
  return errors;
}

function validateControllerPublicStatusCases(file) {
  const fixture = JSON.parse(fs.readFileSync(file, "utf8"));
  const errors = [];
  const expectedIds = [
    "controller-job-not-started",
    "controller-running",
    "controller-id-mismatch",
    "controller-binding-mismatch",
    "controller-repo-mismatch",
    "controller-base-mismatch",
    "controller-malformed-blocked",
    "controller-blocked-recoverable",
    "controller-legacy-normalized-recoverable",
    "controller-blocked-manual",
    "controller-blocked-replan",
    "controller-unknown-block-kind",
    "controller-completed",
    "controller-failed",
    "controller-unknown-status",
    "controller-status-unavailable",
  ];
  if (fixture.version !== 1 || fixture.evidenceTier !== "DETERMINISTIC_CONTRACT_FIXTURE"
    || fixture.cases?.map(({ id }) => id).join("\n") !== expectedIds.join("\n")) {
    return ["invalid Controller public-status deterministic fixture"];
  }
  for (const item of fixture.cases) {
    if (item.sourceLegacyBlockedKindMissing
      && (item.statusPatch?.legacy !== true || item.statusPatch?.blocked?.kind !== "recoverable")) {
      errors.push(`${item.id}: legacy Controller status is not safely normalized`);
    }
    const route = (controller, nextAction, showStoredStart = false) => ({
      planningHandoff: "HANDOFF_READY",
      controller,
      nextAction,
      showStoredStart,
      plannerMutations: 0,
      privateJobReads: 0,
      polls: 0,
    });
    let actual;
    if (item.errorCode) {
      actual = item.errorCode === "job_not_found"
        ? route("NOT_STARTED", "stored_start", true)
        : route("STATUS_UNAVAILABLE", "fail_closed");
    } else {
      const status = {
        ...fixture.baseStatus,
        ...item.statusPatch,
        plan: { ...fixture.baseStatus.plan, ...(item.planPatch ?? {}) },
      };
      const bindingsMatch = status.id === `job-${status.planDigest}`
        && status.plan.id === fixture.approvedPlan.id
        && status.repo === fixture.approvedPlan.repo
        && status.planDigest === fixture.approvedPlan.planDigest
        && status.plan.baseSha === fixture.approvedPlan.baseSha;
      if (!bindingsMatch) actual = route("STATUS_UNAVAILABLE", "fail_closed");
      else if (status.status === "running") actual = route("RUNNING", "controller_run_or_step");
      else if (status.status === "completed") actual = route("COMPLETED", "export_and_ingest_release_result");
      else if (status.status === "failed") actual = route("FAILED", "operator_inspect");
      else if (status.status === "blocked" && status.blocked?.kind === "recoverable") {
        actual = route("BLOCKED_RECOVERABLE", "operator_fix_then_retry");
      } else if (status.status === "blocked" && status.blocked?.kind === "manual") {
        actual = route("BLOCKED_MANUAL", "human_choose_retry_repair_or_abort");
      } else if (status.status === "blocked" && status.blocked?.kind === "replan_required") {
        actual = route("BLOCKED_REPLAN_REQUIRED", "abort_before_replan");
      } else actual = route("STATUS_UNAVAILABLE", "fail_closed");
    }
    if (JSON.stringify(actual) !== JSON.stringify(item.expected)) errors.push(`${item.id}: Controller public-status route drifted`);
  }
  return errors;
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
