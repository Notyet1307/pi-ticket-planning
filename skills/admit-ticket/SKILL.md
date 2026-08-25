---
name: admit-ticket
description: Run independent readiness and graph review when ask-yet has persisted candidates, then stop for human confirmation before ready-label activation.
---

# Admit Ticket

Move candidate implementation issues through an independent fresh-context review, then activate only the unchanged READY result in its reviewed execution lane after human confirmation.

Use /ticket-readiness as the contract. The ticket-readiness-reviewer subagent is the sole scope and readiness judge; this skill owns deterministic graph-integrity checks, evidence gathering, user confirmation, and tracker mutation.

## Preconditions

Require:

- the configured issue tracker and triage-label mapping from `setup-delivery-repository`;
- the subagent tool;
- the ticket-readiness-reviewer agent;
- candidate issues in needs-triage or needs-info.
- for a delivery parent, an accepted Spec with stable Scenario IDs and a current `## Ticket coverage` section.
- an accepted-base checkout from which `check-ticket-context.mjs` can resolve exact Git blobs.

If the reviewer cannot run in a fresh context, stop with the candidates unchanged. The authoring context is not a review fallback.

## Process

### 1. Resolve the admission set

Accept one issue, a list of issues, or a delivery parent. For a delivery parent, include every implementation child and the complete native dependency graph. Exclude Wayfinder decision tickets.

### 2. Build the admission bundle

Re-fetch and include:

- repository and tracker identity;
- exact title, body, state, labels, native blockers, comments containing the current agent brief, and updated timestamp for every candidate;
- for every candidate, the raw `pi-ticket-planning:ticket-context-check:v1` result from its exact body and base, wrapped only with the exact candidate identity;
- parent delivery spec body and updated timestamp;
- trusted source identity, exact Release revision when applicable, exact repository base, and effective policy identity;
- for every graph and every standalone `AGENT` candidate, a freshly executed `herdr-harness:project-readiness:v1` receipt for the exact accepted base. Run `pi-ticket-plan admit readiness --repo <owner/repo> --base <sha> --harness-cli <absolute dist/src/cli.js> --harness-config <private 0600 config> --out <private receipt binding>` before fresh review. The command verifies the colocated versioned schema, both Provider lanes, Docker, exact-base validation, and the live no-bypass GitHub merge gate. Include only its bounded stable projection in the reviewer bundle; never include either private path, raw validation output, Docker host, environment, or credential material. Without a passing receipt, leave every candidate unactivated and do not dispatch the reviewer. A standalone `HUMAN` candidate does not require Harness execution readiness;
- parent Scenario definitions, explicit state/artifact handoffs, and Release signal mapping;
- the exact normalized Delivery Graph JSON from `## Ticket coverage` and its checker output;
- child order, native sub-issue relationships, and blocking edges;
- linked ADRs, closed Wayfinder decisions, research findings, prototype decisions, and other sources needed by the ticket;
- any detected source conflict or missing artifact.

Use exact source text where practical. Summaries may orient the reviewer but never replace the candidate body or authoritative decision.

Before any fresh review, write each refreshed candidate body to a private temporary file and run:

```text
node "$PI_TICKET_PLANNING_ROOT/scripts/check-ticket-context.mjs" --repo <absolute-repository-path> --base <exact-base-sha> --input <candidate-body-file>
```

Use the same rule for every delivery-map child and a standalone QUICK candidate. Bind the raw JSON as `contextChecks: [{ "candidateId": "<exact id>", "result": <raw result> }]`, and retain the accepted-base checkout's absolute path as private transient `repositoryPath`. `check-admission-state`, `admit plan`, and `admit apply` re-run the checker from that checkout and require the canonical raw results to match; a caller-supplied digest is not trusted as proof. Keep `repositoryPath` in the private deterministic/CLI context, not the reviewer payload, Plan, or Tracker. A missing result, FAIL verdict, invalid digest, body-hash mismatch, base-SHA mismatch, blob mismatch, duplicate identity, or unexpected identity makes the Graph verdict NEEDS_INFO. Keep every label unchanged and do not dispatch a reviewer. The checker decides only structure and exact Git-blob facts; the fresh reviewer still owns semantic authority, staleness, relevance, conflict, and first-action economy.

