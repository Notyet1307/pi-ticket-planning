import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateDeliveryGraph } from "./check-delivery-graph.mjs";
import { validateContracts } from "./workflow-contract.mjs";

const EXPECTED_COMMIT = "84fdeffd12f2ee307994d1eb6feb48173b6e0502";
const SCOUT_MODEL = "openai-codex/gpt-5.6-luna";
const SCOUT_THINKING = "max";
const REQUIRED_PACKAGE_SKILLS = [
  "admit-ticket",
  "ask-yet",
  "setup-delivery-repository",
  "ticket-readiness",
  "to-spec",
  "to-tickets",
  "triage",
];
const HUMAN_INVOKED_SKILLS = new Set(["ask-yet"]);
const MODEL_INVOKED_PACKAGE_SKILLS = new Set([
  "admit-ticket",
  "setup-delivery-repository",
  "to-spec",
  "to-tickets",
  "triage",
]);
const ASK_YET_REFERENCES = [
  "release-loop.md",
  "evidence-method-selection.md",
  "interview-session.md",
  "solution-shaping.md",
  "human-interface.md",
  "execution-closeout.md",
];
const REQUIRED_FILES = [
  ".github/workflows/ci.yml",
  "AGENTS.md",
  "CHANGELOG.md",
  "README.md",
  "README.zh-CN.md",
  "agents/ticket-readiness-reviewer.md",
  "contracts/authority.json",
  "contracts/workflow.json",
  "docs/README.md",
  "fixtures/admission-cases.json",
  "fixtures/README.md",
  "install.sh",
  "package.json",
  "profile/AGENTS.md",
  "profile/pi-ticket-plan",
  "profile/settings.template.json",
  "schemas/project-readiness-v1.schema.json",
  "scripts/admit.mjs",
  "scripts/delivery-gate.mjs",
  "scripts/check-admission-state.mjs",
  "scripts/check-delivery-graph.mjs",
  "scripts/check-docs.mjs",
  "scripts/check-profile.mjs",
  "scripts/check-ticket-context.mjs",
  "scripts/install-profile.mjs",
  "scripts/readiness-receipt.mjs",
  "scripts/workflow-contract.mjs",
  "skills/admit-ticket/SKILL.md",
  "skills/ask-yet/SKILL.md",
  "skills/setup-delivery-repository/SKILL.md",
  "skills/setup-delivery-repository/issue-tracker-github.md",
  "skills/setup-delivery-repository/issue-tracker-gitlab.md",
  "skills/setup-delivery-repository/issue-tracker-local.md",
  "skills/ticket-readiness/SKILL.md",
  "skills/to-spec/SKILL.md",
  "skills/to-tickets/SKILL.md",
  "skills/triage/AGENT-BRIEF.md",
  "skills/triage/SKILL.md",
  "upstream-lock.json",
  ...ASK_YET_REFERENCES.map((name) => `skills/ask-yet/references/${name}`),
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function frontmatterValue(text, key) {
  return text.match(new RegExp(`^${key}:\\s*["']?([^\\n"']+)`, "m"))?.[1]?.trim();
}

function requireTokens(errors, file, text, tokens) {
  for (const token of tokens) {
    if (!text.includes(token)) errors.push(`${file}: missing required identifier ${token}`);
  }
}

export function validatePackage(root) {
  const errors = [];
  for (const relative of REQUIRED_FILES) {
    if (!fs.existsSync(path.join(root, relative))) errors.push(`missing ${relative}`);
  }
  if (errors.length > 0) return errors;

  const contractCheck = validateContracts();
  for (const problem of contractCheck.problems) {
    errors.push(`machine workflow contract: ${problem.code}${problem.subject ? ` ${problem.subject}` : ""}`);
  }

  const pkg = readJson(path.join(root, "package.json"));
  const lock = readJson(path.join(root, "upstream-lock.json"));
  const profile = readJson(path.join(root, "profile", "settings.template.json"));
  const suppressedSkills = new Set(lock.suppressedSkills ?? []);
  const loadedSkills = new Set([
    ...lock.officialStableSkills.filter((name) => !suppressedSkills.has(name)),
    ...lock.packageSkills,
  ]);

  if (pkg.mattpocockUpstream?.commit !== EXPECTED_COMMIT) errors.push("package.json upstream commit drifted");
  if (lock.commit !== EXPECTED_COMMIT) errors.push("upstream-lock.json commit drifted");
  if (pkg.mattpocockUpstream?.updatePolicy !== "manual") errors.push("upstream policy must remain manual");

  const expectedScripts = {
    admit: "node scripts/admit.mjs",
    check: "node scripts/check-package.mjs",
    "check:admission-state": "node scripts/check-admission-state.mjs",
    "check:behavior-fixtures": "node scripts/check-behavior-fixtures.mjs",
    "check:delivery-graph": "node scripts/check-delivery-graph.mjs",
    "check:docs": "node scripts/check-docs.mjs",
    "check:frontier": "node scripts/check-frontier-order.mjs",
    "check:ticket-context": "node scripts/check-ticket-context.mjs",
    "check:workflow": "node scripts/workflow-contract.mjs",
    doctor: "node scripts/doctor.mjs",
    "delivery-gate": "node scripts/delivery-gate.mjs",
    "eval:pi": "node scripts/eval-pi-behavior.mjs",
    "eval:pi:nightly": "node scripts/eval-pi-behavior.mjs --suite nightly --repeat 3 --report-only",
    verify: "npm run verify:ci && npm run check:profile",
    "verify:ci": "npm run check && npm run check:behavior-fixtures && npm run check:docs && npm test",
    "verify:release": "npm run verify && npm run eval:pi -- --suite release --retry-failures 1 --require-clean",
  };
  for (const [name, command] of Object.entries(expectedScripts)) {
    if (pkg.scripts?.[name] !== command) errors.push(`package script drifted: ${name}`);
  }

  const ci = fs.readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
  requireTokens(errors, ".github/workflows/ci.yml", ci, [
    "actions/checkout@v7",
    "fetch-depth: 0",
    "actions/setup-node@v7",
    "npm run verify:ci",
  ]);

  const upstreamSource = `git:github.com/mattpocock/skills@${EXPECTED_COMMIT}`;
  const upstreamProfile = profile.packages?.find((entry) => entry?.source === upstreamSource);
  const packageProfile = profile.packages?.find((entry) => entry?.source === "__PACKAGE_ROOT__");
  const subagentsProfile = profile.packages?.find((entry) => entry?.source === "npm:pi-subagents@0.42.1");
  if (!upstreamProfile) errors.push("profile does not pin the expected Matt upstream commit");
  if (!packageProfile) errors.push("profile does not expose the package-root install placeholder");
  if (!subagentsProfile) errors.push("profile does not pin pi-subagents 0.42.1");
  if (JSON.stringify(profile.skills) !== JSON.stringify(["!**"])) errors.push("profile must suppress ambient user skills");
  if (profile.subagents?.agentOverrides?.scout?.model !== SCOUT_MODEL) errors.push(`profile scout model must be ${SCOUT_MODEL}`);
  if (profile.subagents?.agentOverrides?.scout?.thinking !== SCOUT_THINKING) errors.push(`profile scout thinking must be ${SCOUT_THINKING}`);
  for (const skill of lock.overriddenSkills) {
    if (!upstreamProfile?.skills?.includes(`!skills/engineering/${skill}/**`)) {
      errors.push(`profile does not exclude upstream override ${skill}`);
    }
  }
  for (const skill of suppressedSkills) {
    if (!lock.officialStableSkills.includes(skill)) errors.push(`suppressed skill ${skill} is not in the upstream inventory`);
    if (!upstreamProfile?.skills?.includes(`!skills/engineering/${skill}/**`)) {
      errors.push(`profile does not exclude suppressed upstream skill ${skill}`);
    }
  }

  const skillRoot = path.join(root, "skills");
  const dirs = fs.readdirSync(skillRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  const names = [];
  const skillTexts = [];
  for (const dir of dirs) {
    const file = path.join(skillRoot, dir.name, "SKILL.md");
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    const name = frontmatterValue(text, "name");
    const description = frontmatterValue(text, "description");
    names.push(name);
    skillTexts.push(text);
    if (name !== dir.name) errors.push(`${dir.name}: frontmatter name mismatch`);
    if (!description) errors.push(`${dir.name}: missing description`);
    if (/\bTODO\b/.test(text)) errors.push(`${dir.name}: TODO remains`);
    if (HUMAN_INVOKED_SKILLS.has(dir.name) && frontmatterValue(text, "disable-model-invocation") !== "true") {
      errors.push(`${dir.name}: human gate allows implicit model invocation`);
    }
    if (MODEL_INVOKED_PACKAGE_SKILLS.has(dir.name) && frontmatterValue(text, "disable-model-invocation") === "true") {
      errors.push(`${dir.name}: helper is hidden from implicit model invocation`);
    }

    const metadataFile = path.join(skillRoot, dir.name, "agents", "openai.yaml");
    if (fs.existsSync(metadataFile)) {
      const metadata = fs.readFileSync(metadataFile, "utf8");
      if (HUMAN_INVOKED_SKILLS.has(dir.name) && !metadata.includes("allow_implicit_invocation: false")) {
        errors.push(`${dir.name}: UI metadata allows implicit invocation`);
      }
      if (MODEL_INVOKED_PACKAGE_SKILLS.has(dir.name) && !metadata.includes("allow_implicit_invocation: true")) {
        errors.push(`${dir.name}: helper UI metadata blocks implicit invocation`);
      }
    }

    for (const match of text.matchAll(/(?:^|[\s(])\/(?:skill:)?([a-z][a-z0-9-]*)/gm)) {
      if (!loadedSkills.has(match[1])) errors.push(`${dir.name}: unresolved skill reference /${match[1]}`);
    }
  }

  for (const required of REQUIRED_PACKAGE_SKILLS) {
    if (!names.includes(required)) errors.push(`missing package skill ${required}`);
  }
  if (names.includes("to-release")) errors.push("to-release must remain an internal reference, not a public skill");
  if (skillTexts.some((text) => /\/skill:to-release\b/.test(text))) errors.push("active Skill recommends obsolete /skill:to-release");

  const askYet = fs.readFileSync(path.join(skillRoot, "ask-yet", "SKILL.md"), "utf8");
  for (const reference of ASK_YET_REFERENCES) {
    if (!askYet.includes(`](references/${reference})`)) errors.push(`ask-yet does not route to ${reference}`);
  }
  requireTokens(errors, "skills/ask-yet/SKILL.md", askYet, [
    "`ORIENT`",
    "`ADVANCE`",
    "`RESUME`",
    "`STATUS`",
    "`PRODUCT`",
    "`DELIVERY`",
    "`TRIAGE`",
    "`RISK`",
    "`INCIDENT`",
    "setup-delivery-repository",
    "`to-spec`",
    "`to-tickets`",
    "`admit-ticket`",
    "contracts/workflow.json",
    "contracts/authority.json",
    "scripts/workflow-contract.mjs",
  ]);

  const checkpoint = "Checkpoint: <LANE>/<STAGE> · <authoritative work identity or NONE> · <allowed verdict>";
  const humanInterface = fs.readFileSync(path.join(skillRoot, "ask-yet", "references", "human-interface.md"), "utf8");
  if (!askYet.includes(checkpoint) || !humanInterface.includes(checkpoint)) {
    errors.push("ask-yet and human-interface must preserve the final Checkpoint syntax");
  }
  if (frontmatterValue(humanInterface, "name") || names.includes("human-interface")) {
    errors.push("human-interface must remain an internal reference, not a public Skill");
  }
  const statusLabels = ["当前目标：", "已经确认：", "仍然缺少：", "为什么现在不能继续：", "你只需要决定："];
  const statusIndexes = statusLabels.map((label) => humanInterface.indexOf(label));
  if (!statusIndexes.every((index, position) => index >= 0 && (position === 0 || index > statusIndexes[position - 1]))) {
    errors.push("human-interface does not preserve the STATUS field order");
  }

  for (const obsolete of [
    "active_release:",
    "next_command:",
    "forbidden_transition:",
    "Admission Receipt",
    "ADMISSION_EVIDENCE_ONLY",
    "EVIDENCE_ACTION_NEEDED",
    "EVIDENCE_DESIGNED_NOT_AUTHORIZED",
  ]) {
    if (askYet.includes(obsolete)) errors.push(`ask-yet retains obsolete machine token: ${obsolete}`);
  }

  const toSpec = fs.readFileSync(path.join(skillRoot, "to-spec", "SKILL.md"), "utf8");
  const toTickets = fs.readFileSync(path.join(skillRoot, "to-tickets", "SKILL.md"), "utf8");
  const triage = fs.readFileSync(path.join(skillRoot, "triage", "SKILL.md"), "utf8");
  const triageBrief = fs.readFileSync(path.join(skillRoot, "triage", "AGENT-BRIEF.md"), "utf8");
  const readiness = fs.readFileSync(path.join(skillRoot, "ticket-readiness", "SKILL.md"), "utf8");
  const admission = fs.readFileSync(path.join(skillRoot, "admit-ticket", "SKILL.md"), "utf8");

  if (/apply the `?ready-for-agent/i.test(toSpec)) errors.push("to-spec directly applies ready-for-agent");
  if (/Status:\s*ready-for-agent/i.test(toTickets)) errors.push("to-tickets publishes ready candidates");
  if (/trust them and apply/i.test(triage)) errors.push("triage retains the upstream direct-ready bypass");

  requireTokens(errors, "skills/ticket-readiness/SKILL.md", readiness, [
    "Execution lane: AGENT | HUMAN",
    "pi-ticket-planning:admission-review:v1",
    "Starting state:",
    "Invariants and guardrails:",
    "Coverage role: DIRECT | ENABLER | STANDALONE",
    "Delivery graph contract: PASS | FAIL",
    "Scenario coverage: PASS | FAIL",
    "Walking skeleton: PASS | FAIL",
    "Strict-frontier order: PASS | FAIL",
    "Context authority:",
    "Context freshness:",
    "Context conflicts:",
    "Context anchors:",
    "Context economy:",
    "Harness readiness projection",
  ]);
  requireTokens(errors, "skills/admit-ticket/SKILL.md", admission, [
    "herdr-harness:project-readiness:v1",
    "pi-ticket-plan admit readiness",
    "--harness-cli",
    "--harness-config",
    "stable Harness readiness projection",
  ]);
  requireTokens(errors, "skills/triage/AGENT-BRIEF.md", triageBrief, [
    "## Starting state",
    "## Invariants and guardrails",
    "## Coverage role",
    "STANDALONE",
    "## Context anchors",
  ]);
  requireTokens(errors, "skills/to-spec/SKILL.md", toSpec, [
    "PRODUCT_RELEASE",
    "## Release signal mapping",
    "## Walking skeleton target",
    "git show <base>:<release-path>",
  ]);
  requireTokens(errors, "skills/to-tickets/SKILL.md", toTickets, [
    "## Source scenarios",
    "## Coverage role",
    "## Ticket coverage",
    "## Starting state",
    "## Invariants and guardrails",
    "## Execution lane",
    "pi-ticket-planning:delivery-graph:v2",
    "check-delivery-graph.mjs",
    "check-admission-state.mjs",
    "## Context anchors",
  ]);
  requireTokens(errors, "skills/admit-ticket/SKILL.md", admission, [
    "pi-ticket-planning:admission-review:v1",
    "pi-ticket-planning:delivery-graph:v2",
    "check-delivery-graph.mjs",
    "check-admission-state.mjs",
    "check-ticket-context.mjs",
    "pi-ticket-plan admit plan",
    "pi-ticket-plan admit apply",
    "Plan fingerprint",
    "PARTIAL",
    "CONFLICT",
    "contextChecks",
  ]);

  const reviewer = fs.readFileSync(path.join(root, "agents", "ticket-readiness-reviewer.md"), "utf8");
  if (frontmatterValue(reviewer, "defaultContext") !== "fresh") errors.push("reviewer is not fresh by default");
  if (frontmatterValue(reviewer, "skills") !== "ticket-readiness") errors.push("reviewer lacks the ticket-readiness contract");
  if (frontmatterValue(reviewer, "skillPath") !== "../skills") errors.push("reviewer does not pin its package-private skill path");
  if (frontmatterValue(reviewer, "tools") !== "read") errors.push("reviewer must permit only read for its configured skill");
  if (!/^extensions:\s*$/m.test(reviewer)) errors.push("reviewer must explicitly disable ambient extensions");

  const launcher = fs.readFileSync(path.join(root, "profile", "pi-ticket-plan"), "utf8");
  requireTokens(errors, "profile/pi-ticket-plan", launcher, [
    "PI_TICKET_PLANNING_ROOT",
    "PI_TICKET_PLAN_PROFILE_DIR",
    '= "doctor"',
    "scripts/doctor.mjs",
    '= "admit"',
    "scripts/admit.mjs",
    '= "delivery-gate"',
    "scripts/delivery-gate.mjs",
    'exec pi "$@"',
  ]);

  const deliveryGate = fs.readFileSync(path.join(root, "scripts", "delivery-gate.mjs"), "utf8");
  requireTokens(errors, "scripts/delivery-gate.mjs", deliveryGate, [
    "pi-ticket-planning:delivery-gate-plan:v1",
    "pi-ticket-planning:delivery-gate-result:v1",
    "EXPECTED_FINGERPRINT_MISMATCH",
    "EFFECTIVE_GATE_NOT_READY",
  ]);
  if (deliveryGate.includes("pull_request_target")) errors.push("delivery-gate workflow must not use pull_request_target");

  const setupDelivery = fs.readFileSync(path.join(root, "skills", "setup-delivery-repository", "SKILL.md"), "utf8");
  requireTokens(errors, "skills/setup-delivery-repository/SKILL.md", setupDelivery, [
    "canonical validation script",
    "delivery-gate plan",
    "no bypass actors",
    "pull_request_target",
  ]);

  const admit = fs.readFileSync(path.join(root, "scripts", "admit.mjs"), "utf8");
  requireTokens(errors, "scripts/admit.mjs", admit, [
    'const PLAN_SCHEMA = "pi-ticket-planning:admission-plan:v1"',
    'const REVIEW_SCHEMA = "pi-ticket-planning:admission-review:v1"',
    "pi-ticket-planning:reviewed-admission-state:v1",
    "pi-ticket-planning:admission-result:v1",
    "pi-ticket-planning:admission:v1:",
    "EXPECTED_FINGERPRINT_MISMATCH",
    "CONTROLLED_LABEL_DRIFT",
    "HARNESS_CLAIM_DETECTED",
    "WRITE_NOT_COMPLETED",
    "runHarnessReadiness",
    "HARNESS_READINESS_DRIFT",
  ]);

  const readinessReceiptScript = fs.readFileSync(path.join(root, "scripts", "readiness-receipt.mjs"), "utf8");
  const readinessSchema = fs.readFileSync(path.join(root, "schemas", "project-readiness-v1.schema.json"));
  const readinessSchemaDigest = createHash("sha256").update(readinessSchema).digest("hex");
  requireTokens(errors, "scripts/readiness-receipt.mjs", readinessReceiptScript, [
    "herdr-harness:project-readiness:v1",
    "pi-ticket-planning:harness-readiness:v1",
    "runHarnessReadiness",
    "stableHarnessReadiness",
    readinessSchemaDigest,
  ]);

  const graphCheck = fs.readFileSync(path.join(root, "scripts", "check-delivery-graph.mjs"), "utf8");
  requireTokens(errors, "scripts/check-delivery-graph.mjs", graphCheck, [
    "<!-- pi-ticket-planning:delivery-graph:v1 -->",
    "<!-- pi-ticket-planning:delivery-graph:v2 -->",
  ]);

  const contextCheck = fs.readFileSync(path.join(root, "scripts", "check-ticket-context.mjs"), "utf8");
  requireTokens(errors, "scripts/check-ticket-context.mjs", contextCheck, [
    "pi-ticket-planning:ticket-context-check:v1",
    "TOO_MANY_CONTEXT_ANCHORS",
    "CONTEXT_ANCHOR_NOT_BLOB",
    "CONTEXT_CHECK_DIGEST_MISMATCH",
    "verifyCandidateContextChecks",
  ]);

  const installer = fs.readFileSync(path.join(root, "scripts", "install-profile.mjs"), "utf8");
  requireTokens(errors, "scripts/install-profile.mjs", installer, [
    'run(piBin, ["install", UPSTREAM_SOURCE]',
    'run(piBin, ["install", SUBAGENTS_SOURCE]',
    'run(piBin, ["update", "--extensions"]',
    "check-profile.mjs",
  ]);
  if ((fs.statSync(path.join(root, "install.sh")).mode & 0o111) === 0) errors.push("install.sh is not executable");
  if ((fs.statSync(path.join(root, "profile", "pi-ticket-plan")).mode & 0o111) === 0) {
    errors.push("profile launcher is not executable");
  }

  for (const trackerName of ["issue-tracker-github.md", "issue-tracker-gitlab.md", "issue-tracker-local.md"]) {
    const relative = path.join("skills", "setup-delivery-repository", trackerName);
    const trackerText = fs.readFileSync(path.join(root, relative), "utf8");
    requireTokens(errors, relative, trackerText, [
      "pi-ticket-planning:delivery-graph:v2",
      "check-delivery-graph.mjs",
    ]);
  }

  for (const relative of [
    "README.md",
    "README.zh-CN.md",
    "profile/pi-ticket-plan",
    "profile/settings.template.json",
    "scripts/check-profile.mjs",
    "scripts/check-admission-state.mjs",
    "scripts/admit.mjs",
    "scripts/workflow-contract.mjs",
    "scripts/doctor.mjs",
    "scripts/delivery-gate.mjs",
    "scripts/readiness-receipt.mjs",
    "skills/setup-delivery-repository/issue-tracker-github.md",
  ]) {
    const text = fs.readFileSync(path.join(root, relative), "utf8");
    if (/(?:\/Users|\/home)\/[^/$\s]+/.test(text) || /\/opt\/homebrew\/bin\/pi/.test(text)) {
      errors.push(`${relative} contains a maintainer-specific path`);
    }
  }

  const profileCheck = fs.readFileSync(path.join(root, "scripts", "check-profile.mjs"), "utf8");
  requireTokens(errors, "scripts/check-profile.mjs", profileCheck, [
    "REQUIRED_HUMAN_INVOKED",
    "REQUIRED_MODEL_INVOKED",
    "modelInvocationDisabled",
  ]);

  const fixtures = readJson(path.join(root, "fixtures", "admission-cases.json"));
  const verdicts = new Set(fixtures.cases.map((item) => item.expectedVerdict));
  const lanes = new Set(fixtures.cases.map((item) => item.expectedExecutionLane));
  for (const verdict of ["READY", "SPLIT", "NEEDS_INFO"]) {
    if (!verdicts.has(verdict)) errors.push(`missing ${verdict} fixture`);
  }
  for (const lane of ["AGENT", "HUMAN"]) {
    if (!lanes.has(lane)) errors.push(`missing ${lane} execution-lane fixture`);
  }
  if (!fixtures.cases.some((item) => item.expectedVerdict === "READY" && item.expectedExecutionLane === "HUMAN")) {
    errors.push("missing READY/HUMAN fixture");
  }
  for (const item of fixtures.cases) {
    if (!item.candidate?.startingState?.trim()) errors.push(`${item.id}: fixture lacks starting state`);
    if (!Array.isArray(item.candidate?.invariants) || item.candidate.invariants.length === 0) {
      errors.push(`${item.id}: fixture lacks invariants`);
    }
  }
  const graphVerdicts = new Set(fixtures.graphCases?.map((item) => item.expectedGraphVerdict));
  for (const verdict of ["READY", "NEEDS_INFO"]) {
    if (!graphVerdicts.has(verdict)) errors.push(`missing graph ${verdict} fixture`);
  }
  for (const item of fixtures.graphCases ?? []) {
    const actual = validateDeliveryGraph(item).verdict;
    if (actual !== item.expectedGraphVerdict) {
      errors.push(`${item.id}: expected graph verdict ${item.expectedGraphVerdict}, fixture computes ${actual}`);
    }
  }

  return errors;
}

const ownPath = fs.realpathSync(fileURLToPath(import.meta.url));
if (process.argv[1] && fs.realpathSync(process.argv[1]) === ownPath) {
  const root = path.resolve(path.dirname(ownPath), "..");
  const errors = validatePackage(root);
  if (errors.length > 0) {
    for (const error of errors) console.error(`ERROR ${error}`);
    process.exitCode = 1;
  } else {
    console.log("package contract: ok");
  }
}
