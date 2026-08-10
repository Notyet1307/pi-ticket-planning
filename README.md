# PI Ticket Planning

[English](README.md) | [简体中文](README.zh-CN.md)

A profile-only PI package for turning delivery specs into implementation tickets, independently admitting them, and activating only graphs that are safe for a strict-frontier Harness.

It combines the complete pinned stable Matt Pocock skill set with package-owned overrides for specification, ticket generation, triage, and admission. Upstream adoption is manual.

## Install from GitHub

Requirements:

- Node.js 22.16 or newer;
- `pi`, `git`, and `gh` on `PATH`;
- a working PI login/model configuration;
- GitHub authentication before operating on real Issues.

Clone a released tag, then run the installer:

```sh
git clone --branch v0.1.1 --depth 1 \
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

Configure a repository once:

```text
/skill:setup-matt-pocock-skills
```

PI's explicit skill command form is `/skill:<name>`. References such as `/to-spec` inside skill documents describe workflow transitions; humans type `/skill:to-spec`.

## Workflow

For a new or undecided project:

```text
/skill:ask-matt 我想从 0 开始做一个……
/skill:wayfinder 规划这个项目的决策地图
/skill:to-spec
/skill:to-tickets
```

The delivery path is:

```text
setup-matt-pocock-skills
  -> ask-matt / wayfinder
  -> to-spec: needs-triage delivery spec
  -> to-tickets: needs-triage children and blocker graph
  -> strict-frontier order check
  -> fresh ticket-readiness reviewer
  -> human confirmation
  -> ready-for-agent / ready-for-human children
  -> delivery parent activated last
  -> Harness claim
```

Wayfinder maps contain decisions, research, prototypes, and human input. They never enter the implementation queue. `READY | SPLIT | NEEDS_INFO` judges ticket readiness; `AGENT | HUMAN` selects the execution lane.

Existing issues and direct activation requests use:

```text
/skill:triage owner/repo#39
/skill:admit-ticket owner/repo#39
```

No generation or triage path may directly add a ready label.

## Strict-frontier safety

For every internal `blocker -> dependent` edge, the blocker must appear earlier in the delivery parent's native child list. Admission runs the same read-only GitHub check before review and again before activation.

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

After installation:

```sh
npm run verify
```

The expected Profile smoke result is `profile isolation: ok (27 skills)`.

Updates are explicit and release-based:

```sh
git fetch --tags
git checkout v0.1.2
./install.sh
```

Do not follow Matt upstream directly. A package release must deliberately update the pinned commit, replay the four overrides, update `upstream-lock.json`, and pass verification.

## Security and provenance

PI packages and skills can cause commands to run with the user's permissions. Review a release before installation and pin a tag or commit. Keep `LICENSE` and `NOTICE`; the compatible overrides derive from `mattpocock/skills` at the commit recorded in `upstream-lock.json`.
