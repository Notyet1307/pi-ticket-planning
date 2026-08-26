import { createHash } from "node:crypto";

import { createExecutionHandoffApproval } from "../planning-case/cli.mjs";
import { createPlanningCaseStore } from "../planning-case/store.mjs";
import {
  createFactAttestation,
  loadProtocol,
  producerAttestationSource,
} from "../protocol/kernel.mjs";
import { NOW } from "./execution-plan-fixture.mjs";

function caseFactBuilder(subject, now) {
  const protocol = loadProtocol();
  let counter = 0;
  return (names, mutationId) => names.map((name) => {
    const rule = { ...protocol.authority.factDefaults, ...protocol.authority.facts[name] };
    const sourceKind = rule.sources[0];
    const producer = protocol.producers.sources[sourceKind].producers[0];
    counter += 1;
    return createFactAttestation({
      id: `F-handoff-flow-${counter}`,
      fact: name,
      value: true,
      subject,
      source: producerAttestationSource(sourceKind, producer, { protocol, producerVersion: "test" }),
      observedAt: now,
      expiresAt: rule.freshness?.mode === "max-age"
        ? new Date(Date.parse(now) + rule.freshness.maxAgeMs).toISOString()
        : null,
      ...(rule.freshness?.mode === "same-mutation" ? { mutationId } : {}),
      evidence: {
        kind: rule.owner === "human" ? "operator" : "artifact",
        ref: `handoff-flow:${name}:${counter}`,
        digest: `sha256:${createHash("sha256").update(`${name}:${counter}`).digest("hex")}`,
      },
    });
  });
}

export function createReadyCase({ stateDir, plan, now = NOW, caseId = "PC-execution-handoff" }) {
  const target = `github:${plan.repo}`;
  const store = createPlanningCaseStore({ stateDir, clock: () => now });
  store.create({ target, caseId });
  const subject = {
    target,
    kind: "release",
    id: plan.target,
    revision: plan.source.revision,
    digest: plan.reviewedFingerprint,
  };
  advanceCaseToActivation({ store, caseId, target, subject, now });
  const approval = createExecutionHandoffApproval({ plan, caseId, correlationId: "C-execution-handoff", observedAt: now });
  store.addApproval({ caseId, target, approval });
  return { store, caseId, target, approval, subject };
}

export function advanceCaseToActivation({ store, caseId, target, subject, now = NOW }) {
  const facts = caseFactBuilder(subject, now);
  const nextAction = { kind: "NONE", command: null, skill: null, requiredInputs: [], blockingFacts: [], contextRoute: null, reasonCode: "TEST_FLOW" };
  const transition = (lane, stage, verdict, names, mutationId = null, rebind = false) => store.transition({
    caseId,
    target,
    checkpoint: { schema: "pi-ticket-planning:checkpoint:v2", lane, stage, verdict, subject },
    facts: facts(names, mutationId),
    mutationId,
    rebind,
    nextAction,
  });
  transition("PRODUCT", "FRAME", "FRAME_CANDIDATE", ["human.targetSelected"], null, true);
  transition("PRODUCT", "EVIDENCE", "EVIDENCE_RECORDED", ["evidence.persisted"]);
  transition("PRODUCT", "COMMIT", "COMMITTED", ["release.readinessPassed", "human.commitment", "release.persisted"]);
  transition("DELIVERY", "SPEC", "SPEC_ACCEPTED", ["human.commitment", "release.persisted", "release.accepted", "git.deliveryBase", "spec.persisted"]);
  transition("DELIVERY", "TICKETS", "TICKETS_ACCEPTED", ["spec.persisted", "tickets.persisted", "graph.passed", "human.graphApproval"], "M-handoff-tickets");
  transition("DELIVERY", "ADMISSION", "ACTIVATION_AWAITING_CONFIRMATION", ["source.unchanged", "policy.accepted", "review.ready"], "M-handoff-activation");
}
