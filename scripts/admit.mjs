export { fingerprint } from "../admission/domain.mjs";
export { buildAdmissionPlan, buildStandaloneAdmissionPlan } from "../admission/plan.mjs";
export { validateAdmissionPlan } from "../admission/validate.mjs";
export { applyAdmissionPlan } from "../admission/apply.mjs";
export { createGitHubAdapter } from "../admission/github-adapter.mjs";
import { runAdmissionCli } from "../admission/cli.mjs";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) runAdmissionCli();
