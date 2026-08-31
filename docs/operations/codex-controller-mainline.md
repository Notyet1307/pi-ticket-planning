# Qualified Codex Controller mainline

## Scope

The only qualified production integration is:

```text
accepted delivery-release-graph v3
→ human-approved Planner handoff
→ execution-handoff-plan v2 carrying Release Plan v2 and provenance v3
→ operator executes the printed Controller start command
→ Controller-owned validation, review, PR, required CI, exact-head auto-merge, and completion v3
```

Planner never starts a Job, reads private Controller state, or grants merge authority. Dispatcher, `ready-for-agent`, per-Issue Plan v1, Legacy Herdr admission, automatic rebase, and Oracle v2/package mutation remain outside this contract.

## Exact identity and versions

`compatibility/codex-controller-contract.json` is generated from a clean build of merged Controller A+B commit `4d6295af2f1533a8fee5ffe1d420241bc1f5bcba`:

```text
source manifest = 5a6a2a719d3489b50d856ec06315a47b5de05c4e8ce76da6ea854b5edf218601
build           = 43ae3e1037537c0afb400a23429f6ff6573c6120108f3981507ecf78350aad0a
identity        = 305d3c59024c7925d71d91126e61968246824353477b7b0e0e970abddb2d6f57
config          = v3
provenance      = v3
Job state       = v4
completion      = v3
integration     = release-plan-v2-direct
Dispatcher      = unqualified
operator start  = required
```

New handoffs must select that active identity. `compatibility/codex-controller-trust.json` also retains Controller A commit `1d532133657e763f8e50429774eabf01c45f98e9`, identity `310bc0727db0dd94eb9369320416c4b4230ffc14be161c765c5d388d917e4d04`, as historically qualified for completion v2 only. A non-revoked A completion remains valid after B activation; unknown or revoked identities do not.

## Production gates

Before handoff approval/materialization, the public Controller contract must prove:

- exact active Controller source/build identity and clean checkout;
- config v3, direct-v2 mode, canonical review enabled, and blocking severities exactly `critical` plus `major`;
- verified disposable validation sandbox, network denial, fixed runtime identity, and no custom profile;
- exact target Git fetch/push identity;
- versioned, unambiguous App/workflow-bound required checks and accepted conclusions;
- Controller-owned strict exact-head auto-merge and expected-head branch quarantine;
- matching Plan/config/runtime/check/merge/history provenance digests.

The same canonical delivery proof is used before push/PR/auto-merge, at merge observation, at completion checkpoint, and at public export. Required checks alone gate delivery; optional observations do not. Missing or pending required checks reach durable deadlines. Authority loss disables auto-merge and quarantines only the exact unchanged Controller branch; it never emits a production manual-merge instruction.

## Completion and migration

Controller completion v3 is the public predecessor evidence. Planner ingestion creates `release-predecessor-receipt:v3`, embedding the exact completion and binding its active or historical identity, owned schema hash, immutable qualification-entry digest, candidate, merge, validation, canonical review, provenance, and dependency handoffs. The current lock-bound registry is rechecked separately for revocation, so a legitimate append-only rotation does not invalidate older receipts.

- Completion v3 from active B: accepted.
- Completion v2 from non-revoked historical A: accepted.
- Unknown or revoked identity: rejected.
- Receipt v2: `PREDECESSOR_RECEIPT_NEEDS_MIGRATION`; obtain a currently trusted public completion and re-run ingestion.
- Execution handoff plan v1: `NEEDS_MIGRATION`; rebuild from fresh live inputs and re-approve instead of rewriting it.
- Private `job.json`, status summaries, and legacy release-manager v1 self-digests: never accepted.

## Exact-checkout verification

Use an absolute, clean Controller checkout at the locked commit, install its pinned dependencies, and run its full deterministic verification. Then, from Planner:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run generate:codex-controller-contract -- --controller-root "$CONTROLLER_ROOT"
npm run check:codex-controller-contract
npm run canary:codex-controller-contract -- --controller-root "$CONTROLLER_ROOT"
```

The generator runs in check mode unless `--write` is explicitly supplied. The canary rejects a dirty/wrong checkout, rebuilds an exact clone with Node network permission denied, compares Plan/config/completion/history/runtime/risk bytes, validates one current and one ordinal-2 handoff, and runs selected exact-build P0 tests for sandbox, prompt, review, CI, remote, authority quarantine, completion/history, and Oracle boundaries.

Canary PASS is deterministic L1 evidence. It does not invoke the environment-bound live `doctor`, start a Controller Job, invoke a Provider, mutate GitHub, or establish L2/L3/L4 production qualification. Adapter doctor readback has deterministic unit coverage, but the real handoff must still run `doctor` against its actual repository, GitHub policy, executable, and sandbox.

## Upgrade rule

For a future Controller B→C upgrade:

1. merge Controller changes through exact-head required CI;
2. build the exact clean merge commit;
3. append B's outgoing identity and owned schemas to Controller history before changing the active identity;
4. run the Planner generator from that exact build—never hand-edit hashes;
5. review the active/historical/revoked trust projections and explicit schema migrations;
6. run both repositories' full deterministic checks and the cross-repository canary;
7. merge Planner only after its PR exact-head checks pass.

Never silently follow Controller `main`, rewrite an active old Job into new authority, or infer live qualification from deterministic fixtures.
