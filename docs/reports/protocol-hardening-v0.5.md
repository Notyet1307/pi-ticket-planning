# Protocol hardening v0.5 report

Status: alpha implementation evidence, not production qualification.

## Implemented

- Versioned Registry, schemas, Rule IDs, Fact Attestation, combination/identity
  validation, Mutation postconditions, and protocol model checker.
- Private persistent Planning Cases with locks, event replay, intents, crash
  recovery, Result Envelopes, route Context Manifests, and control CLI.
- Admission modules, exact Reviewer transport/binding, Capability Receipt and
  compatibility gate, author/body readback, and preserved Plan v1 algorithm.
- Dry-run Profile update/migration/rollback with manifest and retained snapshots;
  read-only Outcome ingestion and human learning gate.
- L1/Mock, L2, guarded L3, L4 qualification workflows, negative security tests,
  benchmark, SECURITY policy, and threat model.

## Evidence boundaries

L1 and Mock commands were executed locally. The enforced core coverage result is
100% lines, 93.91% branches, and 98.71% functions: Protocol Kernel 97.28%
branches, Planning Case Store 90.21%, and Admission recovery 93.59%. The latest
benchmark exercised 100/500/1000 Ticket graphs and 10/50 Cases without a
relative regression.

The installed Profile isolation check passed with 27 Skills. Static Doctor was
`DEGRADED` because Docker was unavailable. Provider/model and Harness inputs
were unconfigured, so runtime capabilities and the exact compatibility tuple
remain `UNTESTED`; no active probe or model test was attempted. The live adapter
is absent and `release:qualify` correctly returns `BLOCKED` with zero real E2E
and zero Provider/model coverage.

The initial `npm ci` failed because v0.4 had no lockfile; v0.5 adds one. No
production version, GitHub release, deployment, Admission activation, or Harness
run is claimed by this report.
