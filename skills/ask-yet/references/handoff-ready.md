# Handoff-ready routing contract

Use this reference only for `EXECUTION / HANDOFF_READY`. Read the durable `execution.handoffReady` Fact Attestation and branch by its registered source; do not infer the executor from labels, prose, or conversation history.

## Controller Release Handoff

When `source.kind == execution-plan-apply` and evidence binds the exact `release-plan.json` fingerprint:

- `HANDOFF_READY` means the one private Plan passed exact readback and approval was consumed once. It does not mean Controller execution started.
- Report the exact stored `node <controller-cli> start ... --approve-plan <planDigest>` next command and the Plan fingerprint. Do not execute it without a new explicit operator request.
- Do not read or write ready labels, wait for a claim, poll Controller execution, create a Worktree/branch/commit/PR, or read private `job.json`.
- Keep the Planning Case at `HANDOFF_READY` until a public `release-result:v1` is explicitly supplied for ingestion; do not infer execution, review, PR/CI, or merge state.

## Legacy Herdr handoff

When `source.kind == admission-cli` and evidence binds the exact legacy Admission Plan:

- `HANDOFF_READY` means the approved ready labels and relationships were written and no Harness claim is active yet.
- Harness may be offline without invalidating planning handoff. On a later status request, use the Legacy [execution and closeout contract](execution-closeout.md) and its owning ledger facts.
- Never remove a ready label, retry, recover, or edit claimed work outside the explicit Legacy policy.

Any other producer, missing Plan binding, or disagreement between the Fact and durable file/labels is `BLOCKED`; report the exact conflict and do not choose an executor.
