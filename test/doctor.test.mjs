import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { diagnose, doctorReadiness, renderDoctor } from "../scripts/doctor.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const upstream = "84fdeffd12f2ee307994d1eb6feb48173b6e0502";
const packageSha = "9b87a4b018c8438b31669b174689115020b7deab";
const packageVersion = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;

test("doctor reports one authentication failure and skips dependent remote checks", () => {
  const fixture = profileFixture();
  try {
    const checks = diagnose({
      packageRoot: root,
      targetDir: root,
      env: fixture.env,
      runner: (command, args) => {
        const key = [command, ...args].join(" ");
        if (key === "pi --version") return ok("0.84.1\n");
        if (command === process.execPath && args[0].endsWith("check-profile.mjs")) return ok("profile isolation: ok (27 skills)\n");
        if (key === `git -C ${root} rev-parse HEAD`) return ok(`${packageSha}\n`);
        if (key === `git -C ${root} status --porcelain`) return ok("");
        if (key === "gh --version") return ok("gh version 2.97.0\n");
        if (key === "gh auth status --hostname github.com") return failed("HTTP 401 token gho_do-not-print\n");
        if (key === `git -C ${root} rev-parse --show-toplevel`) return ok(`${root}\n`);
        throw new Error(`unexpected command: ${key}`);
      },
    });
    const output = renderDoctor(checks);
    assert.equal(checks.filter((check) => check.status === "FAIL").length, 1);
    assert.match(output, /FAIL\s+GitHub authentication/u);
    assert.match(output, /Readiness: Planning READY · Admission BLOCKED/u);
    assert.deepEqual(doctorReadiness(checks), { planning: "READY", admission: "BLOCKED", release: "READY" });
    assert.match(output, /SKIP\s+Latest release and main/u);
    assert.doesNotMatch(output, /gho_do-not-print/u);
    assert.doesNotMatch(renderDoctor([{ section: "Test", status: "FAIL", label: "Secret", detail: "https://user:do-not-print@example.com" }]), /do-not-print/u);
  } finally {
    fixture.cleanup();
  }
});

test("doctor checks a GitHub delivery target and isolates one missing label", () => {
  const fixture = profileFixture();
  const target = path.join(fixture.temporary, "target");
  mkdirSync(target);
  const targetRoot = realpathSync(target);
  const policy = "Use docs/agents/delivery-gate.md, docs/agents/issue-tracker.md, and docs/agents/triage-labels.md.\n";
  const labels = ["needs-triage", "ready-for-agent", "ready-for-human", "wontfix"];
  try {
    const checks = diagnose({
      packageRoot: root,
      targetDir: target,
      env: fixture.env,
      runner: (command, args) => {
        const key = [command, ...args].join(" ");
        if (key === "pi --version") return ok("0.84.1\n");
        if (command === process.execPath && args[0].endsWith("check-profile.mjs")) return ok("profile isolation: ok (27 skills)\n");
        if (key === `git -C ${root} rev-parse HEAD`) return ok(`${packageSha}\n`);
        if (key === `git -C ${root} status --porcelain`) return ok("");
        if (key === "gh --version") return ok("gh version 2.97.0\n");
        if (key === "gh auth status --hostname github.com") return ok("");
        if (key === "gh api repos/Notyet1307/pi-ticket-planning/releases/latest --jq .tag_name") return ok(`v${packageVersion}\n`);
        if (key === "gh api repos/Notyet1307/pi-ticket-planning --jq .default_branch") return ok("main\n");
        if (key === "gh api repos/Notyet1307/pi-ticket-planning/commits/main --jq .sha") return ok(`${packageSha}\n`);
        if (key === `git -C ${target} rev-parse --show-toplevel`) return ok(`${targetRoot}\n`);
        if (key === `git -C ${targetRoot} remote get-url origin`) return ok("https://github.com/acme/demo.git\n");
        if (key === "gh repo view acme/demo --json nameWithOwner,defaultBranchRef,hasIssuesEnabled") {
          return ok(JSON.stringify({ nameWithOwner: "acme/demo", defaultBranchRef: { name: "main" }, hasIssuesEnabled: true }));
        }
        if (key.startsWith("gh api repos/acme/demo/contents/")) {
          const relative = decodeURIComponent(key.split("contents/")[1].split("?ref=")[0]);
          if (relative === "AGENTS.md") return content(policy);
          if (relative === "docs/agents/triage-labels.md") return content(labelTable());
          if (["docs/agents/delivery-gate.md", "docs/agents/issue-tracker.md"].includes(relative)) return content(`# ${relative}\n`);
          return failed("gh: Not Found (HTTP 404)\n");
        }
        if (key === "gh label list --repo acme/demo --limit 1000 --json name") return ok(JSON.stringify(labels.map((name) => ({ name }))));
        if (key === "gh issue list --repo acme/demo --state all --limit 1 --json number") return ok("[]");
        if (key === "gh api repos/acme/demo") return ok(JSON.stringify({ allow_auto_merge: true, allow_merge_commit: true }));
        if (key === "gh api repos/acme/demo/rules/branches/main") return ok(JSON.stringify([
          {
            type: "required_status_checks",
            ruleset_id: 71,
            parameters: {
              strict_required_status_checks_policy: true,
              required_status_checks: [{ context: "verify", integration_id: 15368 }],
            },
          },
          {
            type: "pull_request",
            ruleset_id: 71,
            parameters: {
              required_approving_review_count: 0,
              required_reviewers: [],
              require_code_owner_review: false,
              require_last_push_approval: false,
              allowed_merge_methods: ["merge"],
            },
          },
        ]));
        if (key === "gh api repos/acme/demo/rulesets/71") return ok(JSON.stringify({ enforcement: "active", bypass_actors: [] }));
        throw new Error(`unexpected command: ${key}`);
      },
    });
    const failures = checks.filter((check) => check.status === "FAIL");
    assert.deepEqual(failures.map((check) => check.label), ["Missing label: needs-info"]);
    assert.equal(doctorReadiness(checks).planning, "READY");
    assert.equal(doctorReadiness(checks).admission, "BLOCKED");
    assert.equal(checks.find((check) => check.label === "Accepted repository policy")?.status, "PASS");
    assert.equal(checks.find((check) => check.label === "Harness merge rules")?.status, "PASS");
    assert.equal(checks.filter((check) => check.label.endsWith("API") && check.status === "SKIP").length, 2);
  } finally {
    fixture.cleanup();
  }
});

