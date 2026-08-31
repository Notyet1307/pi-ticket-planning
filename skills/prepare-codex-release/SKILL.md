---
name: prepare-codex-release
description: Compile an accepted Delivery Graph into one semantic Codex Controller Release Plan, obtain one exact human approval, and materialize Controller input without starting execution.
---

# Prepare Codex Release

Read [the Planning Case runtime](../planning-case-runtime.md), [the semantic release contract](../../execution-plan/contract.md), [the Release closure guardrails](../../docs/operations/release-closure-guardrails.md), and the current Case approval state.

The boundary is one `release-plan.json`. Planner owns the accepted Spec, Delivery Graph, decisions, review, Oracle, scope, freshness, and approval facts. Controller owns config, runtime policy, implementation, validation, aggregate review, PR, CI, and exact-head merge.

1. Fresh-read the remote base, Parent/Children, tracked Spec/result/decision/handoff bindings, and Oracle bytes. Require one blocker-free all-AGENT v3 Release with passing graph, frontier, Context, and Release closure checks. This step is complete when every Planner-owned binding matches the current execution base.
2. Dispatch one fresh, read-only `ticket-readiness-reviewer` graph review for the whole Release. This step is complete only with an exact READY review binding for every included child.
3. Run live `pi-ticket-plan execution-plan build --repo ... --parent ... --context ... --out <release-plan.json>`. Display the complete semantic Plan and its `sha256:` fingerprint. Keep every Ticket in `needs-triage`.
4. Stop for `pi-ticket-planctl case approve-handoff <case-id> --plan <release-plan.json> --expected-fingerprint <exact sha256> --json`. General continuation text is not approval.
5. Run `pi-ticket-plan execution-plan apply` with fresh live Context, the exact approval, Controller CLI/config paths, and a private output directory. This step is complete when exact readback finds only `release-plan.json`, the Case is `HANDOFF_READY`, and approval is consumed once.
6. Report the printed `node <controller-cli> start --config ... --plan ... --approve-plan <planDigest> --json` command. Leave execution to the operator.

The semantic contract version is `controllerContractVersion: 1`. Controller revision, build identity, provenance, runtime locks, identity history, and old Completion formats are not handoff inputs.

This skill does not start Controller, call Dispatcher, write ready labels, invoke Codex, or wait for execution results.
