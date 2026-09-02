import { createHash } from "node:crypto";
import path from "node:path";

import { validateArtifact } from "./kernel.mjs";

const hash = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const SHA = /^[a-f0-9]{40,64}$/;
const TARGET = /^[a-z][a-z0-9+.-]*:[^\u0000\r\n]+$/;

function bytes(value) {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === "string") return Buffer.from(value, "utf8");
  throw new TypeError("projection source bytes are required");
}

function safePath(value) {
  if (typeof value !== "string" || value.length === 0 || path.isAbsolute(value) || value.split(/[\\/]/u).includes("..")) {
    throw new Error("projection source path is invalid");
  }
  return value;
}

export function projectRelease({ target, id, revision, status, ref, baseSha, path: sourcePath, bytes: sourceBytes }) {
  if (!TARGET.test(target ?? "") || !id || !revision || !SHA.test(baseSha ?? "")) throw new Error("Release projection identity is invalid");
  if (!["CANDIDATE", "READY_TO_COMMIT", "COMMITTED", "HOLD", "REWORK", "DROP", "RELEASED_AWAITING_EVIDENCE", "REVIEWED"].includes(status)) {
    throw new Error("Release projection status is invalid");
  }
  const blobDigest = hash(bytes(sourceBytes));
  const projection = {
    schema: "pi-ticket-planning:release-projection:v1",
    target,
    id,
    revision,
    status,
    source: { ref, baseSha, path: safePath(sourcePath), blobDigest },
  };
  return { ...projection, digest: hash(JSON.stringify(projection)) };
}

export function projectSpec({ target, id, revision, baseSha, source, scenarioIds, bytes: sourceBytes, acceptance }) {
  if (!TARGET.test(target ?? "") || !id || !revision || !SHA.test(baseSha ?? "") || !Array.isArray(scenarioIds)
    || scenarioIds.length === 0 || new Set(scenarioIds).size !== scenarioIds.length
    || scenarioIds.some((scenario) => !/^S[1-9][0-9]*$/.test(scenario))) throw new Error("Spec projection identity is invalid");
  if (acceptance?.schema !== "pi-ticket-planning:spec-acceptance:v1" || !validateArtifact(acceptance).ok) {
    throw new Error("Spec projection acceptance is invalid");
  }
  return {
    schema: "pi-ticket-planning:spec-projection:v1",
    target,
    id,
    revision,
    baseSha,
    source: structuredClone(source),
    scenarioIds: [...scenarioIds],
    contentDigest: hash(bytes(sourceBytes)),
    acceptance: structuredClone(acceptance),
  };
}