test("profile launcher dispatches doctor help without starting PI", () => {
  const result = spawnSync(path.join(root, "profile", "pi-ticket-plan"), ["doctor", "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Usage: pi-ticket-plan doctor/mu);
});

test("profile launcher dispatches Admission commands without starting PI", () => {
  const result = spawnSync(path.join(root, "profile", "pi-ticket-plan"), ["admit"], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage: readiness .* plan .* apply --plan/u);
});

test("profile launcher dispatches delivery-gate commands without starting PI", () => {
  const result = spawnSync(path.join(root, "profile", "pi-ticket-plan"), ["delivery-gate"], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /delivery-gate plan .* delivery-gate apply/u);
});

function profileFixture() {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "pi-ticket-plan-doctor-"));
  const profileDir = path.join(temporary, "profile");
  const binDir = path.join(temporary, "bin");
  mkdirSync(profileDir);
  mkdirSync(binDir);
  writeFileSync(path.join(profileDir, "settings.json"), `${JSON.stringify({
    packages: [
      { source: `git:github.com/mattpocock/skills@${upstream}` },
      { source: root },
      { source: "git:github.com/Notyet1307/pi-interactive-subagents@f82ee0dbc8a1445c14048a3a73bf669032e08bae" },
    ],
  })}\n`);
  const launcher = path.join(binDir, "pi-ticket-plan");
  symlinkSync(path.join(root, "profile", "pi-ticket-plan"), launcher);
  return {
    temporary,
    env: {
      ...process.env,
      PI_TICKET_PLAN_PROFILE_DIR: profileDir,
      PI_TICKET_PLAN_LAUNCHER: launcher,
    },
    cleanup: () => rmSync(temporary, { recursive: true, force: true }),
  };
}

function labelTable() {
  return [
    "| Role | Label |",
    "|---|---|",
    ...["needs-triage", "needs-info", "ready-for-agent", "ready-for-human", "wontfix"].map((label) => `| \`${label}\` | \`${label}\` |`),
  ].join("\n");
}

function content(text) {
  return ok(JSON.stringify({ type: "file", encoding: "base64", content: Buffer.from(text).toString("base64") }));
}

function ok(stdout) {
  return { status: 0, stdout, stderr: "", error: null };
}

function failed(stderr) {
  return { status: 1, stdout: "", stderr, error: null };
}
