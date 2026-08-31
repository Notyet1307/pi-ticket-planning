import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
const PROFILE_ROOT = path.resolve(
  process.env.PI_TICKET_PLAN_PROFILE_DIR ?? path.join(os.homedir(), ".pi", "ticket-planning"),
);
const LAUNCHER = path.resolve(
  process.env.PI_TICKET_PLAN_LAUNCHER ?? path.join(os.homedir(), ".local", "bin", "pi-ticket-plan"),
);
const UPSTREAM = `git:github.com/mattpocock/skills@${JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).mattpocockUpstream.commit}`;
const TEMPLATE = JSON.parse(readFileSync(new URL("../profile/settings.template.json", import.meta.url), "utf8"));
const SUBAGENTS_SOURCE = TEMPLATE.packages.find((entry) => /^git:github\.com\/Notyet1307\/pi-interactive-subagents@[a-f0-9]{40}$/.test(entry?.source ?? ""))?.source;
const FFF_SOURCE = TEMPLATE.packages.find((entry) => /^npm:@ff-labs\/pi-fff@[0-9]+\.[0-9]+\.[0-9]+$/.test(entry?.source ?? ""))?.source;
const REVIEWER_AGENT = path.join("agents", "ticket-readiness-reviewer.md");
const lock = JSON.parse(readFileSync(new URL("../upstream-lock.json", import.meta.url), "utf8"));
const SUPPRESSED_SKILLS = new Set(lock.suppressedSkills ?? []);
const PACKAGE_SKILLS = new Set([...lock.overriddenSkills, ...lock.packageSkills]);
const EXPECTED_SKILLS = new Set([
  ...lock.officialStableSkills.filter((name) => !SUPPRESSED_SKILLS.has(name)),
  ...lock.packageSkills,
]);
const REQUIRED_HUMAN_INVOKED = new Set([
  "ask-yet",
  "to-questionnaire",
  "wayfinder",
]);
const REQUIRED_MODEL_INVOKED = new Set([
  "admit-ticket",
  "diagnosing-bugs",
  "domain-modeling",
  "grilling",
  "prototype",
  "prepare-codex-release",
  "research",
  "setup-delivery-repository",
  "ticket-readiness",
  "to-spec",
  "to-tickets",
  "triage",
]);

const run = spawnSync(
  LAUNCHER,
  ["--mode", "rpc", "--no-session", "--offline", "--no-approve"],
  {
    encoding: "utf8",
    input: '{"type":"get_commands","id":"commands"}\n',
    timeout: 15_000,
    env: { ...process.env, PI_TICKET_PLAN_PROFILE_DIR: PROFILE_ROOT },
  },
);

if (run.error) throw run.error;
if (run.status !== 0) throw new Error(run.stderr || `PI exited ${run.status}`);

const messages = run.stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line));
const response = messages.find((message) => message.id === "commands" && message.type === "response");
if (!response?.success) throw new Error("PI did not return its command catalog");

const commands = response.data.commands;
const skills = commands.filter((command) => command.source === "skill");
const byName = new Map(skills.map((skill) => [skill.name.replace(/^skill:/, ""), skill]));
const failures = [];

