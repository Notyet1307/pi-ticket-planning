---
name: admit-ticket
description: Run independent readiness and graph review when ask-yet has persisted candidates, then stop for human confirmation before ready-label activation.
---

# Admit Ticket

Move candidate implementation issues through an independent fresh-context review, then activate only the unchanged READY result in its reviewed execution lane after human confirmation.

Use /ticket-readiness as the contract. The ticket-readiness-reviewer subagent is the sole scope and readiness judge; this skill owns deterministic graph-integrity checks, evidence gathering, user confirmation, and tracker mutation.

## Preconditions

Require:

- the configured issue tracker and triage-label mapping from /setup-matt-pocock-skills;
- the subagent tool;
- the ticket-readiness-reviewer agent;
- candidate issues in needs-triage or needs-info.
- for a delivery parent, an accepted Spec with stable Scenario IDs and a current `## Ticket coverage` section.

If the reviewer cannot run in a fresh context, stop with the candidates unchanged. The authoring context is not a review fallback.

## Process

### 1. Resolve the admission set

Accept one issue, a list of issues, or a delivery parent. For a delivery parent, include every implementation child and the complete native dependency graph. Exclude Wayfinder decision tickets.

### 2. Build the admission bundle

Re-fetch and include:

- repository and tracker identity;
- exact title, body, state, labels, native blockers, comments containing the current agent brief, and updated timestamp for every candidate;
- parent delivery spec body and updated timestamp;
- trusted source identity, exact Release revision when applicable, exact repository base, and effective policy identity;
- the verified Harness parent-ready fence identity and content digest for a GitHub delivery map; without this enforced claim fence, leave every child unactivated;
- parent Scenario definitions, explicit state/artifact handoffs, and Release signal mapping;
- the exact normalized Delivery Graph JSON from `## Ticket coverage` and its checker output;
- child order, native sub-issue relationships, and blocking edges;
- linked ADRs, closed Wayfinder decisions, research findings, prototype decisions, and other sources needed by the ticket;
- any detected source conflict or missing artifact.

Use exact source text where practical. Summaries may orient the reviewer but never replace the candidate body or authoritative decision.

For a delivery map, extract the one `<!-- pi-ticket-planning:delivery-graph:v2 -->` snapshot from the refreshed parent and run the configured tracker command through `check-delivery-graph.mjs`. A v1 snapshot requires migration; a missing, duplicate, malformed, or failed snapshot is Graph NEEDS_INFO. Then compare the passing snapshot against the fresh Spec and native graph before dispatch:

1. Matrix Scenario IDs equal the parent Scenario IDs.
2. Every Scenario has current `DIRECT` coverage.
3. Every current child appears in the matrix and names existing Scenario IDs.
4. Every `ENABLER` names current downstream consumers, an objective exit condition, and matching blocker edges; internal and external blockers match their separate snapshot fields.
5. The declared walking-skeleton chain references current children in dependency-valid order and closes the stated smallest loop.
6. Every named downstream state or artifact has the persisted producer or external source required by the Spec; no admission check invents a missing handoff.

Serialize the refreshed source identity/revision/base, complete parent body, and native-order children with exact bodies and open `blockedBy` identities as one Admission bundle. Run it through `check-admission-state.mjs`; this one check re-runs the Delivery Graph contract and compares the Spec hash and Scenario set, child set/order/body hashes, source identity, and native dependency graph. Return `Delivery graph contract: PASS | FAIL`, `Scenario coverage: PASS | FAIL`, and `Walking skeleton: PASS | FAIL`. Then run the configured strict-frontier order check against the fresh native graph. Any failed or unavailable structural check is Graph NEEDS_INFO: keep every label unchanged, report the exact gap or read failure, and do not accept a reviewer READY result. After a confirmed edit, rebuild the bundle from scratch.

### 3. Dispatch the independent review

Invoke `ticket-readiness-reviewer` once with `async: false`, `context: fresh`, `artifacts: false`, `mission: false`, and acceptance disabled with reason `The readiness verdict is the gate output`. Give the bundle one exact review timestamp. Pass only the admission bundle and the request to judge it. Do not include the author's intended verdict, suspected split, or arguments for approval. The reviewer may read only its configured readiness skill; a tool call to any other path is a malformed review.

