# Controlled Beta baseline

Observed on 2026-08-25 from `origin/main` at
`cefb9e1fbb76a6ccc3a42f9dfdbd551f0924ef4e`. The working branch
`codex/controlled-beta-convergence` was created from that exact commit. Local
`main` and the existing feature branches were left untouched.

## Preflight

| Check | Result |
| --- | --- |
| Package | `pi-ticket-planning@0.5.0-alpha.0` |
| Node / npm | `v26.3.0` / `11.16.0` |
| `npm ci --ignore-scripts --no-audit --no-fund` | PASS |
| Baseline `npm run verify:ci` | PASS, 184/184 tests |
| Enforced core coverage | 100% lines, 93.91% branches, 98.71% functions |
| Branch protection | No `main` branch protection; repository rulesets list empty |
| L2 / L3 / L4 | UNTESTED; no current-commit real report exists |

The clean deterministic result is Alpha evidence only. It does not establish a
real Provider, Child result, persisted cross-process session, Disposable GitHub
run, Harness run, Actions provenance, or qualified compatibility tuple.

## Commands

The complete npm script surface at the baseline is:

| Script | Command |
| --- | --- |
| `admit` | `node scripts/admit.mjs` |
| `check` | `node scripts/check-package.mjs` |
| `check:admission-state` | `node scripts/check-admission-state.mjs` |
| `check:delivery-graph` | `node scripts/check-delivery-graph.mjs` |
| `check:docs` | `node scripts/check-docs.mjs` |
| `check:frontier` | `node scripts/check-frontier-order.mjs` |
| `check:ticket-context` | `node scripts/check-ticket-context.mjs` |
| `check:behavior-fixtures` | `node scripts/check-behavior-fixtures.mjs` |
| `check:profile` | `node scripts/check-profile.mjs` |
| `check:workflow` | `node scripts/workflow-contract.mjs` |
| `canary:execution-readiness` | `node scripts/canary-execution-readiness.mjs` |
| `doctor` | `node scripts/doctor.mjs` |
| `delivery-gate` | `node scripts/delivery-gate.mjs` |
| `eval:pi` | `node scripts/eval-pi-behavior.mjs` |
| `eval:pi:nightly` | `node scripts/eval-pi-behavior.mjs --suite nightly --repeat 3 --report-only` |
| `install:profile` | `node scripts/install-profile.mjs` |
| `benchmark` | `node benchmark/benchmark.mjs` |
| `planctl` | `node scripts/planctl.mjs` |
| `test` | `node --test test/*.test.mjs` |
| `test:integration:live` | `node integration/e2e.mjs` |
| `test:integration:mock` | four deterministic Admission/readiness/E2E test files |
| `test:model` | release Pi suite to `artifacts/model-eval.json` |
| `test:security` | deterministic security/protocol/state/transport tests |
| `test:coverage` | 90% thresholds for three named core modules |
| `test:state` | Planning Case and control-CLI tests |
| `release:qualify` | `node integration/qualify.mjs` |
| `verify:ci` | package, protocol, context, fixtures, docs, tests, coverage, benchmark |
| `verify:context` | `node scripts/verify-context.mjs` |
| `verify:protocol` | `node scripts/verify-protocol.mjs` |
| `verify` | `verify:ci` plus installed Profile isolation |
| `verify:release` | deterministic/Profile gates plus the real Pi release suite |

Gate-C commands `verify:single-kernel`, `verify:context-coverage`,
`test:admission-transaction`, and `test:migration` do not yet exist.

## Protocol and artifact runtime

Legal workflow state is owned by `contracts/workflow.json`; fact and mutation
authority is owned by `contracts/authority.json`. `protocol/kernel.mjs` exposes
artifact identity, Fact, transition, mutation, and shallow model checks.
`scripts/workflow-contract.mjs` independently implements state, Fact,
transition, and mutation decisions and is called by `admission/domain.mjs`.
This is a real dual-runtime failure, not merely a compatibility-file presence.

