import { verifyProtocol } from "../protocol/kernel.mjs";
import { verifyContext } from "./verify-context.mjs";

const protocol = verifyProtocol();
const manifests = verifyContext();
const report = {
  ok: manifests.ok && protocol.contextRoutesMissing.length === 0 && protocol.orphanContextRoutes.length === 0,
  legalStates: protocol.legalStates,
  reachableLegalStates: protocol.reachableLegalStates,
  missing: protocol.contextRoutesMissing,
  orphaned: protocol.orphanContextRoutes,
  manifestProblems: manifests.problems,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ok) process.exitCode = 1;
