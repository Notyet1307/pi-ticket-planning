import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadContextManifest(route, { root = ROOT } = {}) {
  const directory = path.join(path.resolve(root), "context", "manifests");
  const matches = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith(".json"))
    .map((entry) => JSON.parse(fs.readFileSync(path.join(directory, entry.name), "utf8")))
    .filter((manifest) => manifest.route === route);
  if (matches.length !== 1) throw new Error(matches.length === 0 ? `CONTEXT_ROUTE_NOT_FOUND: ${route}` : `DUPLICATE_CONTEXT_ROUTE: ${route}`);
  return structuredClone(matches[0]);
}
