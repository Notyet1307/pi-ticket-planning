import { randomUUID } from "node:crypto";

import { controlMetadata } from "../planning-case/cli.mjs";
import { resultEnvelope } from "../planning-case/result.mjs";
import { compatibilityFor } from "./compatibility.mjs";
import { inspectCapabilities } from "./doctor.mjs";

const STATIC_NAMES = new Set([
  "runtime.node",
  "runtime.pi",
  "runtime.git",
  "runtime.gh",
  "runtime.docker",
  "profile.static-integrity",
  "protocol.registry",
]);

function overall(capabilities) {
  if (capabilities.some(({ status }) => status === "BLOCKED")) return "BLOCKED";
  if (capabilities.some(({ status }) => status === "DEGRADED" || status === "UNTESTED")) return "DEGRADED";
  return "COMPLETE";
}

export async function runCapabilityCli(argv, {
  env = process.env,
  clock = () => new Date().toISOString(),
  correlationId = `C-${randomUUID()}`,
  inspect = inspectCapabilities,
} = {}) {
  let command = "doctor.invalid";
  try {
    if (argv[0] !== "doctor") throw new Error("INVALID_COMMAND");
    const flags = new Set(argv.slice(1));
    if (flags.size !== argv.length - 1 || [...flags].some((flag) => !["--static", "--capabilities", "--active-probe", "--json"].includes(flag))) {
      throw new Error("INVALID_OPTION");
    }
    const staticMode = flags.has("--static");
    const capabilityMode = flags.has("--capabilities");
    if (staticMode === capabilityMode || (flags.has("--active-probe") && !capabilityMode)) throw new Error("INVALID_DOCTOR_MODE");
    command = staticMode ? "doctor.static" : "doctor.capabilities";
    const receipt = await inspect({ activeProbe: flags.has("--active-probe"), env, clock });
    const selected = staticMode ? receipt.capabilities.filter(({ name }) => STATIC_NAMES.has(name)) : receipt.capabilities;
    const compatibility = staticMode ? null : compatibilityFor(receipt);
    const status = overall(compatibility ? [...selected, { status: compatibility.status }] : selected);
    const problems = selected
      .filter(({ status: value }) => value !== "SUPPORTED")
      .map(({ name, status: value }) => ({ code: `CAPABILITY_${value}`, subject: name }));
    if (compatibility && compatibility.status !== "SUPPORTED") {
      problems.push({ code: `CAPABILITY_${compatibility.status}`, subject: "compatibility-matrix" });
    }
    const recovery = !staticMode && !flags.has("--active-probe") && selected.some(({ status: value }) => value === "UNTESTED")
      ? { command: "pi-ticket-planctl doctor --capabilities --active-probe --json" }
      : null;
    return {
      exitCode: status === "COMPLETE" ? 0 : 1,
      envelope: resultEnvelope({
        command,
        status,
        data: staticMode ? { checks: selected } : { receipt, compatibility },
        problems,
        recovery,
        meta: controlMetadata({ clock, correlationId }),
      }),
    };
  } catch (error) {
    const code = /^[A-Z][A-Z0-9_]+$/.test(error?.message ?? "") ? error.message : "DOCTOR_FAILED";
    return {
      exitCode: 1,
      envelope: resultEnvelope({
        command,
        status: "INVALID",
        data: {},
        problems: [{ code }],
        recovery: null,
        meta: controlMetadata({ clock, correlationId }),
      }),
    };
  }
}
