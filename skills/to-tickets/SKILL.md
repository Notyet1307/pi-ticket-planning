---
name: to-tickets
description: Draft and publish a traceable candidate graph when ask-yet has an accepted Delivery Spec, stopping once for graph approval before independent admission.
---

# To Tickets

Compile one accepted Delivery Spec into candidate tracer-bullet tickets. Publish candidates in `needs-triage`; `admit-ticket` alone owns ready labels.

The issue tracker and triage labels must be configured by `setup-delivery-repository`. Load `/ticket-readiness` before drafting.

## Process

### 1. Resolve the accepted Spec

Re-fetch the complete parent body, comments, label, and updated timestamp. Require:

- one trusted source identity and exact delivery base;
- stable Scenario IDs with explicit entry/input, trigger, result/failure, exit/output, and Release signal mapping;
- one walking-skeleton target naming the ordered Scenario IDs and state/artifact handoffs in the smallest loop;
- an empty `Unresolved decisions` section;
- the human-approved Delivery Spec in `needs-triage`.

Fetch linked Release, ADR, Wayfinder, research, questionnaire, and prototype sources only when needed to interpret a stated decision. A conversation or plan is not a replacement for the accepted parent. Stop with `NEEDS_INFO` on missing scenarios or explicit handoffs, source drift, conflicting authority, or an unsafe ready-labelled parent. Do not infer an omitted producer, representation, or clearing transition for a state consumed by a later scenario.

Treat the accepted Spec, its one named source, and the configured tracker/policy files as one small authoritative set; read them directly in the main context. Delegate only a genuinely large linked-source set. For local Markdown, the current tracked blob is the body snapshot and its latest commit identity/time is the update marker; an absent `## Comments` section means empty local comment history. Search for no sidecar unless the stored tracker contract names one. One `git status` plus the minimum blob/commit checks is enough to establish drift.

### 2. Draft vertical slices

Create one candidate per observable behavior. Cross only the schema, API, UI, migration, and test layers required for that behavior.

Each candidate must satisfy `/ticket-readiness`:

- one primary outcome and one primary verification;
- 3–6 single-assertion acceptance criteria, with eight as the hard maximum;
- no more than three independent delivery surfaces;
- stable source Scenario IDs, closed decisions, real blockers, decision sources, and explicit out-of-scope work;
- an explicit starting state matching its Scenario entry or blocker-produced artifact, plus the invariants and guardrails it must preserve;
- enough durable context in the candidate body for a fresh executor to choose the first correct action from it and repository policy; links provide provenance or detail, not the only copy of required behavior or guardrails.
- when primary verification depends on Docker, Compose, a non-default runtime, or another configured tool, the stable requirement and canonical tracked validation entry are explicit. Live socket, daemon, credential, and machine availability stay out of the Ticket and are proven later by Admission readiness.

Add `## Context anchors` only when the first action has a non-obvious repository entry. Use zero to five bullets in this exact form:

    - `src/module/current-entry.ts` — Locate the current behavior entry point.

Each anchor is one exact repo-relative regular file at the reviewed base plus one non-empty purpose. Do not use directories, globs, absolute paths, `..`, working-tree/draft/historical/example/fixture sources, or instructions such as `read docs/`, `inspect the codebase`, or `read all ADRs`. Anchors navigate; they never replace behavior, acceptance criteria, decisions, or guardrails in the body. Omit the section when the entry is obvious. More than five means the Ticket is too broad, the necessary decision belongs in the body, or the list has not been reduced to first-action sources; it cannot proceed as READY.

Every `## Decision sources` item must name the concern it owns and an exact accepted identity. Discussions, summaries, examples, and navigation documents are not decision authorities.

Do not qualify a `READY` verdict. If an open decision can change the candidate's outcome, primary verification, acceptance criteria, or output contract, that candidate is `NEEDS_INFO` until the decision closes.

Use coverage role `DIRECT` for a user-observable scenario slice. Use `ENABLER` only when an independently green vertical slice is impossible; name its downstream candidate consumers, exit condition, source scenarios, and real blocking edges. An ENABLER with no current consumer is an orphan and cannot proceed.

Assign execution lane `AGENT` by default. Use `HUMAN` only when completion or primary verification requires intentionally human-held access, external or isolated environment control, physical access, or non-delegable judgment.

### 3. Prove Scenario coverage

Build this matrix before the blocker graph:

| Scenario ID | User-observable behavior | Entry -> exit / handoff | DIRECT candidate(s) | ENABLER candidate(s) | Primary verification | Release signal |
|---|---|---|---|---|---|---|

Return `Scenario coverage: PASS | FAIL` using all of these rules:

1. Every Spec Scenario ID has at least one `DIRECT` candidate.
2. Every candidate names one or more existing Scenario IDs.
3. Every `ENABLER` names a current downstream consumer and an objective exit condition.
4. No candidate duplicates an independently deliverable outcome already owned by another candidate.
5. No out-of-scope behavior or speculative platform work appears as a candidate.
6. Every downstream state or artifact is produced by an earlier scenario/candidate or named as an external input; every blocking or invalid state has a decided representation and clearing transition when completion depends on it.

Then name the earliest candidate chain that closes the Spec's smallest trigger-to-result loop. Return `Walking skeleton: PASS | FAIL` with the ordered candidate IDs, covered Scenario IDs, and named handoffs. Every member must be individually `READY`, appear in dependency-valid order, and consume a state produced by an earlier member or declared external input. A missing direct path, broken handoff, uncovered scenario, orphan candidate, or non-READY member is `NEEDS_INFO`; do not publish a partial graph.

