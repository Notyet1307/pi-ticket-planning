import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_COMMIT = "84fdeffd12f2ee307994d1eb6feb48173b6e0502";
const SCOUT_MODEL = "openai-codex/gpt-5.6-luna";
const SCOUT_THINKING = "max";
const REQUIRED_PACKAGE_SKILLS = [
  "admit-ticket",
  "setup-matt-pocock-skills",
  "ticket-readiness",
  "to-spec",
  "to-tickets",
  "triage",
];

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
  const loadedSkills = new Set([...lock.officialStableSkills, ...lock.packageSkills]);

  if (pkg.mattpocockUpstream?.commit !== EXPECTED_COMMIT) errors.push("package.json upstream commit drifted");
  if (lock.commit !== EXPECTED_COMMIT) errors.push("upstream-lock.json commit drifted");
  if (pkg.mattpocockUpstream?.updatePolicy !== "manual") errors.push("upstream policy must remain manual");

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

    for (const match of text.matchAll(/(?:^|[\s(])\/([a-z][a-z0-9-]*)/gm)) {
      const target = match[1];
      if (!loadedSkills.has(target)) errors.push(`${dir.name}: unresolved skill reference /${target}`);
    }
  }

  for (const required of REQUIRED_PACKAGE_SKILLS) {
    if (!names.includes(required)) errors.push(`missing package skill ${required}`);
  }

  const toSpec = fs.readFileSync(path.join(skillRoot, "to-spec", "SKILL.md"), "utf8");
  const toTickets = fs.readFileSync(path.join(skillRoot, "to-tickets", "SKILL.md"), "utf8");
  const triage = fs.readFileSync(path.join(skillRoot, "triage", "SKILL.md"), "utf8");
  const readiness = fs.readFileSync(path.join(skillRoot, "ticket-readiness", "SKILL.md"), "utf8");
  const admission = fs.readFileSync(path.join(skillRoot, "admit-ticket", "SKILL.md"), "utf8");
  if (/apply the `?ready-for-agent/i.test(toSpec)) errors.push("to-spec directly applies ready-for-agent");
  if (/Status:\s*ready-for-agent/i.test(toTickets)) errors.push("to-tickets publishes ready candidates");
  if (/trust them and apply/i.test(triage)) errors.push("triage retains the upstream direct-ready bypass");
  if (!readiness.includes("Execution lane: AGENT | HUMAN")) errors.push("ticket-readiness lacks the execution-lane output");
  if (!readiness.includes("cannot be completed and pass its primary verification independently")) {
    errors.push("ticket-readiness uses the wrong blocker boundary");
  }
  if (!admission.includes("On READY + AGENT") || !admission.includes("On READY + HUMAN")) {
    errors.push("admit-ticket does not apply both execution lanes");
  }
  if (pkg.scripts?.["check:frontier"] !== "node scripts/check-frontier-order.mjs") {
    errors.push("package does not expose the strict-frontier check");
  }
  if (!toTickets.includes("stable topological order")) errors.push("to-tickets does not topologically order children");
  if (!readiness.includes("Strict-frontier order: PASS | FAIL")) {
    errors.push("ticket-readiness lacks the strict-frontier graph verdict");
  }
  if (!admission.includes("Re-run the strict-frontier order check")) {
    errors.push("admit-ticket does not recheck strict-frontier order before activation");
  }
  if (!toTickets.includes("## Execution lane")) errors.push("to-tickets omits execution lane from candidate bodies");
  if (!triage.includes("ready-for-agent or ready-for-human transition")) {
    errors.push("triage does not route both ready labels through admission");
  }

  const reviewer = fs.readFileSync(path.join(root, "agents", "ticket-readiness-reviewer.md"), "utf8");
  if (frontmatterValue(reviewer, "defaultContext") !== "fresh") errors.push("reviewer is not fresh by default");
  if (frontmatterValue(reviewer, "skills") !== "ticket-readiness") errors.push("reviewer lacks the ticket-readiness contract");
  if (frontmatterValue(reviewer, "skillPath") !== "../skills") errors.push("reviewer does not pin its package-private skill path");
  if (!/^tools:\s*$/m.test(reviewer)) errors.push("reviewer must explicitly disable tools");
  if (!/^extensions:\s*$/m.test(reviewer)) errors.push("reviewer must explicitly disable ambient extensions");
  if (!reviewer.includes("READY/HUMAN, not NEEDS_INFO")) errors.push("reviewer conflates human execution with missing information");

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

  for (const relative of [
    "README.md",
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
  for (const required of ["one obvious read or search command", "bounded multi-file fact retrieval", "ambiguous or conflicting"]) {
    if (!routing.includes(required)) errors.push(`profile AGENTS.md lacks routing rule: ${required}`);
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

  return errors;
}

const ownPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === ownPath) {
  const root = path.resolve(path.dirname(ownPath), "..");
  const errors = validatePackage(root);
  if (errors.length > 0) {
    for (const error of errors) console.error(`ERROR ${error}`);
    process.exitCode = 1;
  } else {
    console.log("package contract: ok");
  }
}
