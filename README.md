# PI Ticket Planning

[English](README.md) | [简体中文](README.zh-CN.md)

A profile-only PI package with `/skill:ask-yet` as the single product-to-outcome entry point, followed by committed Release compilation, independent ticket admission, and strict-frontier Harness activation.

It pins the Matt Pocock stable skill set, replaces its upstream router with package-owned `ask-yet`, and overrides specification, ticket generation, triage, and admission. Upstream adoption is manual.

## Install from GitHub

Requirements:

- Node.js 22.16 or newer;
- `pi`, `git`, and `gh` on `PATH`;
- a working PI login/model configuration;
- GitHub authentication before operating on real Issues.

Clone a released tag, then run the installer:

```sh
git clone --branch v0.3.0 --depth 1 \
  https://github.com/Notyet1307/pi-ticket-planning.git
cd pi-ticket-planning
./install.sh
```

The installer:

1. creates the dedicated Profile at `$HOME/.pi/ticket-planning`;
2. renders its package settings with the checkout's actual path;
3. pins Matt upstream and `pi-subagents` to the recorded versions;
4. installs `$HOME/.local/bin/pi-ticket-plan` as a symlink to the checkout;
5. shares existing default-profile `auth.json` and `models.json` by symlink when present;
6. reconciles packages and verifies the isolated command catalog and reviewer contract.

Existing Profile preferences outside the managed package, skill, and scout-routing fields are preserved. Changed managed files are backed up beside the originals before replacement. Credentials, sessions, trust decisions, caches, and runtime state never belong in this repository.

Custom install locations are supported:

```sh
PI_TICKET_PLAN_PROFILE_DIR=/absolute/profile \
PI_TICKET_PLAN_BIN_DIR=/absolute/bin \
./install.sh
```

Ensure the selected bin directory is on `PATH`. When using a non-default Profile directory, export the same `PI_TICKET_PLAN_PROFILE_DIR` in the shell that later starts `pi-ticket-plan`.

## Diagnose installation and project readiness

Run the read-only doctor from the project you intend to plan:

```sh
cd /absolute/path/to/project
pi-ticket-plan doctor
```

It checks Node.js, PI, the dedicated Profile and Reviewer, the pinned upstream Skill commit, GitHub authentication, the package release/main version, and the current GitHub target's default branch, delivery policy, labels, Issue APIs, and merge rules. The opening summary separates `Planning`, `Admission`, and `Release` readiness, so a missing GitHub label does not imply that product shaping is unusable. By default only blocked Planning readiness makes the command exit 1; use `pi-ticket-plan doctor --require admission` before activation, or `--require all` for a strict full preflight. Every `FAIL` includes a `FIX` when there is a safe next command. A repository with no Issue reports the read-only Sub-issue and Dependency probes as `SKIP`, not as unsupported. Running it from this package checkout verifies installation and version state but skips target-repository checks.

## Profile boundary

The launcher selects the Profile before PI starts:

```sh
export PI_CODING_AGENT_DIR="${PI_TICKET_PLAN_PROFILE_DIR:-$HOME/.pi/ticket-planning}"
exec pi "$@"
```

Ordinary `pi` remains unchanged and does not load this package. An existing ordinary PI session cannot switch profiles in place; exit it and start `pi-ticket-plan`.

Confirm the active Profile inside PI:

```text
!!printf '%s\n' "$PI_CODING_AGENT_DIR"
```

The default result is `$HOME/.pi/ticket-planning`.

## Start in a project

Always start from the project root because PI scopes sessions by working directory:

```sh
cd /absolute/path/to/project
pi-ticket-plan --name "project-planning"
```

Humans normally invoke only `/skill:ask-yet`. Setup, triage, spec, ticket, and Admission skills are model-invoked helpers; their direct `/skill:<name>` commands remain available for recovery and debugging.

## Workflow

Start every product idea, feature, issue, and resumed flow through one entry point:

```text
/skill:ask-yet [optional idea, issue, Release artifact, or current goal]
```

`ask-yet` reconstructs state from the repository and authoritative artifacts, then advances automatically through reversible planning work covered by the human's standing authorization. It stops for product choices, repository-policy changes, Ticket-graph approval, Admission activation, forbidden operations, or material drift. In an existing Git target, a Release is authoritative only when its exact blob is present in the accepted remote base; a working-tree file or unpublished commit cannot feed `to-spec`. An empty or unborn repository remains in product shaping until a human commits an exact Release revision; only then may the setup helper create the minimal Git/tracker delivery base. That bootstrap does not choose an application stack or create implementation scaffolding.

