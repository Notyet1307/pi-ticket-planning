import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function routeParts(route) {
  const match = typeof route === "string" ? route.match(/^([A-Z][A-Z0-9_]*)\/([A-Z][A-Z0-9_]*)\/([A-Z][A-Z0-9_]*)$/) : null;
  if (!match) throw new Error(`INVALID_CONTEXT_ROUTE: ${route ?? ""}`);
  return { lane: match[1], stage: match[2], verdict: match[3] };
}

function manifests(root) {
  const directory = path.join(root, "context", "manifests");
  return new Map(fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith(".json"))
    .map((entry) => [entry.name, JSON.parse(fs.readFileSync(path.join(directory, entry.name), "utf8"))]));
}

export function resolveContextTemplate(route, { root = ROOT } = {}) {
  const resolvedRoot = path.resolve(root);
  const { lane, stage, verdict } = routeParts(route);
  const routing = JSON.parse(fs.readFileSync(path.join(resolvedRoot, "context", "routes.json"), "utf8"));
  const matches = routing.rules.filter((rule) => (!rule.lanes || rule.lanes.includes(lane))
    && rule.stages.includes(stage)
    && (!rule.verdicts || rule.verdicts.includes(verdict)));
  if (matches.length !== 1) throw new Error(matches.length === 0 ? `CONTEXT_ROUTE_NOT_FOUND: ${route}` : `DUPLICATE_CONTEXT_ROUTE: ${route}`);
  return matches[0].manifest;
}

export function loadContextManifest(route, options = {}) {
  const resolvedRoot = path.resolve(options.root ?? ROOT);
  const template = resolveContextTemplate(route, { root: resolvedRoot });
  const manifest = manifests(resolvedRoot).get(template);
  if (!manifest) throw new Error(`CONTEXT_MANIFEST_NOT_FOUND: ${template}`);
  return { ...structuredClone(manifest), route };
}
