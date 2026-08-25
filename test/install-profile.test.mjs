import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PACKAGE_ROOT, writeInstallation } from "../scripts/install-profile.mjs";
import { applyInstallation, applyRollback, inspectInstallation, planInstallation, planRollback, recoverInstallation } from "../installation/manager.mjs";

test("profile installation is isolated, portable, and preserves unrelated preferences", () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "pi-ticket-planning-"));
  const profileDir = path.join(temporary, "profile");
  const binDir = path.join(temporary, "bin");
  const defaultProfileDir = path.join(temporary, "default-profile");

  try {
    mkdirSync(defaultProfileDir, { recursive: true });
    writeFileSync(path.join(defaultProfileDir, "auth.json"), "{}\n", { mode: 0o600 });
    writeFileSync(path.join(defaultProfileDir, "models.json"), "{}\n", { mode: 0o600 });

    const first = writeInstallation({ profileDir, binDir, defaultProfileDir });
    const settingsFile = path.join(profileDir, "settings.json");
    const settings = JSON.parse(readFileSync(settingsFile, "utf8"));
    assert.equal(settings.packages.find((entry) => entry.source === PACKAGE_ROOT)?.source, PACKAGE_ROOT);
    assert.deepEqual(
      settings.subagents.agentOverrides["ticket-readiness-reviewer"].subagentOnlyExtensions,
      [path.join(PACKAGE_ROOT, "extensions", "ticket-readiness-read-guard.mjs")],
    );
    assert.equal(lstatSync(first.launcher).isSymbolicLink(), true);
    assert.equal(path.resolve(binDir, readlinkSync(first.launcher)), path.join(PACKAGE_ROOT, "profile", "pi-ticket-plan"));
    assert.equal(lstatSync(first.controlLauncher).isSymbolicLink(), true);
    assert.equal(path.resolve(binDir, readlinkSync(first.controlLauncher)), path.join(PACKAGE_ROOT, "profile", "pi-ticket-plan"));
    assert.equal(lstatSync(path.join(profileDir, "auth.json")).isSymbolicLink(), true);
    assert.equal(lstatSync(path.join(profileDir, "models.json")).isSymbolicLink(), true);
    assert.equal(lstatSync(settingsFile).mode & 0o777, 0o600);
    const manifest = JSON.parse(readFileSync(path.join(profileDir, "installation.json"), "utf8"));
    assert.equal(manifest.piVersion, "UNTESTED");
    assert.equal(JSON.stringify(manifest).match(/auth\.json|models\.json|"(?:token|credential)"\s*:/i), null);

    settings.theme = "dark";
    settings.packages = [];
    writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
    chmodSync(settingsFile, 0o600);
    const second = writeInstallation({ profileDir, binDir, defaultProfileDir });
    assert.equal(JSON.parse(readFileSync(settingsFile, "utf8")).theme, "dark");
    assert.equal(second.backups.length, 1);
    assert.equal(readFileSync(second.backups[0], "utf8").includes('"theme": "dark"'), true);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("installation plans are dry-run first, fail closed on managed drift, and rollback locally", () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "pi-ticket-planning-"));
  const profileDir = path.join(temporary, "profile");
  const clock = () => new Date("2026-08-25T00:00:00.000Z");
  try {
    const initial = planInstallation({ profileDir, files: [{ path: "AGENTS.md", content: "one\n", mode: 0o644 }], metadata: { packageVersion: "0.4.0" }, clock });
    assert.equal(initial.dryRun, true);
    assert.equal(existsSync(path.join(profileDir, "AGENTS.md")), false);
    applyInstallation(initial);
    writeFileSync(path.join(profileDir, "AGENTS.md"), "local\n");
    const update = planInstallation({ profileDir, files: [{ path: "AGENTS.md", content: "two\n" }], clock });
    assert.equal(update.status, "CONFLICT");
    assert.equal(update.ok, false);
    writeFileSync(path.join(profileDir, "AGENTS.md"), "one\n");
    const rollback = planRollback({ profileDir, clock });
    assert.equal(rollback.dryRun, true);
    applyRollback(rollback);
    assert.equal(existsSync(path.join(profileDir, "installation.json")), false);
    assert.equal(existsSync(path.join(profileDir, "AGENTS.md")), false);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test("interrupted installation retains a private transaction for recovery", () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "pi-ticket-planning-"));
  const profileDir = path.join(temporary, "profile");
  try {
    const plan = planInstallation({ profileDir, files: [{ path: "AGENTS.md", content: "one\n" }] });
    assert.throws(() => applyInstallation(plan, { failpoint: "after:AGENTS.md" }), /interrupted/);
    assert.equal(existsSync(path.join(plan.transactionDir, "transaction.json")), true);
    assert.equal(recoverInstallation({ profileDir, transactionDir: plan.transactionDir }).status, "RECOVERED");
    assert.equal(existsSync(path.join(profileDir, "AGENTS.md")), false);
    assert.equal(inspectInstallation({ profileDir }).status, "UNINSTALLED");
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test("installation paths stay contained and rollback targets an exact retained installation", () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "pi-ticket-planning-"));
  const profileDir = path.join(temporary, "profile");
  const clock = () => new Date("2026-08-25T00:00:00.000Z");
  try {
    assert.throws(
      () => planInstallation({ profileDir, files: [{ path: "../escape", content: "x" }], clock }),
      /unsafe managed path/,
    );
    const first = planInstallation({ profileDir, files: [{ path: "AGENTS.md", content: "one\n", mode: 0o644 }], clock });
    applyInstallation(first);
    const second = planInstallation({ profileDir, files: [{ path: "AGENTS.md", content: "two\n", mode: 0o644 }], clock });
    applyInstallation(second);
    const rollback = planRollback({ profileDir, to: first.manifest.installationId, clock });
    assert.equal(rollback.rollbackTo, first.manifest.installationId);
    applyRollback(rollback);
    assert.equal(readFileSync(path.join(profileDir, "AGENTS.md"), "utf8"), "one\n");
    assert.equal(existsSync(path.join(profileDir, "installation.json")), true);

    rmSync(path.join(profileDir, "AGENTS.md"));
    symlinkSync(path.join(profileDir, "installation.json"), path.join(profileDir, "AGENTS.md"));
    assert.throws(
      () => planInstallation({ profileDir, files: [{ path: "AGENTS.md", content: "safe\n" }], clock, operation: "rollback" }),
      /unsafe managed file/,
    );
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test("pi-ticket-planctl update is dry-run by default", () => {
  const temporary = mkdtempSync(path.join(os.tmpdir(), "pi-ticket-planning-cli-"));
  const profileDir = path.join(temporary, "profile");
  try {
    const run = spawnSync(process.execPath, ["scripts/planctl.mjs", "update", "--dry-run", "--json"], {
      cwd: PACKAGE_ROOT,
      env: { ...process.env, PI_TICKET_PLAN_PROFILE_DIR: profileDir },
      encoding: "utf8",
    });
    assert.equal(run.status, 0, run.stderr);
    const envelope = JSON.parse(run.stdout);
    assert.equal(envelope.command, "installation.update");
    assert.equal(envelope.data.applied, false);
    assert.equal(existsSync(path.join(profileDir, "installation.json")), false);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
