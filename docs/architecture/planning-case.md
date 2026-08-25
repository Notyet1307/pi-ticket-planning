# Planning Case

`planning-case/store.mjs` is one deep state interface. Its default root is
`~/.local/state/pi-ticket-planning/`; `PI_TICKET_PLAN_STATE_DIR` selects another
private root. A Case is partitioned by target hash and Case ID and contains a
canonical snapshot, append-only event log, exclusive lock, private transactions,
and receipts.

Every mutation writes an intent, fsyncs the event, atomically replaces the
snapshot, and marks the transaction complete. A crash at any step leaves an
explicit recovery action. Event replay must reconstruct the snapshot; a mismatch
is `RECOVERY_REQUIRED`, never an ignored line. Locks are removed only by normal
ownership release or explicit stale-lock recovery after PID liveness and age
checks.

`pi-ticket-planctl case resume <id> --json` returns the checkpoint, blocker,
single next action, exact route Context Manifest, artifact bindings, capability
compatibility, and recovery command. It reads no chat history. Skills call the
CLI or store interface; direct JSON edits are unsupported.

`case approve <id> --plan <file> --expected-fingerprint <sha256> --json` is the
operator entry for Admission activation. It records a one-hour FactAttestation
bound to the case target, source revision, and exact Plan digest. Apply leaves it
pending across `PARTIAL`, then appends one consumed event after all mutation
postconditions pass.
