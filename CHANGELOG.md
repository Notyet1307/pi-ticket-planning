# Changelog

## Unreleased

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