The reviewer must return the /ticket-readiness output for every candidate plus a graph verdict for a batch and one matching `pi-ticket-planning:admission-review:v1` JSON block. Treat a missing, malformed, internally inconsistent, or non-substantive result as NEEDS_INFO and leave tracker state unchanged.

### 4. Present the result

For a GitHub delivery map, place the exact machine review JSON and a freshly resolved context JSON in a private temporary directory, then run `pi-ticket-plan admit plan --repo <owner/repo> --parent <number> --review <review.json> --context <context.json> --out <plan.json>`. For one standalone candidate, use the same command with `--issue <number>` instead of `--parent`. The context contains the trusted source identity/revision/base, accepted policy identity/digest, and current Checkpoint; a delivery map also contains the verified Harness identity/digest with `parentReadyFence: true`. This command is read-only and must return a passing plan.

Show the verdicts, execution lanes, proposed splits, unresolved decisions, blockers, coverage findings, walking-skeleton finding, frontier finding, exact label additions/removals, Graph fingerprint, and Admission Plan fingerprint. Ask the user to confirm that exact Plan fingerprint. A reviewer result or a general “continue” alone grants no mutation authority.

When a candidate is edited, a blocker edge changes, a source decision changes, or the user requests a different split, return to step 2 and review the new snapshot.

### 5. Apply the confirmed outcome

Re-fetch the admission set first. Treat updated timestamps as reread signals, then compare the gate-critical projection: exact title, open state, body hash, native blockers, source revision/base, policy, controlled labels, and, for a delivery map, normalized snapshot, walking skeleton, graph, and Harness fence. Re-run `check-admission-state.mjs` and the strict-frontier order check for a delivery map before the first label mutation. Unrelated comments and labels do not invalidate an otherwise unchanged Plan.

For a READY GitHub delivery map or standalone candidate, rebuild the context JSON from those fresh facts and run only:

```text
pi-ticket-plan admit apply --plan <plan.json> --expected-fingerprint <confirmed sha256> --context <fresh-context.json>
```

`admit apply` is the sole owner of READY Admission comments and ready-label writes. It compares the approved fingerprint, accepts only the planned before/after or safe in-progress controlled-label states, preserves unrelated labels through per-label changes, deduplicates comments by marker, and rereads ambiguous writes. A delivery map activates blockers-first children and the parent last; a standalone Plan contains one resource. `COMPLETE` is success; `PARTIAL` is safely resumable with the same plan and fingerprint; `CONFLICT` requires a new bundle and review. Never compensate by removing a ready label after a Harness claim.

The following direct outcome rules apply only to confirmed non-READY review outcomes. They never bypass `admit apply` for any READY activation:

- On drift: stop and re-review.
- On a coverage, walking-skeleton, strict-frontier, or read failure: stop with every label unchanged and return to graph review.
- On SPLIT: keep needs-triage, remove both ready labels, and post the proposed split only after user confirmation.
- On NEEDS_INFO: replace needs-triage with needs-info after user confirmation, remove both ready labels, and list the exact unresolved questions.

For a delivery map, `admit apply` activates children in their reviewed lanes first. It adds ready-for-agent to the parent only after every intended child has a READY verdict, all scenarios have direct coverage, the walking skeleton and frontier pass, all relationships are wired, and no unresolved implementation candidate remains. A READY/HUMAN child is resolved for graph admission. The parent is always the final activation write.

### 6. Report completion

Report issue identifiers, final labels, reviewer verdicts, execution lanes, reviewed timestamps, trusted source revision, repository base SHA, effective policy identity, Plan fingerprint, result status, recovered operations, and whether the delivery parent was activated. For a delivery map, include all four graph verdicts. This transient operator output creates no additional artifact; the idempotent admission comment retains the fingerprint, while Harness authority remains the current ready label, ticket body, native relationships, and repository policy. Never call `PARTIAL` or `CONFLICT` a successful Admission.
