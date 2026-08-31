import fs from "node:fs";
import path from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const runtimes = new Map();

function schemaFiles(root) {
  const directory = path.join(root, "schemas");
  return fs.readdirSync(directory)
    .filter((name) => name.endsWith(".schema.json"))
    .sort()
    .map((name) => path.join(directory, name));
}

const EXTERNAL_SCHEMAS_WITHOUT_ID = new Set([
  "herdr-codex-release-plan.schema.json",
  "herdr-codex-release-result-v1.schema.json",
]);

function createRuntime(root) {
  const ajv = new Ajv2020({
    allErrors: true,
    allowUnionTypes: true,
    strict: true,
    strictRequired: false,
    strictTypes: false,
    validateFormats: true,
  });
  addFormats(ajv, { mode: "full" });
  const schemas = new Map();
  for (const file of schemaFiles(root)) {
    const schema = JSON.parse(fs.readFileSync(file, "utf8"));
    if ((!schema.$id || typeof schema.$id !== "string") && !EXTERNAL_SCHEMAS_WITHOUT_ID.has(path.basename(file))) {
      throw new Error(`MISSING_JSON_SCHEMA_ID: ${path.relative(root, file)}`);
    }
    const id = schema.$id || `https://schemas.pi-ticket-planning.invalid/${path.basename(file)}`;
    if ([...schemas.values()].includes(id)) throw new Error(`DUPLICATE_JSON_SCHEMA_ID: ${id}`);
    schemas.set(path.resolve(file), id);
    ajv.addSchema(schema, id);
  }
  for (const id of schemas.values()) ajv.getSchema(id);
  return { ajv, schemas };
}

export function localSchemaRuntime(root) {
  const resolved = path.resolve(root);
  if (!runtimes.has(resolved)) runtimes.set(resolved, createRuntime(resolved));
  return runtimes.get(resolved);
}

export function validateLocalSchema(value, schemaPath, { root }) {
  const runtime = localSchemaRuntime(root);
  const id = runtime.schemas.get(path.resolve(root, schemaPath));
  if (!id) throw new Error(`UNREGISTERED_JSON_SCHEMA: ${schemaPath}`);
  const validate = runtime.ajv.getSchema(id);
  if (!validate) throw new Error(`UNCOMPILED_JSON_SCHEMA: ${id}`);
  const ok = validate(value);
  return {
    ok,
    problems: ok ? [] : validate.errors.map((error) => ({
      code: "ARTIFACT_SCHEMA_INVALID",
      subject: `${error.instancePath || "/"}:${error.keyword}`,
    })),
  };
}
