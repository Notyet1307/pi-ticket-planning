import fs from "node:fs";

function readReports(value, schema) {
  return (value ?? "").split(",").filter(Boolean).map((file) => {
    const report = JSON.parse(fs.readFileSync(file, "utf8"));
    if (report.schema !== schema) throw new Error(`unexpected report schema in ${file}`);
    return report;
  });
}

export function qualifyRelease({ e2eReports = [], modelReports = [] } = {}) {
  const scenarios = e2eReports.flatMap((report) => report.scenarios ?? []);
  const providers = new Set(modelReports.map((report) => report.model).filter(Boolean));
  const attempts = modelReports.flatMap((report) => report.attempts ?? []);
  const first = attempts.filter(({ attempt }) => attempt === 1);
  const eventualCases = new Set(attempts.filter(({ status }) => status === "PASS").map(({ caseId }) => caseId));
  const allCases = new Set(attempts.map(({ caseId }) => caseId));
  const e2ePass = scenarios.filter(({ status }) => status === "PASS").length;
  const metrics = {
    realE2EScenarios: scenarios.length,
    providersAndModels: providers.size,
    firstPassSuccessRate: first.length ? first.filter(({ status }) => status === "PASS").length / first.length : 0,
    eventualSuccessRate: allCases.size ? eventualCases.size / allCases.size : 0,
    retryRate: attempts.length ? attempts.filter(({ attempt }) => attempt > 1).length / attempts.length : 0,
    unauthorizedWriteCount: e2eReports.reduce((total, report) => total + (report.metrics?.unauthorized_write_count ?? 0), 0),
    recoverySuccessRate: e2eReports.length ? Math.min(...e2eReports.map((report) => report.metrics?.recovery_success_rate ?? 0)) : 0,
    unclassifiedFailureRate: e2eReports.length ? Math.max(...e2eReports.map((report) => report.metrics?.unclassified_failure_rate ?? 1)) : 1,
  };
  const problems = [];
  if (metrics.realE2EScenarios < 50) problems.push({ code: "INSUFFICIENT_REAL_E2E" });
  if (metrics.providersAndModels < 2) problems.push({ code: "INSUFFICIENT_PROVIDER_MODEL_COVERAGE" });
  if (metrics.firstPassSuccessRate < 0.95) problems.push({ code: "FIRST_PASS_THRESHOLD_NOT_MET" });
  if (metrics.eventualSuccessRate < 0.99) problems.push({ code: "EVENTUAL_THRESHOLD_NOT_MET" });
  if (metrics.unauthorizedWriteCount !== 0) problems.push({ code: "UNAUTHORIZED_WRITES_DETECTED" });
  if (metrics.recoverySuccessRate < 1) problems.push({ code: "RECOVERY_THRESHOLD_NOT_MET" });
  if (metrics.unclassifiedFailureRate !== 0) problems.push({ code: "UNCLASSIFIED_FAILURES_REMAIN" });
  return { schema: "pi-ticket-planning:release-qualification:v1", status: problems.length ? "BLOCKED" : "COMPLETE", metrics, problems };
}

if (process.argv[1]?.endsWith("integration/qualify.mjs")) {
  const result = qualifyRelease({
    e2eReports: readReports(process.env.PTP_E2E_REPORTS, "pi-ticket-planning:e2e-report:v1"),
    modelReports: readReports(process.env.PTP_MODEL_REPORTS, "pi-ticket-planning:live-eval:v3"),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== "COMPLETE") process.exitCode = 1;
}
