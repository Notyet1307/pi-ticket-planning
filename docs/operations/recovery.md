# Recovery

Planning Case recovery is dry-run first:

```sh
pi-ticket-planctl case verify PC-ID --json
pi-ticket-planctl case recover PC-ID --dry-run --json
pi-ticket-planctl case recover PC-ID --json
```

Only a dead, old lock is removable. Pending intents roll forward; event/snapshot
drift rebuilds from the verified event chain. Corrupt events, an active lock,
unsafe permissions, links, cross-target substitution, or binding drift remain
blocked.

Profile operations are also dry-run by default:

```sh
pi-ticket-planctl update --dry-run --json
pi-ticket-planctl migrate --dry-run --json
pi-ticket-planctl rollback --to I-ID --dry-run --json
```

Use `--apply` only after reviewing the exact managed paths. Locally modified
managed files cause a conflict. Install transactions retain private backups and
snapshots; rollback never reverses GitHub comments, labels, Issues, PRs, or
Harness delivery.

An Admission `PARTIAL` result may reuse only the unchanged Plan and still-pending
Planning Case approval. `COMPLETE` records `APPROVAL_CONSUMED`; reusing that
approval is `APPROVAL_ALREADY_CONSUMED` and performs no write.
`CONFLICT`, Source/Policy/Body/Graph/Context/Label/readiness/capability drift, or a
Harness claim requires a new path-specific decision; no compensating label
removal is automatic.

Evidence migrations are also fail closed. `scripts/migrate-evidence-reports.mjs`
requires supplied commit, workflow, tuple, time, and evidence digests; a legacy
report without reconstructable provenance returns `LEGACY_PROVENANCE_UNAVAILABLE`.
Do not repair a report or Compatibility Matrix by hand. Rerun the exact L2/L3
workflow, then Qualification, and apply only its digest-bound proposal.

For an interrupted disposable run, use the report's retained
`recoveryCommand`, confirm the exact `ptp-e2e:<run-id>` marker, close remaining
run-owned Issues, and verify no tagged open resources remain. Never broaden the
cleanup query or reuse the package repository as the disposable target.
The command consumes the private 0600 `PTP_E2E_STATE` manifest, verifies the
exact repo/run/actor plus every declared marker/title/time binding, performs
per-Issue readback, removes the run label, and is idempotent after completion.
Any untracked resource makes cleanup fail without closing it.
If a runner is lost, dispatch `Disposable integration cleanup` with the same
repo/run ID. It reconstructs the manifest from the run's exact GitHub control
Issue and still requires `PTP_E2E_ALLOWLIST`; it does not trust a new local JSON
replacement.
