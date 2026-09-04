# Threat model

## Overview

`pi-ticket-planning` is a local planning and Admission package. It projects
repository and tracker data into versioned facts and Plans, stores recoverable
Planning Cases outside target repositories, obtains an independent Reviewer
result, and applies only an exact human-approved handoff or tracker mutation.
Codex Goal Runner owns the normal-risk supervised execution path; Codex Controller
owns high-risk, unattended, and automatic delivery; HerdrHarness owns the separate
Legacy path. Planner never starts an executor or reads private runtime state.

| Component | Security role | Source evidence |
| --- | --- | --- |
| Protocol kernel | Registry, Fact, transition, identity, and mutation checks | `protocol/kernel.mjs:158`, `protocol/kernel.mjs:229`, `protocol/kernel.mjs:388` |
| Planning Case store | Private state, locks, event chain, transaction recovery | `planning-case/store.mjs:270`, `planning-case/store.mjs:412`, `planning-case/store.mjs:645` |
| Reviewer transport | Exact projected bytes and no-link held descriptor | `admission/review-transport.mjs:262`, `admission/review-transport.mjs:284` |
| Admission apply | Kernel authorization, exact Plan, claim checks, writes, approval consumption, and readback | `admission/apply.mjs:89`, `admission/apply.mjs:150`, `admission/apply.mjs:244` |
| GitHub adapter | Validated target and authenticated comment readback | `admission/github-adapter.mjs:16`, `admission/github-adapter.mjs:56` |
| Capability Doctor | Static vs active evidence and expiring receipt | `capabilities/doctor.mjs:14`, `capabilities/doctor.mjs:412` |
| Installer | Dry-run plan, contained writes, backup and exact rollback | `installation/manager.mjs:86`, `installation/manager.mjs:136`, `installation/manager.mjs:176` |
| Live E2E guard | Exact disposable repo and run-bound confirmation | `integration/e2e.mjs:24`, `integration/e2e.mjs:67` |
| Qualification | Report schema/digest/time/commit checks plus independent Actions attestation and run readback | `integration/report.mjs`, `integration/qualify.mjs` |
| Controller handoff | Exact semantic Plan approval and one-file materialization | `execution-plan/compiler.mjs`, `execution-plan/handoff-apply.mjs` |
| Goal handoff | Exact channel/runner/Plan approval and one-file materialization | `execution-plan/goal-handoff.mjs` |
| Result ingestion | Producer-specific Result schemas; Goal handoff correlation and self-digested predecessor acceptance | `execution-plan/release-result-ingest.mjs` |

```mermaid
flowchart LR
  U[Untrusted repository and tracker text] --> P[Protocol and Planning Case]
  P --> R[Fresh read-only Reviewer]
  R --> B[Bound review result]
  B --> A[Admission Plan]
  H[Human exact fingerprint] --> C[Pending Planning Case approval]
  C --> A
  A --> G[GitHub mutation and readback]
  C --> D[Approved release-plan.json]
  D --> K[Operator-started Codex Controller]
  K --> E[Public release-result.json]
  E --> P
  C --> Q[Approved goal-handoff.json]
  Q --> Z[Operator-started Goal Runner]
  Z --> Y[Human merge + Goal Result]
  Y --> P
  G --> X[Legacy HerdrHarness execution]
  X --> O[Read-only Outcome Receipt]
  O --> P
```

Effective resources differ by workflow:

| Deployment or workflow | Resource or capability | Configuration and precedence | Safe effective value or location | Recipients | Enforcing control | Evidence or unknowns |
| --- | --- | --- | --- | --- | --- | --- |
| Planning session | Case state | `PI_TICKET_PLAN_STATE_DIR`, then local-state default | Private state root, never target repo | Planner process | Store containment and modes | Same-account compromise is outside the filesystem-mode guarantee |
| Reviewer | Input bytes | Materialized descriptor and child-only extension | One digest-named 0600 file | Fresh Reviewer only | Held descriptor and allowlisted read | Real Provider behavior needs active probe |
| Admission | GitHub writes | Exact Plan plus refreshed context | Named repo/Issue operations only | GitHub API | Adapter validation and readback | App-auth identity handling remains deployment-dependent |
| Controller handoff | Semantic contract major and exact Plan digest | Current Controller config plus approved Plan | One private Plan and one printed start command | Operator and Controller only | Exact approval and one-file readback; Controller owns runtime/delivery preflight | Semantic fixtures are compatibility evidence; real Provider/GitHub delivery remains separate |
| Goal handoff | Exact Goal envelope fingerprint | Approved channel, runner reference, embedded Plan, and one printed start command | Goal Runner target only | Dedicated approval and one-file readback; Runner owns Worktree/validation/commit/review | Remote execution requires the same Runner and config on the approved host |
| Live E2E | Disposable writes | Enable flag, exact allowlist, run token, actor/topic/default branch, no-production check | Tagged dedicated repository resources | Test GitHub account | Guarded live adapter and cleanup readback | Adapter code exists; no current disposable/Harness report is qualified |
| Qualification | L2/L3 evidence | Exact Actions run IDs and current commit | Attested workflow artifacts only | Release operator | Schema, semantic, digest, expiry, uniqueness, attestation, and workflow readback | Local JSON and non-complete reports remain blocked |

## Threat Model, Trust Boundaries, and Assumptions

Protected assets are human Commitment and Admission authority, exact source and
Plan identities, ready labels/comments, private Case/Profile metadata, Provider
and Harness configuration, and the integrity of recovery evidence.

