# Controlled Beta operations

Controlled Beta is available only when the current commit's Qualification is
`COMPLETE` and the exact runtime tuple is `SUPPORTED` in the Compatibility
Matrix.

The repository remains Alpha until that statement is true. L1 success, an
installed Profile, configured credentials, or a locally generated report does
not change the release state.

| Priority | Current risk | Owner | Exit condition |
| --- | --- | --- | --- |
| P0 | No current-commit SUPPORTED tuple and no complete L2/L3/L4 chain | Release operator | Attested reports pass Gates D-G and the proposal binds the exact tuple |
| P1 | Single-maintainer rules cannot require an independent approval without lockout | Repository maintainer | Add a second trusted reviewer, then require one non-bypass approval |

## Allowed

- named operators and an explicit repository allowlist;
- one exact supported Pi, subagent, Provider, Model, Thinking, Profile, and
  Harness tuple;
- human confirmation of one Admission Plan fingerprint;
- controlled GitHub Admission with per-write readback;
- observable Harness handoff and Outcome receipt ingestion.

## Not allowed

- unattended writes to production repositories or organization-wide rollout;
- unknown Provider, Model, Profile, Harness, or expired Capability receipt;
- a skipped Reviewer, Capability check, Plan approval, readback, or cleanup;
- silent fallback from the qualified tuple or acceptance of `PARTIAL` or
  `CONFLICT` as success.

## Run contract

1. Run `pi-ticket-planctl doctor --capabilities --active-probe --json`.
2. Require an unexpired receipt and an exact `SUPPORTED` Matrix tuple.
3. Require the repository allowlist and an online Planning Case resume.
4. Bind every mutation to its Case ID, correlation ID, and Plan fingerprint.
5. Stop for human handling on `PARTIAL` or `CONFLICT`; resume the same durable
   transaction after exact external readback.

Offline resume is `DEGRADED` and cannot authorize an external mutation.

Release artifacts are built only from `0.5.0-beta.1` after a `COMPLETE`
current-commit Qualification and its provenance-verified `SUPPORTED` Matrix proposal. Verify
the downloaded Qualification and proposal attestations, `SHA256SUMS`, SBOM,
no-Git install smoke, migration, and rollback documents before installation.

The evidence sequence is intentionally split across completed workflows:

1. Run Model evaluation and Disposable integration for the exact commit.
2. Run Release qualification with those exact successful run IDs.
3. After that workflow has completed and its report is attested, run
   Compatibility proposal with the Qualification and Capability run IDs.
4. Review the proposal digest. Build release artifacts from that successful
   proposal run; the builder derives the installable Matrix without dirtying or
   changing the qualified source commit.
5. If a maintainer also persists the entry in the source Matrix,
   `compatibility apply` requires the same attested Qualification, exact
   Capability receipt, proposal, and expected proposal digest. Commit it in a
   dedicated PR and requalify that new HEAD; direct JSON editing is invalid and
   the resulting commit is not evidence for the earlier Qualification.
6. The installable
   archive receives the qualification-derived Matrix entry without changing the
   source commit it qualifies. Verify each attestation and `SHA256SUMS` before
   installing or rolling back.

Download into a new directory, then verify before extraction:

```sh
gh run download PROPOSAL_RUN_ID --repo OWNER/REPO --dir ./proposal
gh run download ARTIFACT_RUN_ID --repo OWNER/REPO --dir ./release
(cd ./release && shasum -a 256 -c SHA256SUMS)
gh attestation verify ./release/pi-ticket-planning-0.5.0-beta.1-installable.tar.gz \
  --repo OWNER/REPO \
  --signer-workflow github.com/OWNER/REPO/.github/workflows/release-artifacts.yml \
  --source-digest COMMIT
```

After extraction, run `npm ci --ignore-scripts --no-audit --no-fund`, static
Doctor, Profile update dry-run, install/update, Profile verification, then a
fresh active Capability probe. Use the exact installation ID and
`docs/operations/rollback.md` if any step fails.
