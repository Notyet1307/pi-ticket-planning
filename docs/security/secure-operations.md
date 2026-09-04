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
- For a Controller handoff, approve the exact semantic Plan fingerprint. Apply
  materializes only `release-plan.json` and prints but never executes
  `start --approve-plan <planDigest>`. Controller performs its own runtime and
  delivery preflights.
- For a Goal handoff, select only a private-allowlisted runner, approve the
  envelope including runner digest and host, and verify that same entry at
  apply. Remote execution uses the allowlisted SSH target and remote hostname.
- Ingest only public `release-result:v1`, bound to the expected release, Plan,
  and base. Goal ingestion also requires its private approved handoff and emits
  `goal-result-acceptance:v1`; a raw Goal Result cannot enter a later Graph.
- Keep auth and model credential files outside installation manifests and
  reports. Error rendering redacts credential-shaped values and truncates
  external text.
