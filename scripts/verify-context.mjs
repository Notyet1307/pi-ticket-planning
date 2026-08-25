import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/;
const FORBIDDEN_DEFAULT = /(?:^|\/)(?:research|archive|archives|examples|fixtures)(?:\/|$)/i;
const QUICK_OR_STATUS_HEAVY = /(?:release-loop|solution-shaping|evidence-method-selection|interview-session)\.md$/;
const REVIEWER_AUTHOR_REASONING = /^(?:skills\/(?:admit-ticket|ask-yet)\/|docs\/rationale\/)/;

function problem(code, subject) {
  return subject === undefined ? { code } : { code, subject };
}

function within(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function localLinks(file, text, root, problems) {
  const links = [];
  for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
    const raw = match[1].trim().replace(/^<|>$/g, "").split(/\s+/, 1)[0];
    if (!raw || raw.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(raw)) continue;
    let decoded;
    try {
      decoded = decodeURIComponent(raw.split(/[?#]/, 1)[0]);
    } catch {
      problems.push(problem("INVALID_CONTEXT_REFERENCE", raw));
      continue;
    }
    const target = path.resolve(path.dirname(file), decoded);
    if (!within(root, target)) {
      problems.push(problem("CONTEXT_REFERENCE_ESCAPE", raw));
      continue;
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      problems.push(problem("CONTEXT_REFERENCE_MISSING", path.relative(root, target)));
      continue;
    }
    links.push(path.relative(root, target));
  }
  return links;
}

function cycle(graph) {
  const visiting = new Set();
  const visited = new Set();
  function visit(node, trail) {
    if (visiting.has(node)) return [...trail, node];
    if (visited.has(node)) return null;
    visiting.add(node);
    for (const target of graph.get(node) ?? []) {
      const found = visit(target, [...trail, node]);
      if (found) return found;
    }
    visiting.delete(node);
    visited.add(node);
    return null;
  }
  for (const node of graph.keys()) {
    const found = visit(node, []);
    if (found) return found;
  }
  return null;
}

export function verifyContext({ root = REPOSITORY_ROOT, manifestDir = "context/manifests" } = {}) {
  const requestedRoot = path.resolve(root);
  const resolvedRoot = fs.existsSync(requestedRoot) ? fs.realpathSync(requestedRoot) : requestedRoot;
  const directory = path.resolve(resolvedRoot, manifestDir);
  const problems = [];
  if (!within(resolvedRoot, directory) || !fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    return { ok: false, manifests: 0, totalBytes: 0, problems: [problem("CONTEXT_MANIFEST_DIRECTORY_MISSING")] };
  }
  const routes = new Set();
  let totalBytes = 0;
  let manifestCount = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith(".json")) {
      problems.push(problem("INVALID_CONTEXT_MANIFEST_FILE", entry.name));
      continue;
    }
    manifestCount += 1;
    const relativeManifest = path.join(manifestDir, entry.name);
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(directory, entry.name), "utf8"));
    } catch {
      problems.push(problem("INVALID_CONTEXT_MANIFEST_JSON", relativeManifest));
      continue;
    }
    const expectedKeys = ["schema", "route", "required", "optional", "maxBytes", "maxEstimatedTokens", "maxDocuments"];
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)
      || Object.keys(manifest).sort().join("\n") !== expectedKeys.sort().join("\n")
      || manifest.schema !== "pi-ticket-planning:context-manifest:v1"
      || !/^[A-Z][A-Z0-9_]*(?:\/[A-Z][A-Z0-9_]*){2}$/.test(manifest.route ?? "")
      || !Array.isArray(manifest.required)
      || !Array.isArray(manifest.optional)
      || !Number.isInteger(manifest.maxBytes)
      || !Number.isInteger(manifest.maxEstimatedTokens)
      || !Number.isInteger(manifest.maxDocuments)) {
      problems.push(problem("INVALID_CONTEXT_MANIFEST", relativeManifest));
      continue;
    }
    if (routes.has(manifest.route)) problems.push(problem("DUPLICATE_CONTEXT_ROUTE", manifest.route));
    routes.add(manifest.route);
    const documents = [...new Set([...manifest.required, ...manifest.optional])];
    if (documents.length !== manifest.required.length + manifest.optional.length) {
      problems.push(problem("DUPLICATE_CONTEXT_DOCUMENT", manifest.route));
    }
    if (documents.length > manifest.maxDocuments) problems.push(problem("CONTEXT_DOCUMENT_BUDGET_EXCEEDED", manifest.route));
    let bytes = 0;
    const selected = new Set();
    const graph = new Map();
    for (const relative of documents) {
      if (typeof relative !== "string" || !SAFE_PATH.test(relative)) {
        problems.push(problem("INVALID_CONTEXT_PATH", `${manifest.route}:${relative ?? ""}`));
        continue;
      }
      if (FORBIDDEN_DEFAULT.test(relative)) problems.push(problem("FORBIDDEN_DEFAULT_CONTEXT", `${manifest.route}:${relative}`));
      if (/(?:QUICK|STATUS)/.test(manifest.route) && QUICK_OR_STATUS_HEAVY.test(relative)) {
        problems.push(problem("LIGHTWEIGHT_ROUTE_LOADS_DISCOVERY", `${manifest.route}:${relative}`));
      }
      if (manifest.route.includes("/ADMISSION/REVIEW") && REVIEWER_AUTHOR_REASONING.test(relative)) {
        problems.push(problem("REVIEWER_AUTHOR_REASONING_INCLUDED", `${manifest.route}:${relative}`));
      }
      const file = path.resolve(resolvedRoot, relative);
      if (!within(resolvedRoot, file) || !fs.existsSync(file)) {
        problems.push(problem("CONTEXT_FILE_MISSING", `${manifest.route}:${relative}`));
        continue;
      }
      const metadata = fs.lstatSync(file);
      if (!metadata.isFile() || metadata.isSymbolicLink() || !within(resolvedRoot, fs.realpathSync(file))) {
        problems.push(problem("UNSAFE_CONTEXT_FILE", `${manifest.route}:${relative}`));
        continue;
      }
      selected.add(relative);
      bytes += metadata.size;
      const text = fs.readFileSync(file, "utf8");
      graph.set(relative, localLinks(file, text, resolvedRoot, problems));
    }
    for (const [source, links] of graph) graph.set(source, links.filter((target) => selected.has(target)));
    const referenceCycle = cycle(graph);
    if (referenceCycle) problems.push(problem("CONTEXT_REFERENCE_CYCLE", `${manifest.route}:${referenceCycle.join("->")}`));
    totalBytes += bytes;
    if (bytes > manifest.maxBytes) problems.push(problem("CONTEXT_BYTE_BUDGET_EXCEEDED", manifest.route));
    if (Math.ceil(bytes / 4) > manifest.maxEstimatedTokens) problems.push(problem("CONTEXT_TOKEN_BUDGET_EXCEEDED", manifest.route));
  }
  return { ok: problems.length === 0, manifests: manifestCount, totalBytes, problems };
}

const ownPath = fs.realpathSync(fileURLToPath(import.meta.url));
if (process.argv[1] && fs.realpathSync(process.argv[1]) === ownPath) {
  const result = verifyContext();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}
