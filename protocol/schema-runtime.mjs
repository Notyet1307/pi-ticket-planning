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
    if (typeof schema.$id !== "string" || !schema.$id) throw new Error(`MISSING_JSON_SCHEMA_ID: ${path.relative(root, file)}`);
    if (schemas.has(schema.$id)) throw new Error(`DUPLICATE_JSON_SCHEMA_ID: ${schema.$id}`);
    schemas.set(schema.$id, schema);
    ajv.addSchema(schema);
  }
  for (const id of schemas.keys()) ajv.getSchema(id);
  return { ajv, schemas };
}

export function localSchemaRuntime(root) {
  const resolved = path.resolve(root);
  if (!runtimes.has(resolved)) runtimes.set(resolved, createRuntime(resolved));
  return runtimes.get(resolved);
}

export function validateLocalSchema(value, schemaPath, { root }) {
  const runtime = localSchemaRuntime(root);
  const schema = runtime.schemas.get(JSON.parse(fs.readFileSync(path.resolve(root, schemaPath), "utf8")).$id);
  if (!schema) throw new Error(`UNREGISTERED_JSON_SCHEMA: ${schemaPath}`);
  const validate = runtime.ajv.getSchema(schema.$id);
  if (!validate) throw new Error(`UNCOMPILED_JSON_SCHEMA: ${schema.$id}`);
  const ok = validate(value);
  return {
    ok,
    problems: ok ? [] : validate.errors.map((error) => ({
      code: "ARTIFACT_SCHEMA_INVALID",
      subject: `${error.instancePath || "/"}:${error.keyword}`,
    })),
  };
}
