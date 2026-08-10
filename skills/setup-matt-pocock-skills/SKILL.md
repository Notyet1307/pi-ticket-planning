---
name: setup-matt-pocock-skills
description: "Configure a repository for the Matt Pocock engineering flow plus the ticket-admission gate: issue tracker, labels, domain docs, Wayfinder operations, and delivery-map activation. Run once before the first engineering flow."
disable-model-invocation: true
---

# Setup Matt Pocock Skills

Configure the repository facts consumed by the engineering skills and the ticket-planning profile. Explore, present findings, obtain confirmation, then write.

## 1. Explore

Read the real starting state:

- git remote -v and .git/config;
- root AGENTS.md or CLAUDE.md;
- CONTEXT.md, CONTEXT-MAP.md, and docs/adr;
- docs/agents and any prior setup output;
- .scratch and existing local issue conventions;
- installed skills, especially triage, wayfinder, ticket-readiness, and admit-ticket;
- monorepo signals such as pnpm-workspace.yaml, package workspaces, or populated packages directories;
- for GitHub, current labels and whether native sub-issues and issue dependencies are available.

Report what exists, what conflicts, and what is missing.

## 2. Resolve configuration

Take one section at a time. Lead with the recommended answer and accept a short confirmation.

### A. Issue tracker

Prefer GitHub when the remote points to GitHub. Otherwise offer GitLab, local Markdown, or a user-described tracker. Record the choice in docs/agents/issue-tracker.md using the matching template in this skill directory.

HerdrHarness Lite execution requires GitHub. When another tracker is selected, record that the planning flow remains usable but Harness activation is unavailable.

### B. Triage labels

When triage is installed, recommend the canonical mapping:

- needs-triage
- needs-info
- ready-for-agent
- ready-for-human
- wontfix

Collect overrides only when the repository already has an established vocabulary. Record the mapping in docs/agents/triage-labels.md.

### C. Domain docs

Default to one root CONTEXT.md and docs/adr. Offer a root CONTEXT-MAP.md with per-context documents only for a genuine multi-package repository. Record consumer rules and layout in docs/agents/domain.md.

### D. Delivery gate

Record docs/agents/delivery-gate.md from the template in this skill directory. It must establish:

- Wayfinder maps contain decision tickets and never enter the implementation queue;
- delivery specs and candidate children begin in needs-triage;
- /admit-ticket is the sole skill path to ready-for-agent or ready-for-human;
- native child and blocker relationships are wired before review;
- the delivery parent receives ready-for-agent last.

Use /ticket-readiness as the package-level contract; keep repository-specific label names and tracker operations in docs/agents.

## 3. Confirm the write set

Show the user:

- the exact Agent skills block for AGENTS.md or CLAUDE.md;
- the proposed docs/agents files;
- for GitHub, every missing triage and Wayfinder label to create;
- any unavailable native sub-issue or dependency capability and the fallback that would be recorded.

Wait for confirmation before editing files or creating labels.

## 4. Write repository configuration

Edit CLAUDE.md when it exists; otherwise edit AGENTS.md. If neither exists, ask which one to create. Update an existing Agent skills block in place.

Use this block, omitting Triage labels when triage is absent:

    ## Agent skills

    ### Issue tracker
    [one-line tracker summary]. See docs/agents/issue-tracker.md.

    ### Triage labels
    [one-line label mapping summary]. See docs/agents/triage-labels.md.

    ### Domain docs
    [single-context or multi-context summary]. See docs/agents/domain.md.

    ### Delivery gate
    Candidate implementation issues require independent admission before any ready label. See docs/agents/delivery-gate.md.

Write the docs from:

- issue-tracker-github.md, issue-tracker-gitlab.md, or issue-tracker-local.md;
- triage-labels.md when triage is installed;
- domain.md;
- delivery-gate.md.

Preserve surrounding user content.

## 5. Provision GitHub labels

After the confirmed docs write, create only missing labels. Use the configured triage label names plus these Wayfinder labels when wayfinder is installed:

- wayfinder:map
- wayfinder:research
- wayfinder:prototype
- wayfinder:grilling
- wayfinder:task

Do not rename or delete existing labels. If label creation fails, report the exact missing labels and leave setup incomplete.

## 6. Verify

Re-read the written files and tracker labels. Verify that every pointer resolves, configured label names exist, and the GitHub operations documented for Wayfinder and delivery maps match available tracker capabilities.

Report the files changed, labels created or reused, capability fallbacks, and the next valid entry point: /ask-matt. Setup is complete only when the stored configuration matches the tracker.
