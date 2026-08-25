import { runPlanningCaseCli } from "../planning-case/cli.mjs";

const result = runPlanningCaseCli(process.argv.slice(2));
process.stdout.write(`${JSON.stringify(result.envelope, null, 2)}\n`);
process.exitCode = result.exitCode;
