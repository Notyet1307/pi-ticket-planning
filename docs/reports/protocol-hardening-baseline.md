# Protocol hardening baseline

Observed: 2026-08-25 on `codex/protocol-hardening-v0.5` at
`a9ede1304b08695447ed248fc56a39bec0b90eb5` (`origin/main`). This report records
the v0.4 implementation before protocol-hardening code changes. Historical tags,
fixtures, and the local `b5760bae` commit are not treated as current-main facts.

## Preflight

| Check | Result |
| --- | --- |
| Worktree | Clean; branch created from exact `origin/main` |
| Node | `v26.3.0`; package minimum is Node `22.16.0` |
| npm | `11.16.0` |
| `npm ci` | Failed: the repository intentionally has no `package-lock.json` or `npm-shrinkwrap.json` |
| `npm run verify:ci` on `origin/main` | PASS: package, behavior fixtures, docs, and 106/106 Node tests |
| Model, live GitHub, live Provider, release qualification | Not run; no such result is inferred from deterministic tests |

The absent lockfile is a real baseline mismatch with the requested `npm ci`
command. No lockfile was invented during the inventory.

## Current commands

`package.json` version is `0.4.0`. Its complete script surface is:

| Script | Current command |
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
| `test` | `node --test test/*.test.mjs` |
| `verify:ci` | package + behavior + docs + tests |
| `verify` | `verify:ci` + installed Profile check |
| `verify:release` | `verify` + real Pi release suite with one bounded retry |

The only Action is `.github/workflows/ci.yml`; it runs `verify:ci` on push and
pull request with Node 22.16.0. There is no coverage, model, disposable live
integration, or release-qualification Action.

## Authority and workflow

- `contracts/workflow.json` version 1 is the legal owner of lanes, stages,
  verdicts, stage transitions, verdict-required facts, and the two scoped
  HOLD/REWORK recovery rules.
- `contracts/authority.json` version 1 owns fact names, source allowlists, and
  the two Admission mutations.
- `scripts/workflow-contract.mjs` validates individual states, transitions,
  source strings, mutation actors, and approval-subject equality.
- Current facts are caller-built `{ value, source, subject? }` objects. They do
  not bind target, subject kind/id/revision/digest, producer identity,
  observation/freshness, evidence, or consumption.
- Current mutations declare actor, required/produced facts, source/target state,
  and approval fact, but no postconditions.
- No machine check currently proves graph reachability, recoverable dead ends,
  producer/consumer liveness, single authority placement, or identity
  continuity/rebind legality.

## Artifact inventory

Only `herdr-harness:project-readiness:v1` has a standalone JSON Schema file.
Other shapes are hand-validated in scripts or model contracts.

| Artifact | Current major/readability | Writer | Readers |
| --- | --- | --- | --- |
| Workflow | version 1 | repository maintainer | workflow checker, package checker, Skills |
| Authority | version 1 | repository maintainer | workflow checker, package checker |
| Delivery Graph | writes v2; reads v1/v2; v1 cannot pass Admission | `to-tickets`/tracker publication | graph, frontier, Admission state and plan |
| Ticket Context Check | v1 | context checker | Admission state and plan/apply |
| Admission Review | v1 | fresh `ticket-readiness-reviewer` | Admission plan builder |
| Reviewed Admission State | v1 | Admission plan builder | plan validator/apply |
| Admission Plan | v1 | Admission plan builder | validator/apply/CLI |
| Admission Result | v1 | Admission apply | operator/CLI |
| Harness Project Readiness | v1 | HerdrHarness | readiness adapter |
| Harness Readiness binding | v1 | readiness adapter | Admission plan/apply |
| Delivery Gate Plan/Result | v1 | delivery-gate planner/apply | delivery-gate CLI and Doctor |
| Live model evaluation report | v3 | Pi evaluation runner | release reporting |
| Release | Markdown contract, stable ID/revision/blob | `ask-yet` under human write authority | `to-spec`, outcome loop |
| Delivery Spec | tracker/Markdown body with Source and stable Scenario IDs | `to-spec` under human approval | `to-tickets`, Admission graph checks |
| Checkpoint | final text line parsed into lane/stage/identity/verdict | `ask-yet` | workflow checker, Admission context |

There is no Artifact Registry, declared fingerprint algorithm, centralized
legacy reader, unknown-major dispatcher, Release/Spec machine projection,
Planning Case, Fact Attestation, Outcome Receipt, or stable result envelope.

## Admission mechanics

`scripts/admit.mjs` combines domain validation, plan construction, plan
validation, mutation/recovery, GitHub I/O, Harness execution, and CLI parsing.
Its reusable seams are already visible:

- `buildAdmissionPlan` / `buildStandaloneAdmissionPlan` construct a deterministic
  v1 plan from exact source, policy, bodies, graph, Context checks, fresh review,
  checkpoint, and stable Harness projection.
