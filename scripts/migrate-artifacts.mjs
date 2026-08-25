import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseCheckpoint } from "./workflow-contract.mjs";

const digest = (value) => `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;

export function migrateCheckpointV1(line, { target }) {
  const legacy = parseCheckpoint(line);
  const kind = legacy.identity === "NONE" ? "none" : legacy.identity.includes("@") ? "ticket" : "release";
  const separator = kind === "ticket" ? "@" : "/";
  const parts = kind === "none" ? ["NONE", "0"] : legacy.identity.split(separator);
  if (!target || parts.length !== 2) throw new Error("Checkpoint migration context is invalid");
  const subject = { target, kind, id: parts[0], revision: parts[1], digest: digest({ target, identity: legacy.identity }) };
  return { schema: "pi-ticket-planning:checkpoint:v2", lane: legacy.lane, stage: legacy.stage, verdict: legacy.verdict, subject };
}

export function migrateDeliveryGraphV1(value, context) {
  if (value?.version !== 1) throw new Error("Delivery Graph migration requires v1");
  if (!/^sha256:[a-f0-9]{64}$/.test(context?.specContentHash ?? "") || !context?.children) {
    throw new Error("Delivery Graph migration context is incomplete");
  }
  const children = value.children.map((child) => {
    const supplied = context.children[child.id];
    if (!/^sha256:[a-f0-9]{64}$/.test(supplied?.bodyHash ?? "") || typeof supplied?.startingState !== "string" || !supplied.startingState) {
      throw new Error(`Delivery Graph migration context is incomplete for ${child.id}`);
    }
    return { ...child, externalBlockers: child.externalBlockers ?? [], bodyHash: supplied.bodyHash, startingState: supplied.startingState };
  });
  return { ...structuredClone(value), version: 2, source: { ...value.source, specContentHash: context.specContentHash }, children };
}

const ownPath = fs.realpathSync(fileURLToPath(import.meta.url));
if (process.argv[1] && fs.realpathSync(process.argv[1]) === ownPath) {
  try {
    const args = new Map();
    for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);
    if (!args.has("--dry-run") || !args.has("--input") || !args.has("--artifact")) throw new Error("usage: --artifact NAME --input FILE --context FILE --dry-run true");
    const input = fs.readFileSync(path.resolve(args.get("--input")), "utf8");
    const context = args.has("--context") ? JSON.parse(fs.readFileSync(path.resolve(args.get("--context")), "utf8")) : {};
    const output = args.get("--artifact") === "checkpoint"
      ? migrateCheckpointV1(input.trim(), context)
      : migrateDeliveryGraphV1(JSON.parse(input), context);
    process.stdout.write(`${JSON.stringify({ dryRun: true, output }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`ERROR ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