Represent the same proposed graph once as JSON:

```json
{
  "version": 2,
  "source": { "identity": "<accepted Spec>", "revision": "<exact update>", "baseSha": "<exact base>", "specContentHash": "sha256:<Spec body without Ticket coverage>" },
  "scenarios": [
    { "id": "S1", "behavior": "<observable behavior>", "entry": "external:<input> or <artifact>", "exit": "<artifact>", "releaseSignal": "<signal>", "smallestLoop": true }
  ],
  "children": [
    { "id": "C01", "title": "<title>", "coverageRole": "DIRECT", "sourceScenarios": ["S1"], "blockedBy": [], "externalBlockers": [], "bodyHash": "sha256:<exact UTF-8 body>", "startingState": "<entry state>", "primaryVerification": "<behavioral check>", "executionLane": "AGENT" }
  ],
  "walkingSkeleton": ["C01"]
}
```

`blockedBy` contains only children in this map; put unresolved outside prerequisites in `externalBlockers`, which makes the graph ineligible for Admission. For an `ENABLER`, also include `downstreamConsumers` and `exitCondition`. Hash the exact proposed child body bytes and the parent Spec body with its complete `## Ticket coverage` section removed. Before approval, candidate IDs may be stable proposed IDs. Pipe this object to:

```sh
node "$PI_TICKET_PLANNING_ROOT/scripts/check-delivery-graph.mjs" --input -
```

Require `contract`, `scenarioCoverage`, `walkingSkeleton`, and `strictFrontier` to pass. This checker proves structural consistency only; semantic overlap and individual Ticket readiness still require review.

Also run each exact proposed candidate body through:

```sh
node "$PI_TICKET_PLANNING_ROOT/scripts/check-ticket-context.mjs" --repo <absolute-repository-path> --base <exact-base-sha> --input <candidate-body-file>
```

No anchors is a valid PASS. Any failed Context check is `NEEDS_INFO`, not a graph repair or a reason to infer a path.

### 4. Build and approve the graph

Assign only real blocking edges. Compute a stable topological order: for every internal `blocker -> dependent` edge, the blocker appears earlier in native child order. Preserve the approved order among simultaneously unblocked candidates. A cycle is `NEEDS_INFO`.

Present together:

- the Scenario coverage matrix and verdict;
- the walking-skeleton chain and verdict;
- exact numbered child order and blocker edges;
- each candidate's title, source scenarios, coverage role, primary outcome, primary verification, execution lane, AC count, delivery surfaces, blockers, and out of scope;
- the exact write set: child creation, parent-child links, blocker edges, and the parent `## Ticket coverage` update.
- the deterministic Delivery Graph checker result.

Wait for explicit approval of this exact split, graph, and write set. Approval does not authorize a ready label.

### 5. Publish the approved snapshot

Create every child with `needs-triage`, then attach native parent-child relationships and blocking edges in the approved stable topological order. Re-fetch the graph and run the configured strict-frontier check.

Use this child body:

    ## Parent
    Link to the accepted Delivery Spec and exact source/base identity.

    ## Source scenarios
    Stable Scenario IDs from the parent Spec.

    ## Coverage role
    DIRECT, or ENABLER with downstream consumers and an objective exit condition.

    ## Starting state
    The pre-existing state, input, or blocker-produced artifact from which work begins.

    ## What to build
    One sentence describing the observable or enabling outcome.

    ## Invariants and guardrails
    Stable source or repository rules that must remain true; use None only when none apply.

    ## Primary verification
    One behavioral seam or scenario that proves the outcome.

    ## Execution lane
    AGENT, or HUMAN with the non-delegable reason.

    ## Acceptance criteria
    - [ ] One independently verifiable assertion per item.

    ## Blocked by
    Real prerequisites, or None.

    ## Decision sources
    Exact accepted identities, each stating the concern it decides.

    ## Out of scope
    Adjacent behavior excluded from this ticket.

Update or replace one `## Ticket coverage` section in the parent. Store exactly one normalized snapshot, using real tracker child identities throughout:

    <!-- pi-ticket-planning:delivery-graph:v2 -->
    ```json
    <the approved version 2 object>
    ```

The JSON is the durable Scenario matrix, handoff chain, child order, roles, verifications, lanes, and blocker graph. Do not persist a duplicate prose matrix, table, or receipt. Mapping proposed IDs to newly created tracker identities is mechanical; any changed behavior, mapping, role, verification, lane, order, or edge requires renewed approval.

Re-fetch the parent and build one Admission bundle containing the trusted source identity/revision/base, private absolute accepted-base `repositoryPath`, complete parent body, and native-order children with exact bodies and open blocker identities. Re-run `check-ticket-context.mjs` for every persisted child and include each raw result bound to its candidate identity as `contextChecks`. Run `check-admission-state.mjs` against that bundle so it independently rechecks the raw results against Git, then run the configured strict-frontier check. All checks must pass before handoff.

Any failed graph, coverage, skeleton, or frontier check leaves the parent and children in `needs-triage`. Any candidate, source, matrix, order, or blocker change requires renewed human approval and a rebuilt snapshot.

### 6. Continue to Admission

Re-fetch the persisted parent and graph. Report their identities, Delivery Graph contract, both coverage verdicts, strict-frontier verdict, and current labels to `ask-yet`, then follow the `admit-ticket` helper in the same run. Candidate publication is complete only when the tracker matches the approved coverage and graph snapshot; Admission still stops after fresh review for explicit activation confirmation.
