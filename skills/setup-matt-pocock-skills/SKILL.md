---
name: setup-matt-pocock-skills
description: Configure delivery setup when ask-yet finds a COMMITTED Release whose existing or greenfield target lacks tracker labels, policy pointers, or admission/Harness prerequisites.
---

# Setup Matt Pocock Skills

Establish the repository facts consumed by planning and admission. Explore, resolve authorization once, apply the smallest permitted setup, and verify the resulting delivery base.

## 1. Classify the starting state

Resolve the exact target directory and classify it:

- `EXISTING`: Git `HEAD` resolves to a commit.
- `GREENFIELD`: the directory is non-Git or Git has an unborn `HEAD`.

Inspect safely:

- Git status, `HEAD`, remotes, and `.git/config` when present;
- effective root `AGENTS.md` or `CLAUDE.md` and any shadowing policy file;
- root README, product/release artifacts, `CONTEXT.md`, `CONTEXT-MAP.md`, and `docs/adr`;
- `docs/agents`, `.scratch`, installed Skills, tracker conventions, and monorepo signals;
- for an existing GitHub remote, current labels and native sub-issue/dependency capabilities.

For `GREENFIELD`, require the supplied Release artifact path, Release ID, exact revision, and current `status: COMMITTED`. Re-read it from disk. If any identity is missing, mismatched, or not COMMITTED, stop without mutation and return `/skill:ask-yet <target and Release artifact>`. Missing Git, README, policy, code, and tracker are expected facts, not authorization.

## 2. Resolve delivery configuration

Take one section at a time. Lead with a recommendation and obtain only undiscoverable human choices.

### A. Repository and tracker

Prefer GitHub when the target will use HerdrHarness Lite. For a new GitHub repository, collect owner, repository name, visibility, and default branch before proposing creation. Reuse an existing remote only after verifying its identity. A local Markdown or GitLab tracker remains valid for planning, but record that HerdrHarness activation is unavailable.

Store the selected tracker contract in `docs/agents/issue-tracker.md` using the matching template in this Skill directory.

### B. Triage labels

Use the repository's established vocabulary or recommend:

- `needs-triage`
- `needs-info`
- `ready-for-agent`
- `ready-for-human`
- `wontfix`

Record the mapping in `docs/agents/triage-labels.md` when the tracker uses labels.

### C. Agent and domain policy

For a greenfield Harness repository, recommend root `AGENTS.md`. For an existing repository, preserve the effective policy file and surrounding user content. Add only stable cross-ticket routing and delivery-gate pointers; keep Release behavior, Ticket acceptance criteria, tentative architecture, and implementation advice out of root policy.

Default to one root `CONTEXT.md` convention and `docs/adr`; create neither until real domain terms or decisions exist. Store only the consumption convention in `docs/agents/domain.md`.

### D. Delivery gate

Write `docs/agents/delivery-gate.md` from the template. It must establish candidate state, Scenario coverage, walking-skeleton, strict-frontier, fresh review, human confirmation, execution lanes, and parent-last activation.

## 3. Present one exact mutation plan

For every starting state, determine whether standing automation approval covers the exact reversible operations. Apply covered operations without another interruption. Otherwise show one consolidated plan containing:

- exact files to create or edit and the proposed Agent policy block;
- exact tracker configuration, missing labels, and capability fallbacks;
- every external mutation, including repository creation, remote addition, push, and label creation.
- for an existing GitHub/Harness target, the exact stage, commit, and permitted pre-delivery publication handoff that will put approved configuration into the accepted remote base; the implementation Harness cannot publish its own prerequisite setup.

For `GREENFIELD`, also show:

- whether `git init -b <branch>` is required;
- every path to stage, including the exact COMMITTED Release artifact;
- the initial commit message and files intentionally left untracked;
- the proposed remote URL and push target, if any.

Stage only authorized paths; never use `git add .`. Preserve every pre-existing file and change outside the approved set. Repository or label creation and push require standing approval that includes those external mutations or one consolidated approval. A required stable policy change is always shown once before it governs later work.

The greenfield plan creates a delivery container only. It contains no application scaffold, language or framework selection, dependency manifest, database, CI, Docker setup, or AI architecture unless a later accepted Delivery Spec explicitly requires them.

## 4. Apply the approved local setup

Immediately before mutation, re-check the target path, starting-state classification, Release revision, and Git status. Stop on drift.

For `GREENFIELD` after authorization:

1. Initialize Git only when absent; preserve an existing unborn repository and its configured default branch.
2. Write only the approved `AGENTS.md` or `CLAUDE.md` block and `docs/agents` files.
3. Stage the approved paths explicitly, including the COMMITTED Release artifact; leave unrelated files untouched and untracked.
4. Create the initial commit only when the displayed commit was approved and Git author identity is already usable. Do not invent or modify identity configuration.
5. Resolve and report the resulting exact base SHA.

For `EXISTING`, write only the approved configuration and labels. Do not create a commit, branch, remote, or push unless the displayed plan explicitly included that operation. When policy reserves publication for a human maintainer or an already-configured pre-delivery mechanism, stop with the exact approved paths and handoff instead of reporting setup complete. Never route prerequisite setup through the implementation Harness.

## 5. Apply approved remote and tracker setup

Create or add a remote and push only after the matching external mutation is approved. Refuse to overwrite a conflicting `origin`. Re-read the remote repository identity after creation or push.

For GitHub, create only missing triage and Wayfinder labels after the repository exists. Do not rename or delete existing labels. If repository creation, push, capability discovery, or label provisioning fails, report the exact partial state and leave setup incomplete.

## 6. Verify completion

Re-read local and remote facts. `GREENFIELD` setup is complete only when:

- Git `HEAD` resolves and the exact COMMITTED Release artifact exists in that commit;
- all approved setup files are committed in the reported base SHA;
- the effective root policy path and content are known;
- tracker identity and stored tracker configuration agree;
- required labels and relationship capabilities exist, or an explicit planning-only fallback is recorded;
- unrelated pre-existing files and changes remain untouched.

For any repository, verify every policy pointer, configured label, Scenario-coverage rule, and tracker operation. For an existing GitHub/Harness target, setup is complete only when the accepted remote base contains every required configuration blob and the remote labels exist; a working-tree or unpublished commit is incomplete. Report the exact base SHA, effective policy, files changed, commit/remote/push state, labels, capability fallbacks, untouched changes, and whether Harness activation is available.

Return the verified setup facts to `ask-yet`, which continues to `to-spec` in the same run when no human gate remains.
