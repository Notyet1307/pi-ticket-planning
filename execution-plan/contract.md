# Codex Controller Release Handoff contract

Use the immutable accepted Delivery Spec, exact `spec-acceptance:v1` receipt, separately bound `delivery-release-graph:v3`, Ticket Context PASS results, fresh review binding, and Planning Case handoff approval to compile one Controller Release Plan v2. `execution-plan` validates only Controller public `config validate`, `plan validate`, and `doctor` commands; it never starts a Controller Job. Roadmaps and legacy v1/v2 graphs are readable migration inputs, never production handoffs.

## Qualified Controller mainline

`compatibility/codex-controller-contract.json` is the machine owner of the exact Controller revision, source-manifest/build identity digests, Release Plan/completion schemas, shared risk registry, and integration scope. The currently qualified revision is `10ff0db3c4e5cc1dc17384442831231341c2fec2`, with `integrationMode=release-plan-v2-direct`, `dispatcherQualified=false`, and `operatorStartRequired=true`.

This contract qualifies only the direct path:

```text
approved Delivery Graph
→ Release Plan v2
→ execution-plan apply
→ operator executes the printed Controller start command
→ Controller run
```

The optional Controller Dispatcher is deliberately outside this contract. Planner code and Skills must never call `dispatch`, require or write `ready-for-agent`, read a dispatcher config, or replace the approved multi-Issue Release Plan v2 with a per-Issue Release Plan v1. Dispatcher support requires a separate admission contract and separate qualification evidence.

The v3 artifact represents one bounded all-AGENT Release. Before compilation, each Ticket passes Oracle/risk/scope/protected-write-set/replan and exact reviewer checks. An ordinal 2+ predecessor receipt must be v2 from deterministic Controller completion ingestion; it embeds the exact public completion export and binds its candidate, merge, validation/review, provenance, and handoffs. Legacy release-manager v1 self-digests are rejected. Build and apply also fresh-read the remote base, tracked Spec/receipt bytes, decision manifest sources, dependency handoffs, Parent/Children, Oracle data, explicit verifier source/helper/schema bytes, package script definition, and Controller provenance. Approval binds that projection, the Graph/review, projected Plan, and handoff fingerprint.

Release Plan v2 binds:

- target repository, accepted base ref, and exact 40-hex base commit;
- open Parent number, exact title, and UTF-8 body hash;
- Delivery Spec content hash and canonical Delivery Graph digest;
- decision-manifest, predecessor-receipt, dependency-handoff, and full Oracle binding digests (including each verifier manifest digest);
- every open Child number, order, internal dependencies, exact title/body hash, one-sentence objective, and 3–8 exact assertions;
- every Child Oracle binding, risk classes, scope budget, expected/protected paths, REPLAN triggers, integration-only declaration, and waiver digests;
- scenario-observable Release acceptance plus the walking-skeleton target;
- every Scenario failure, the walking-skeleton handoff, and controlled Constraints, Release signals, and Decisions in their accepted source language. Entries are deduplicated, limited to 20 and 2000 UTF-8 bytes each, and oversize input fails closed.

Every projected AGENT Child fixes `suggestedValidation: []` and `allowNoop: false`; Controller config owns validation commands. Controller config must match repo/base ref, enable aggregate Release review, and permit the projected Issue count. HUMAN work, any external blocker, or an over-limit child set remains `CODEX_RELEASE_NOT_EXECUTABLE` or `CHILD_COUNT_POLICY_EXCEEDED`; a Roadmap returns `ROADMAP_NOT_EXECUTABLE` and v2 returns `NEEDS_MIGRATION`.

Production CLI build/verify/apply require live GitHub Context and reject offline `--input`. Build may produce a candidate after fresh-source, `config validate`, and `plan validate` even when doctor is temporarily unavailable. Verify/apply repeat freshness and require `doctor`. Apply first persists `ADMISSION/HANDOFF_APPROVED` with the exact pending approval, then writes only `release-plan.json`, `execution-handoff-plan.json`, and `execution-handoff-receipt.json`, verifies them, advances to `EXECUTION/HANDOFF_READY`, and consumes approval last. Recovery repeats the same checks from either durable state.

The operator starts the Controller only with the command returned after COMPLETE. That command binds `--expected-config-digest`, `--expected-controller-revision`, and `--expected-controller-provenance-digest` to the approved Handoff. Planner code must not call `start`, create a Worktree/branch/commit/PR, write labels/comments, poll execution, or read Controller private state.

The deployment checkout containing the supplied Controller CLI must be at the exact locked commit with a clean tracked worktree before handoff build or apply. The cross-repository workflow enforces this for CI. Planner validates the Controller's public runtime identity/provenance readback against the lock, but production operators must preserve the exact-clean-checkout preflight; a matching command surface or self-report alone is not proof of the qualified revision.

The public provenance gate binds the approved build through Job creation and later Controller steps. It does not replace the required Skill/operator Git preflight; a build or apply without both checks is outside the qualified path.

The lock also pins the owner schema bytes and digest algorithm. The cross-repository canary rejects dirty checkout state, builds an exact network-denied clone, and proves schema/revision/identity plus C1 at A, stale C2 rejection, fresh descendant C2, decision/Oracle/Parent/Child/provenance drift, Roadmap exclusion, exact v3→v2-direct acceptance, closed-shape negatives, and v1 rejection. It still does not run a Controller Job, Codex, or GitHub delivery.

Authority owners: `scripts/check-delivery-graph.mjs`, `scripts/check-ticket-context.mjs`, `admission/review-transport.mjs`, `planning-case/cli.mjs`, and `execution-plan/compiler.mjs`.

Planner never reads Controller private `job.json` or treats its status API as predecessor evidence. Ordinal 2+ consumes only the verified public completion export embedded by deterministic predecessor-receipt v2 ingestion.

Legacy v2 graphs remain readable but never compile. `scripts/migrate-artifacts.mjs --artifact delivery-graph-v2 ... --dry-run true` deterministically emits only `PLANNED`, human-approved v3 and/or Roadmap candidates.