`ask-yet` independently infers planning depth and risk control; the human does not choose either:

| Tier | Use when | Shortest formal path |
|---|---|---|
| `QUICK` | One trusted source can become one decision-complete standalone ticket | Source → one Ticket → fresh Readiness → Admission |
| `STANDARD` | Actor and target behavior are established, but a Spec or multiple tickets are needed | Release-lite → Spec → Tickets → Admission |
| `DISCOVERY` | A new product, actor, core workflow, value, or behavior remains uncertain | Frame → Evidence → Commit → Spec → Tickets |
| `CONTROLLED` | Any planning depth plus security, privacy, compliance, destructive migration, high-risk production cutover, enablement/rollback mechanics, irreversible effects, or broad blast radius | The matching shortest planning path + applicable controls, approvals, Admission, and release gate |

Planning depth is based on decision uncertainty and delivery shape; `CONTROLLED` is a risk overlay, and ordinary reversible deployment does not trigger it by itself. A one-line production credential change can therefore be `QUICK + CONTROLLED`: it avoids customer discovery and a multi-ticket Spec while retaining authority, verification, recovery, approval, smoke, audit, and release gates. The user sees only `controlled path`; internal dimensions stay hidden. The path explanation appears once inside a five-field human status card; internal lane, stage, and verdict names stay in the final machine footer:

```text
Current goal: Correct the existing status wording.
Confirmed: This is a bounded local change and will use the fast path.
Still missing: One durable standalone Ticket and fresh readiness review.
Why it cannot continue now: Admission has not confirmed activation.
You only need to decide: Confirm activation; the system will then hand the Ticket to the Harness.

Checkpoint: TRIAGE/ADMISSION · GH-42@review-1 · ACTIVATION_AWAITING_CONFIRMATION
```

The full `DISCOVERY` path is:

```text
ask-yet
  -> Frame: one actor, trigger, outcome, and smallest closed loop
  -> Evidence: one riskiest assumption and bounded evidence action
  -> human Commitment
  -> greenfield delivery bootstrap when no Git base exists
  -> repository-contract impact review
  -> to-spec: needs-triage delivery spec with stable Scenario IDs and explicit handoffs
  -> to-tickets: Scenario coverage, walking skeleton, children, and blocker graph
  -> coverage snapshot persisted in the delivery parent
  -> strict-frontier order check
  -> fresh ticket-readiness reviewer
  -> deterministic Admission Plan and fingerprint
  -> human confirmation of that exact fingerprint
  -> idempotent admit apply
  -> ready-for-agent / ready-for-human children
  -> delivery parent activated last
  -> Harness claim
  -> Harness-owned execution and review
  -> planning closeout after every intended child is terminal
  -> audience enablement with Release Record, smoke, and rollback evidence
  -> outcome review at the evidence window
```

`ask-yet` is not a resident monitor. Invoke it again to resume: it resolves Admission from the tracker, execution from the Harness ledger, accepted source from Git/PR state, release from the Release Record and actual enablement, and outcome from post-window signal evidence. Harness alone may remain resident. `HANDOFF_READY`, `IN_PROGRESS`, `DELIVERED`, merged, released, and outcome achieved remain distinct states.

Wayfinder maps contain decisions, research, prototypes, and human input. They never enter the implementation queue. `READY | SPLIT | NEEDS_INFO` judges ticket readiness; `AGENT | HUMAN` selects the execution lane.

Existing issues and direct activation requests also use the router:

```text
/skill:ask-yet owner/repo#39
```

`ask-yet` loads triage or Admission itself when that is the true next gate. No generation or triage path may directly add a ready label. Admission rechecks Scenario coverage, every state/artifact handoff, the walking skeleton, strict-frontier order, and a fresh readiness review before human confirmation. Durable stages, verdicts, transition requirements, and fact owners come from `contracts/workflow.json` and `contracts/authority.json`; natural-language output can propose a state but cannot legalize it. A changed source, matrix, candidate, or graph must pass Admission again before Harness handoff.

## Strict-frontier safety

The parent stores one normalized Delivery Graph v2 JSON snapshot under `## Ticket coverage`. It binds the accepted Spec content and every exact child body by SHA-256. Check its source identity, Scenario handoffs, coverage, walking skeleton, and internal order with:

```sh
npm run check:delivery-graph -- --input /path/to/parent-or-snapshot
```

