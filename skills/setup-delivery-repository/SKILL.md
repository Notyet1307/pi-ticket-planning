---
name: setup-delivery-repository
description: Configure an existing or greenfield repository when ask-yet finds missing planning tracker, policy, delivery base, or explicitly selected Legacy Admission prerequisites.
---

# Setup Delivery Repository

Establish the repository facts consumed by planning. Add Admission/Harness setup only when the operator explicitly selects Legacy Herdr. Explore, resolve authorization once, apply the smallest permitted setup, and verify the resulting delivery base.

Read [the Planning Case runtime](../planning-case-runtime.md) before work. Resume the exact Case, record setup decisions, and bind the verified source, policy, tracker, and delivery base after readback. Repository setup is incomplete while any binding exists only in conversation or the working tree.

## 1. Classify the starting state

Resolve the exact target directory and classify it:

- `EXISTING`: Git `HEAD` resolves to a commit.
- `GREENFIELD`: the directory is non-Git or Git has an unborn `HEAD`.

Inspect safely:

- Git status, `HEAD`, remotes, and `.git/config` when present;
- effective root `AGENTS.md` or `CLAUDE.md` and any shadowing policy file;
- root README and product/release artifacts, plus only the glossary, context index, and accepted ADRs that can change the current setup decision;
- `docs/agents`, `.scratch`, installed Skills, tracker conventions, and monorepo signals;
- for an existing GitHub remote, current labels and native sub-issue/dependency capabilities.

For `GREENFIELD`, require the supplied Release artifact path, Release ID, exact revision, and current `status: COMMITTED`. Re-read it from disk. If any identity is missing, mismatched, or not COMMITTED, stop without mutation and return `/skill:ask-yet <target and Release artifact>`. Missing Git, README, policy, code, and tracker are expected facts, not authorization.

## 2. Resolve delivery configuration

Take one section at a time. Lead with a recommendation and obtain only undiscoverable human choices.

### A. Repository and tracker

Prefer GitHub when the target will use HerdrHarness Lite. For a new GitHub repository, collect owner, repository name, visibility, and default branch before proposing creation. Reuse an existing remote only after verifying its identity.

| Tracker | Supported boundary |
| --- | --- |
| GitHub | Planning, graph and readiness review, transactional Admission `plan`/`apply`, ready-label activation, and configured HerdrHarness handoff. |
| GitLab | Planning and planning-level/readiness review only; no package-backed transactional `admit apply` or HerdrHarness activation. |
| Local Markdown | Planning and review only; no transactional ready activation or HerdrHarness activation. |

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

For a greenfield Harness repository, recommend root `AGENTS.md`. For an existing repository, preserve the effective policy file and surrounding user content. Before proposing text, check whether equivalent concern-owned authority rules already exist. Add only missing stable cross-ticket routing and delivery-gate rules; keep Release behavior, Ticket acceptance criteria, tentative architecture, current symbols, line numbers, state call sequences, and implementation advice out of root policy.

The effective root policy should establish this compact authority boundary, adapted to the repository's existing vocabulary:

- task behavior comes from the accepted Release, Spec, or Ticket;
- current implementation facts come from code, configuration, types, and tests at the task base;
- load-bearing technical decisions come from accepted ADRs;
- global non-discoverable invariants come from the effective root policy;
- live tracker and execution facts come from their owning systems;
- README, CONTEXT files, examples, fixtures, and Git history are supporting material, not substitutes for those owners;
- read only the smallest source set required for the current decision and fail closed when authorities for the same concern conflict.

The Harness governance boundary remains the effective root policy. Do not create nested `src/**/AGENTS.md` or `packages/**/AGENTS.md` or claim scoped precedence unless the configured Harness explicitly supports it. Any policy write remains part of the exact mutation plan in section 3; absence alone never authorizes a write.

Create `CONTEXT.md` only for real terminology ambiguity and `CONTEXT-MAP.md` only when at least two real bounded contexts need navigation. They remain glossary/navigation aids, never product, architecture, data-ownership, or policy authorities. Store only their consumption convention in `docs/agents/domain.md`; create accepted ADR storage only when a real load-bearing decision exists.

### D. Delivery gate

Write `docs/agents/delivery-gate.md` from the template. It must establish candidate state, Scenario coverage, walking-skeleton, strict-frontier, fresh review, human confirmation, and execution lanes. Include transactional ready activation and parent-last writes only for GitHub.

### E. Optional Legacy Herdr CI and merge gate

Only when the operator explicitly selects Legacy Herdr, configure this section and its Admission/Harness prerequisites. For the default Controller-direct route or a planning-artifact publication, skip the whole section; missing Harness, Provider, Reviewer, capability receipt, compatibility tuple, auto-merge, or ready labels does not make planning setup incomplete.

For a GitHub repository that will use HerdrHarness, require one tracked, executable, Secret-free canonical validation script. It owns project-specific dependency setup, safe test environment creation, Docker/Compose profiles, validation, and cleanup. Do not infer a command from a package manager, copy an untracked `.env`, or create a language-specific script. If the script is missing, return an ENABLER or `NEEDS_INFO`; do not configure auto-merge.

