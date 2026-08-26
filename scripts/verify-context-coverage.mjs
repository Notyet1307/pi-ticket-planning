import { verifyProtocol } from "../protocol/kernel.mjs";
import { verifyContext } from "./verify-context.mjs";

const protocol = verifyProtocol();
const manifests = verifyContext();
const report = {
  ok: manifests.ok && protocol.contextRoutesMissing.length === 0 && protocol.orphanContextRoutes.length === 0,
  legalStructuralStates: protocol.legalStructuralStates,
  reachableStructuralStates: protocol.reachableStructuralStates,
  missing: protocol.contextRoutesMissing,
  orphaned: protocol.orphanContextRoutes,
  manifestProblems: manifests.problems,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ok) process.exitCode = 1;
