# Semantic release execution contract

Planner keeps Planning Case, accepted Spec, Delivery Graph, decisions, ticket review, Oracle bindings, scope controls, freshness checks, channel choice, and human approval as internal authority. Both execution channels derive from one unchanged `release-plan.json` v1.

```text
Planner internal facts → release-plan.json
  ├─ Controller handoff → Prepare Gate → offline Workers/validation/review → exact-head delivery
  └─ Goal handoff → fresh Thread per Ticket → persistent Goal → deterministic checkpoints → detached review → human merge
```

The Plan uses `controllerContractVersion: 2` and contains only the release identity and objective, repository/base, Parent and ordered child Issue numbers, dependencies, objectives, acceptance criteria, required expected paths and scope budget, simple risk, and required Oracle command list (non-empty only for high risk), release acceptance criteria, and review focus. Controller does not consume Spec, Graph, decision, predecessor, waiver, build, runtime, or provenance artifacts.

`execution-plan build` compiles the semantic Plan from fresh Planner facts. `verify` recompiles and compares it. Controller `apply` requires the exact human-approved Plan fingerprint, writes only `release-plan.json`, verifies exact readback, advances the Planning Case to `HANDOFF_READY`, consumes approval last, and prints:

```text
herdr-codex start --config ... --plan ... --approve-plan <planDigest>
```

For normal/low-risk supervised work, `goal-build` resolves one `runnerRef` from a private 0600 allowlist and wraps the exact Plan with `GOAL_LOCAL | GOAL_REMOTE`, runner digest, and target host. `approve-goal-handoff` binds the complete envelope fingerprint. `goal-apply` revalidates fresh Planner facts and the same runner entry, writes only `goal-handoff.json`, consumes the dedicated approval last, and prints the exact local command or remote SSH/stdin command. Goal target failure never falls back to another channel without a new approval.

Controller returns `herdr-codex-controller:release-result:v1`; Goal Runner returns the distinct `pi-ticket-planning:goal-release-result:v1` only after human merge is reverified. Planner Goal ingestion additionally requires the private approved handoff, matches its fingerprint/channel/runner, and emits a self-digested `goal-result-acceptance:v1`. Downstream Graphs accept a Controller Result or that Planner acceptance, never a raw Goal Result. On explicit STATUS/RESUME, Planner may read the selected executor's bounded public status once for display routing, but never reads private runtime state, polls execution, persists runtime status, or treats status/model claims as completion.

Cross-repository CI checks semantic fixtures and matching schema bytes from current checkouts. It does not clone or hash a pinned Controller commit.

Authority owners: `scripts/check-delivery-graph.mjs`, `scripts/check-ticket-context.mjs`, `admission/review-transport.mjs`, `planning-case/cli.mjs`, `execution-plan/compiler.mjs`, and `execution-plan/release-contract.mjs`.