For a delivery map, extract the one `<!-- pi-ticket-planning:delivery-graph:v2 -->` snapshot from the refreshed parent and run the configured tracker command through `check-delivery-graph.mjs`. A v1 snapshot requires migration; a missing, duplicate, malformed, or failed snapshot is Graph NEEDS_INFO. Then compare the passing snapshot against the fresh Spec and native graph before dispatch:

1. Matrix Scenario IDs equal the parent Scenario IDs.
2. Every Scenario has current `DIRECT` coverage.
3. Every current child appears in the matrix and names existing Scenario IDs.
4. Every `ENABLER` names current downstream consumers, an objective exit condition, and matching blocker edges; internal and external blockers match their separate snapshot fields.
5. The declared walking-skeleton chain references current children in dependency-valid order and closes the stated smallest loop.
6. Every named downstream state or artifact has the persisted producer or external source required by the Spec; no admission check invents a missing handoff.

Serialize the refreshed source identity/revision/base, private `repositoryPath`, complete parent body, native-order children with exact bodies and open `blockedBy` identities, and bound `contextChecks` as one private deterministic bundle. Run it through `check-admission-state.mjs`; this one check re-runs the Delivery Graph contract and every Ticket Context checker against Git, then compares the Spec hash and Scenario set, child set/order/body hashes, source identity, native dependency graph, and every Context check binding. Strip `repositoryPath` before sending the otherwise exact bundle to the reviewer. Return `Delivery graph contract: PASS | FAIL`, `Scenario coverage: PASS | FAIL`, and `Walking skeleton: PASS | FAIL`. Then run the configured strict-frontier order check against the fresh native graph. Any failed or unavailable structural check is Graph NEEDS_INFO: keep every label unchanged, report the exact gap or read failure, and do not accept a reviewer READY result. After a confirmed edit, rebuild the bundle from scratch.

### 3. Dispatch the independent review

Create one private `0700` directory and run `pi-ticket-plan admit review-input --input <bundle.json> --review-dir <directory> --reviewed-at <exact timestamp> --out <descriptor.json>`. Completion means the descriptor binds one `0600` regular file and contains no private repository path in its safe binding.

Invoke `ticket-readiness-reviewer` once with `async: false`, `context: fresh`, `artifacts: false`, `mission: false`, and acceptance disabled with reason `The readiness verdict is the gate output`. Pass only the transport descriptor and the request to judge it. Do not include the author's intended verdict, suspected split, or arguments for approval. Completion means the reviewer reads the bound file through EOF and its machine result echoes the exact safe binding.

The reviewer must return the /ticket-readiness output for every candidate plus a graph verdict for a batch and one matching `pi-ticket-planning:admission-review:v1` JSON block. A missing or mismatched `inputBinding`, malformed result, internal inconsistency, or non-substantive review is NEEDS_INFO and leaves tracker state unchanged.

### 4. Present the result

For a GitHub delivery map, place the exact machine review JSON and freshly resolved context JSON in a private directory, then run `pi-ticket-plan admit plan --repo <owner/repo> --parent <number> --review <review.json> --review-binding <descriptor.json> --context <context.json> --harness-cli <absolute dist/src/cli.js> --harness-config <private 0600 config> --out <plan.json>`. For one standalone candidate, use `--issue <number>`; omit Harness flags only for a reviewed `HUMAN` lane. The CLI recomputes the review input from refreshed facts, requires both binding copies to match, executes readiness again, and stores only the safe binding in the Plan. Completion means one passing Plan whose fingerprint indirectly binds the exact Reviewer input.