Realistic attackers may control Issue/README/AGENTS/Skill text, candidate bodies,
model output, malformed artifact files, network responses, or a low-privilege
contributor account. They do not initially control the operator account, private
state root, authenticated GitHub token, Provider account, Harness config, or
accepted base. A same-account local attacker can rewrite unkeyed local files;
0700/0600 and digest chains detect accidents and cross-path substitution but are
not a cryptographic defense against that attacker.

Security objectives are fail-closed unknown majors, one authority owner per
fact/rule, exact target/subject/revision/digest binding, fresh independent review,
single-consume approval, no mutation before evidence, parent-last activation,
post-write proof, recoverable local transactions, no credential persistence,
and no automatic Outcome-to-Kernel promotion.

## Attack Surface, Mitigations, and Attacker Stories

These are hypotheses for review, not confirmed vulnerabilities.

| Priority | Scenario and capability gain | Prerequisites | Impact | Existing controls | Mitigation | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| P0 | Replay or substitute an approval to activate another Plan | Attacker can inject a Fact or stale Case state | Unauthorized ready labels | Exact subject, expiry, kernel check, and consumed approval event | Keep operator approval bound to one Plan digest and target Case | `admission/apply.mjs:89`; `protocol/kernel.mjs:394`; `planning-case/store.mjs:195` |
| P0 | Drift Tracker data during partial apply | Concurrent Issue/label/body change or lost response | Wrong Issue state presented as admitted | Pre-read, per-write readback, final readback, claim detection | Preserve `PARTIAL/CONFLICT`; rebuild after drift | `admission/apply.mjs:113`; `admission/apply.mjs:233` |
| P1 | Prompt injection produces a false READY | Attacker controls candidate or policy text | Reviewer content influences Plan | Fresh context, projected input, binding echo, deterministic checks | Require active Reviewer capability and reject malformed binding | `extensions/ticket-readiness-read-guard.mjs:45`; `admission/review-transport.mjs:284` |
| P1 | Path/Symlink swap reads or overwrites another file | Local access to state/temporary path | Confidentiality or state corruption | Containment, no-follow open, inode/link/mode checks | Keep state local; fail on any unsafe metadata | `planning-case/store.mjs:412`; `admission/review-transport.mjs:262` |
| P1 | Forge Harness/Provider capability from config presence | Attacker supplies self-consistent JSON | Unsafe Admission proceeds | Producer/digest/freshness validation; runtime-only support needs active evidence | Qualify exact tuples and expire receipts | `capabilities/doctor.mjs:14`; `capabilities/doctor.mjs:92` |
| P2 | Marker injection makes an attacker comment look applied | Contributor can comment on Issue | Idempotency/readback bypass | Exact body plus authenticated author match | Pin app identity where app auth is used | `admission/github-adapter.mjs:56` |
| P2 | Accidental live E2E targets a real repository | Operator enables integration with wrong target | Unintended test writes | Enable flag, exact allowlist, run confirmation, resource tag | Dedicated account/repo and retained cleanup command | `integration/e2e.mjs:67` |
| P2 | External error leaks credentials into receipt/log | Tool returns credential-bearing stderr | Token disclosure | Structured codes and credential-shaped redaction | Keep raw output out of artifacts; rotate on exposure | `admission/apply.mjs:112` |
| P0 | Fabricated or replayed local report promotes an untested tuple | Attacker can supply arbitrary JSON or duplicate prior evidence | Unsupported Provider/Harness gains Admission authority | Current-commit/time/digest checks, report and scenario deduplication, Actions attestation and workflow readback | Keep Matrix writes qualification-derived and digest-matched | `integration/qualify.mjs`; `capabilities/compatibility.mjs` |
| P0 | Forged Controller Result advances a later Release | Attacker can replace a public Result file | Unauthorized predecessor authority | Closed schema plus expected release/Plan/base binding and tracked artifact bytes | Obtain Result from the verified Controller export path; never accept status or private Job files | `execution-plan/release-result-ingest.mjs`; `execution-plan/freshness.mjs` |
| P0 | Raw or cross-runner Goal Result advances a later Release | Attacker substitutes a Goal Result from the same Plan | Wrong channel or runner gains predecessor authority | Ingestion requires the private handoff and emits a self-digested acceptance; Graph schema rejects raw Goal Results | Bind runner config, handoff, result, acceptance, and tracked bytes at each boundary | `execution-plan/release-result-ingest.mjs`; `scripts/check-delivery-graph.mjs` |
| P0 | Unsafe Controller config weakens sandbox, review, CI, or merge authority | Operator selects a drifted config | Unsafe delivery despite a valid Plan | Controller validates config, remote, sandbox, required checks, exact candidate, PR, and merge independently | Treat Planner's semantic compatibility as no substitute for Controller runtime gates | Controller repository runtime tests and `release-result:v1` |

## Severity Calibration

- **Critical:** an unauthenticated or repository-text attacker can cause an
  arbitrary cross-repository mutation or extract operator credentials. A model
  returning READY without write authority is not Critical.
- **High:** a contributor can replay human approval, bypass exact Plan binding,
  forge a trusted Harness/Reviewer receipt, or escape the private state root to
  gain new write/read capability.
- **Medium:** a realistic race can misclassify a partial mutation as complete,
  an authenticated untrusted comment satisfies readback, or logs expose a
  limited-scope token. Exact conflict detection or mandatory re-approval lowers
  severity.
- **Low:** self-only denial of service, verbose non-secret paths, or a failure
  that remains `BLOCKED/UNTESTED` with no authority gain.

Confidence in deterministic local controls is supported by L1 tests. Provider,
real GitHub, Harness, cleanup, and release thresholds remain unqualified until
current-commit L2-L4 reports pass the provenance checks. Their absence is a
release blocker, not an invitation to weaken the verifier.
