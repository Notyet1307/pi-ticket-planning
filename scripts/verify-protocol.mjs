import {
  validateCodeSchemaCoverage,
  validateProtocolRules,
  validateRegistry,
  verifyProtocol,
} from "../protocol/kernel.mjs";

const checks = [validateRegistry(), validateCodeSchemaCoverage(), validateProtocolRules()];
const report = verifyProtocol();
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

const problems = checks.flatMap((check) => check.problems);
for (const item of problems) {
  process.stderr.write(`ERROR ${item.code}${item.subject ? ` ${item.subject}` : ""}\n`);
}
const critical = [
  report.unreachableStates,
  report.undeclaredDeadEnds,
  report.factsWithoutProducer,
  report.factsWithoutConsumer,
  report.mutationsWithoutPostconditions,
  report.ambiguousAuthorityOwners,
  report.invalidIdentityTransitions,
];
if (problems.length > 0 || critical.some((items) => items.length > 0)) process.exitCode = 1;
