# PI Ticket Planning

English | [简体中文](README.zh-CN.md)

PI Ticket Planning turns a rough product idea, a feature request for an existing project, or an Issue into a decision-complete Ticket with the correct execution lane: an AI agent can execute and verify `AGENT` work independently, while non-delegable work stays `HUMAN`. It is for product and engineering owners who want the system to gather repository facts, preserve evidence and decisions, and prepare delivery work without delegating the decisions that still belong to people.

The input can be one natural-language sentence or an Issue reference. The durable output is an admitted standalone Ticket or an admitted Ticket graph linked to an accepted product goal, technical decisions, and verification. Starting an agent immediately would hide unresolved product, architecture, dependency, or risk choices inside implementation; this package closes those choices first.

> The system recommends and performs reversible planning work. People still supply real customer facts, make Commitment and risk decisions, approve the Ticket graph, and activate Admission. It does not create implementation work or write GitHub ready labels without the applicable gate and approval.

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
- a working PI login/model configuration;
- GitHub authentication before operating on real Issues.

Clone the current released tag and run the installer:

```sh
git clone --branch v0.3.1 --depth 1 \
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
| Run a fresh-context readiness review and prepare an exact Admission Plan. | Confirmation of the exact Admission fingerprint and activation. |
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
→ a person confirms handoff to the execution Harness
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
| Final review before an agent can claim work | **Admission** |
| Record real enablement and health | **Release Record** |
| Judge the post-release result | **Outcome** |

These terms describe gates and durable artifacts; users do not need to learn them before starting.

## What it will not do

- fabricate customer Evidence or infer product value from code existence;
- treat “use AI” as permission to start a model Spike before the user workflow is known;
- select a full stack or bootstrap an application before Commitment;
- plan a complete long-term backlog or put the whole system in one first Ticket;
- let a Ticket enter the Harness before Admission;
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
7. Admission shows the exact files or Issues, revision, ref, fingerprint, and invariants before activation. A general “continue” is not approval for that exact mutation.
8. Only confirmed Admission writes `ready-for-agent` or `ready-for-human` labels.

The machine contracts in [`skills/`](skills/), [`contracts/`](contracts/), [`scripts/`](scripts/), and [`fixtures/`](fixtures/) remain authoritative. This README and the guides explain them; they do not create a second runtime contract.

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

The installer creates the dedicated Profile at `$HOME/.pi/ticket-planning`, renders settings with the checkout's actual path, pins the recorded Matt Pocock Skill commit and `pi-subagents`, and installs `$HOME/.local/bin/pi-ticket-plan` as a symlink to this checkout. Existing default-profile `auth.json` and `models.json` are shared by symlink when present. Managed files are backed up before replacement; credentials, sessions, trust decisions, caches, and runtime state do not belong in this repository.

The launcher sets the Profile before PI starts:

```sh
export PI_CODING_AGENT_DIR="${PI_TICKET_PLAN_PROFILE_DIR:-$HOME/.pi/ticket-planning}"
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

The source of truth depends on the fact: product Evidence and decisions live in accepted product artifacts; source identity and accepted baseline come from Git; ticket state comes from the tracker; execution comes from the Harness ledger; real enablement comes from the Release Record; the post-window result comes from Outcome Evidence. Conversation and summaries are leads, not authority.

In an existing Git target, one human-approved remote draft ref may preserve exact candidate blobs through Candidate Frame and Evidence revisions. It cannot feed the Delivery Spec. After Commitment, the exact Release blob must enter the accepted remote base. In Greenfield work, repository setup becomes eligible only after exact Commitment and the needed authorization; it creates the minimum delivery container, not an application stack or implementation scaffold.

### Solution Shaping, Spec, and Ticket graph

After an exact committed Release is present on the accepted base, Solution Shaping closes only decisions required for the first implementation boundary. Existing accepted ADRs and interfaces are reused. A new ADR is needed only for an unresolved load-bearing boundary such as a public interface, data ownership, cross-Ticket schema, security boundary, or primary verification seam. A bounded technical Spike establishes a technical fact; it does not choose product value or accept an ADR.

The Delivery Spec binds behavior to stable Scenario IDs and explicit handoffs. Ticket generation covers those scenarios, identifies a walking skeleton, records dependencies, and produces candidate Issues under `needs-triage`. Wayfinder maps contain decisions, research, prototypes, and human input; they do not enter the implementation queue.

### Strict frontier and Admission

The delivery parent stores one normalized Delivery Graph v2 snapshot under `## Ticket coverage`. It binds accepted Spec content and exact child bodies by SHA-256. Check a snapshot with:

```sh
npm run check:delivery-graph -- --input /path/to/parent-or-snapshot
```

The stronger Admission-state check compares that snapshot with the parent Spec, current child bodies, native order, and blocker graph:

```sh
npm run check:admission-state -- --input /path/to/admission-bundle.json
```

For a GitHub map, prepare and apply an exact Admission transaction through the launcher:

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

A standalone Ticket uses `--issue 42` instead of `--parent 90`. `plan` is read-only. `apply` accepts only the confirmed snapshot, preserves unrelated labels, records an idempotent Admission comment, and rereads all children before activating a parent. `COMPLETE` is success, `PARTIAL` resumes with the same Plan, and `CONFLICT` requires a new review. A ready label plus the Admission record is the Harness handoff; Admission does not independently inspect the deployed Harness.

Harness claim, execution, review, merge, real enablement, health, and Outcome remain distinct. `ask-yet` runs only when invoked and reconstructs the next gate from authoritative sources; only the Harness may remain resident.

Internal design history is available in [`ask-yet` architecture](docs/plans/ask-yet-skill-architecture.md) and the [product-to-delivery operating model](docs/plans/product-to-delivery-operating-model.md). These are maintainer references, not first-use guides.

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

The expected Profile smoke result is `profile isolation: ok (27 skills)`.

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

Updates are explicit and release-based:

```sh
git fetch --tags
git checkout v0.3.1
./install.sh
```

Do not follow Matt upstream directly. Updating the pinned source, package overrides, suppressed Skills, or release manifest requires deliberate review and the repository's release verification.

## Security and provenance

PI packages and Skills can cause commands to run with the user's permissions. Review a release before installation and pin a tag or commit. Keep `LICENSE` and `NOTICE`; compatible overrides derive from `mattpocock/skills` at the commit recorded in [`upstream-lock.json`](upstream-lock.json).
