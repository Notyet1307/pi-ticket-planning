import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const APP = /^[A-Za-z0-9_.-]{1,100}$/;
const EXPECTED_PERMISSIONS = ["issues:write", "metadata:read"];
const AUTHORIZATIONS = new WeakMap();

export function repositoryFromRemote(value) {
  return value?.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/i)?.slice(1, 3).join("/") ?? null;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical(value)), "utf8").digest("hex")}`;
}

function bindingProjection(value) {
  return {
    schema: "pi-ticket-planning:github-app-credential-binding:v1",
    action: "actions/create-github-app-token@v3",
    appSlug: value.appSlug,
    installationId: value.installationId,
    targetRepo: value.targetRepo,
    permissions: [...value.permissions].sort(),
  };
}

function tokenBinding(token, projection) {
  return `sha256:${createHmac("sha256", token).update(JSON.stringify(canonical(projection)), "utf8").digest("hex")}`;
}

export function writeGitHubAppCredentialBinding({ file, token, appSlug, installationId, targetRepo, permissions = EXPECTED_PERMISSIONS }) {
  if (!token || !APP.test(appSlug ?? "") || !/^[1-9][0-9]*$/.test(installationId ?? "") || !REPO.test(targetRepo ?? "")
    || JSON.stringify([...permissions].sort()) !== JSON.stringify(EXPECTED_PERMISSIONS)) throw new Error("DISPOSABLE_APP_AUTH_IDENTITY_INVALID");
  const projection = bindingProjection({ appSlug, installationId, targetRepo, permissions });
  const binding = { ...projection, tokenBinding: tokenBinding(token, projection) };
  const resolved = path.resolve(file);
  fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(resolved), 0o700);
  fs.writeFileSync(resolved, `${JSON.stringify(binding)}\n`, { flag: "wx", mode: 0o600 });
  return binding;
}

function readGitHubAppCredentialBinding(file, token) {
  const requested = path.resolve(file ?? "");
  const metadata = fs.lstatSync(requested);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || (metadata.mode & 0o777) !== 0o600) throw new Error("DISPOSABLE_APP_AUTH_BINDING_UNSAFE");
  const binding = JSON.parse(fs.readFileSync(requested, "utf8"));
  const projection = bindingProjection(binding);
  if (JSON.stringify(Object.keys(binding).sort()) !== JSON.stringify([...Object.keys(projection), "tokenBinding"].sort())
    || JSON.stringify(bindingProjection(projection)) !== JSON.stringify(projection)
    || !/^sha256:[a-f0-9]{64}$/.test(binding.tokenBinding ?? "")) throw new Error("DISPOSABLE_APP_AUTH_BINDING_INVALID");
  const expected = Buffer.from(tokenBinding(token, projection));
  const actual = Buffer.from(binding.tokenBinding);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("DISPOSABLE_APP_TOKEN_BINDING_MISMATCH");
  return projection;
}

export function verifyDisposableGitHubAppAuth({ env, repo, sourceRepo, api }) {
  if (!env.GH_TOKEN || !REPO.test(repo ?? "") || repo === sourceRepo || repo === env.GITHUB_REPOSITORY) throw new Error("DISPOSABLE_APP_AUTH_TARGET_INVALID");
  const binding = readGitHubAppCredentialBinding(env.PTP_E2E_GITHUB_APP_BINDING, env.GH_TOKEN);
  const { appSlug, installationId, permissions } = binding;
  if (binding.targetRepo !== repo) throw new Error("DISPOSABLE_APP_TOKEN_TARGET_MISMATCH");
  const pages = api(["api", "--paginate", "--slurp", "installation/repositories?per_page=100"]);
  const repositories = (Array.isArray(pages) ? pages : [pages]).flatMap((page) => page?.repositories ?? []);
  if (repositories.length !== 1 || repositories[0]?.full_name !== repo) throw new Error("DISPOSABLE_APP_TOKEN_TARGET_MISMATCH");
  const identity = { appSlug, installationId };
  const evidence = {
    status: "PASS",
    appSlug,
    installationIdentityDigest: digest(identity),
    targetRepo: repo,
    permissions: { metadata: "read", issues: "write", contents: "none", administration: "none" },
    writeActorReadback: false,
  };
  const authorization = Object.freeze({});
  AUTHORIZATIONS.set(authorization, { targetRepo: repo, installationIdentityDigest: evidence.installationIdentityDigest });
  return {
    actor: `${appSlug}[bot]`,
    evidence: { ...evidence, evidenceDigests: [digest(evidence)] },
    authorization,
  };
}

export function assertDisposableGitHubAppAuthorization(authorization, evidence, repo) {
  const verified = authorization && AUTHORIZATIONS.get(authorization);
  if (!verified || verified.targetRepo !== repo || verified.installationIdentityDigest !== evidence?.installationIdentityDigest
    || evidence?.targetRepo !== repo || evidence.status !== "PASS") throw new Error("L3_DISPOSABLE_AUTH_REQUIRED");
  return true;
}

const ownPath = fs.realpathSync(fileURLToPath(import.meta.url));
let invokedDirectly = false;
try { invokedDirectly = Boolean(process.argv[1] && fs.realpathSync(process.argv[1]) === ownPath); } catch { /* Imported by an eval/embedded process. */ }
if (invokedDirectly) {
  if (process.argv[2] !== "bind" || process.argv[3] !== "--out" || !process.argv[4]) throw new Error("usage: github-app-auth bind --out FILE");
  writeGitHubAppCredentialBinding({
    file: process.argv[4],
    token: process.env.GH_TOKEN,
    appSlug: process.env.PTP_E2E_GITHUB_APP_SLUG,
    installationId: process.env.PTP_E2E_GITHUB_APP_INSTALLATION_ID,
    targetRepo: process.env.PTP_E2E_GITHUB_APP_TARGET_REPO,
    permissions: (process.env.PTP_E2E_GITHUB_APP_PERMISSIONS ?? "").split(",").map((value) => value.trim()).filter(Boolean),
  });
}
