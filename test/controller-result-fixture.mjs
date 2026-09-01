export function controllerResultFixture({
  releaseId = "r1-c1-r1",
  planDigest = "1".repeat(64),
  baseSha = "1".repeat(40),
  candidateSha = "2".repeat(40),
  mergeSha = "3".repeat(40),
} = {}) {
  return {
    schema: "herdr-codex-controller:release-result:v1",
    releaseId,
    planDigest,
    status: "merged",
    baseSha,
    candidateSha,
    pullRequest: { number: 1, url: "https://github.com/Notyet1307/example/pull/1" },
    requiredChecks: { names: ["verify"], status: "passed" },
    mergeSha,
    completedAt: "2026-08-29T00:10:00.000Z",
  };
}
