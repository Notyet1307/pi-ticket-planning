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
git clone --branch v0.2.0 --depth 1 \
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

The complete path is:

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
  -> human confirmation
  -> ready-for-agent / ready-for-human children
  -> delivery parent activated last
  -> Harness claim
```

Wayfinder maps contain decisions, research, prototypes, and human input. They never enter the implementation queue. `READY | SPLIT | NEEDS_INFO` judges ticket readiness; `AGENT | HUMAN` selects the execution lane.

Existing issues and direct activation requests also use the router:

```text
/skill:ask-yet owner/repo#39
```

`ask-yet` loads triage or Admission itself when that is the true next gate. No generation or triage path may directly add a ready label. Admission rechecks Scenario coverage, every state/artifact handoff, the walking skeleton, strict-frontier order, and a fresh readiness review before human confirmation. A changed source, matrix, candidate, or graph must pass Admission again before Harness handoff.

## Strict-frontier safety

The parent stores one normalized Delivery Graph JSON snapshot under `## Ticket coverage`. Check its source identity, Scenario handoffs, coverage, walking skeleton, and internal order with:

```sh
npm run check:delivery-graph -- --input /path/to/parent-or-snapshot
```

For every internal `blocker -> dependent` edge, the blocker must also appear earlier in the delivery parent's native child list. Admission runs both the snapshot check and the read-only GitHub order check before review and again before activation.

Run it manually from the checkout:

```sh
npm run check:frontier -- \
  --repo owner/repo \
  --parent 90
```

`FAIL` or a GitHub read error keeps the graph in `needs-triage`.

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

After installation, also verify the live Profile:

```sh
npm run verify
```

The expected Profile smoke result is `profile isolation: ok (27 skills)`.

Updates are explicit and release-based:

```sh
git fetch --tags
git checkout v0.2.0
./install.sh
```

Do not follow Matt upstream directly. A package release must deliberately update the pinned commit, replay the four overrides and suppressed upstream router, update `upstream-lock.json`, and pass verification.

## Security and provenance

PI packages and skills can cause commands to run with the user's permissions. Review a release before installation and pin a tag or commit. Keep `LICENSE` and `NOTICE`; the compatible overrides derive from `mattpocock/skills` at the commit recorded in `upstream-lock.json`.