for (const name of EXPECTED_SKILLS) {
  if (!byName.has(name)) failures.push(`${name} is missing from the profile`);
}
for (const name of PACKAGE_SKILLS) {
  if (realpathSafe(byName.get(name)?.sourceInfo?.baseDir) !== PACKAGE_ROOT) {
    failures.push(`${name} did not load from the local package`);
  }
}
for (const name of [...SUPPRESSED_SKILLS, "to-release"]) {
  if (byName.has(name)) failures.push(`${name} must not be exposed by the profile`);
}
for (const [name, skill] of byName) {
  if (!EXPECTED_SKILLS.has(name)) failures.push(`${name} is an unexpected profile skill`);
  const source = skill.sourceInfo?.source;
  if (!PACKAGE_SKILLS.has(name) && source !== UPSTREAM) failures.push(`${name} loaded from unexpected source ${source}`);
  if (skill.sourceInfo?.path?.includes("/skills/in-progress/") || skill.sourceInfo?.path?.includes("/skills/misc/")) {
    failures.push(`${name} loaded from an excluded upstream area`);
  }
  if (skill.sourceInfo?.path?.startsWith(path.join(os.homedir(), ".agents"))) {
    failures.push(`${name} leaked from ambient user skills`);
  }
}
for (const name of REQUIRED_HUMAN_INVOKED) {
  if (!modelInvocationDisabled(byName.get(name)?.sourceInfo?.path)) {
    failures.push(`${name} is visible to implicit model invocation`);
  }
}
for (const name of REQUIRED_MODEL_INVOKED) {
  if (modelInvocationDisabled(byName.get(name)?.sourceInfo?.path)) {
    failures.push(`${name} is hidden from the router's model-invoked helper path`);
  }
}

const subagents = commands.find((command) => command.name === "subagent" && command.source === "extension");
if (!SUBAGENTS_SOURCE || subagents?.sourceInfo?.source !== SUBAGENTS_SOURCE) failures.push("pi-interactive-subagents extension is missing or unpinned");
const fff = commands.find((command) => command.name === "fff-mode" && command.source === "extension");
if (!FFF_SOURCE || fff?.sourceInfo?.source !== FFF_SOURCE) failures.push("pi-fff extension is missing or unpinned");

if (readFileSync(path.join(PROFILE_ROOT, "AGENTS.md"), "utf8") !== readFileSync(path.join(PACKAGE_ROOT, "profile", "AGENTS.md"), "utf8")) {
  failures.push("deployed profile AGENTS.md drifted from the package template");
}
if (readFileSync(path.join(PROFILE_ROOT, REVIEWER_AGENT), "utf8") !== readFileSync(path.join(PACKAGE_ROOT, REVIEWER_AGENT), "utf8")) {
  failures.push("deployed reviewer agent drifted from the package definition");
}
if ((statSync(path.join(PROFILE_ROOT, "settings.json")).mode & 0o077) !== 0) {
  failures.push("profile settings must not be group- or world-readable");
}
const settings = JSON.parse(readFileSync(path.join(PROFILE_ROOT, "settings.json"), "utf8"));
const sources = settings.packages?.map((entry) => typeof entry === "string" ? entry : entry.source) ?? [];
if (!sources.includes(SUBAGENTS_SOURCE) || !sources.includes(FFF_SOURCE) || sources.some((source) => /^npm:pi-subagents@/.test(source ?? ""))) {
  failures.push("deployed profile package sources do not match the replacement template");
}
if (settings.subagents !== undefined) failures.push("deployed profile retained legacy pi-subagents settings");

const reviewer = readFileSync(path.join(PROFILE_ROOT, REVIEWER_AGENT), "utf8");
for (const [key, expected] of Object.entries({
  "session-mode": "standalone",
  "system-prompt": "replace",
  "auto-exit": "true",
  skills: "ticket-readiness",
  tools: "review_input_read",
})) {
  if (frontmatterValue(reviewer, key) !== expected) failures.push(`reviewer ${key} must be ${expected}`);
}

if (failures.length) {
  for (const failure of failures) console.error(`ERROR ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`profile configuration: ok (${skills.length} skills, interactive subagents, FFF override default)`);
}

function realpathSafe(value) {
  if (!value) return null;
  try {
    return realpathSync(value);
  } catch {
    return path.resolve(value);
  }
}

function modelInvocationDisabled(file) {
  if (!file) return false;
  const text = readFileSync(file, "utf8");
  const frontmatter = text.startsWith("---\n") ? text.slice(4, text.indexOf("\n---", 4)) : "";
  return /^disable-model-invocation:\s*true\s*$/m.test(frontmatter);
}

function frontmatterValue(text, key) {
  const frontmatter = text.startsWith("---\n") ? text.slice(4, text.indexOf("\n---", 4)) : "";
  return frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1]?.trim();
}
