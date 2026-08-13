---
name: to-tickets
description: Break an accepted Delivery Spec into traceable candidate tickets, prove Scenario coverage and a walking skeleton, wire the blocker graph, and prepare the unchanged graph for independent admission.
disable-model-invocation: true
---

# To Tickets

Compile one accepted Delivery Spec into candidate tracer-bullet tickets. Publish candidates in `needs-triage`; `/skill:admit-ticket` alone owns ready labels.

The issue tracker and triage labels must be configured by `/skill:setup-matt-pocock-skills`. Load `/ticket-readiness` before drafting.

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
- enough durable context for a fresh executor in the assigned lane.

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
  "version": 1,
  "source": { "identity": "<accepted Spec>", "revision": "<exact update>", "baseSha": "<exact base>" },
  "scenarios": [
    { "id": "S1", "behavior": "<observable behavior>", "entry": "external:<input> or <artifact>", "exit": "<artifact>", "releaseSignal": "<signal>", "smallestLoop": true }
  ],
  "children": [
    { "id": "C01", "title": "<title>", "coverageRole": "DIRECT", "sourceScenarios": ["S1"], "blockedBy": [], "externalBlockers": [], "primaryVerification": "<behavioral check>", "executionLane": "AGENT" }
  ],
  "walkingSkeleton": ["C01"]
}
```

`blockedBy` contains only children in this map; put other exact prerequisites in `externalBlockers`. For an `ENABLER`, also include `downstreamConsumers` and `exitCondition`. Before approval, candidate IDs may be stable proposed IDs. Pipe this object to:

```sh
node "$PI_TICKET_PLANNING_ROOT/scripts/check-delivery-graph.mjs" --input -
```

Require `contract`, `scenarioCoverage`, `walkingSkeleton`, and `strictFrontier` to pass. This checker proves structural consistency only; semantic overlap and individual Ticket readiness still require review.

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

    ## What to build
    One sentence describing the observable or enabling outcome.

    ## Primary verification
    One behavioral seam or scenario that proves the outcome.

    ## Execution lane
    AGENT, or HUMAN with the non-delegable reason.

    ## Acceptance criteria
    - [ ] One independently verifiable assertion per item.

    ## Blocked by
    Real prerequisites, or None.

    ## Decision sources
    Parent sections and linked authoritative decisions.

    ## Out of scope
    Adjacent behavior excluded from this ticket.

Update or replace one `## Ticket coverage` section in the parent. Store exactly one normalized snapshot, using real tracker child identities throughout:

    <!-- pi-ticket-planning:delivery-graph:v1 -->
    ```json
    <the approved version 1 object>
    ```

The JSON is the durable Scenario matrix, handoff chain, child order, roles, verifications, lanes, and blocker graph. Do not persist a duplicate prose matrix, table, or receipt. Mapping proposed IDs to newly created tracker identities is mechanical; any changed behavior, mapping, role, verification, lane, order, or edge requires renewed approval.

Re-fetch the parent and run the Delivery Graph checker against its body using the tracker command. Then compare its child set and blocker edges with the fresh native graph and run the configured strict-frontier check. All checks must pass before handoff.

Any failed graph, coverage, skeleton, or frontier check leaves the parent and children in `needs-triage`. Any candidate, source, matrix, order, or blocker change requires renewed human approval and a rebuilt snapshot.

### 6. Hand off to Admission

Re-fetch the persisted parent and graph. Report their identities, Delivery Graph contract, both coverage verdicts, strict-frontier verdict, and current labels. Then print exactly one command and stop:

```text
/skill:admit-ticket <delivery parent identity>
```

Do not invoke Admission silently. Candidate publication is complete only when the tracker matches the approved coverage and graph snapshot; ready activation remains a separate human-invoked gate.
