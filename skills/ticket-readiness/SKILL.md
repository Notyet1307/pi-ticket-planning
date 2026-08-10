---
name: ticket-readiness
description: Judge candidate implementation issues before they enter an agent or human execution queue. Use when drafting, splitting, triaging, reviewing, or activating issues with a ready label, and when another skill needs the READY, SPLIT, or NEEDS_INFO contract.
---

# Ticket Readiness

Use this as the single source of truth for implementation-ticket scope and admission. Evaluate and report; let /admit-ticket own tracker mutations.

## Artifact roles

- A **Wayfinder map** contains decision tickets. It produces decisions, research, prototypes, and human input. It never enters the implementation queue.
- A **delivery spec** is a parent planning issue. Keep it in needs-triage while its implementation graph is incomplete.
- A **candidate ticket** is a proposed implementation child in needs-triage.
- An **admitted ticket** has passed an independent fresh-context review and human confirmation, then receives the ready label for its execution lane.

Create a delivery spec separate from any Wayfinder map. A closed decision ticket may be a source for an implementation ticket; it is not itself an implementation ticket.

## READY contract

Return READY only when every condition holds:

1. **One primary outcome.** State one externally observable result in one sentence.
2. **One primary verification.** Name one behavioral seam or scenario that proves the outcome: one API scenario, one state-machine suite, or one UI flow. Lint, typecheck, build, and full CI remain merge gates, not the primary verification.
3. **Bounded assertions.** Use 3–6 acceptance criteria. Eight single-assertion criteria is the hard maximum.
4. **Bounded delivery surface.** The ticket has no more than three independently useful delivery surfaces. A necessary schema, API, and UI path for one behavior may still be one vertical slice; layers are not automatically independent surfaces.
5. **Decisions are closed.** Product behavior, architecture, data ownership, compatibility, and rollout choices needed to start are already decided and do not conflict with linked ADRs.
6. **Dependencies are real.** Blocked by lists prerequisites without which the ticket cannot be completed and pass its primary verification independently. Preferred order is not a blocker when an available stable contract still permits independent completion.
7. **Scope is explicit.** Out of scope names the adjacent work this ticket intentionally leaves behind.
8. **Fresh-start sufficiency.** A fresh executor in the assigned lane can begin from this ticket, its parent spec, and linked decision sources without recovering hidden conversation context.

Prefer a vertical slice through only the layers needed for the observable result. Preserve wide mechanical refactors as expand–migrate–contract sequences when no independently green vertical slice exists.

## Verdicts

- **READY** — the candidate satisfies the full contract.
- **SPLIT** — the objective is decided, but the candidate contains multiple outcomes, multiple primary verification seams, four or more independent delivery surfaces, more than eight assertions, or work that can land independently.
- **NEEDS_INFO** — a product or architecture decision, contradictory source, missing behavior, unavailable required input, or unclear blocker prevents a stable ticket.

Use NEEDS_INFO before SPLIT when the missing decision prevents a trustworthy split.

## Execution lane

Classify the execution lane independently from the verdict:

- **AGENT** — an AFK agent can complete the work and primary verification with the repository and configured tools.
- **HUMAN** — completion or primary verification requires intentionally human-held access, control of an external or isolated environment, physical access, or non-delegable judgment.

A complete human-only ticket is READY with execution lane HUMAN. Human ownership alone is not missing information, and ready-for-human is an activation label rather than a fourth verdict. Use NEEDS_INFO only when a required decision or input is actually unavailable.

## Review output

For one candidate, return exactly:

    Verdict: READY | SPLIT | NEEDS_INFO
    Execution lane: AGENT | HUMAN
    Primary outcome:
    Primary verification:
    Independent delivery surfaces:
    Single-assertion AC count:
    Unresolved decisions or ADR conflicts:
    Real blockers:
    Proposed split: <only for SPLIT>

For a batch, add a Graph verdict first, then repeat the fields for every candidate. The graph review must also report coverage gaps, overlapping outcomes, invalid dependency edges, and execution lanes. A READY candidate in the HUMAN lane does not make the graph NEEDS_INFO.

For a delivery map consumed by a strict-frontier Harness, Graph READY additionally requires its native child list to be a topological order of the internal blocker graph. For every internal `blocker -> dependent` edge, `position(blocker) < position(dependent)`. External blockers are reported but are not orderable inside the map. A cycle or order inversion makes the Graph verdict NEEDS_INFO even when every candidate is individually READY.

The batch output must include:

    Strict-frontier order: PASS | FAIL — <exact inverted edges when FAIL>

Tie the verdict to the exact candidate bodies, parent spec, sources, graph, and updated timestamps supplied in the admission bundle. Any material drift requires a new review.

## Activation invariant

Activation follows this order:

1. Publish the parent and all children as needs-triage.
2. Create native parent-child and blocking relationships.
3. Verify native child order against the blocker graph, then review the complete graph in a fresh context.
4. Obtain explicit human confirmation.
5. Re-fetch and confirm the reviewed snapshot is unchanged.
6. Add ready-for-agent to READY/AGENT children and ready-for-human to READY/HUMAN children.
7. Add ready-for-agent to the delivery parent last.

Keep Wayfinder maps and their decision tickets outside this activation sequence.
