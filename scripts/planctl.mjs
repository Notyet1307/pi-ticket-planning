import { runCapabilityCli } from "../capabilities/cli.mjs";
import { runInstallationCli } from "../installation/cli.mjs";
import { runPlanningCaseCli } from "../planning-case/cli.mjs";

const argv = process.argv.slice(2);
const result = argv[0] === "doctor"
  ? await runCapabilityCli(argv)
  : ["update", "migrate", "rollback"].includes(argv[0])
    ? runInstallationCli(argv)
    : runPlanningCaseCli(argv);
process.stdout.write(`${JSON.stringify(result.envelope, null, 2)}\n`);
process.exitCode = result.exitCode;
