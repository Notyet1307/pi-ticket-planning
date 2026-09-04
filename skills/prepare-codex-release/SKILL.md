---
name: prepare-codex-release
description: Compile an accepted Delivery Graph into one semantic Release Plan, choose the Goal or Controller execution channel, obtain one exact human approval, and materialize the selected handoff without starting execution.
---

# Prepare Codex Release

Read [the Planning Case runtime](../planning-case-runtime.md), [the semantic release contract](../../execution-plan/contract.md), [the Release closure guardrails](../../docs/operations/release-closure-guardrails.md), and the current Case approval state.

The shared semantic boundary is one `release-plan.json` v1, unchanged across channels. Planner owns the accepted Spec, Delivery Graph, decisions, review, Oracle, scope, freshness, channel recommendation, and approval facts. The selected executor owns runtime state and implementation.

1. Fresh-read the remote base, Parent/Children, tracked Spec/result/decision/handoff bindings, and Oracle bytes. Require one blocker-free all-AGENT v3 Release with passing graph, frontier, Context, and Release closure checks. This step is complete when every Planner-owned binding matches the current execution base.
2. Dispatch one fresh, read-only `ticket-readiness-reviewer` graph review for the whole Release. This step is complete only with an exact READY review binding for every included child.
3. Run live `pi-ticket-plan execution-plan build --repo ... --parent ... --context ... --out <release-plan.json>`. Display the complete semantic Plan and its `sha256:` fingerprint. Keep every Ticket in `needs-triage`.
4. Recommend `GOAL_LOCAL` when every Ticket is normal/low risk and the operator will supervise and merge manually. Use `GOAL_REMOTE` only after the operator names one configured runner. Recommend `CONTROLLER` for any high-risk Ticket, unattended work, automatic delivery, or audit-grade execution. This recommendation never starts execution.
5. For `CONTROLLER`, stop for the existing `case approve-handoff`, then run the existing `execution-plan apply` unchanged; its start command remains bound by `--approve-plan <planDigest>`.
6. For Goal, load one private 0600 `goal-runner-config:v1` allowlist and run `pi-ticket-plan execution-plan goal-build --plan ... --context ... --channel GOAL_LOCAL|GOAL_REMOTE --runner-ref ... --runners <config> --out <goal-handoff.json> --json`. Display the complete envelope and fingerprint, then stop for `pi-ticket-planctl case approve-goal-handoff <case-id> --handoff <goal-handoff.json> --expected-fingerprint <exact sha256> --json`. General continuation text is not approval.
7. Run `pi-ticket-plan execution-plan goal-apply --runners <same config>` with fresh live Context, the exact Goal approval, and a private output directory. The allowlisted runner digest and host must still match. Exact readback must find only `goal-handoff.json`; the Case becomes `HANDOFF_READY`, and approval is consumed once.
8. Report the selected handoff's exact printed start command. Leave execution to the operator.

The semantic contract version is `controllerContractVersion: 1`. Controller revision, build identity, provenance, runtime locks, identity history, and old Completion formats are not handoff inputs.

This skill does not start an executor, write ready labels, invoke Codex, or wait for execution results. A failed Goal target never falls back to another target or to Controller without a new exact handoff approval.
