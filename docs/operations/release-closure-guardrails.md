# Release closure guardrails

A `delivery-release-graph:v3` is executable only when planning authority, verification authority, and write ownership remain closed through Controller handoff.

## Protected authority

Every AGENT child must list all of these exact repository files in `protectedPaths`:

- the tracked Spec acceptance receipt;
- the tracked decision manifest;
- the predecessor receipt when present;
- the effective policy;
- the product Release;
- every accepted decision or ADR in the decision manifest;
- every dependency handoff in the decision manifest;
- `package.json` and the direct repository verifier sources selected by the bound Oracle `npm run verify:*` script.

None of those paths may match an `expectedPaths` write family. A missing protection fails Admission before Controller handoff.

## One write owner

Within one executable Release, every `expectedPaths` family has one Ticket owner. Exact or wildcard families that can match the same path fail with `PATH_OWNERSHIP_OVERLAP`. This matches the Controller hardening rule that every changed path must have one exact Issue owner.

## Oracle execution

Binding immutable Oracle bytes is not enough. Every bound Oracle command must also appear exactly in the qualified Controller configuration's `validation.release` command list. Missing coverage fails handoff with `ORACLE_VALIDATION_COMMAND_MISSING`.

The Controller config digest and provenance bind that command set through build, verify, apply, and `start`.

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
