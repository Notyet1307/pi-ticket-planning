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

An Admission `PARTIAL` result may reuse only the unchanged Plan and approval.
`CONFLICT`, Source/Policy/Body/Graph/Context/Label/readiness/capability drift, or a
Harness claim requires a new path-specific decision; no compensating label
removal is automatic.
