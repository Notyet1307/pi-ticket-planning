# Handoff-ready routing contract

Use this reference only for `EXECUTION / HANDOFF_READY`. Read the durable `execution.handoffReady` Fact Attestation and branch by its registered source; do not infer the executor from labels, prose, or conversation history.

## Controller Release Handoff

When `source.kind == execution-plan-apply` and evidence binds the exact `release-plan.json` fingerprint:

- `HANDOFF_READY` means the one private Plan passed exact readback and approval was consumed once. It does not mean Controller execution started.
- Outside an explicit STATUS or RESUME request, report the exact stored `node <controller-cli> start ... --approve-plan <planDigest>` next command and the Plan fingerprint. Do not execute it without a new explicit operator request.
- For explicit STATUS or RESUME, use the exact Controller CLI/config identities from that stored command and the Plan `id` to run `node <controller-cli> status --config <controller-config> --job <release-id> --public --json` once. This read is on demand: do not poll, start, retry, abort, or write state.
- Accept a returned status only when `id`, `repo`, `planDigest`, and `baseSha` match the approved Plan (`planDigest` is the exact 64-hex `--approve-plan` value). Treat any mismatch, malformed output, or error other than exact `job_not_found` as `Controller: STATUS_UNAVAILABLE`; fail closed and do not guess whether execution started.
- Never copy the public JSON into the Planning Case. It may override only the current response's displayed next action; the durable Checkpoint and stored start command remain Planner-owned `HANDOFF_READY` state.

Route a valid public result as follows:

- Exact `job_not_found`: display `Planning handoff: HANDOFF_READY`, `Controller: NOT_STARTED`, and the exact stored start command. This is the only route that still displays start as the current action.
- `running`: display `Planning handoff: still valid`, `Controller: RUNNING / <phase>`, and `Next: continue with Controller run/step`. Never suggest starting the same Job again.
- `blocked / recoverable`: display `Planning handoff: still valid`, `Controller: BLOCKED / recoverable`, `Owner: Operator / Controller maintenance`, and `Next: fix the environment, then explicitly retry`. Do not change Spec, Graph, Tickets, or Plan.
- `blocked / manual`: display `Planning handoff: still valid`, `Controller: BLOCKED / manual`, and `Next: inspect the public summary plus private operator evidence; a human chooses retry, manual repair, or abort then replan`. Do not choose automatically.
- `blocked / replan_required`: display `Planning handoff: current Plan cannot continue`, `Controller: BLOCKED / replan_required`, and `Next: explicitly abort the old Job`. Only after the abort is confirmed may Planner update planning material, run a fresh review, obtain exact approval, and hand off a new Job.
- `completed`: require an explicit existing `release-result:v1` export and ingestion. Public status is not merge authority and cannot replace the Result.
- `failed`, an unknown status/kind, or `legacy=true` with inconsistent fields: stop for operator inspection. Never reconstruct a cause from `blocked.message` or private state.

- Do not read or write ready labels, wait for a claim, create a Worktree/branch/commit/PR, or read private `job.json`.
- Keep the Planning Case at `HANDOFF_READY` until a public `release-result:v1` is explicitly supplied for ingestion; do not infer execution, review, PR/CI, or merge state.

## Goal Release Handoff

When `source.kind == goal-handoff-apply` and evidence binds the exact `goal-handoff.json` fingerprint:

- `HANDOFF_READY` means one `GOAL_LOCAL` or `GOAL_REMOTE` target and the embedded Release Plan passed exact readback and consumed one dedicated approval. It does not mean the Goal Runner started.
- Outside an explicit STATUS or RESUME request, report the exact stored Goal Runner start command and handoff fingerprint. Do not execute it without a new explicit operator request.
- For explicit STATUS, derive the read-only `herdr-codex-goal status --config ... --run-id <release-id> --json` invocation from the exact stored start identities. For `GOAL_REMOTE`, run that status command through the same approved `runnerRef`. Read once; do not poll, start, step, resume, push, or merge.
- Accept status only when `id`, `repo`, `planDigest`, `baseSha`, `channel`, and `runnerRef` match the approved handoff. Malformed output, an unavailable runner, or any mismatch is `Goal Runner: STATUS_UNAVAILABLE`; do not guess.
- `running`: show the current phase, Ticket, bounded Goal usage, and `Next: continue Goal Runner step/run`.
- `blocked`: preserve its `recoverable | manual | replan_required` kind. A human explicitly chooses resume or new planning; Planner never switches target or channel automatically.
- `review_ready`: show the exact candidate identity and `Next: human push/PR/review/merge`; a model Goal status is not merge evidence.
- `completed`: require the public `pi-ticket-planning:goal-release-result:v1` plus the private approved handoff; ingestion must match release, Plan, base, handoff fingerprint, channel, and runner, then emit `goal-result-acceptance:v1`. Only that acceptance may enter a downstream Graph. Status cannot replace it.
- `failed` or an unknown status: stop for operator inspection.

Keep the Case at `HANDOFF_READY` until the Goal Result is explicitly ingested. Never read Goal private state, Codex rollout files, absolute Worktree paths, or Controller `job.json`.

## Legacy Herdr handoff

When `source.kind == admission-cli` and evidence binds the exact legacy Admission Plan:

- `HANDOFF_READY` means the approved ready labels and relationships were written and no Harness claim is active yet.
- Harness may be offline without invalidating planning handoff. On a later status request, use the Legacy [execution and closeout contract](execution-closeout.md) and its owning ledger facts.
- Never remove a ready label, retry, recover, or edit claimed work outside the explicit Legacy policy.

Any other producer, missing Plan binding, or disagreement between the Fact and durable file/labels is `BLOCKED`; report the exact conflict and do not choose an executor.
