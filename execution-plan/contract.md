# Codex Controller Release Handoff contract

Use the immutable accepted Delivery Spec, exact `spec-acceptance:v1` receipt, separately bound `delivery-release-graph:v3`, Ticket Context PASS results, fresh review binding, and Planning Case handoff approval to compile one Controller Release Plan v2. `execution-plan` validates only Controller public `config validate`, `plan validate`, and `doctor` commands; it never starts a Controller Job. Roadmaps and legacy v1/v2 graphs are readable migration inputs, never production handoffs.

## Qualified Controller mainline

`compatibility/codex-controller-contract.json` is the machine owner of the exact Controller revision, source-manifest/build identity digests, and integration scope. The currently qualified revision is `45bb61a2697ad518e97402ab9d921617739cbd92`, with `integrationMode=release-plan-v2-direct`, `dispatcherQualified=false`, and `operatorStartRequired=true`.

This contract qualifies only the direct path:

```text
approved Delivery Graph
→ Release Plan v2
→ execution-plan apply
→ operator executes the printed Controller start command
→ Controller run
```

The optional Controller Dispatcher is deliberately outside this contract. Planner code and Skills must never call `dispatch`, require or write `ready-for-agent`, read a dispatcher config, or replace the approved multi-Issue Release Plan v2 with a per-Issue Release Plan v1. Dispatcher support requires a separate admission contract and separate qualification evidence.

The v3 artifact represents one bounded all-AGENT Release. Before compilation, each exact Ticket body must pass Oracle bytes/base/digest/owner/command checks, risk/scope and protected-write-set limits, controlled REPLAN triggers, and exact reviewer metadata comparison. PR 2 gates these facts in Planner; Release Plan projection and Controller runtime enforcement remain the coordinated PR 3 contract. Approval binds the exact Graph digest, review fingerprint, projected Plan, and handoff-plan fingerprint.

Release Plan v2 binds:

- target repository, accepted base ref, and exact 40-hex base commit;
- open Parent number, exact title, and UTF-8 body hash;
- Delivery Spec content hash and canonical Delivery Graph digest;
- every open Child number, order, internal dependencies, exact title/body hash, one-sentence objective, and 3–8 exact assertions;
- scenario-observable Release acceptance plus the walking-skeleton target;
- every Scenario failure, the walking-skeleton handoff, and controlled Constraints, Release signals, and Decisions in their accepted source language. Entries are deduplicated, limited to 20 and 2000 UTF-8 bytes each, and oversize input fails closed.

Every projected AGENT Child fixes `suggestedValidation: []` and `allowNoop: false`; Controller config owns validation commands. Controller config must match repo/base ref, enable aggregate Release review, and permit the projected Issue count. HUMAN work, any external blocker, or an over-limit child set remains `CODEX_RELEASE_NOT_EXECUTABLE` or `CHILD_COUNT_POLICY_EXCEEDED`; a Roadmap returns `ROADMAP_NOT_EXECUTABLE` and v2 returns `NEEDS_MIGRATION`.

Build may produce a candidate after `config validate` and `plan validate` even when live doctor readiness is temporarily unavailable. The handoff fingerprint binds the locked Controller revision, source manifest, executable build, runtime identity, execution mode, config digest, and Release Plan digest returned by those public commands. Verify and apply also require `doctor`, whose config digest and Controller identity must match the approved values. Apply writes only `release-plan.json`, `execution-handoff-plan.json`, and `execution-handoff-receipt.json` as exact `0600` files in one atomic private directory. If publication completed before the Case checkpoint, recovery revalidates live source, config, Plan, provenance, and doctor before advancing; conflict or blocked readiness preserves the files, checkpoint, and pending approval. A completed checkpoint with exact files may consume the pending approval, and a consumed approval is idempotently complete.

The operator starts the Controller only with the command returned after COMPLETE. That command binds `--expected-config-digest`, `--expected-controller-revision`, and `--expected-controller-provenance-digest` to the approved Handoff. Planner code must not call `start`, create a Worktree/branch/commit/PR, write labels/comments, poll execution, or read Controller private state.

The deployment checkout containing the supplied Controller CLI must be at the exact locked commit with a clean tracked worktree before handoff build or apply. The cross-repository workflow enforces this for CI. Planner validates the Controller's public runtime identity/provenance readback against the lock, but production operators must preserve the exact-clean-checkout preflight; a matching command surface or self-report alone is not proof of the qualified revision.

The public provenance gate binds the approved build through Job creation and later Controller steps. It does not replace the required Skill/operator Git preflight; a build or apply without both checks is outside the qualified path.

The lock also pins the owner schema path, byte SHA-256, and canonical digest algorithm. The Planner schema mirror is byte-identical to that commit. The cross-repository canary rejects dirty checkout state, builds an exact local clone under Node permission isolation with network denied, and runs only `config validate` and `plan validate`. It proves exact revision/identity readback, schema bytes, config/Plan/provenance digest agreement, one positive v2 direct vector, closed-shape negatives, and Release Plan v1 rejection; Dispatcher remains out of scope. It does not prove live Controller source revalidation or Codex/GitHub execution.

Authority owners: `scripts/check-delivery-graph.mjs`, `scripts/check-ticket-context.mjs`, `admission/review-transport.mjs`, `planning-case/cli.mjs`, and `execution-plan/compiler.mjs`.

Controller execution-result ingestion is intentionally not part of this compatibility change. A future separate contract may consume the public status API; Planner code must never read private `job.json` state.
