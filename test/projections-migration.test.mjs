import assert from "node:assert/strict";
import test from "node:test";

import { projectRelease, projectSpec } from "../protocol/projections.mjs";
import { migrateCheckpointV1, migrateDeliveryGraphV1 } from "../scripts/migrate-artifacts.mjs";

test("Release and Spec projections bind exact source bytes", () => {
  const release = projectRelease({
    target: "github:acme/product",
    id: "R001",
    revision: "r1",
    status: "COMMITTED",
    ref: "refs/heads/main",
    baseSha: "a".repeat(40),
    path: "docs/releases/R001.md",
    bytes: Buffer.from("release-v1\n"),
  });
  assert.equal(release.schema, "pi-ticket-planning:release-projection:v1");
  const changed = projectRelease({ ...release, ref: release.source.ref, baseSha: release.source.baseSha, path: release.source.path, bytes: Buffer.from("changed\n") });
  assert.notEqual(changed.digest, release.digest);

  const spec = projectSpec({
    target: release.target,
    id: "100",
    revision: "r2",
    baseSha: release.source.baseSha,
    source: { target: release.target, kind: "release", id: release.id, revision: release.revision, digest: release.digest },
    scenarioIds: ["S1", "S2"],
    bytes: Buffer.from("spec\n"),
  });
  assert.equal(spec.schema, "pi-ticket-planning:spec-projection:v1");
  assert.match(spec.contentDigest, /^sha256:/);
});

test("legacy Checkpoint and Delivery Graph migration is explicit and deterministic", () => {
  const checkpoint = migrateCheckpointV1("Checkpoint: PRODUCT/EVIDENCE · R001/r2 · NEEDS_RESEARCH", {
    target: "github:acme/product",
  });
  assert.equal(checkpoint.schema, "pi-ticket-planning:checkpoint:v2");
  assert.deepEqual(checkpoint.subject.kind, "release");
  assert.equal(checkpoint.subject.id, "R001");
  assert.equal(checkpoint.subject.revision, "r2");

  const v1 = {
    version: 1,
    source: { identity: "spec", revision: "r1", baseSha: "a".repeat(40) },
    scenarios: [{ id: "S1", behavior: "B", entry: "external:x", exit: "y", releaseSignal: "s", smallestLoop: true }],
    children: [{ id: "C1", title: "C", coverageRole: "DIRECT", sourceScenarios: ["S1"], blockedBy: [], externalBlockers: [], primaryVerification: "v", executionLane: "AGENT" }],
    walkingSkeleton: ["C1"],
  };
  const v2 = migrateDeliveryGraphV1(v1, {
    specContentHash: `sha256:${"b".repeat(64)}`,
    children: { C1: { bodyHash: `sha256:${"c".repeat(64)}`, startingState: "x" } },
  });
  assert.equal(v2.version, 2);
  assert.equal(v2.source.specContentHash, `sha256:${"b".repeat(64)}`);
  assert.throws(() => migrateDeliveryGraphV1(v1, {}), /migration context/);
});
