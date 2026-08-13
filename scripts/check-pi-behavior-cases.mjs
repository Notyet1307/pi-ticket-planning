import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function validatePiBehaviorCases(file) {
  const fixture = JSON.parse(fs.readFileSync(file, "utf8"));
  const errors = [];
  const ids = new Set();

  for (const item of fixture.cases ?? []) {
    if (!item.id || ids.has(item.id)) errors.push(`${item.id || "unnamed"}: duplicate or missing id`);
    ids.add(item.id);
    if (!item.skill || !item.inputState || !item.observedExcerpt) errors.push(`${item.id}: incomplete case`);
    if (!Array.isArray(item.expected?.mustMatch) || item.expected.mustMatch.length === 0) {
      errors.push(`${item.id}: missing positive invariants`);
    }
    for (const text of item.expected?.mustMatch ?? []) {
      if (!item.observedExcerpt.includes(text)) errors.push(`${item.id}: observed output lacks ${text}`);
    }
    for (const text of item.expected?.mustNotMatch ?? []) {
      if (item.observedExcerpt.includes(text)) errors.push(`${item.id}: observed output contains forbidden ${text}`);
    }
    if (JSON.stringify(item.expected?.allowedWrites) !== "[]") errors.push(`${item.id}: canary was not read-only`);
  }

  for (const id of [
    "greenfield-uncommitted-stays-in-frame",
    "greenfield-committed-routes-to-bootstrap",
    "missing-handoffs-fail-closed",
    "complete-handoffs-reach-approval-gate",
    "normalized-delivery-graph-reaches-approval-gate",
    "fresh-reviewer-accepts-complete-execution-context",
    "fresh-reviewer-rejects-missing-execution-context"
  ]) {
    if (!ids.has(id)) errors.push(`missing observed behavior case ${id}`);
  }

  return errors;
}

const ownPath = fs.realpathSync(fileURLToPath(import.meta.url));
if (process.argv[1] && fs.realpathSync(process.argv[1]) === ownPath) {
  const file = path.resolve(path.dirname(ownPath), "..", "fixtures", "pi-behavior-cases.json");
  const errors = validatePiBehaviorCases(file);
  if (errors.length) {
    for (const error of errors) console.error(`ERROR ${error}`);
    process.exitCode = 1;
  } else {
    console.log("PI behavior cases: ok");
  }
}
