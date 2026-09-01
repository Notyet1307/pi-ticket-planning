import { createHash } from "node:crypto";

export const SHA256 = /^sha256:[a-f0-9]{64}$/;
export const HEX = /^[a-f0-9]{64}$/;

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

export function fingerprint(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical(value)), "utf8").digest("hex")}`;
}

export function hashText(value) {
  if (typeof value !== "string") throw new Error("INVALID_TEXT_HASH_INPUT");
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export function releasePlanDigest(plan) {
  return fingerprint(plan).slice("sha256:".length);
}
