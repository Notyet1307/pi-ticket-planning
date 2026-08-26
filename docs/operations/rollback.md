# Rollback

Rollback is exact-installation recovery, not a version guess.

1. Inspect `installation.json` and retain its `installationId`, installed-file
   digests, and backup records.
2. Dry-run `pi-ticket-planctl rollback --to <installation-id> --json`.
3. Stop on managed-file drift; preserve the conflicting file for human review.
4. Apply the exact dry-run target with `--apply`, then rerun Profile verification
   and active Capability probes.
5. Keep the newer Compatibility entry unavailable until it is qualified again
   on the restored installation.

An interrupted install is recovered from its private transaction directory with
`recoverInstallation`; a `COMPLETE` manifest is written only after Profile and
extension verification succeeds.
