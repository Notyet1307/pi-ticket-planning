# Changelog

## Unreleased

- Formally qualify `herdr-codex-controller` commit `b1afa0127dd0b51e210757e9baf150d2d2851326` for the direct Release Plan v2 mainline. The machine lock now fixes `release-plan-v2-direct`, keeps Dispatcher unqualified, and preserves operator-explicit `start`.
- Require the Controller checkout used by `prepare-codex-release` to match the exact lock with a clean tracked worktree; never translate the approved graph into Dispatcher-driven per-Issue Plan v1 or use `ready-for-agent` on this path.
- Add the recommended Codex Controller Release Handoff: deterministic Release Plan v2 compilation, exact source/review/config binding, one-hour fingerprint approval, live Controller doctor gate, and atomic three-file materialization without starting execution or writing ready labels.
- Keep per-ticket Herdr Admission as an explicit Legacy path while generalizing `HANDOFF_READY` to the executor-neutral `execution.handoffReady` fact.
- Add the v0.5 versioned protocol kernel, Artifact Registry, Fact Attestation,
  Planning Case state, Result Envelope, Context Manifests, and model checker.
- Split Admission into deep modules and bind fresh Reviewer input, Capability
  evidence, exact human approval through a persistent Planning Case, Tracker
  writes, and post-write proof; consumed approvals cannot be replayed.
- Add dry-run local update/migration/rollback, read-only Outcome ingestion,
  tiered evidence workflows, security controls, and performance checks.
- Add fingerprinted two-phase GitHub CI and auto-merge gate setup with strict readback.
- Require an executed exact-base Harness readiness receipt before activating `AGENT` work.
- Add a cross-repository disposable readiness canary covering environment and merge-gate failures.

## v0.4.0 - 2026-08-21

- Make `ask-yet` candidate-first with progressive human responses.
- Add bounded Evidence method selection, exploratory/validation interview sessions, and Greenfield Solution Shaping.
- Require accepted-base Release and technical-decision sources before delivery compilation.
- Add manifest-driven single-turn and multi-turn PI evaluation suites.
- Add a ticket-context quality gate and focused onboarding guides for all three entry paths.

## v0.3.1 - 2026-08-16

Previous stable release. It predates the Unreleased current-development behavior above.
