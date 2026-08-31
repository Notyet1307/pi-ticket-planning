# Secure operations

- Keep `PI_TICKET_PLAN_STATE_DIR` on a local filesystem owned by the operator.
  Case directories are `0700`; files are `0600`. Recovery is explicit and
  dry-run first.
- Treat `installation.json`, Capability Receipts, Admission Plans, and Outcome
  Receipts as private metadata. They contain digests and paths, not credentials.
- Run `pi-ticket-planctl doctor --capabilities --active-probe --json` after any
  Pi, Subagent, Provider/model, Profile, Harness, repo/base, or config change.
  An expired or unmatched tuple is not supported.
- A live integration run requires all of `PI_TICKET_PLAN_E2E=1`, one exact
  `E2E_REPO` in `E2E_ALLOWLIST`, and the run-bound confirmation. Every created
  resource uses `ptp-e2e:<run-id>` and retains a cleanup command on failure.
- Review a Plan fingerprint, record it with `case approve`, and pass that exact
  Case/approval ID to Apply. Rebuild the Plan after Source, Policy, Body, Graph,
  Context, Label, readiness, or capability drift. A consumed approval is never
  reusable.
- Preserve `PARTIAL` and `CONFLICT` results. Re-run the same unchanged Plan only
  for an explicitly resumable partial write; never compensate after a Harness
  claim.
- For a Controller handoff, verify the supplied checkout is clean and exactly at
  the generated active lock. Require config/provenance v3 public readback and
  live doctor success before approval/materialization. Planner prints but never
  executes the exact-bound `start` command.
- Ingest only a public Controller completion v2/v3. The resulting predecessor
  receipt v3 must bind a non-revoked active or historical identity, owned schema,
  and immutable qualification digest while the current registry supplies revocation.
  Never substitute private Job files or status output.
- Keep auth and model credential files outside installation manifests and
  reports. Error rendering redacts credential-shaped values and truncates
  external text.
