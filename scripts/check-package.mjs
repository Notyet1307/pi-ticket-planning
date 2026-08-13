import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateDeliveryGraph } from "./check-delivery-graph.mjs";
import { validateLiveEvalFixture } from "./eval-pi-behavior.mjs";

const EXPECTED_COMMIT = "84fdeffd12f2ee307994d1eb6feb48173b6e0502";
const SCOUT_MODEL = "openai-codex/gpt-5.6-luna";
const SCOUT_THINKING = "max";
const REQUIRED_PACKAGE_SKILLS = [
  "admit-ticket",
  "ask-yet",
  "setup-matt-pocock-skills",
  "ticket-readiness",
  "to-spec",
  "to-tickets",
  "triage",
];
const HUMAN_INVOKED_SKILLS = new Set(["ask-yet"]);
const MODEL_INVOKED_PACKAGE_SKILLS = new Set([
  "admit-ticket",
  "setup-matt-pocock-skills",
  "to-spec",
  "to-tickets",
  "triage",
]);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function frontmatterValue(text, key) {
  return text.match(new RegExp(`^${key}:\\s*["']?([^\\n"']+)`, "m"))?.[1]?.trim();
}

export function validatePackage(root) {
  const errors = [];
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
  if (pkg.scripts?.["verify:ci"] !== "npm run check && npm run check:pi-behavior && npm test") {
    errors.push("package lacks the repository-only CI check");
  }
  if (pkg.scripts?.verify !== "npm run verify:ci && npm run check:profile") {
    errors.push("full verification must include the live Profile check");
  }
  if (pkg.scripts?.["eval:pi"] !== "node scripts/eval-pi-behavior.mjs") {
    errors.push("package does not expose the fresh-process PI behavior eval");
  }

  const releaseTag = `v${pkg.version}`;
  for (const relative of ["README.md", "README.zh-CN.md"]) {
    const text = fs.readFileSync(path.join(root, relative), "utf8");
    if (!text.includes(`git clone --branch ${releaseTag} --depth 1`)) {
      errors.push(`${relative} clone command does not match package version ${releaseTag}`);
    }
    if (!text.includes(`git checkout ${releaseTag}`)) {
      errors.push(`${relative} update command does not match package version ${releaseTag}`);
    }
  }

  const ci = fs.readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
  for (const required of ["actions/checkout@v7", "actions/setup-node@v7", "npm run verify:ci"]) {
    if (!ci.includes(required)) errors.push(`CI workflow lacks ${required}`);
  }

  const upstreamSource = `git:github.com/mattpocock/skills@${EXPECTED_COMMIT}`;
  const upstreamProfile = profile.packages?.find((entry) => entry?.source === upstreamSource);
  const packageProfile = profile.packages?.find((entry) => entry?.source === "__PACKAGE_ROOT__");
  const subagentsProfile = profile.packages?.find((entry) => entry?.source === "npm:pi-subagents@0.42.1");
  if (!upstreamProfile) errors.push("profile does not pin the expected Matt upstream commit");
  if (!packageProfile) errors.push("profile does not expose the package-root install placeholder");
  if (!subagentsProfile) errors.push("profile does not pin pi-subagents 0.42.1");
  if (JSON.stringify(profile.skills) !== JSON.stringify(["!**"])) errors.push("profile must suppress ambient user skills");
  const scoutOverride = profile.subagents?.agentOverrides?.scout;
  if (scoutOverride?.model !== SCOUT_MODEL) errors.push(`profile scout model must be ${SCOUT_MODEL}`);
  if (scoutOverride?.thinking !== SCOUT_THINKING) errors.push(`profile scout thinking must be ${SCOUT_THINKING}`);
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
  for (const dir of dirs) {
    const file = path.join(skillRoot, dir.name, "SKILL.md");
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    const name = frontmatterValue(text, "name");
    const description = frontmatterValue(text, "description");
    names.push(name);
    if (name !== dir.name) errors.push(`${dir.name}: frontmatter name mismatch`);
    if (!description) errors.push(`${dir.name}: missing description`);
    if (/\bTODO\b/.test(text)) errors.push(`${dir.name}: TODO remains`);
    if (HUMAN_INVOKED_SKILLS.has(dir.name) && frontmatterValue(text, "disable-model-invocation") !== "true") {
      errors.push(`${dir.name}: human gate allows implicit model invocation`);
    }
    const metadataFile = path.join(skillRoot, dir.name, "agents", "openai.yaml");
    if (
      HUMAN_INVOKED_SKILLS.has(dir.name)
      && fs.existsSync(metadataFile)
      && !fs.readFileSync(metadataFile, "utf8").includes("allow_implicit_invocation: false")
    ) {
      errors.push(`${dir.name}: UI metadata allows implicit invocation`);
    }
    if (MODEL_INVOKED_PACKAGE_SKILLS.has(dir.name) && frontmatterValue(text, "disable-model-invocation") === "true") {
      errors.push(`${dir.name}: helper is hidden from implicit model invocation`);
    }
    if (
      MODEL_INVOKED_PACKAGE_SKILLS.has(dir.name)
      && fs.existsSync(metadataFile)
      && !fs.readFileSync(metadataFile, "utf8").includes("allow_implicit_invocation: true")
    ) {
      errors.push(`${dir.name}: helper UI metadata blocks implicit invocation`);
    }

    for (const match of text.matchAll(/(?:^|[\s(])\/(?:skill:)?([a-z][a-z0-9-]*)/gm)) {
      const target = match[1];
      if (!loadedSkills.has(target)) errors.push(`${dir.name}: unresolved skill reference /${target}`);
    }
  }

  for (const required of REQUIRED_PACKAGE_SKILLS) {
    if (!names.includes(required)) errors.push(`missing package skill ${required}`);
  }
  if (names.includes("to-release")) errors.push("to-release must remain an internal reference, not a public skill");

  const askYet = fs.readFileSync(path.join(skillRoot, "ask-yet", "SKILL.md"), "utf8");
  const releaseLoop = fs.readFileSync(path.join(skillRoot, "ask-yet", "references", "release-loop.md"), "utf8");
  const executionCloseout = fs.readFileSync(path.join(skillRoot, "ask-yet", "references", "execution-closeout.md"), "utf8");
  const toSpec = fs.readFileSync(path.join(skillRoot, "to-spec", "SKILL.md"), "utf8");
  const toTickets = fs.readFileSync(path.join(skillRoot, "to-tickets", "SKILL.md"), "utf8");
  const setup = fs.readFileSync(path.join(skillRoot, "setup-matt-pocock-skills", "SKILL.md"), "utf8");
  const triage = fs.readFileSync(path.join(skillRoot, "triage", "SKILL.md"), "utf8");
  const triageBrief = fs.readFileSync(path.join(skillRoot, "triage", "AGENT-BRIEF.md"), "utf8");
  const readiness = fs.readFileSync(path.join(skillRoot, "ticket-readiness", "SKILL.md"), "utf8");
  const admission = fs.readFileSync(path.join(skillRoot, "admit-ticket", "SKILL.md"), "utf8");
  for (const required of [
    "references/release-loop.md",
    "references/execution-closeout.md",
    "PRODUCT | DELIVERY | TRIAGE | RISK | INCIDENT",
    "READY_TO_COMMIT",
    "Research Handoff",
    "Repository Contract Impact Review",
    "standing approval for reversible planning mutations",
    "do not re-ask per file, commit, or tracker write",
    "setup-matt-pocock-skills",
    "to-spec",
    "to-tickets",
    "admit-ticket",
    "Stop for the required split and graph approval",
    "Stop for the required activation confirmation",
    "The human needs to remember only",
    "model-invoked helpers",
    "A required stable policy change remains a human decision",
    "ADMITTED",
    "FRAME_WRITE_AWAITING_APPROVAL",
    "NEEDS_RESEARCH",
    "NEEDS_PROTOTYPE",
    "NEEDS_DECISION",
    "AWAITING_EVIDENCE",
    "Checkpoint:",
    "Next:",
    "Need:",
    "Blocked:",
    "system facts, not customer-actor evidence",
    "cannot displace a higher-risk actor",
    "protocol design alone does not advance product evidence",
    "an unborn Git repository",
    "absent facts, not blockers",
    "choose a stack or architecture",
    "Repository bootstrap becomes eligible only after",
    "accepted remote delivery base",
    "remain in `FRAME` until the accepted remote base contains the approved blob",
    "Never route this publication through the implementation Harness",
  ]) {
    if (!askYet.includes(required)) errors.push(`ask-yet lacks required contract: ${required}`);
  }
  for (const obsolete of ["active_release:", "next_command:", "forbidden_transition:"]) {
    if (askYet.includes(obsolete)) errors.push(`ask-yet retains verbose checkpoint field: ${obsolete}`);
  }
  if (askYet.includes("FRAME_RECORDED")) errors.push("ask-yet may not remain in FRAME after the approved artifact write");
  for (const obsolete of [
    "Admission Receipt",
    "ADMISSION_EVIDENCE_ONLY",
    "EVIDENCE_ACTION_NEEDED",
    "EVIDENCE_DESIGNED_NOT_AUTHORIZED",
  ]) {
    if (askYet.includes(obsolete) || releaseLoop.includes(obsolete)) {
      errors.push(`ask-yet runtime retains deferred handoff machinery: ${obsolete}`);
    }
  }
  for (const required of [
    "FACT",
    "ASSUMPTION",
    "DECISION",
    "UNKNOWN",
    "CAPABILITY_GAP",
    "AGENTS.override.md",
    "COMMITTED",
    "ACHIEVED",
    "from_revision",
    "target_revision",
    "explicit write approval",
    "Router `stage`",
    "isolated shadow",
    "stable Scenario IDs",
    "Scenario-coverage",
    "Use Git as the durability boundary",
    "cannot feed `to-spec`",
    "cannot publish the Release or setup needed to reach Admission",
    "standing automation approval",
    "do not request permission for each file, commit, or tracker mutation",
    "Ticket-graph publication and Admission activation",
  ]) {
    if (!releaseLoop.includes(required)) errors.push(`release-loop lacks required contract: ${required}`);
  }
  for (const required of [
    "Authority by fact",
    "never runs a planning daemon",
    "HANDOFF_READY",
    "IN_PROGRESS",
    "DELIVERED",
    "A merged PR without Harness terminal success is not enough",
    "Before the evidence window",
    "all intended child tickets are terminal",
    "Do not repeat the entire Release",
  ]) {
    if (!executionCloseout.includes(required)) errors.push(`execution-closeout lacks required contract: ${required}`);
  }
  if (/apply the `?ready-for-agent/i.test(toSpec)) errors.push("to-spec directly applies ready-for-agent");
  if (/Status:\s*ready-for-agent/i.test(toTickets)) errors.push("to-tickets publishes ready candidates");
  if (/trust them and apply/i.test(triage)) errors.push("triage retains the upstream direct-ready bypass");
  if (!readiness.includes("Execution lane: AGENT | HUMAN")) errors.push("ticket-readiness lacks the execution-lane output");
  if (!readiness.includes("cannot be completed and pass its primary verification independently")) {
    errors.push("ticket-readiness uses the wrong blocker boundary");
  }
  for (const required of ["Starting state:", "Invariants and guardrails:"]) {
    if (!readiness.includes(required)) errors.push(`ticket-readiness lacks execution context: ${required}`);
  }
  for (const required of [
    "choose the first correct action from the ticket plus repository policy",
    "never the only copy of behavior or a guardrail required to start",
  ]) {
    if (!readiness.includes(required)) errors.push(`ticket-readiness hides required execution context: ${required}`);
  }
  for (const required of ["## Starting state", "## Invariants and guardrails"]) {
    if (!triageBrief.includes(required)) errors.push(`triage brief lacks execution context: ${required}`);
  }
  if (!triageBrief.includes("choose the first correct action from this brief and repository policy")) {
    errors.push("triage brief depends on hidden tracker context");
  }
  for (const required of [
    "PRODUCT_RELEASE",
    "stable Scenario ID",
    "explicit entry state or external input",
    "## Release signal mapping",
    "## Walking skeleton target",
    "exact base SHA",
    "git show <base>:<release-path>",
  ]) {
    if (!toSpec.includes(required)) errors.push(`to-spec lacks source/scenario contract: ${required}`);
  }
  for (const required of [
    "Scenario coverage: PASS | FAIL",
    "Walking skeleton: PASS | FAIL",
    "## Source scenarios",
    "## Coverage role",
    "## Ticket coverage",
    "follow the `admit-ticket` helper in the same run",
    "explicit activation confirmation",
    "Do not qualify a `READY` verdict",
    "Every member must be individually `READY`",
    "Entry -> exit / handoff",
    "Do not infer an omitted producer",
    "read them directly in the main context",
    "Search for no sidecar",
    "pi-ticket-planning:delivery-graph:v1",
    "check-delivery-graph.mjs",
    "Do not persist a duplicate prose matrix",
    "## Starting state",
    "## Invariants and guardrails",
    "choose the first correct action from it and repository policy",
  ]) {
    if (!toTickets.includes(required)) errors.push(`to-tickets lacks coverage contract: ${required}`);
  }
  for (const required of [
    "Coverage role: DIRECT | ENABLER | STANDALONE",
    "Delivery graph contract: PASS | FAIL",
    "Scenario coverage: PASS | FAIL",
    "Walking skeleton: PASS | FAIL",
    "every intended candidate to be individually READY",
    "broken or inferred handoff",
  ]) {
    if (!readiness.includes(required)) errors.push(`ticket-readiness lacks coverage contract: ${required}`);
  }
  for (const required of [
    "Matrix Scenario IDs equal the parent Scenario IDs",
    "pi-ticket-planning:delivery-graph:v1",
    "check-delivery-graph.mjs",
    "Delivery graph contract: PASS | FAIL",
    "artifacts: false",
    "mission: false",
    "The readiness verdict is the gate output",
    "Scenario coverage: PASS | FAIL",
    "Walking skeleton: PASS | FAIL",
    "Re-run the Delivery Graph checker",
    "no admission check invents a missing handoff",
    "trusted source revision, repository base SHA, effective policy identity",
    "For a delivery map, include all four graph verdicts",
    "creates no additional artifact",
  ]) {
    if (!admission.includes(required)) errors.push(`admit-ticket lacks coverage recheck: ${required}`);
  }
  for (const required of [
    "`GREENFIELD`",
    "exact COMMITTED Release",
    "never use `git add .`",
    "application scaffold",
    "authorized paths",
    "exact base SHA",
    "accepted remote base contains every required configuration blob",
    "Never route prerequisite setup through the implementation Harness",
  ]) {
    if (!setup.includes(required)) errors.push(`setup lacks greenfield contract: ${required}`);
  }
  if (!admission.includes("On READY + AGENT") || !admission.includes("On READY + HUMAN")) {
    errors.push("admit-ticket does not apply both execution lanes");
  }
  if (pkg.scripts?.["check:frontier"] !== "node scripts/check-frontier-order.mjs") {
    errors.push("package does not expose the strict-frontier check");
  }
  if (pkg.scripts?.["check:delivery-graph"] !== "node scripts/check-delivery-graph.mjs") {
    errors.push("package does not expose the delivery-graph check");
  }
  if (!toTickets.includes("stable topological order")) errors.push("to-tickets does not topologically order children");
  if (!readiness.includes("Strict-frontier order: PASS | FAIL")) {
    errors.push("ticket-readiness lacks the strict-frontier graph verdict");
  }
  if (!admission.includes("strict-frontier order check")) errors.push("admit-ticket omits strict-frontier checks");
  if (!toTickets.includes("## Execution lane")) errors.push("to-tickets omits execution lane from candidate bodies");
  if (!triage.includes("ready-for-agent or ready-for-human transition")) {
    errors.push("triage does not route both ready labels through admission");
  }
  if (!triage.includes("continue to `admit-ticket`") || !triage.includes("does not bypass fresh review or its later mutation confirmation")) {
    errors.push("triage does not continue through the model-invoked Admission helper");
  }

  const toSpecMetadata = fs.readFileSync(path.join(skillRoot, "to-spec", "agents", "openai.yaml"), "utf8");
  if (!toSpecMetadata.includes("exact COMMITTED Release or decision-complete source")) {
    errors.push("to-spec UI prompt accepts an untrusted conversational source");
  }
  const toTicketsMetadata = fs.readFileSync(path.join(skillRoot, "to-tickets", "agents", "openai.yaml"), "utf8");
  if (!toTicketsMetadata.includes("stop for graph approval, then continue to Admission")) {
    errors.push("to-tickets UI prompt does not preserve the graph gate before automatic Admission");
  }

  const reviewer = fs.readFileSync(path.join(root, "agents", "ticket-readiness-reviewer.md"), "utf8");
  if (frontmatterValue(reviewer, "defaultContext") !== "fresh") errors.push("reviewer is not fresh by default");
  if (frontmatterValue(reviewer, "skills") !== "ticket-readiness") errors.push("reviewer lacks the ticket-readiness contract");
  if (frontmatterValue(reviewer, "skillPath") !== "../skills") errors.push("reviewer does not pin its package-private skill path");
  if (frontmatterValue(reviewer, "tools") !== "read") errors.push("reviewer must permit only read for its configured skill");
  if (!/^extensions:\s*$/m.test(reviewer)) errors.push("reviewer must explicitly disable ambient extensions");
  if (!reviewer.includes("READY/HUMAN, not NEEDS_INFO")) errors.push("reviewer conflates human execution with missing information");
  if (!reviewer.includes("normalized Delivery Graph snapshot")) errors.push("reviewer uses a stale graph input contract");
  if (!reviewer.includes('"level":"none"') || !reviewer.includes("Use `read` for no other path")) {
    errors.push("reviewer cannot load only its configured skill without a redundant acceptance wrapper");
  }

  const launcher = fs.readFileSync(path.join(root, "profile", "pi-ticket-plan"), "utf8");
  if (!launcher.includes("PI_TICKET_PLANNING_ROOT") || !launcher.includes("PI_TICKET_PLAN_PROFILE_DIR")) {
    errors.push("launcher does not select the portable dedicated profile");
  }
  if (!launcher.includes('exec pi "$@"')) errors.push("launcher does not resolve Pi from PATH");

  const installer = fs.readFileSync(path.join(root, "scripts", "install-profile.mjs"), "utf8");
  if (!installer.includes('run(piBin, ["install", UPSTREAM_SOURCE]') || !installer.includes('run(piBin, ["install", SUBAGENTS_SOURCE]')) {
    errors.push("installer does not explicitly install both remote profile packages");
  }
  if (!installer.includes('run(piBin, ["update", "--extensions"]')) {
    errors.push("installer does not reconcile pinned profile packages");
  }
  if (!installer.includes("check-profile.mjs")) errors.push("installer does not verify the installed profile");
  if ((fs.statSync(path.join(root, "install.sh")).mode & 0o111) === 0) errors.push("install.sh is not executable");
  if ((fs.statSync(path.join(root, "profile", "pi-ticket-plan")).mode & 0o111) === 0) {
    errors.push("profile launcher is not executable");
  }

  const tracker = fs.readFileSync(path.join(skillRoot, "setup-matt-pocock-skills", "issue-tracker-github.md"), "utf8");
  if (!tracker.includes('$PI_TICKET_PLANNING_ROOT/scripts/check-frontier-order.mjs')) {
    errors.push("GitHub frontier check is not package-root portable");
  }
  for (const trackerName of ["issue-tracker-github.md", "issue-tracker-gitlab.md", "issue-tracker-local.md"]) {
    const trackerText = fs.readFileSync(path.join(skillRoot, "setup-matt-pocock-skills", trackerName), "utf8");
    if (!trackerText.includes("pi-ticket-planning:delivery-graph:v1") || !trackerText.includes("check-delivery-graph.mjs")) {
      errors.push(`${trackerName} lacks the normalized Delivery Graph check`);
    }
  }

  for (const relative of [
    "README.md",
    "README.zh-CN.md",
    "profile/pi-ticket-plan",
    "profile/settings.template.json",
    "scripts/check-profile.mjs",
    "skills/setup-matt-pocock-skills/issue-tracker-github.md",
  ]) {
    const text = fs.readFileSync(path.join(root, relative), "utf8");
    const absoluteHome = new RegExp(String.raw`/(?:Users|home)/[^/$\s]+`);
    const fixedPiBinary = new RegExp(String.raw`/opt/homebrew/bin/` + "pi");
    if (absoluteHome.test(text) || fixedPiBinary.test(text)) {
      errors.push(`${relative} contains a maintainer-specific path`);
    }
  }

  const routing = fs.readFileSync(path.join(root, "profile", "AGENTS.md"), "utf8");
  for (const required of [
    "small set of already-named authoritative files",
    "bounded multi-file fact retrieval",
    "only when the source set is large enough",
    "ambiguous or conflicting",
  ]) {
    if (!routing.includes(required)) errors.push(`profile AGENTS.md lacks routing rule: ${required}`);
  }
  const profileCheck = fs.readFileSync(path.join(root, "scripts", "check-profile.mjs"), "utf8");
  for (const required of ["REQUIRED_HUMAN_INVOKED", "REQUIRED_MODEL_INVOKED", "modelInvocationDisabled"]) {
    if (!profileCheck.includes(required)) errors.push(`profile check lacks invocation verification: ${required}`);
  }

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

  for (const error of validateLiveEvalFixture(readJson(path.join(root, "fixtures", "pi-live-eval-cases.json")))) {
    errors.push(`live PI eval fixture: ${error}`);
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
