import assert from "node:assert/strict";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PACKAGE_ROOT, writeInstallation } from "../scripts/install-profile.mjs";

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
