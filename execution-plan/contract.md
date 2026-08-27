# Codex Controller Release Handoff contract

Use the accepted Delivery Spec, exact Delivery Graph v2, Ticket Context PASS results, fresh review binding, and Planning Case handoff approval to compile one Controller Release Plan v2. `execution-plan` validates only Controller public `config validate`, `plan validate`, and `doctor` commands; it never starts a Controller Job.

The release contains only AGENT children with no external blocker. Every live Parent/Child identity and body hash must match the Graph and review source. Approval binds the exact handoff-plan fingerprint. Apply atomically materializes the three Controller input files, records `EXECUTION/HANDOFF_READY`, then consumes that approval.

Release Plan v2 binds:

- target repository, accepted base ref, and exact 40-hex base commit;
- open Parent number, exact title, and UTF-8 body hash;
- Delivery Spec content hash and canonical Delivery Graph digest;
- every open Child number, order, internal dependencies, exact title/body hash, one-sentence objective, and 3–8 exact assertions;
- scenario-observable Release acceptance plus the walking-skeleton target;
- every Scenario failure, the walking-skeleton handoff, and controlled Constraints, Release signals, and Decisions in their accepted source language. Entries are deduplicated, limited to 20 and 2000 UTF-8 bytes each, and oversize input fails closed.

Every Child fixes `suggestedValidation: []` and `allowNoop: false`; Controller config owns validation commands. Controller config must match repo/base ref, enable aggregate Release review, and permit the Issue count. A HUMAN Child or external blocker is `CODEX_RELEASE_NOT_EXECUTABLE`.

Build may produce a candidate after `config validate` and `plan validate` even when live doctor readiness is temporarily unavailable. Verify and apply also require `doctor`, whose `configDigest` must equal the validated and approved config digest. Apply writes only `release-plan.json`, `execution-handoff-plan.json`, and `execution-handoff-receipt.json` as exact `0600` files in one atomic private directory. If publication completed before the Case checkpoint, recovery revalidates live source, config, Plan, and doctor before advancing; conflict or blocked readiness preserves the files, checkpoint, and pending approval. A completed checkpoint with exact files may consume the pending approval, and a consumed approval is idempotently complete.

The operator starts the Controller only with the command returned after COMPLETE. That command binds `--expected-config-digest` to the approved Handoff config digest. Planner code must not call `start`, create a Worktree/branch/commit/PR, write labels/comments, poll execution, or read Controller private state.

`compatibility/codex-controller-contract.json` pins the exact Controller commit, owner schema path, byte SHA-256, and canonical digest algorithm. The Planner schema mirror is byte-identical to that commit. The cross-repository canary rejects a dirty tracked checkout, exports exact tracked source, and uses Node permission isolation to compile and run only `config validate` and `plan validate` with network denied. It proves the static schema/digest contract, not live Controller source revalidation or Codex/GitHub execution.

Authority owners: `scripts/check-delivery-graph.mjs`, `scripts/check-ticket-context.mjs`, `admission/review-transport.mjs`, `planning-case/cli.mjs`, and `execution-plan/compiler.mjs`.

Controller execution-result ingestion is intentionally not part of this contract. It waits for a public, stable Controller export/status API; Planner code must never read private `job.json` state.
