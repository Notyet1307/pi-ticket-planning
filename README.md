# PI Ticket Planning

English | [简体中文](README.zh-CN.md)

PI Ticket Planning turns a rough product idea, a feature request for an existing project, or an Issue into a decision-complete Ticket with the correct execution lane: an AI agent can execute and verify `AGENT` work independently, while non-delegable work stays `HUMAN`. It is for product and engineering owners who want the system to gather repository facts, preserve evidence and decisions, and prepare delivery work without delegating the decisions that still belong to people.

The input can be one natural-language sentence or an Issue reference. The durable planning output is a decision-complete standalone Ticket or accepted Delivery Graph linked to an accepted product goal, technical decisions, and verification. Starting an agent immediately would hide unresolved product, architecture, dependency, or risk choices inside implementation; this package closes those choices first.

For an accepted Delivery Graph, the recommended execution exit is one **Codex Controller Release Handoff**: compile an exact Release Plan v2, approve its fingerprint once, materialize three private input files, then let the operator start the Controller. Legacy `admit` remains the explicit Herdr per-ticket ready-label path.

> The system recommends and performs reversible planning work. People still supply real customer facts, make Commitment and risk decisions, approve the Ticket graph, and authorize the exact execution handoff. It never starts the Controller; GitHub ready labels belong only to explicit Legacy Herdr admission.

> **v0.5 alpha:** `main` now uses a versioned protocol kernel and recoverable
> Planning Cases. Deterministic checks are available, but the compatibility
> matrix has no qualified runtime tuple and no live L3 report exists. Legacy
> Herdr Admission therefore fails closed; the Controller path separately requires
> its public validation and live `doctor`. `v0.4.0` remains the latest stable release.

Machine control and recovery use `pi-ticket-planctl`:

```sh
pi-ticket-planctl case create --target github:OWNER/REPO --json
pi-ticket-planctl case resume PC-ID --json
pi-ticket-planctl doctor --capabilities --json
pi-ticket-planctl update --dry-run --json
```

## Start from any of three points

| Your starting point | First input | What the system does first |
| --- | --- | --- |
| [A rough product idea](docs/getting-started/greenfield.md) | “I want to help small teams miss fewer delivery steps, but I have not worked out the product yet.” | Forms distinct candidate directions, recommends one, then asks one real-event question. |
| [A feature for an existing project](docs/getting-started/brownfield-feature.md) | “I want bulk import, but I do not know whether that means bulk creation, migration, or synchronization.” | Reads the smallest relevant repository facts, then forms candidates without treating code as customer Evidence. |
| [An existing Issue or Bug](docs/getting-started/existing-issue.md) | `/skill:ask-yet owner/repo#39` | Reads the accessible Issue and relevant code facts, then decides whether one Ticket is enough or more shaping is required. |

You do not choose a workflow mode. The system infers the shortest safe path from the facts.

