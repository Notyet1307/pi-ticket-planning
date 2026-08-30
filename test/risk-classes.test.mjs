import assert from "node:assert/strict";
import test from "node:test";

import { validateArtifact } from "../protocol/kernel.mjs";
import {
  RISK_CLASS_REGISTRY,
  RISK_CLASS_REGISTRY_SCHEMA,
  isCanonicalRiskClass,
  riskClassesRequireSplit,
  unknownRiskClasses,
  validateRiskClassRegistry,
} from "../scripts/risk-classes.mjs";

test("risk class registry is closed, self-digested, canonical, and alias-free", () => {
  assert.equal(validateArtifact(RISK_CLASS_REGISTRY, { identity: RISK_CLASS_REGISTRY_SCHEMA }).ok, true);
  assert.deepEqual(validateRiskClassRegistry(RISK_CLASS_REGISTRY), []);
  assert.equal(isCanonicalRiskClass("AUTHORITY_BOUNDARY"), true);
  assert.equal(isCanonicalRiskClass("BOUNDED_CHANGE"), false);
  assert.deepEqual(unknownRiskClasses(["AUTHORITY_BOUNDARY", "BOUNDED_CHANGE", "UNREGISTERED_RISK"]), ["BOUNDED_CHANGE", "UNREGISTERED_RISK"]);
  assert.equal(riskClassesRequireSplit(["PROVIDER_ATTEMPT_RECOVERY", "PUBLICATION_RECOVERY"]), true);
  assert.equal(riskClassesRequireSplit(["AUTHORITY_BOUNDARY", "BOUNDED_CHANGE"]), false);

  const drifted = structuredClone(RISK_CLASS_REGISTRY);
  drifted.classes.reverse();
  assert.equal(validateRiskClassRegistry(drifted).some(({ code }) => code === "INVALID_RISK_CLASS_REGISTRY"), true);
  assert.equal(validateRiskClassRegistry({ ...RISK_CLASS_REGISTRY, digest: `sha256:${"0".repeat(64)}` }).some(({ code }) => code === "RISK_CLASS_REGISTRY_DIGEST_MISMATCH"), true);
});
