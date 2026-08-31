# Changelog

## Unreleased

- Replace the exact-build Controller lock with semantic `controllerContractVersion: 1` compatibility.
- Compile and approve one closed `release-plan.json`; apply materializes only that file and prints `start --approve-plan <planDigest>`.
- Ingest only the concise public `release-result:v1`; remove Completion v1-v3, predecessor wrappers, provenance, runtime-lock, trust-registry, and identity-history readers.
- Keep Spec, Delivery Graph, decisions, review, Oracle, protected paths, scope, freshness, and Planning Case approval as Planner-internal authority.
- Cross-repository CI validates current Plan/Result fixtures and schema equality without cloning or hashing a pinned Controller commit.
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
