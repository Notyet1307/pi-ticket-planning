import fs from "node:fs";
import path from "node:path";

import { controlMetadata } from "../planning-case/cli.mjs";
import { resultEnvelope } from "../planning-case/result.mjs";
import { verifyGitHubEvidence } from "../integration/provenance.mjs";
import { applyCompatibilityProposal, proposeCompatibility } from "./compatibility.mjs";

function parse(argv) {
  const [scope, command, ...rest] = argv;
  if (scope !== "compatibility" || !["propose", "apply"].includes(command)) throw new Error("INVALID_COMPATIBILITY_COMMAND");
  const options = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    if (!rest[index]?.startsWith("--") || !rest[index + 1] || rest[index + 1].startsWith("--") || options.has(rest[index])) throw new Error("INVALID_COMPATIBILITY_OPTION");
    options.set(rest[index], rest[index + 1]);
  }
  const required = command === "propose" ? ["--qualification", "--capability", "--out"] : ["--proposal", "--qualification", "--capability", "--expected-digest"];
  if (required.some((name) => !options.has(name))) throw new Error("MISSING_COMPATIBILITY_OPTION");
  return { command, options };
}

export function runCompatibilityCli(argv, { clock = () => new Date().toISOString(), correlationId = `C-compatibility-${process.pid}` } = {}) {
  let command = "compatibility.invalid";
  try {
    const parsed = parse(argv);
    command = `compatibility.${parsed.command}`;
    let data;
    const qualificationFile = path.resolve(parsed.options.get("--qualification"));
    const capabilityFile = path.resolve(parsed.options.get("--capability"));
    const qualification = JSON.parse(fs.readFileSync(qualificationFile, "utf8"));
    const capabilityReceipt = JSON.parse(fs.readFileSync(capabilityFile, "utf8"));
    const verified = verifyGitHubEvidence(qualificationFile, qualification);
    if (!verified.provenanceVerified || !verified.workflowVerified || !verified.receipt) throw new Error("QUALIFICATION_PROVENANCE_INVALID");
    if (parsed.command === "propose") {
      const proposal = proposeCompatibility({ qualification, capabilityReceipt, qualificationProvenance: verified.receipt, qualificationAuthorization: verified.authorization });
      const out = path.resolve(parsed.options.get("--out"));
      fs.writeFileSync(out, `${JSON.stringify(proposal, null, 2)}\n`, { mode: 0o600, flag: "wx" });
      data = { proposal, out };
    } else {
      const proposal = JSON.parse(fs.readFileSync(path.resolve(parsed.options.get("--proposal")), "utf8"));
      data = { matrix: applyCompatibilityProposal(proposal, {
        expectedDigest: parsed.options.get("--expected-digest"),
        qualification,
        capabilityReceipt,
        qualificationProvenance: verified.receipt,
        qualificationAuthorization: verified.authorization,
      }) };
    }
    return { exitCode: 0, envelope: resultEnvelope({ command, status: "COMPLETE", data, problems: [], recovery: null, meta: controlMetadata({ clock, correlationId }) }) };
  } catch (error) {
    const code = /^[A-Z][A-Z0-9_]+$/.test(error?.message ?? "") ? error.message : "COMPATIBILITY_OPERATION_FAILED";
    return { exitCode: 1, envelope: resultEnvelope({ command, status: "INVALID", data: {}, problems: [{ code }], recovery: null, meta: controlMetadata({ clock, correlationId }) }) };
  }
}