Show the verdicts, execution lanes, proposed splits, unresolved decisions, blockers, Context-check PASS/FAIL and digest per candidate, coverage findings, walking-skeleton finding, frontier finding, exact label additions/removals, Graph fingerprint, and Admission Plan fingerprint. The raw checker output remains in the private bundle/Plan and is not copied into Tracker comments. Ask the user to confirm that exact Plan fingerprint. A reviewer result or a general “continue” alone grants no mutation authority.

When a candidate is edited, a blocker edge changes, a source decision changes, or the user requests a different split, return to step 2 and review the new snapshot.

### 5. Apply the confirmed outcome

Re-fetch the admission set first. Treat updated timestamps as reread signals, then compare the gate-critical projection: exact title, open state, body hash, native blockers, source revision/base, policy, controlled labels, the stable Harness readiness projection for executable lanes, and, for a delivery map, normalized snapshot, walking skeleton, and graph. Re-run `check-ticket-context.mjs` from every refreshed exact body and base, rebuild `contextChecks`, re-execute Harness readiness with the same private CLI/config, and re-run `check-admission-state.mjs` plus the strict-frontier order check for a delivery map before the first label mutation. A new receipt may have another timestamp, duration, or output digest, but its repo/base/config, validation argv/source, Docker requirement, and delivery-gate projection must match the confirmed Plan. Unrelated comments and labels do not invalidate an otherwise unchanged Plan.

For a READY GitHub delivery map or standalone candidate, rebuild the context JSON from those fresh facts and fresh Context-check results, then run only:

```text
pi-ticket-planctl case create --target github:<owner/repo> --case-id <PC-id> --json
pi-ticket-planctl case approve <PC-id> --plan <plan.json> --expected-fingerprint <confirmed sha256> --json
pi-ticket-plan admit apply --plan <plan.json> --expected-fingerprint <confirmed sha256> --case-id <PC-id> --approval-id <F-id from case.approve> --context <fresh-context.json> --harness-cli <absolute dist/src/cli.js> --harness-config <private 0600 config>
```

`admit apply` is the sole owner of READY Admission comments and ready-label writes. It authorizes only the pending Planning Case approval whose FactAttestation subject matches the exact Plan, rejects consumed or foreign approvals, accepts only the planned before/after or safe in-progress controlled-label states, preserves unrelated labels through per-label changes, validates the fresh Context-check digests against the reviewed Plan, deduplicates comments by marker, and rereads ambiguous writes. A delivery map activates blockers-first children and the parent last; a standalone Plan contains one resource. Body, base, policy, or Context-check drift returns `CONFLICT` and requires a new bundle and review. `COMPLETE` consumes the approval; `PARTIAL` leaves it pending and is safely resumable with the same unchanged Plan. Never compensate by removing a ready label after a Harness claim.

The following direct outcome rules apply only to confirmed non-READY review outcomes. They never bypass `admit apply` for any READY activation:

- On drift: stop and re-review.
- On a coverage, walking-skeleton, strict-frontier, or read failure: stop with every label unchanged and return to graph review.
- On SPLIT: keep needs-triage, remove both ready labels, and post the proposed split only after user confirmation.
- On NEEDS_INFO: replace needs-triage with needs-info after user confirmation, remove both ready labels, and list the exact unresolved questions.

For a delivery map, `admit apply` activates children in their reviewed lanes first. It adds ready-for-agent to the parent only after every intended child has a READY verdict, all scenarios have direct coverage, the walking skeleton and frontier pass, all relationships are wired, and no unresolved implementation candidate remains. A READY/HUMAN child is resolved for graph admission. The parent is always the final activation write.

### 6. Report completion

Report issue identifiers, final labels, reviewer verdicts, execution lanes, reviewed timestamps, trusted source revision, repository base SHA, effective policy identity, Plan fingerprint, result status, recovered operations, and whether the delivery parent was activated. For a delivery map, include all four graph verdicts. This transient operator output creates no additional artifact; the idempotent admission comment retains the fingerprint, while Harness authority remains the current ready label, ticket body, native relationships, and repository policy. Never call `PARTIAL` or `CONFLICT` a successful Admission.
