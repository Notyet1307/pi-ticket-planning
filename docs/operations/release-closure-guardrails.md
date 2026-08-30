# Release closure guardrails

A `delivery-release-graph:v3` is executable only when planning authority, verification authority, and write ownership remain closed through Controller handoff.

## Authority write exclusion

The Planner derives an immutable authority set from:

- the tracked Spec acceptance receipt;
- the tracked decision manifest;
- the predecessor receipt when present;
- the effective policy;
- the product Release;
- every accepted decision or ADR in the decision manifest;
- every dependency handoff in the decision manifest.

No path in that set may match any Ticket's `expectedPaths` write family. The rule is derived from the graph and does not depend on a Ticket author manually copying authority files into `protectedPaths`. A match fails Admission with `AUTHORITY_PATH_IN_EXPECTED_WRITE_SET` before Controller handoff.

The Oracle artifact itself remains explicitly listed in `protectedPaths` under the existing Ticket contract.

## Oracle verifier write exclusion

Each Oracle binding carries a closed `herdr-codex-controller:oracle-verifier-manifest:v1`. The independent verification owner explicitly lists the exact package script definition plus every verifier source, helper, and schema byte; the Planner does not infer this closure from imports or command text. Across the whole Release, `package.json` and every declared verifier file must remain outside every Ticket's `expectedPaths`. A match fails with `GLOBAL_ORACLE_VERIFIER_PATH_IN_WRITE_SET`.

Missing manifest shape fails with `ORACLE_VERIFIER_MANIFEST_MISSING`; manifest digest, package script, or declared file byte drift fails with `ORACLE_VERIFIER_BINDING_DRIFT`.

## One write owner

Within one executable Release, every `expectedPaths` family has one Ticket owner. Exact or wildcard families that can match the same path fail with `PATH_OWNERSHIP_OVERLAP`. This matches the Controller hardening rule that every changed path must have one exact Issue owner.

## Oracle execution

Binding immutable Oracle bytes is not enough. Every bound Oracle command must also appear exactly in the qualified Controller configuration's `validation.release` command list. Missing coverage fails the qualified build, verify, or apply path with `ORACLE_VALIDATION_COMMAND_MISSING`.

The Controller config digest and provenance bind that command set through handoff and `start`. The Controller executes each Ticket's Oracle before its commit, records a durable Validation Receipt v2, and runs every Oracle again during authoritative Release validation.

## Roadmap continuity

When an executable Release binds a Roadmap, the current Roadmap entry must match the v3 Release's:

- Scenario coverage;
- complete AGENT candidate set;
- Ticket IDs and titles;
- Ticket objectives;
- execution lane.

HUMAN Roadmap obligations remain outside the v3 graph. A mismatch requires the Roadmap or current Release to be rebuilt and re-approved.

## Recovery

These failures are planning conflicts, not hardening input. Keep Tickets in `needs-triage`, rebuild the graph from the fresh execution base, obtain a new review, and approve a new exact handoff fingerprint. Do not use retry or a ready label to bypass them.
