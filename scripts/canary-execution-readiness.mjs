import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const marker = "HERDR_HARNESS_PROVIDER_OK";

function safeError(value) {
  return String(value ?? "unknown error").replace(/[\0\r\n]+/gu, " ").slice(0, 1_000);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
    timeout: options.timeout ?? 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(safeError(result.error?.message ?? (result.stderr || result.stdout || `${command} exited ${result.status}`)));
  }
  return result.stdout;
}

function executable(file, content) {
  writeFileSync(file, content, { mode: 0o700 });
  chmodSync(file, 0o700);
}

function git(repo, ...args) {
  return run("git", ["-C", repo, ...args]).trim();
}

function parseArgs(argv) {
  if (argv.length !== 2 || argv[0] !== "--harness-root" || !path.isAbsolute(argv[1])) {
    throw new Error("usage: canary-execution-readiness --harness-root /absolute/HerdrHarness-lite");
  }
  return fsRealpath(argv[1]);
}

function fsRealpath(value) {
  try {
    return realpathSync(value);
  } catch {
    throw new Error("Harness root is unavailable");
  }
}

function roleConfig(harnessRoot) {
  return {
    workerArgv: [
      "--no-approve", "--no-skills", "--no-session", "--no-extensions", "--no-context-files", "--no-prompt-templates", "--no-themes",
      "--extension", path.join(harnessRoot, "pi/extensions/worker-tools.js"),
      "--skill", path.join(harnessRoot, "test/fixtures/pi-skills/skills/implement"),
      "--skill", path.join(harnessRoot, "pi/skills/tdd"),
      "--skill", path.join(harnessRoot, "pi/skills/focused-self-check"),
      "--tools", "read,bash,edit,write,grep,find,ls,worker_submit",
      "--thinking", "high",
    ],
    reviewerArgv: [
      "--no-approve", "--no-skills", "--no-session", "--no-extensions", "--no-context-files", "--no-prompt-templates", "--no-themes",
      "--extension", path.join(harnessRoot, "pi/extensions/reviewer-subagent-config.js"),
      "--extension", path.join(harnessRoot, "test/fixtures/pi-subagents/index.js"),
      "--extension", path.join(harnessRoot, "pi/extensions/reviewer-tools.js"),
      "--skill", path.join(harnessRoot, "pi/skills/code-review"),
      "--tools", "read,grep,find,ls,subagent,review_preflight,review_submit",
      "--thinking", "max",
    ],
  };
}

function writeFakeTools(bin) {
  executable(path.join(bin, "pi"), `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(`${marker}\n`)});\n`);
  executable(path.join(bin, "docker"), [
    "#!/usr/bin/env node",
    "const args = process.argv.slice(2);",
    "if (process.env.CANARY_DOCKER_FAIL === '1') { process.stderr.write('docker unavailable\\n'); process.exit(1); }",
    "if (args[0] === 'context' && args[1] === 'inspect') process.stdout.write(JSON.stringify([{Endpoints:{docker:{Host:'unix:///tmp/herdr-canary-docker.sock'}}}]));",
    "else if (args.includes('compose')) process.stdout.write('5.1.2\\n');",
    "else if (args.includes('version')) process.stdout.write('29.4.0\\n');",
    "else { process.stderr.write('unexpected docker command\\n'); process.exit(2); }",
  ].join("\n"));
  executable(path.join(bin, "gh"), [
    "#!/usr/bin/env node",
    "const args = process.argv.slice(2);",
    "if (args[0] !== 'api') { process.stderr.write('unexpected gh command\\n'); process.exit(2); }",
    "const endpoint = args[1];",
    "const gateFail = process.env.CANARY_GATE_FAIL === '1';",
    "if (endpoint === 'repos/owner/readiness-canary') process.stdout.write(JSON.stringify({default_branch:'main',allow_auto_merge:!gateFail,allow_merge_commit:true}));",
    "else if (endpoint === 'repos/owner/readiness-canary/rules/branches/main') process.stdout.write(JSON.stringify(gateFail ? [] : [{type:'required_status_checks',ruleset_id:42,parameters:{strict_required_status_checks_policy:true,required_status_checks:[{context:'herdr-delivery-gate',integration_id:15368}]}},{type:'pull_request',ruleset_id:42,parameters:{required_approving_review_count:0,required_reviewers:[],require_code_owner_review:false,require_last_push_approval:false,allowed_merge_methods:['merge']}}]));",
    "else if (endpoint === 'repos/owner/readiness-canary/rulesets/42') process.stdout.write(JSON.stringify({enforcement:'active',bypass_actors:[]}));",
    "else { process.stderr.write('unexpected endpoint\\n'); process.exit(2); }",
  ].join("\n"));
}

function createProject(root) {
  const source = path.join(root, "source");
  const origin = path.join(root, "origin.git");
  mkdirSync(source);
  run("git", ["init", "--bare", "--quiet", origin]);
  git(source, "init", "--quiet", "-b", "main");
  git(source, "config", "user.email", "canary@example.test");
  git(source, "config", "user.name", "Readiness Canary");
  mkdirSync(path.join(source, "scripts"));
  executable(path.join(source, "scripts/herdr-validate.sh"), [
    "#!/bin/sh",
    "set -eu",
    "test -f .env.test",
    "docker compose version --short >/dev/null",
  ].join("\n"));
  writeFileSync(path.join(source, ".env.test"), "CANARY=1\n");
  writeFileSync(path.join(source, "AGENTS.md"), "# Canary policy\n\nValidation requires the tracked script and local Docker Compose.\n");
  git(source, "add", "AGENTS.md", ".env.test", "scripts/herdr-validate.sh");
  git(source, "commit", "--quiet", "-m", "canary base");
  git(source, "remote", "add", "origin", origin);
  git(source, "push", "--quiet", "-u", "origin", "main");
  return { source, baseSha: git(source, "rev-parse", "HEAD") };
}

