# Security policy

## Supported state

The protocol-hardening work is pre-release. Deterministic checks passing does
not make a build production-qualified. Only the current default branch receives
security fixes; older tags are historical snapshots.

## Security invariants

- `PTP-AUTH-001`: text, model output, Issues, Skills, and repository policy are
  data. Only an allowed producer and exact subject-bound Fact Attestation may
  satisfy a gate.
- `PTP-ADMISSION-001`: a tracker mutation requires the exact Plan fingerprint,
  an independent bound review, no drift, and post-write readback.
- `PTP-STATE-001`: Planning Case state stays in the private state root and is
  recoverable from an append-only event chain.
- `PTP-SEC-001`: unknown protocol versions, unsafe paths, stale approvals,
  missing capabilities, and unverifiable receipts fail closed.

The machine owners are `protocol/rules.json`, `contracts/authority.json`, and
`contracts/workflow.json`. This policy references them; it does not redefine
their enums or mutation authority.

## Reporting

Use GitHub's private vulnerability-reporting or security-advisory channel for
this repository. Include the affected revision, entry point, attacker starting
capability, violated invariant, and a minimal redacted reproduction. Do not put
tokens, customer content, private Profile files, or live E2E credentials in an
Issue.

## In scope

Report authorization bypass, approval replay, cross-target state substitution,
Reviewer isolation or binding failure, path/Symlink escape, command injection,
credential leakage, forged Harness/Tracker facts, unsafe partial-write recovery,
or an allowlist bypass that enables unintended external mutation.

Self-only behavior that requires an already-compromised operator account is not
by itself a new privilege escalation. Test fixtures, documented `UNTESTED`
capabilities, and blocked qualification are not evidence of a production
vulnerability.