The Registry contains 35 entries: artifact-registry, protocol-rules,
lane-stage-matrix, protocol-link, workflow, authority, result-envelope,
fact-attestation, checkpoint, planning-case, release-projection,
spec-projection, delivery-graph, ticket-context-check, admission-review,
reviewed-admission-state, admission-plan, admission-result, harness-readiness,
Herdr project-readiness, delivery-gate plan/result, live-eval, outcome-receipt,
capability-receipt, admission-review input/binding, installation-manifest,
planning-case event/transaction, context-manifest, compatibility-matrix,
e2e-report, benchmark-report, and release-qualification.

At baseline, Registry writer/reader values are unchecked free strings.
`validateArtifact` structurally/semantically checks only Fact Attestation and
Checkpoint; every other known artifact returns `ok: true` after identity lookup.
Schema-use scanning omits capabilities, installation, integration, outcome,
benchmark, and extensions. `producerDigest` is shape-checked but not resolved to
a producer. `same-mutation`, `crossRevision`, `reusable`, and Fact consumption
are not enforced.

The model checker reports only stage reachability (`9/9`). It does not enumerate
Lane x Stage x Verdict x Identity, executable producers/consumers, human-gate
entries, verifier exports, recovery edges, or Context coverage, and it counts a
mutation's `producesFacts` as consumers.

## Planning Case and Admission

The durable store has private paths, locking, append-only events, atomic local
transactions, replay, repair, exact approval storage, and cross-process CLI
resume. Production events are limited to `CASE_CREATED`, `CASE_ABANDONED`,
`APPROVAL_ADDED`, `APPROVAL_CONSUMED`, and `BINDING_SET`. The event payload and
most snapshot domain fields remain free objects; core decisions, unknowns,
evidence, blockers, next actions, transitions, facts, outcome, and Admission
transaction states have no event/CLI reducer path.

The CLI supports create/list/status/approve/resume/abandon/verify/recover and an
empty migration stub. The default binding verifier accepts everything. There is
no explicit offline degraded resume. Of the six core Skills, only Admission
mentions Planning Case approval/apply; no complete start/end state integration
exists.

Admission itself preserves exact Plan fingerprints, drift checks, child-first
and parent-last operations, claim checks, per-write readback, ambiguous-response
recovery, final readback, and single approval consumption. It does not persist
the required local/external `ADMISSION_*` transaction sequence. A crash after
GitHub completion but before approval consumption can therefore leave the local
Case unable to prove committed completion without an explicit recovery state.

## Capability and evidence tiers

The active Doctor currently treats parent-session text as a Child result,
checks Reviewer output using string inclusion, compares parent identities for
freshness, resumes a named session in the same process, and does not force a
timeout/cancellation. These paths cannot establish the runtime-only
capabilities required by Gate D. Harness readiness has a real command seam but
is unconfigured in the current environment.

| Tier | Baseline state | Reason |
| --- | --- | --- |
| L1 | PASS | 184 deterministic tests, named core coverage, benchmark |
| L2 | UNTESTED | no current-commit real Provider/model release report |
| L3 | UNTESTED | live command has no concrete adapter or disposable repo configuration |
| L4 | BLOCKED | qualification trusts local JSON and has no Actions provenance |

`compatibility/matrix.json` has no entries. Pi `0.84.2` and
`pi-subagents@0.42.1` are installed in the isolated Profile, but Provider,
Model, Thinking, Profile/Harness tuple evidence is absent; the combination is
therefore `UNTESTED`, not `SUPPORTED`.

## Installation, Outcome, and governance

Installation has dry-run/update/rollback and a private manifest transaction,
but runtime metadata still falls back to Git and the subagent/package versions
are duplicated in code. There is no build metadata usable outside a Git
worktree and no complete source/install archive, checksum, SBOM, or provenance
flow. Outcome ingestion is read-only and subject-bound, but the required Case
CLI/event trace is incomplete.

GitHub authentication is available for the repository, but no dedicated
Disposable E2E repository is configured and no external write was made during
baseline collection. `main` currently has neither branch protection nor a
ruleset, so CI presence alone does not satisfy Gate H.

## Initial controlled-Beta decision

Gates A-H are not satisfied at this baseline. The version remains
`0.5.0-alpha.0`; the working conclusion is `ALPHA_REMAINS_BLOCKED` until code
and current-commit external evidence prove otherwise.