function writeHarnessConfig(root, harnessRoot, source) {
  const roles = roleConfig(harnessRoot);
  const configPath = path.join(root, "readiness.harness.json");
  writeFileSync(configPath, `${JSON.stringify({
    repo: "owner/readiness-canary",
    localPath: source,
    baseRef: "main",
    autoMerge: true,
    readyLabel: "ready-for-agent",
    claimLabel: "agent:claimed",
    stateDir: path.join(root, "state"),
    worktreeRoot: path.join(root, "worktrees"),
    maxReviewRounds: 3,
    maxAnalystTurns: 3,
    workerRuntime: "herdr-pi-cli",
    reviewerRuntime: "herdr-pi-cli",
    validation: { totalTimeoutMs: 30_000 },
    termination: { sigtermGraceMs: 1_000, sigkillGraceMs: 1_000 },
    preflight: { piBin: "pi", dockerRequired: true },
    reviewerValidationArgv: ["/bin/sh", "./scripts/herdr-validate.sh"],
    ...roles,
    herdr: { bin: "herdr", session: "readiness-canary" },
    analyst: { command: process.execPath },
  }, null, 2)}\n`, { mode: 0o600 });
  chmodSync(configPath, 0o600);
  return configPath;
}

function admissionReadiness({ harnessCli, configPath, baseSha, env }) {
  return spawnSync(process.execPath, [
    path.join(packageRoot, "scripts/admit.mjs"), "readiness",
    "--repo", "owner/readiness-canary",
    "--base", baseSha,
    "--harness-cli", harnessCli,
    "--harness-config", configPath,
  ], { encoding: "utf8", env, timeout: 120_000, maxBuffer: 1024 * 1024 });
}

function assertRejected(result, label) {
  assert.equal(result.status, 2, `${label}: ${result.stdout}\n${result.stderr}`);
  assert.equal(`${result.stdout}${result.stderr}`.includes("/tmp/herdr-readiness-"), false);
}

function main() {
  const harnessRoot = parseArgs(process.argv.slice(2));
  const harnessCli = path.join(harnessRoot, "dist/src/cli.js");
  const harnessSchema = path.join(harnessRoot, "schemas/project-readiness-v1.schema.json");
  assert.equal(readFileSync(harnessSchema, "utf8"), readFileSync(path.join(packageRoot, "schemas/project-readiness-v1.schema.json"), "utf8"));
  run("npm", ["run", "build"], { cwd: harnessRoot });

  const root = mkdtempSync(path.join(os.tmpdir(), "execution-readiness-canary-"));
  try {
    const bin = path.join(root, "bin");
    const agentDir = path.join(root, "pi-agent");
    mkdirSync(bin);
    mkdirSync(agentDir);
    writeFileSync(path.join(agentDir, "auth.json"), "{}\n", { mode: 0o600 });
    writeFakeTools(bin);
    const project = createProject(root);
    const configPath = writeHarnessConfig(root, harnessRoot, project.source);
    const baseEnv = {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
      PI_CODING_AGENT_DIR: agentDir,
    };

    const passed = admissionReadiness({ harnessCli, configPath, baseSha: project.baseSha, env: baseEnv });
    assert.equal(passed.status, 0, passed.stderr);
    const binding = JSON.parse(passed.stdout);
    assert.equal(binding.readiness.projection.validation.status, "passed");
    assert.equal(binding.readiness.projection.delivery.status, "passed");
    assert.equal(JSON.stringify(binding).includes(root), false);
    assert.equal(existsSync(path.join(root, "state", "state.json")), false);

    assertRejected(admissionReadiness({
      harnessCli,
      configPath,
      baseSha: project.baseSha,
      env: { ...baseEnv, CANARY_GATE_FAIL: "1" },
    }), "gate failure");
    assertRejected(admissionReadiness({
      harnessCli,
      configPath,
      baseSha: project.baseSha,
      env: { ...baseEnv, CANARY_DOCKER_FAIL: "1" },
    }), "Docker failure");

    rmSync(path.join(project.source, ".env.test"));
    git(project.source, "add", "-u");
    git(project.source, "commit", "--quiet", "-m", "remove validation environment");
    git(project.source, "push", "--quiet", "origin", "main");
    const missingEnvironmentSha = git(project.source, "rev-parse", "HEAD");
    assertRejected(admissionReadiness({
      harnessCli,
      configPath,
      baseSha: missingEnvironmentSha,
      env: baseEnv,
    }), "validation environment failure");

    run(process.execPath, ["--test", "--test-concurrency=1", "dist/test/controller-ci-recovery.test.js", "dist/test/github-gh.test.js"], { cwd: harnessRoot });
    run(process.execPath, [
      "--test",
      "test/delivery-gate.test.mjs",
      "test/readiness-receipt.test.mjs",
      "test/admission-plan.test.mjs",
      "test/admission-apply.test.mjs",
    ], { cwd: packageRoot });
    process.stdout.write(`${JSON.stringify({
      ok: true,
      schemaContract: "matched",
      scenarios: [
        "passing",
        "gate-failed",
        "docker-failed",
        "validation-environment-failed",
        "ci-and-ruleset-plan-apply",
        "head-and-gate-runtime-guards",
      ],
      ledgerCreated: existsSync(path.join(root, "state", "state.json")),
    })}\n`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`FAIL: ${safeError(error.message)}\n`);
  process.exitCode = 1;
}