Delivery-gate setup has two separately approved phases:

1. Run `pi-ticket-plan delivery-gate plan --repo-path <root> --validation-script <repo-relative-script> --out <private-plan>` and show its fingerprint. After confirmation, `delivery-gate apply` creates only `.github/workflows/herdr-delivery-gate.yml`; it never stages, commits, pushes, or overwrites different content. Publish that file through an explicitly approved feature PR and merge the bootstrap manually.
2. Only after the managed GitHub Actions check succeeds on the current default branch, run `delivery-gate plan --repo OWNER/REPO`. The confirmed enforcement Plan first creates or updates the one active default-branch ruleset with strict pinned status checks, zero human approvals, no bypass actors, no force pushes/deletion, and merge-only compatibility; only after that readback succeeds does it enable repository auto-merge and merge commits. Apply is idempotent, rereads every external write, and rolls forward after a partial result.

Never use `pull_request_target`, provision CI Secrets, add a Harness bypass, disable existing protection, or enable repository auto-merge before the required check exists. Existing unrelated workflows and rulesets remain untouched; a conflicting effective rule is `NEEDS_INFO`, not permission to weaken it.

## 3. Present one exact mutation plan

For every starting state, determine whether standing automation approval covers the exact reversible operations. Apply covered operations without another interruption. Otherwise show one consolidated plan containing:

- exact files to create or edit and the proposed Agent policy block;
- exact tracker configuration, missing labels, and capability fallbacks;
- the managed workflow plan/fingerprint or the exact reason CI bootstrap is not ready;
- the repository setting and ruleset before/after projections for any enforcement Plan;
- every external mutation, including repository creation, remote addition, push, and label creation.
- for an existing GitHub/Harness target, the exact stage, commit, and permitted pre-delivery publication handoff that will put approved configuration into the accepted remote base; the implementation Harness cannot publish its own prerequisite setup.

For `GREENFIELD`, also show:

- whether `git init -b <branch>` is required;
- every path to stage, including the exact COMMITTED Release artifact;
- the initial commit message and files intentionally left untracked;
- the proposed remote URL and push target, if any.

Stage only authorized paths; never use `git add .`. Preserve every pre-existing file and change outside the approved set. Repository or label creation and push require standing approval that includes those external mutations or one consolidated approval. A required stable policy change is always shown once before it governs later work.

The greenfield plan creates a delivery container only. It contains no application scaffold, language or framework selection, dependency manifest, database, Docker setup, or AI architecture. CI bootstrap is eligible only after a tracked canonical validation script exists and the exact two-phase GitHub mutation Plans above are approved; setup never invents that script or its technology choices.

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

For GitHub, create only missing triage and Wayfinder labels after the repository exists. Do not rename or delete existing labels. Apply a delivery-gate Plan only with its confirmed fingerprint and only in its declared phase. If repository creation, push, capability discovery, label provisioning, workflow bootstrap, check observation, or ruleset enforcement fails, report the exact partial state and leave setup incomplete.

## 6. Verify completion

### Planning publication completion

Re-read local and remote facts. `GREENFIELD` setup is complete only when:

- Git `HEAD` resolves and the exact COMMITTED Release artifact exists in that commit;
- all approved setup files are committed in the reported base SHA;
- the effective root policy path and content are known;
- tracker identity and stored tracker configuration agree;
- required labels and relationship capabilities exist, or an explicit planning-only fallback is recorded;
- unrelated pre-existing files and changes remain untouched.

For any repository, verify every policy pointer, the equivalent concern-owned Context authority boundary in the effective root policy, configured label, Scenario-coverage rule, and tracker operation. Confirm that no duplicate block, nested-policy assumption, current implementation detail, or accepted code/ADR conflict was introduced. This completion is sufficient for `to-spec`; do not run `doctor --require admission`, Harness readiness, Reviewer probes, compatibility qualification, or Controller validation for a planning publication. Report the exact base SHA, effective policy, files changed, commit/remote/push state, labels, planning fallbacks, and untouched changes.

### Optional Legacy Herdr completion

Only when the operator explicitly selects Legacy Herdr, additionally require:

- `pi-ticket-plan doctor --require admission`, including repository auto-merge, strict pinned required checks, zero human approvals, no relevant ruleset bypass, and merge-commit compatibility;
- a passing exact-base `pi-ticket-plan admit readiness` binding from the private project Harness config and supported Harness CLI, without exposing private paths or raw output;
- every required configuration blob in the accepted remote base and the remote ready-label vocabulary.

A failed or missing Legacy check disables only Legacy activation. It does not invalidate the planning publication completion above.

Return the verified base, effective policy, tracker, and exact Release facts to `ask-yet`. It checks whether first-Release Solution Shaping is required, accepts any load-bearing technical decision through the repository's ADR path, and continues to `to-spec` only when no technical or human gate remains. Setup still chooses no implementation behavior.