- The v1 fingerprint algorithm recursively sorts object keys, preserves array
  order, serializes with `JSON.stringify`, and hashes UTF-8 bytes with SHA-256.
  The approval projection is explicit. This algorithm must not change silently.
- `validateAdmissionPlan` rejects malformed/self-inconsistent plans.
- `applyAdmissionPlan(plan, adapter)` is injectable and retains the most valuable
  current behavior: exact expected fingerprint, full pre-read drift checks,
  blocker-first children, parent activation last, claim checks before every
  mutation, per-write exact readback, ambiguous-write recovery, final readback,
  and `COMPLETE`/`PARTIAL`/`CONFLICT` separation.
- `createGitHubAdapter` is the real tracker adapter. Current tests use in-memory
  adapters; no live GitHub apply was executed for this baseline.

Current drift checks cover Source, Policy, Checkpoint, body/title/open state,
Delivery Graph, native blockers/order, Context checks, controlled labels, review,
and stable Harness readiness. The gaps are attested fact binding, one-time
Approval consumption, durable transaction intent, author/app verification for
comment markers, exact Reviewer input binding, and crash recovery outside a
single process.

## Doctor, Profile, Installer, and Context

- `doctor.diagnose` is read-only and accepts an injected command runner,
  environment, and Node version. Its output is human PASS/FAIL/WARN/SKIP, not a
  versioned Result Envelope or Capability Receipt.
- Harness readiness verifies a pinned colocated schema digest, private config,
  exact repo/base, freshness, Provider lanes, Docker, validation, and delivery
  gate. Configuration existence alone is not treated as support.
- `check-profile` verifies Profile isolation and a fresh read-only Reviewer, but
  CI does not install or exercise the Profile.
- The installer uses a 0700 Profile directory, 0600 settings, backups, and
  atomic replacement. It does not write `installation.json`, detect all local
  modifications, or expose dry-run update/migrate/rollback.
- Ticket Context checks bind exact base blobs, candidate bodies, paths, and a
  canonical digest, and Admission recomputes them instead of trusting a supplied
  digest. There is no route-specific Context Manifest or byte/token/document
  budget checker.

## Evidence tiers

| Tier | Current evidence | Baseline classification |
| --- | --- | --- |
| L1 deterministic | 106/106 tests plus package/fixture/docs checks | PASS on `a9ede13` |
| L2 model behavioral | `eval:pi` supports real Pi sessions, semantic/infrastructure separation, and retry reporting | UNTESTED in this baseline |
| L3 real disposable integration | execution-readiness canary uses temporary repositories and fake GitHub/Docker/Pi | No real L3 evidence; UNTESTED |
| L4 release qualification | `verify:release` can run a bounded model suite | No current qualification report; UNTESTED |

The existing canary proves a cross-repository contract against fakes; it does
not prove a real Provider, real GitHub writes, cleanup, or Harness ledger state.
No current report supplies first-pass/eventual rates, P50/P95, unauthorized
writes, recovery rate, model/Provider matrix, or API/tool/context counts.

## Preserved local work

Local refs `main` and `codex/reviewer-bundle-input` preserve
`b5760bae080e430057fae304a9a6bd90e26081f9`, which is not in `origin/main`.
That commit correctly demonstrates a private descriptor-held Reviewer input,
0700/0600 permissions, symlink/hardlink/digest/TOCTOU defenses, bounded reads,
and Reviewer-only extension injection. It is not cherry-picked as a baseline:
its transport binding is not part of the Admission Plan fingerprint/fact chain,
and its hand-written shape rules would become a second protocol authority.
The OS-level adapter behavior and negative cases should be migrated after the
Registry and exact Reviewer attestation exist.

## v0.5 migration constraints

1. Register the real current majors before adding new artifacts; unknown majors
   fail closed and all legacy compatibility stays in one adapter.
2. Preserve Admission Plan v1 canonicalization and fingerprint semantics.
3. Move workflow/authority into one protocol kernel without creating a second
   enum or rule owner; compatibility paths may reference, not redefine it.
4. Keep Admission Reviewer fresh and independent, and bind its result to exact
   input bytes/source/revision/base/graph before Plan construction.
5. Preserve all existing Admission preconditions, drift checks, parent-last
   ordering, claim detection, per-write/final readback, and no rollback after a
   claim.
6. Put durable Planning Case state outside target repositories with containment,
   permissions, locking, transactions, event replay, and explicit recovery.
7. Keep L1, L2, L3, and L4 claims separate. Missing credentials or runtime
   capability yields `UNTESTED`/`BLOCKED`, never a synthetic PASS.

This baseline authorizes no production write, Admission activation, dependency
upgrade, version release, or claim of production readiness.
