---
name: prepare-codex-release
description: Compile an accepted Delivery Graph into one exact Codex Controller Release Plan, obtain one human handoff approval, and materialize Controller input without starting execution.
---

# Prepare Codex Release

Read [the Planning Case runtime](../planning-case-runtime.md), the accepted Delivery Spec, Delivery Graph checker, Ticket Context checks, review contract, [the execution handoff contract](../../execution-plan/contract.md), `compatibility/codex-controller-contract.json`, and the Case approval state. Do not load Legacy Admission apply, Harness readiness, Provider qualification, live adapters, ready-label mechanics, or Dispatcher mechanics.

This Skill owns only the lock-qualified `release-plan-v2-direct` integration. Require `dispatcherQualified=false` and `operatorStartRequired=true`. Resolve the Controller checkout containing the supplied CLI, require its tracked `HEAD` to equal the exact locked commit, and require a clean tracked worktree before build or apply. The public identity readback must also match the locked source-manifest, build, and identity digests. Return `CONTROLLER_CONTRACT_DRIFT` on any mismatch.

The Git preflight and public provenance readback are both mandatory. `execution-plan` validates and fingerprints the public runtime identity/provenance, but that self-report does not prove the checkout is clean; without the exact Git readback above, stop before invoking `build` or `apply`.

Never call `dispatch`, read a dispatcher config, require or write `ready-for-agent`, or convert the approved Release Plan v2 into a per-Issue Release Plan v1. A request to use continuous Dispatcher admission is a different integration and must stop outside this Skill.

1. Re-read the immutable Parent/receipt, exact v3 graph, and every Child. Require one current all-AGENT Release, exact source/body bindings, PASS graph/frontier/context checks, and no external blocker. For every Ticket, re-read the frozen Oracle bytes at the execution base, verify its package-script allowlist, independent owner, protected write set, risk classes, scope budget, REPLAN triggers, integration-only contract, and exact review projection. Return the named stable Oracle/risk/scope error before Controller validation; use `CODEX_RELEASE_NOT_EXECUTABLE` only for other ineligible shapes.
2. Dispatch exactly one fresh, read-only `ticket-readiness-reviewer` graph review using the held review input and exact dispatch binding. Review every child in this one executable Release; this reviews planning quality and is not a per-Issue runtime code review.
3. Run `pi-ticket-plan execution-plan build`; show the complete embedded Controller Release Plan v2, exact locked Controller commit, source-manifest/build/identity/config/Plan/provenance digests, and exact Handoff fingerprint. Keep every Ticket in `needs-triage`.
4. Stop for `pi-ticket-planctl case approve-handoff <case-id> --plan <file> --expected-fingerprint <exact sha256> --json`. A general “continue” is not approval.
5. Run `pi-ticket-plan execution-plan apply` with a fresh Context. It revalidates source, review, policy, Controller config/Plan/provenance, and live Controller doctor readiness with the same config and identity before atomically materializing the three private files. Pre-checkpoint recovery repeats that validation and preserves existing files plus the pending approval on conflict or block.
6. Report the exact `node <controller-cli> start ... --expected-config-digest <digest> --expected-controller-revision <revision> --expected-controller-provenance-digest <digest> --json` command printed by apply, but do not execute it.

Never start the Controller, write ready labels, run Codex, or wait for execution results.