The stronger Admission-state check consumes one refreshed bundle and compares that snapshot with the parent Spec, current child bodies, native child order, and blocker graph:

```sh
npm run check:admission-state -- --input /path/to/admission-bundle.json
```

For every internal `blocker -> dependent` edge, the blocker must also appear earlier in the delivery parent's native child list. Admission runs both the snapshot check and the read-only GitHub order check before review and again before activation.

Run it manually from the checkout:

```sh
npm run check:frontier -- \
  --repo owner/repo \
  --parent 90
```

`FAIL` or a GitHub read error keeps the graph in `needs-triage`.

For a GitHub delivery map, the Admission helper creates and applies an exact plan through the launcher:

```sh
pi-ticket-plan admit plan \
  --repo owner/repo --parent 90 \
  --review /tmp/review.json --context /tmp/context.json \
  --out /tmp/admission-plan.json

pi-ticket-plan admit apply \
  --plan /tmp/admission-plan.json \
  --expected-fingerprint sha256:<confirmed-plan-hash> \
  --context /tmp/fresh-context.json
```

A QUICK standalone Ticket uses the same transaction with `--issue`:

```sh
pi-ticket-plan admit plan \
  --repo owner/repo --issue 42 \
  --review /tmp/review.json --context /tmp/context.json \
  --out /tmp/admission-plan.json
```

`plan` is read-only. `apply` accepts only the approved snapshot, records the Plan fingerprint in its idempotent Admission comment, preserves unrelated labels through per-label changes, and rolls completed operations forward after ambiguous failures. It treats timestamps as reread hints and blocks only on the gate-critical projection: title, open state, body, blockers, source, policy, controlled labels, and graph/Harness facts when applicable. A delivery parent is activated only after a final full child reread. `COMPLETE` is success; `PARTIAL` is resumable with the same plan; `CONFLICT` requires a new review. It never removes a ready label after a Harness claim.

## Continue sessions

Return to the same project directory and the same launcher:

```sh
pi-ticket-plan -c
pi-ticket-plan -r
```

Inside PI, `/session` shows the current session, `/new` starts one, `/resume` selects one, and `/quit` exits.

## Verify and update

Repository-only checks do not require an installed PI Profile:

```sh
npm run verify:ci
```

The frozen outputs and live-case definitions share one deterministic validator:

```sh
npm run check:behavior-fixtures
```

After installation, also verify the live Profile:

```sh
npm run verify
```

The expected Profile smoke result is `profile isolation: ok (27 skills)`.

Before a package release, run static checks, the Profile smoke test, and every live-model case from a clean checkout:

```sh
npm run verify:release -- --report /tmp/pi-ticket-plan-release-eval.json
```

The Release Gate rejects a dirty checkout before spending model tokens. Its pinned 14-case manifest loads `ask-yet`, `to-spec`, `to-tickets`, `ticket-readiness`, and `admit-ticket` from this checkout, uses a separate `--no-session` process with read-only tools for every attempt, validates the machine Checkpoint outside the model, and verifies that the temporary workspace is unchanged. The JSON report distinguishes `PASS`, `SEMANTIC_FAIL`, and `INFRA_FAIL`, with per-case and overall success rates. A failed case is retried once; every case must pass at least once, and recovered failures are reported as `FLAKY`.

Use `npm run eval:pi -- --case <id>` to rerun one failure. To measure variance, repeat every case and save a report:

```sh
npm run eval:pi:nightly -- --report /tmp/pi-ticket-plan-live-eval.json
```

This authenticated repeat-three run is advisory and always writes success-rate data without becoming a release decision. It remains outside ordinary PR CI. The repository currently has no dedicated Actions runner or evaluation secret, so scheduling it is intentionally left to an authenticated external runner; no workflow reuses a maintainer's personal OAuth. A no-Skill baseline and weaker-model matrix remain advisory until they have a stable scoring contract.

Updates are explicit and release-based:

```sh
git fetch --tags
git checkout v0.3.0
./install.sh
```

Do not follow Matt upstream directly. A package release must deliberately update the pinned commit, replay the four overrides and suppressed upstream router, update `upstream-lock.json`, and pass verification.

## Security and provenance

PI packages and skills can cause commands to run with the user's permissions. Review a release before installation and pin a tag or commit. Keep `LICENSE` and `NOTICE`; the compatible overrides derive from `mattpocock/skills` at the commit recorded in `upstream-lock.json`.
