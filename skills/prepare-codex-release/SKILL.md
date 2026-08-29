---
name: prepare-codex-release
description: Compile an accepted Delivery Graph into one exact Codex Controller Release Plan, obtain one human handoff approval, and materialize Controller input without starting execution.
---

# Prepare Codex Release

Read [the Planning Case runtime](../planning-case-runtime.md), the accepted Delivery Spec, Delivery Graph checker, Ticket Context checks, review contract, [the execution handoff contract](../../execution-plan/contract.md), [the Release closure guardrails](../../docs/operations/release-closure-guardrails.md), `compatibility/codex-controller-contract.json`, and the Case approval state. Do not load Legacy Admission apply, Harness readiness, Provider qualification, live adapters, ready-label mechanics, or Dispatcher mechanics.

This Skill owns only the lock-qualified `release-plan-v2-direct` integration. Require `dispatcherQualified=false` and `operatorStartRequired=true`. Resolve the Controller checkout containing the supplied CLI, require its tracked `HEAD` to equal the exact locked commit, and require a clean tracked worktree before build or apply. The public identity readback must also match the locked source-manifest, build, and identity digests. Return `CONTROLLER_CONTRACT_DRIFT` on any mismatch.

The Git preflight and public provenance readback are both mandatory. `execution-plan` validates and fingerprints the public runtime identity/provenance, but that self-report does not prove the checkout is clean; without the exact Git readback above, stop before invoking `build` or `apply`.

Never call `dispatch`, read a dispatcher config, require or write `ready-for-agent`, or convert the approved Release Plan v2 into a per-Issue Release Plan v1. A request to use continuous Dispatcher admission is a different integration and must stop outside this Skill.

1. Fresh-read the remote base ref/SHA, immutable Parent/Child bodies, tracked Spec receipt, decision manifest and every bound policy/Release/accepted-ADR blob, predecessor receipt, dependency handoffs, and Oracle bytes. Require the current base to follow the declared planning/predecessor ancestry policy and one all-AGENT v3 Release with PASS graph/frontier/context checks. Return `EXECUTION_BASE_DRIFT`, `DECISION_MANIFEST_DRIFT`, `PREDECESSOR_RECEIPT_DRIFT`, `DEPENDENCY_HANDOFF_DRIFT`, or `ORACLE_BINDING_DRIFT` before Controller validation; use existing Oracle/risk/scope codes and `CODEX_RELEASE_NOT_EXECUTABLE` only for other shapes.
2. Require Release closure before review or handoff: no Ticket `expectedPaths` may own a Spec/decision/predecessor receipt, policy, product Release, accepted ADR, dependency handoff, `package.json`, or direct Oracle verifier source; every write family has exactly one Ticket owner; and a bound Roadmap entry exactly matches current Scenario coverage plus AGENT Ticket membership, title, objective, and lane. Fail closed with the specific authority, verifier, ownership, or Roadmap code rather than deferring the conflict to Controller hardening.
3. Dispatch exactly one fresh, read-only `ticket-readiness-reviewer` graph review using the held review input and exact dispatch binding. Review every child in this one executable Release; this reviews planning quality and is not a per-Issue runtime code review.
4. Run live `pi-ticket-plan execution-plan build --repo ... --parent ... --context ...`; offline `--input` is forbidden. The qualified Controller config must include every bound Oracle `npm run verify:*` command exactly in `validation.release`; otherwise stop with `ORACLE_VALIDATION_COMMAND_MISSING`. Show the complete embedded Controller Release Plan v2, fresh-source projection, exact locked Controller commit, source-manifest/build/identity/config/Plan/provenance digests, and exact Handoff fingerprint. Keep every Ticket in `needs-triage`.
5. Stop for `pi-ticket-planctl case approve-handoff <case-id> --plan <file> --expected-fingerprint <exact sha256> --json`. A general “continue” is not approval.
6. Run `pi-ticket-plan execution-plan apply` with a fresh live Context. It repeats every remote/body/receipt/decision/handoff/Oracle read plus review, policy, Release closure, Controller config/Plan/provenance, Oracle-command coverage, and Controller doctor readiness checks; persists `HANDOFF_APPROVED` with approval pending; materializes and verifies the three private files; then records `HANDOFF_READY` and consumes approval. Drift preserves the current durable boundary for recovery.
7. Report the exact `node <controller-cli> start ... --expected-config-digest <digest> --expected-controller-revision <revision> --expected-controller-provenance-digest <digest> --json` command printed by apply, but do not execute it.

Never start the Controller, write ready labels, run Codex, or wait for execution results.

Legacy v2 is never a handoff input. Use `node scripts/migrate-artifacts.mjs --artifact delivery-graph-v2 --input ... --context ... --dry-run true`; it emits only `PLANNED`, human-approval-required v3 and/or Roadmap candidates.