[Five-minute start](#five-minute-start) · [What is automatic](#what-the-system-does-and-what-you-decide) · [Advanced mechanisms](#advanced-mechanisms) · [Development and release verification](#development-and-release-verification)

## Five-minute start

### Install

Requirements:

- Node.js 22.16 or newer;
- `pi`, `git`, and `gh` on `PATH`;
- `tmux` when using interactive subagents;
- a working PI login/model configuration;
- GitHub authentication before operating on real Issues.

This README tracks current development on `main`. Choose one install channel; use `v0.4.0` for the latest reproducible stable release.

#### Current development (`main`)

```sh
git clone --branch main --depth 1 \
  https://github.com/Notyet1307/pi-ticket-planning.git
cd pi-ticket-planning
./install.sh
```

#### Latest stable (`v0.4.0`)

```sh
git clone --branch v0.4.0 --depth 1 \
  https://github.com/Notyet1307/pi-ticket-planning.git
cd pi-ticket-planning
./install.sh
```

### Check

From the project you want to plan, run the read-only doctor:

```sh
cd /absolute/path/to/project
pi-ticket-plan doctor
```

The summary checks `Planning`, `Admission`, and `Release` readiness separately. Product shaping can be usable while GitHub Admission is not; for example, a missing ready label does not block an early product conversation. The default exits non-zero only when Planning is blocked. Use `pi-ticket-plan doctor --require admission` before activation or `pi-ticket-plan doctor --require all` for a strict full preflight. Checks report `PASS`, `FAIL`, `FIX`, or `SKIP`.

### Configure the GitHub delivery gate

For a GitHub repository that will use HerdrHarness, first commit one executable, Secret-free canonical validation script. The setup helper uses two fingerprinted phases; neither phase writes a ready label.

```sh
pi-ticket-plan delivery-gate plan \
  --repo-path "$PWD" \
  --validation-script scripts/herdr-validate.sh \
  --out /tmp/delivery-workflow-plan.json

pi-ticket-plan delivery-gate apply \
  --plan /tmp/delivery-workflow-plan.json \
  --expected-fingerprint sha256:CONFIRMED \
  --repo-path "$PWD"
```

The first apply creates only `.github/workflows/herdr-delivery-gate.yml`. Review and merge that bootstrap through a feature PR. After its `herdr-delivery-gate` check succeeds on the current default branch, prepare and confirm the external enforcement Plan:

```sh
pi-ticket-plan delivery-gate plan --repo OWNER/REPOSITORY --out /tmp/delivery-enforcement-plan.json
pi-ticket-plan delivery-gate apply \
  --plan /tmp/delivery-enforcement-plan.json \
  --expected-fingerprint sha256:CONFIRMED
```

The second apply installs and reads back the active strict ruleset with a pinned check source, zero human approvals, no bypass actors, and force-push/deletion protection before enabling repository auto-merge and merge commits. `COMPLETE` is success; `PARTIAL` rolls forward with the unchanged Plan; `CONFLICT` requires a fresh read and Plan. It never creates the project validation script, stages or publishes the workflow, provisions Secrets, or weakens an existing conflicting rule.

### Start

Start at the project root because PI scopes sessions by working directory:

```sh
cd /absolute/path/to/project
pi-ticket-plan --name "project-planning"
```

Then give the only normal human entry point a goal, Issue, or current problem:

```text
/skill:ask-yet <your natural-language goal, Issue, or current problem>
```

An empty directory is also a valid Greenfield start:

```sh
mkdir my-product
cd my-product
pi-ticket-plan --name "my-product-planning"
```

```text
/skill:ask-yet I want to help small teams miss fewer delivery steps, but I have not worked out the product yet.
```

At this point the system does not initialize Git, select a stack, or create application code. It first narrows the smallest product result and a valid way to test the riskiest assumption.

## What the system does and what you decide

| The system handles | A person must provide or decide |
| --- | --- |
| Read the minimum accessible repository, Issue, Git, tracker, and accepted ADR facts needed for the current gate. | Real customer events and facts that are not in authoritative sources. |
| Separate facts, assumptions, decisions, and unknowns; form candidates and recommend one. | Product direction, priority, appetite, and whether the recommendation is acceptable. |
| Choose one bounded Evidence method and form a Candidate Frame. | Consent, access, privacy boundaries, and any result that only a real participant or environment can supply. |
| After Commitment, check required technical decisions and compile a Delivery Spec. | Commitment, load-bearing architecture choices, data ownership, shared interfaces, and risk acceptance. |
| Generate scenario coverage, a walking skeleton, candidate Tickets, and their dependency graph. | Approval of the exact Ticket graph. |
| Run one fresh graph-readiness review and compile an exact Controller Release Plan v2. | Confirmation of the exact Release Handoff fingerprint. |
| Reconstruct persisted authority and resume at the first open gate. | Production enablement, rollback decisions, and the final Outcome judgment. |

The system recommends, but it never disguises a non-delegable human tradeoff as an automated conclusion.

## What a complete path looks like

```text
one idea or Issue
→ find the smallest verifiable result
→ test the unknown most likely to overturn it
→ a person confirms it is worth delivering
→ close the required technical decisions
→ compile verifiable scenarios and Tickets
→ independent review
→ a person confirms one exact Release Handoff
→ the operator starts the Codex Controller
→ execute, release, and observe the real result
```

The system may shorten this path when trusted facts already close a gate. A decision-complete local correction can become one Ticket; an uncertain product idea cannot.

| Plain-language step | Internal term |
| --- | --- |
| This cycle's smallest verifiable result | **Release** |
| Confirm that it is worth delivering | **Commitment** |
| Close load-bearing technical decisions | **Solution Shaping / ADR** |
| Describe verifiable behavior | **Delivery Spec** |
| Define tasks and dependencies | **Delivery Graph** |
| Final planning review and exact execution authorization | **Execution Handoff** |
| Record real enablement and health | **Release Record** |
| Judge the post-release result | **Outcome** |

These terms describe gates and durable artifacts; users do not need to learn them before starting.

## What it will not do

- fabricate customer Evidence or infer product value from code existence;
- treat “use AI” as permission to start a model Spike before the user workflow is known;
- select a full stack or bootstrap an application before Commitment;
- plan a complete long-term backlog or put the whole system in one first Ticket;
- start a Controller Job or activate Legacy Herdr before the exact applicable approval;
- write to GitHub without the applicable scope and approval;
- treat merged, released, and Outcome achieved as the same fact;
- run `ask-yet` as a daemon or continuously poll the Harness.

## When files or GitHub change

Conversation, durable artifacts, and activation are separate:

1. Before the user selects a candidate, no product file is created.
2. A read-only request writes nothing.
3. A candidate file or approved draft ref may preserve work during framing and Evidence, but it is not an accepted delivery source.
4. Formal Evidence stores only an approved redacted result; raw answers stay outside the repository.
5. An exact accepted Release and any required accepted ADR must reach the accepted code base before the Delivery Spec can become authoritative.
6. Candidate Tickets begin as `needs-triage`.
7. The recommended Codex path shows the exact source, graph, Controller Plan, config digest, fingerprint, and invariants before handoff. A general “continue” is not approval.
8. Confirmed Codex handoff atomically writes three private local files and keeps every Ticket in `needs-triage`; it does not start the Controller. Ready-label writes exist only in the explicitly selected Legacy Herdr path.

Current behavior is owned by [`contracts/`](contracts/), [`scripts/`](scripts/), and the owning [`skills/`](skills/) or reference. [`fixtures/`](fixtures/) and `test/` are regression evidence, not contracts. This README and the guides are explanatory.

## Pause, resume, and inspect status

Return to the same directory and Profile:

```sh
pi-ticket-plan -c
pi-ticket-plan -r
```

Inside PI, `/session` shows the current session, `/new` starts one, `/resume` selects one, and `/quit` exits.

- “Continue” resumes the current active question.
- Asking “Where are we and what is missing?” returns the complete status card without advancing.
- A paused interview resumes at its first missing item.
- A new session cannot recover unpersisted participant answers from model memory or an assistant summary. Prefer the original session.
- An approved, redacted formal Evidence result can be reconstructed from its authoritative repository artifact. Alternatively, an owner may provide a redacted return block and explicitly confirm its factual accuracy; that can resume the conversation, but it closes formal Evidence only when the existing formal contract permits it.

## Advanced mechanisms

### Dedicated PI Profile and pinned release

The installer creates the dedicated Profile at `$HOME/.pi/ticket-planning`, renders settings with the checkout's actual path, pins the recorded Matt Pocock Skill commit, `pi-interactive-subagents` commit, and `pi-fff` version, and installs `$HOME/.local/bin/pi-ticket-plan` as a symlink to this checkout. `pi-fff` replaces the built-in `find` and `grep` tools through its `override` mode. Interactive subagents require a persistent PI session and return results asynchronously; a launch acknowledgement is not review evidence. Existing default-profile `auth.json` and `models.json` are shared by symlink when present. Managed files are backed up before replacement; credentials, sessions, trust decisions, caches, and runtime state do not belong in this repository.

The launcher sets the Profile before PI starts:

```sh
export PI_CODING_AGENT_DIR="${PI_TICKET_PLAN_PROFILE_DIR:-$HOME/.pi/ticket-planning}"
export PI_FFF_MODE="${PI_FFF_MODE:-override}"
exec pi "$@"
```

Ordinary `pi` remains unchanged. An existing ordinary PI session cannot switch Profiles in place. Inside PI, confirm the active Profile with:

```text
!!printf '%s\n' "$PI_CODING_AGENT_DIR"
```

Custom install locations are supported:

```sh
PI_TICKET_PLAN_PROFILE_DIR=/absolute/profile \
PI_TICKET_PLAN_BIN_DIR=/absolute/bin \
./install.sh
```

Use the same `PI_TICKET_PLAN_PROFILE_DIR` when starting the launcher. Human users normally invoke only `ask-yet`; `setup-delivery-repository`, triage, spec, ticket, readiness, and Admission Skills are model-invoked helpers. Direct helper invocation is reserved for advanced recovery and debugging.

### Automatic depth and authoritative sources

Internally, `ask-yet` infers `QUICK`, `STANDARD`, or `DISCOVERY` planning depth and adds `CONTROLLED` risk gates when security, privacy, credentials, destructive migration, production cutover, irreversible effects, or broad blast radius require them. These are implementation details, not choices the user must make.

The source of truth depends on the fact: product Evidence and decisions live in accepted product artifacts; source identity and accepted baseline come from Git; ticket state comes from the tracker; Legacy execution comes from the Harness ledger. Controller execution remains outside Planner state until a public export/status contract exists. Real enablement comes from the Release Record; the post-window result comes from Outcome Evidence. Conversation and summaries are leads, not authority.

In an existing Git target, one human-approved remote draft ref may preserve exact candidate blobs through Candidate Frame and Evidence revisions. It cannot feed the Delivery Spec. After Commitment, the exact Release blob must enter the accepted remote base. In Greenfield work, repository setup becomes eligible only after exact Commitment and the needed authorization; it creates the minimum delivery container, not an application stack or implementation scaffold.

### Solution Shaping, Spec, and Ticket graph

After an exact committed Release is present on the accepted base, Solution Shaping closes only decisions required for the first implementation boundary. Existing accepted ADRs and interfaces are reused. A new ADR is needed only for an unresolved load-bearing boundary such as a public interface, data ownership, cross-Ticket schema, security boundary, or primary verification seam. A bounded technical Spike establishes a technical fact; it does not choose product value or accept an ADR.

The Delivery Spec binds behavior to stable Scenario IDs and explicit handoffs. Ticket generation covers those scenarios, identifies a walking skeleton, records dependencies, and produces candidate Issues under `needs-triage`. Wayfinder maps contain decisions, research, prototypes, and human input; they do not enter the implementation queue.

### Strict frontier and execution handoff

Tracker capability is intentionally asymmetric:

| Tracker | Supported boundary |
| --- | --- |
| GitHub | Planning, graph/readiness review, the recommended Controller Release Handoff, and explicit Legacy Herdr `admit` compatibility. |
| GitLab | Planning and planning-level/readiness review only; no package-backed Controller or Legacy Herdr activation. |
| Local Markdown | Planning and review only; no transactional execution handoff. |

`to-spec apply` binds one exact `spec-acceptance:v1` receipt to the immutable Delivery Parent. `to-tickets` stores a separate `delivery-release-graph:v3` artifact for exactly one current all-AGENT Release; Roadmap/HUMAN/future work stays in a non-executable `roadmap-graph:v1`. Check either artifact with:

```sh
npm run check:delivery-graph -- --input /path/to/parent-or-snapshot
```

The stronger state check compares the v3 graph and receipt with the immutable Parent, current child bodies, native order, and blocker graph:

```sh
npm run check:admission-state -- --input /path/to/admission-bundle.json
```

For an accepted GitHub v3 Release, every AGENT child binds a frozen Oracle and Controller-enforced write paths/budget. The graph also binds tracked Spec/predecessor receipts and a decision manifest covering policy, product Release, accepted ADRs, and dependency handoffs. Build/verify/apply fresh-read the remote base and all bindings; offline `--input`, Roadmap, HUMAN work, future `PLANNED` candidates, and v2 artifacts stay outside Controller input:

```sh
pi-ticket-plan execution-plan build \
  --repo owner/repo --parent 90 \
  --review /private/review.json \
  --review-binding /private/review-binding.json \
  --review-dispatch-binding /private/review-dispatch.json \
  --context /private/context.json \
  --controller-cli /absolute/herdr-codex-controller/dist/src/cli.js \
  --controller-config /private/controller.json \
  --out /private/execution-handoff-plan.json --json

pi-ticket-planctl case approve-handoff PC-release-90 \
  --plan /private/execution-handoff-plan.json \
  --expected-fingerprint sha256:<confirmed-handoff-hash> --json

pi-ticket-plan execution-plan apply \
  --plan /private/execution-handoff-plan.json \
  --expected-fingerprint sha256:<confirmed-handoff-hash> \
  --case-id PC-release-90 --approval-id F-<id-from-approve-handoff> \
  --context /private/fresh-context.json \
  --controller-cli /absolute/herdr-codex-controller/dist/src/cli.js \
  --controller-config /private/controller.json \
  --output-dir /private/codex-release-90 --json
```

Build calls only Controller `config validate` and `plan validate`; apply also calls `doctor`. Both bind/recheck remote base, Parent/Children, receipts, decisions, dependency handoffs, Oracles and Controller provenance. Drift returns stable rebuild-required codes and preserves pending approval. Apply materializes exactly three private files, records `HANDOFF_READY`, consumes approval last, and only prints the bound Controller `start` command.

Legacy v2 migration is dry-run only: `node scripts/migrate-artifacts.mjs --artifact delivery-graph-v2 --input old.json --context migration.json --dry-run true`. A single Release requires exact `releaseMembership`; otherwise Roadmap/current membership is mandatory. Output is `PLANNED`, human-approved, never writes Issues/labels, and cannot hand off directly.

#### Legacy Herdr per-ticket activation

The old ready-label path remains available only when the operator explicitly selects it:

```sh
pi-ticket-plan admit readiness \
  --repo owner/repo --base <exact-accepted-base-sha> \
  --harness-cli /absolute/HerdrHarness-lite/dist/src/cli.js \
  --harness-config /private/project.harness.json \
  --out /tmp/harness-readiness.json

pi-ticket-plan admit plan \
  --repo owner/repo --parent 90 \
  --review /tmp/review.json --context /tmp/context.json \
  --harness-cli /absolute/HerdrHarness-lite/dist/src/cli.js \
  --harness-config /private/project.harness.json \
  --out /tmp/admission-plan.json

pi-ticket-planctl case create \
  --target github:owner/repo --case-id PC-admission-90 --json
pi-ticket-planctl case approve PC-admission-90 \
  --plan /tmp/admission-plan.json \
  --expected-fingerprint sha256:<confirmed-plan-hash> --json

pi-ticket-plan admit apply \
  --plan /tmp/admission-plan.json \
  --expected-fingerprint sha256:<confirmed-plan-hash> \
  --case-id PC-admission-90 --approval-id F-<id-from-case.approve> \
  --context /tmp/fresh-context.json \
  --harness-cli /absolute/HerdrHarness-lite/dist/src/cli.js \
  --harness-config /private/project.harness.json
```

A standalone Ticket uses `--issue 42` instead of `--parent 90`; a reviewed `HUMAN` lane omits the Harness flags. `case approve` records a one-hour, exact-Plan activation approval in the private Planning Case. `apply` reads that attestation through the protocol kernel and consumes it only after every postcondition passes; `PARTIAL` keeps it pending for the same Plan, while replay after `COMPLETE` is a conflict. `readiness` and `plan` may run disposable project validation but do not mutate Tracker or Harness workflow state. The private Harness config must be mode `0600`.

Controller execution, aggregate review, PR/CI/merge, real enablement, health, and Outcome remain distinct. Planner handoff never polls execution. Legacy Harness claim semantics remain confined to the explicit `admit` path.

Controller result ingestion remains deferred until the Controller exposes a public stable export/status contract. The Planner never reads private `job.json` state.

## Development and release verification

Repository-only checks do not require an installed PI Profile:

```sh
npm run check:docs
npm run verify:ci
```

After installation, verify the live Profile:

```sh
npm run verify
```

With the matching Harness checkout available, run the disposable cross-repository contract canary:

```sh
npm run canary:execution-readiness -- --harness-root /absolute/HerdrHarness-lite
```

It uses a temporary Git repository, bare origin, Harness config, Pi agent directory, and fake GitHub/Docker/Pi commands. It exercises one passing receipt plus missing gate, Docker, and tracked validation environment failures, then runs the Harness exact-HEAD/auto-merge guard tests. It does not use a real Provider, GitHub repository, production Docker daemon, Issue, label, PR, or Harness ledger.

With the matching Codex Controller checkout available, run its deterministic public-contract canary:

```sh
npm run canary:codex-controller-contract -- --controller-root /absolute/herdr-codex-controller
```

This canary locks the exact Controller commit, source-manifest/build/identity digests, and owner-schema byte SHA-256; rejects dirty checkout state; rebuilds an exact local clone under Node 26 permission isolation with network denied; compares Planner/lock/Controller schema bytes and config/Plan/provenance digests; accepts one v2 direct Plan; and rejects extra top-level, missing-required, extra-source, extra-Issue, and Release Plan v1 vectors. Dispatcher is reported out of scope and never called. The canary calls only `config validate` and `plan validate`; it never calls `doctor`, `start`, Codex, or a network write. PASS qualifies this read-only static contract, not live source revalidation or Codex/GitHub execution. A missing checkout is `CONTROLLER_UNAVAILABLE`, and missing build dependencies are `CONTROLLER_NOT_BUILT`, never PASS.

The expected Profile smoke result includes the package-owned `prepare-codex-release` skill; the command reports the exact current skill count.

Run one fresh-process live case with:

```sh
npm run eval:pi -- --case <id>
```

Single-turn cases validate a frozen starting point. Multi-turn cases reuse one real PI session; a failed multi-turn case is rerun from its first turn, not resumed midway. The version-controlled [`pi-eval-suites.json`](fixtures/pi-eval-suites.json) defines the current case counts and three suites:

- **Release** is the read-only, release-blocking suite. It uses bounded, stable representative cases and never permits Observer injection or model writes.
- **Nightly** repeats longer or more variable read-only cases, including explicitly declared Observer input. It reports failures but does not make the ordinary package release decision.
- **Isolated Writable** contains allowlisted writeback canaries. Run it only explicitly in the runner's disposable workspace and local bare origin; it is never reached by Release or Nightly.

Cases outside those executable suites are explicitly listed under `quarantine` and remain manual `--case` diagnostics until their coverage and stability justify promotion.

All three suites use a real model. `npm run verify:ci` is deterministic and incurs no model cost.

Before a package release, a clean authenticated checkout may run:

```sh
npm run verify:release -- --report /tmp/pi-ticket-plan-release-eval.json
```

`verify:release` requires a clean checkout and runs the manifest's Release suite. Its report includes the suite name, dynamic case count, nominal model-turn count, and case-set hash. It reports `PASS`, `SEMANTIC_FAIL`, and `INFRA_FAIL`; a failure recovered by its allowed retry is reported as `FLAKY`. To measure variance without making a release decision:

```sh
npm run eval:pi:nightly -- --report /tmp/pi-ticket-plan-live-eval.json
```

Run an allowlisted writable canary only when an isolated write is intended:

```sh
npm run eval:pi -- --suite isolated-writable --report /tmp/pi-ticket-plan-writable-eval.json
```

Update the same channel you installed.

Current development:

```sh
git checkout main
git pull --ff-only
./install.sh
```

Latest stable:

```sh
git fetch --tags
git checkout v0.4.0
./install.sh
```

Do not follow Matt upstream directly. Updating the pinned source, package overrides, suppressed Skills, or release manifest requires deliberate review and the repository's release verification.

## Security and provenance

PI packages and Skills can cause commands to run with the user's permissions. Review a release before installation and pin a tag or commit. Keep `LICENSE` and `NOTICE`; compatible overrides derive from `mattpocock/skills` at the commit recorded in [`upstream-lock.json`](upstream-lock.json).
