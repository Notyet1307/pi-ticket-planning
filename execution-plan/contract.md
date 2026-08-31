# Codex Controller semantic release contract

Planner keeps Planning Case, accepted Spec, Delivery Graph, decisions, ticket review, Oracle bindings, scope controls, freshness checks, and human approval as internal authority. It exports only `release-plan.json`.

```text
Planner internal facts
→ release-plan.json
→ Controller validation, fresh Workers, aggregate review, PR, required CI, exact-head merge
→ review.md + release-result.json
```

The Plan uses `controllerContractVersion: 1` and contains only the release identity and objective, repository/base, Parent and ordered child Issue numbers, dependencies, objectives, acceptance criteria, optional expected paths, simple risk, optional trusted Oracle commands, release acceptance criteria, and review focus. Controller does not consume Spec, Graph, decision, predecessor, waiver, build, runtime, or provenance artifacts.

`execution-plan build` compiles the semantic Plan from fresh Planner facts. `verify` recompiles and compares it. `apply` requires the exact human-approved Plan fingerprint, writes only `release-plan.json`, verifies exact readback, advances the Planning Case to `HANDOFF_READY`, consumes approval last, and prints:

```text
herdr-codex start --config ... --plan ... --approve-plan <planDigest>
```

Controller returns `herdr-codex-controller:release-result:v1`. Planner ingestion requires the approved Plan and binds `releaseId`, `planDigest`, and `baseSha`; a downstream Graph also records and checks the predecessor Plan digest. Planner never reads Controller private Job state, polls execution, or interprets Controller build identity.

Cross-repository CI checks semantic fixtures and matching schema bytes from current checkouts. It does not clone or hash a pinned Controller commit.

Authority owners: `scripts/check-delivery-graph.mjs`, `scripts/check-ticket-context.mjs`, `admission/review-transport.mjs`, `planning-case/cli.mjs`, `execution-plan/compiler.mjs`, and `execution-plan/release-contract.mjs`.
