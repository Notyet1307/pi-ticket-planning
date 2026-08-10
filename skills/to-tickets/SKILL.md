---
name: to-tickets
description: Break a delivery spec, plan, or conversation into detailed candidate implementation tickets, wire their parent and blocking graph, then send the unchanged graph through independent admission.
disable-model-invocation: true
---

# To Tickets

Turn a decided delivery plan into candidate tracer-bullet tickets. Publish candidates in needs-triage; /admit-ticket owns ready-for-agent and ready-for-human.

The issue tracker and triage labels must be configured by /setup-matt-pocock-skills. Load /ticket-readiness before drafting.

## Process

### 1. Gather authoritative context

Read the full source spec or conversation, comments, linked ADRs, completed Wayfinder decisions, research, questionnaires, and prototype decisions. Fetch the current codebase state when it affects the split.

Stop with NEEDS_INFO when the parent has unresolved decisions or conflicting sources. If the parent already has ready-for-agent, report the unsafe state and obtain confirmation to return it to needs-triage before creating children.

### 2. Draft vertical slices

Create one ticket per observable behavior. Cross only the schema, API, UI, migration, and test layers needed for that behavior; a vertical slice does not require every layer.

Each candidate must satisfy /ticket-readiness:

- one primary outcome;
- one primary verification;
- 3–6 single-assertion acceptance criteria, with eight as the hard maximum;
- no more than three independent delivery surfaces;
- closed decisions, real blockers, decision sources, and explicit out-of-scope work;
- enough durable context for a fresh executor in the assigned lane.

Assign execution lane AGENT by default. Use HUMAN only when completion or primary verification itself requires intentionally human-held access, external or isolated environment control, physical access, or non-delegable judgment.

Preserve wide mechanical refactors as expand–migrate–contract sequences when a vertical slice cannot land green. Size migration batches by blast radius and keep the old form until every batch completes.

### 3. Build the graph

Assign only real blocking edges. Before publishing, compute a stable topological order of the internal blocker graph: for every `blocker -> dependent` edge, the blocker must appear earlier in native child order. Preserve the approved order among candidates that are simultaneously unblocked. A cycle is NEEDS_INFO, not an arbitrary ordering choice.

Present the exact numbered child order and blocker edges together. Identify gaps, overlaps, and candidates that can land independently.

For each candidate, present:

- title;
- primary outcome;
- primary verification;
- execution lane and the reason when HUMAN;
- acceptance-criterion count;
- independent delivery surfaces;
- blocked by;
- out of scope.

Ask the user to approve the split and graph before publishing. Approval here authorizes candidate creation, not a ready label.

### 4. Publish candidates

Publish one issue per approved candidate with needs-triage. For a real tracker:

1. Create every issue first so identifiers exist.
2. Link every issue as a native child of the delivery spec in the approved topological order; do not rely on issue number or creation order.
3. Wire native blocking relationships in a second pass.
4. Confirm child order, parent ownership, and blocker identity from a fresh tracker read.
5. Run the configured tracker's strict-frontier order check. Any internal blocker at the same or a later position than its dependent leaves the graph in needs-triage and returns to graph approval.

Keep the parent in needs-triage. Do not reuse a Wayfinder map as the delivery parent.

Use this ticket body:

    ## Parent
    Link to the delivery spec.

    ## What to build
    One sentence describing the observable outcome.

    ## Primary verification
    One behavioral seam or scenario that proves the outcome.

    ## Execution lane
    AGENT, or HUMAN with the non-delegable reason.

    ## Acceptance criteria
    - [ ] One independently verifiable assertion per item.

    ## Blocked by
    Real prerequisites, or None.

    ## Decision sources
    Linked ADRs, Wayfinder decisions, research, prototype decisions, or parent sections.

    ## Out of scope
    Adjacent behavior excluded from this ticket.

Avoid transient file paths and procedural implementation steps. Include a trimmed prototype-derived decision shape only when prose would be less precise.

### 5. Admit the graph

Invoke /admit-ticket for the parent and complete candidate graph. It must use ticket-readiness-reviewer in a fresh context.

When the reviewer returns SPLIT or NEEDS_INFO, present the result and wait for user direction. Any edit or graph change creates a new snapshot and requires another admission run.

### 6. Complete

Report the parent, child identifiers, graph, reviewer verdicts, and final labels. The workflow completes only when the tracker reflects the confirmed verdicts. A candidate-generation reply alone is not completion.
