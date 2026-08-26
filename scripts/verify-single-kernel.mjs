import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DIRECTORIES = ["admission", "benchmark", "capabilities", "context", "installation", "integration", "outcome", "planning-case", "protocol", "scripts"];
const LEGACY_IMPORTERS = new Set(["scripts/workflow-contract.mjs", "scripts/migrate-artifacts.mjs"]);

function files(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(directory, entry.name);
    return entry.isDirectory() ? files(child) : entry.isFile() && entry.name.endsWith(".mjs") ? [child] : [];
  });
}

export function verifySingleKernel(root = ROOT) {
  const problems = [];
  for (const file of SOURCE_DIRECTORIES.flatMap((directory) => files(path.join(root, directory)))) {
    const relative = path.relative(root, file);
    const text = fs.readFileSync(file, "utf8");
    if (relative !== "scripts/workflow-contract.mjs" && /from\s+["'][^"']*workflow-contract\.mjs["']/.test(text)) {
      problems.push({ code: "LEGACY_EVALUATOR_IMPORTED", subject: relative });
    }
    if (!LEGACY_IMPORTERS.has(relative) && /from\s+["'][^"']*legacy-adapter\.mjs["']/.test(text)) {
      problems.push({ code: "LEGACY_ADAPTER_IMPORTED", subject: relative });
    }
    if (!["protocol/kernel.mjs", "scripts/workflow-contract.mjs"].includes(relative)
      && /(?:export\s+)?function\s+(?:evaluateTransition|evaluateMutation|evaluateTransitionShape|evaluateFacts|validateState)\b/.test(text)) {
      problems.push({ code: "DUPLICATE_KERNEL_EVALUATOR", subject: relative });
    }
  }
  const admissionDomain = fs.readFileSync(path.join(root, "admission", "domain.mjs"), "utf8");
  if (!/from\s+["']\.\.\/protocol\/kernel\.mjs["']/.test(admissionDomain)) {
    problems.push({ code: "ADMISSION_KERNEL_BYPASS", subject: "admission/domain.mjs" });
  }
  const facade = fs.readFileSync(path.join(root, "scripts", "workflow-contract.mjs"), "utf8");
  for (const token of ["evaluateKernelTransition", "evaluateKernelMutation", "adaptLegacyCheckpoint", "adaptLegacyFacts"]) {
    if (!facade.includes(token)) problems.push({ code: "LEGACY_FACADE_NOT_THIN", subject: token });
  }
  return { ok: problems.length === 0, problems };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const report = verifySingleKernel();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}
