---
name: prepare-codex-release
description: Compile an accepted Delivery Graph into one exact Codex Controller Release Plan, obtain one human handoff approval, and materialize Controller input without starting execution.
---

# Prepare Codex Release

Read [the Planning Case runtime](../planning-case-runtime.md), the accepted Delivery Spec, Delivery Graph checker, Ticket Context checks, review contract, [the execution handoff contract](../../execution-plan/contract.md), `compatibility/codex-controller-contract.json`, and the Case approval state. Do not load Legacy Admission apply, Harness readiness, Provider qualification, live adapters, ready-label mechanics, or Dispatcher mechanics.

This Skill owns only the lock-qualified `release-plan-v2-direct` integration. Require `dispatcherQualified=false` and `operatorStartRequired=true`. Resolve the Controller checkout containing the supplied CLI, require its tracked `HEAD` to equal the exact locked commit, and require a clean tracked worktree before build or apply. Return `CONTROLLER_CONTRACT_DRIFT` instead of silently accepting another Controller revision.

This is a mandatory Skill/operator preflight. The `execution-plan` CLI does not attest Controller source or binary provenance; without the exact checkout readback above, stop before invoking `build` or `apply`.

Never call `dispatch`, read a dispatcher config, require or write `ready-for-agent`, or convert the approved Release Plan v2 into a per-Issue Release Plan v1. A request to use continuous Dispatcher admission is a different integration and must stop outside this Skill.

1. Re-read the Parent and every Child; require open issues, exact graph/source/title/body bindings, PASS graph/frontier/context checks, accepted policy, AGENT-only lanes, and no external blockers. Return `CODEX_RELEASE_NOT_EXECUTABLE` for a HUMAN child or external blocker.
2. Dispatch exactly one fresh, read-only `ticket-readiness-reviewer` graph review using the held review input and exact dispatch binding. This reviews planning quality; it is not a per-Issue runtime code review.
3. Run `pi-ticket-plan execution-plan build`; show the complete embedded Controller Release Plan v2, Controller digests, exact locked Controller commit, and exact Handoff fingerprint. Keep every Ticket in `needs-triage`.
4. Stop for `pi-ticket-planctl case approve-handoff <case-id> --plan <file> --expected-fingerprint <exact sha256> --json`. A general “continue” is not approval.
5. Run `pi-ticket-plan execution-plan apply` with a fresh Context. It revalidates source, review, policy, Controller config/Plan, and live Controller doctor readiness with the same config digest before atomically materializing the three private files. Pre-checkpoint recovery repeats that validation and preserves existing files plus the pending approval on conflict or block.
6. Report the exact `node <controller-cli> start ... --expected-config-digest <approved-digest> --json` command printed by apply, but do not execute it.

Never start the Controller, write ready labels, run Codex, or wait for execution results.
