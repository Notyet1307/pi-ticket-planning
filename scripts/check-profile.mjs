import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PACKAGE_ROOT = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
const PROFILE_ROOT = path.resolve(
  process.env.PI_TICKET_PLAN_PROFILE_DIR ?? path.join(os.homedir(), ".pi", "ticket-planning"),
);
const LAUNCHER = path.resolve(
  process.env.PI_TICKET_PLAN_LAUNCHER ?? path.join(os.homedir(), ".local", "bin", "pi-ticket-plan"),
);
const SCOUT_MODEL = "openai-codex/gpt-5.6-luna:max";
const UPSTREAM = `git:github.com/mattpocock/skills@${JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).mattpocockUpstream.commit}`;
const TEMPLATE = JSON.parse(readFileSync(new URL("../profile/settings.template.json", import.meta.url), "utf8"));
const SUBAGENTS_SOURCE = TEMPLATE.packages.find((entry) => /^npm:pi-subagents@/.test(entry?.source ?? ""))?.source;
const REVIEWER_READ_GUARD = realpathSync(path.join(PACKAGE_ROOT, "extensions", "ticket-readiness-read-guard.mjs"));
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

const subagents = commands.find((command) => command.name === "subagents" && command.source === "extension");
if (!SUBAGENTS_SOURCE || subagents?.sourceInfo?.source !== SUBAGENTS_SOURCE) failures.push("pi-subagents extension is missing or unpinned");

if (readFileSync(path.join(PROFILE_ROOT, "AGENTS.md"), "utf8") !== readFileSync(path.join(PACKAGE_ROOT, "profile", "AGENTS.md"), "utf8")) {
  failures.push("deployed profile AGENTS.md drifted from the package template");
}
if ((statSync(path.join(PROFILE_ROOT, "settings.json")).mode & 0o077) !== 0) {
  failures.push("profile settings must not be group- or world-readable");
}

process.env.PI_CODING_AGENT_DIR = PROFILE_ROOT;
process.env.PI_OFFLINE = "1";
const jitiPath = path.join(PROFILE_ROOT, "npm", "node_modules", "jiti", "lib", "jiti.mjs");
const { createJiti } = await import(pathToFileURL(jitiPath).href);
const jiti = createJiti(import.meta.url);
const { resolveSubagentLaunchContract } = await jiti.import(
  path.join(PROFILE_ROOT, "npm", "node_modules", "pi-subagents", "src", "api", "preflight.ts"),
);
const preflight = await resolveSubagentLaunchContract({
  agent: "ticket-readiness-reviewer",
  cwd: process.cwd(),
  artifacts: false,
});
if (!preflight.ok) {
  failures.push(`reviewer preflight failed: ${preflight.message}`);
} else {
  const contract = preflight.contract;
  if (contract.context !== "fresh") failures.push("reviewer launch context is not fresh");
  if (contract.systemPromptMode !== "replace") failures.push("reviewer does not replace the inherited system prompt");
  if (contract.inheritProjectContext || contract.inheritSkills) failures.push("reviewer inherits ambient context");
  if (realpathSafe(contract.skills.resolved[0]?.path) !== path.join(PACKAGE_ROOT, "skills", "ticket-readiness", "SKILL.md")) {
    failures.push("reviewer did not resolve its package-private readiness contract");
  }
  if (!contract.tools.explicitAllowlist || JSON.stringify(contract.tools.effectiveAllowlist) !== JSON.stringify(["read"])) {
    failures.push("reviewer launch contract must permit only read");
  }
  if (!contract.tools.disableAmbientExtensions) failures.push("reviewer launch contract permits ambient extensions");
  if (JSON.stringify(contract.tools.configuredExtensions.map(realpathSafe)) !== JSON.stringify([REVIEWER_READ_GUARD])) {
    failures.push("reviewer launch contract lacks its sole package-private read guard");
  }
  if (!contract.tools.extensionArgs.map(realpathSafe).includes(REVIEWER_READ_GUARD)) {
    failures.push("reviewer child does not load the package-private read guard");
  }
}

const scoutPreflight = await resolveSubagentLaunchContract({
  agent: "scout",
  cwd: process.cwd(),
  artifacts: false,
  parentModel: { provider: "openai-codex", id: "gpt-5.6-sol" },
  availableModels: [
    { provider: "openai-codex", id: "gpt-5.6-luna" },
    { provider: "openai-codex", id: "gpt-5.6-sol" },
  ],
});
if (!scoutPreflight.ok) {
  failures.push(`scout preflight failed: ${scoutPreflight.message}`);
} else {
  if (scoutPreflight.contract.model !== SCOUT_MODEL) failures.push(`scout model is not ${SCOUT_MODEL}`);
  if (scoutPreflight.contract.thinking !== "max") failures.push("scout thinking is not max");
  if (scoutPreflight.contract.tools.extensionArgs.map(realpathSafe).includes(REVIEWER_READ_GUARD)) {
    failures.push("reviewer read guard leaked into scout children");
  }
}

if (failures.length) {
  for (const failure of failures) console.error(`ERROR ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`profile isolation: ok (${skills.length} skills)`);
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
