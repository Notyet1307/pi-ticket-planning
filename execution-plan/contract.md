# Codex Controller Release Handoff contract

Use the accepted Delivery Spec, exact Delivery Graph v2, Ticket Context PASS results, fresh review binding, and Planning Case handoff approval to compile one Controller Release Plan v2. `execution-plan` validates only Controller public `config validate`, `plan validate`, and `doctor` commands; it never starts a Controller Job.

The release contains only AGENT children with no external blocker. Every live Parent/Child identity and body hash must match the Graph and review source. Approval binds the exact handoff-plan fingerprint. Apply atomically materializes the three Controller input files, records `EXECUTION/HANDOFF_READY`, then consumes that approval.

Release Plan v2 binds:

- target repository, accepted base ref, and exact 40-hex base commit;
- open Parent number, exact title, and UTF-8 body hash;
- Delivery Spec content hash and canonical Delivery Graph digest;
- every open Child number, order, internal dependencies, exact title/body hash, one-sentence objective, and 3–8 exact assertions;
- scenario-observable Release acceptance plus the walking-skeleton target;
- failure, state/artifact handoff, compatibility, recovery, permission, concurrency, migration, and dependency focus from accepted Spec text.

Every Child fixes `suggestedValidation: []` and `allowNoop: false`; Controller config owns validation commands. Controller config must match repo/base ref, enable aggregate Release review, and permit the Issue count. A HUMAN Child or external blocker is `CODEX_RELEASE_NOT_EXECUTABLE`.

Build may produce a candidate after `config validate` and `plan validate` even when live doctor readiness is temporarily unavailable. Verify and apply also require `doctor`. Apply writes only `release-plan.json`, `execution-handoff-plan.json`, and `execution-handoff-receipt.json` as exact `0600` files in one atomic private directory. Exact published output is the recovery source: pending approval rolls forward; consumed approval is idempotently complete; any byte, mode, or file-set mismatch is a conflict.

The operator starts the Controller only with the command returned after COMPLETE. Planner code must not call `start`, create a Worktree/branch/commit/PR, write labels/comments, poll execution, or read Controller private state.

Authority owners: `scripts/check-delivery-graph.mjs`, `scripts/check-ticket-context.mjs`, `admission/review-transport.mjs`, `planning-case/cli.mjs`, and `execution-plan/compiler.mjs`.

Controller execution-result ingestion is intentionally not part of this contract. It waits for a public, stable Controller export/status API; Planner code must never read private `job.json` state.
