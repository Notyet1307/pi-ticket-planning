# Codex Controller semantic mainline

## Boundary

```text
accepted delivery-release-graph v3
→ human-approved release-plan.json
→ Controller Prepare Gate, offline implementation/validation/review, optional required Demo, PR, CI, and exact-head merge
→ review.md + release-result.json
```

Planner owns WHAT. Controller owns HOW. The shared compatibility key is `controllerContractVersion: 1`; neither repository pins the other's commit, build bytes, executable paths, schema ownership hashes, runtime lock, or identity history.

## Handoff

Build and approve the Plan from fresh live Planner inputs. Apply writes one private file and prints a start command with one approved digest:

```bash
herdr-codex start \
  --config /private/controller.json \
  --plan /private/release-plan.json \
  --approve-plan <64-hex-plan-digest>
```

The Controller independently validates its trusted operator config, target remote, exact base, Parent/Issues, sandbox, candidate, required CI, PR, and merge result.

On an explicit status/resume request, `ask-yet` may run the exact stored Controller CLI/config as `status --job <release-id> --public --json` once. It verifies the approved Plan identity, never reads `job.json`, never polls or persists runtime state, and suppresses the stale start action once a Job exists.

## Result

After verified merge, export and ingest the public result:

```bash
npm run ingest:release-result -- \
  --result /public/release-result.json \
  --plan /private/release-plan.json \
  --out /private/accepted-result.json \
  --json
```

The result contains only release/Plan identity, base and candidate SHAs, PR number/URL, final required-check names/status, merge SHA, completion time, and optional review report digest. Ingestion requires the approved Plan and checks `releaseId + planDigest + baseSha`. It does not contain private Job state or Controller provenance.

## Cross-repository check

Build the current Controller checkout, then run:

```bash
HERDR_CONTROLLER_ROOT=/absolute/herdr-codex-controller npm run check:codex-controller-contract
```

This validates Planner Plan fixtures in Controller, Controller Public Status routing, Controller Result fixtures in Planner, identical Plan/Result schemas, and unsupported major rejection. It is a semantic compatibility check, not live delivery evidence.

## Compatibility cutoff

New handoffs accept only contract v1 Plan and Result v1. Completion v1-v3, Release Plan v2, execution-handoff plan/receipt, exact-build locks, trust registries, and identity history are not read by this release. Historical exported artifacts remain in Git history or external archives; they are not runtime compatibility paths.
