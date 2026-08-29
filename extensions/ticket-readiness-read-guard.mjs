import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { captureAdmissionReviewInput } from "../admission/review-transport.mjs";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_READ_BYTES = 50 * 1024;
const MAX_READ_LINES = 2000;
const EXTENSION_PATH = fileURLToPath(import.meta.url);
const REVIEWER_AGENT = "ticket-readiness-reviewer";
export const REVIEWER_READ_TOOL = "review_input_read";
export const REVIEWER_SKILL_PATH = fs.realpathSync(path.join(PACKAGE_ROOT, "skills", "ticket-readiness", "SKILL.md"));

const READ_PARAMETERS = {
  type: "object",
  properties: {
    path: { type: "string", description: "Exact allowlisted absolute file path" },
    offset: { type: "number", description: "Line number to start reading from (1-indexed)" },
    limit: { type: "number", description: "Maximum number of lines to read" },
  },
  required: ["path"],
  additionalProperties: false,
};

function readSnapshot(content, { offset = 1, limit }) {
  if (!Number.isInteger(offset) || offset < 1) throw new Error("Reviewer read offset must be a positive integer");
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new Error("Reviewer read limit must be a positive integer");
  const lines = content.split("\n");
  const start = offset - 1;
  if (start >= lines.length) throw new Error(`Reviewer read offset ${offset} is beyond EOF`);
  const selected = [];
  let bytes = 0;
  for (let index = start; index < lines.length && selected.length < Math.min(limit ?? MAX_READ_LINES, MAX_READ_LINES); index += 1) {
    const lineBytes = Buffer.byteLength(lines[index], "utf8") + (selected.length > 0 ? 1 : 0);
    if (bytes + lineBytes > MAX_READ_BYTES) break;
    selected.push(lines[index]);
    bytes += lineBytes;
  }
  if (selected.length === 0) throw new Error("Reviewer read line exceeds the bounded transport");
  const end = start + selected.length;
  const continuation = end < lines.length
    ? `\n\n[Showing lines ${offset}-${end} of ${lines.length}. Use offset=${end + 1} to continue.]`
    : "";
  return { text: `${selected.join("\n")}${continuation}`, nextOffset: end < lines.length ? end + 1 : null };
}

export function createReviewerReadTool(cwd) {
  const skill = fs.readFileSync(REVIEWER_SKILL_PATH, "utf8");
  let bundle;
  let bundleError;
  try {
    bundle = captureAdmissionReviewInput(cwd);
  } catch (error) {
    bundleError = error instanceof Error ? error.message : String(error);
  }
  return {
    name: REVIEWER_READ_TOOL,
    label: REVIEWER_READ_TOOL,
    description: "Read only the configured ticket-readiness Skill and the descriptor-held Admission review input.",
    parameters: READ_PARAMETERS,
    async execute(_toolCallId, params, signal) {
      if (signal?.aborted) throw new Error("Reviewer read aborted");
      let source;
      let content;
      if (params.path === REVIEWER_SKILL_PATH) {
        source = "skill";
        content = skill;
      } else if (bundle && params.path === bundle.path) {
        source = "bundle";
        content = bundle.content;
      } else if (bundleError) throw new Error(`Reviewer bundle is unavailable: ${bundleError}`);
      else throw new Error("Reviewer read path is not allowlisted");
      const read = readSnapshot(content, params);
      return {
        content: [{ type: "text", text: read.text }],
        details: { source, nextOffset: read.nextOffset, ...(source === "bundle" ? { binding: bundle.binding } : {}) },
      };
    },
  };
}

function registerBackingExtension() {
  globalThis.__pi_interactive_subagents?.registerToolExtension?.(REVIEWER_READ_TOOL, EXTENSION_PATH);
}

export default function ticketReadinessReadGuard(pi) {
  registerBackingExtension();
  pi.on("session_start", registerBackingExtension);
  if (process.env.PI_SUBAGENT_AGENT === REVIEWER_AGENT
    && process.env.PI_SUBAGENT_ID && process.env.PI_SUBAGENT_SESSION) {
    pi.registerTool(createReviewerReadTool(process.cwd()));
  }
}
