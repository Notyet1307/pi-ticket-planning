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
8. **Fresh-start sufficiency.** The ticket body names its starting state or available inputs, primary outcome and verification, behavior-defining decisions, and invariants or guardrails. A fresh executor can choose the first correct action from the ticket plus repository policy; parent and decision links provide provenance or detail, never the only copy of behavior or a guardrail required to start.
9. **Coverage is traceable.** A Delivery-Spec child names stable source Scenario IDs and a coverage role. `DIRECT` implements user-observable behavior. `ENABLER` names current downstream consumers, an objective exit condition, and the real blocker edges that make it necessary. A standalone triage or risk ticket uses `STANDALONE` and names its exact source behavior or reproduction instead.

Prefer a vertical slice through only the layers needed for the observable result. Preserve wide mechanical refactors as expand–migrate–contract sequences when no independently green vertical slice exists.

## Context quality

READY additionally requires all of these findings:

1. Product behavior, current implementation, load-bearing technical decisions, global policy, and live state each come from their owning authority.
2. Every Git source is read from the reviewed base; tracker and Harness facts are fresh reads from their owning systems.
3. No same-concern conflict can change the outcome, primary verification, acceptance criteria, guardrails, or first correct action.
4. Historical, example, fixture, draft, working-tree, and conversation-summary material is not used as authority.
5. The Ticket body itself contains the required behavior, decisions, invariants, guardrails, blockers, and out-of-scope boundary.
6. Optional Context anchors are exact reviewed-base regular files, relevant to the first action, purpose-labelled, unique, and limited to five; zero is valid.
7. The Ticket never asks the executor to scan a repository or decide which source is true.
8. The effective root policy contains only stable global rules and does not conflict with accepted code or ADRs through stale implementation detail.
9. The deterministic `pi-ticket-planning:ticket-context-check:v1` result is PASS and matches the candidate identity, exact body hash, and exact base SHA.
10. A fresh executor can choose the first correct action directly from the Ticket, repository policy, and bounded anchors.
11. Every `AGENT` candidate has a current passing Harness readiness projection bound to the reviewed repository/base/config: both Provider lanes, required local Docker, exact-base canonical validation, and the active strict no-bypass GitHub merge gate. A `HUMAN` lane does not borrow or fabricate this execution fact.

An older accepted ADR remains authoritative until a valid supersession, same-concern conflict, missing reviewed-base path, or explicit historical/deprecated status proves otherwise. A current implementation that differs from a COMMITTED target normally describes `current state -> target state`; it is not itself a conflict. Missing or conflicting Context Quality is NEEDS_INFO. Use SPLIT only when the same evidence also proves multiple independent outcomes.

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
    Source scenarios or standalone source:
    Coverage role: DIRECT | ENABLER | STANDALONE
    Starting state:
    Primary outcome:
    Primary verification:
    Invariants and guardrails:
    Independent delivery surfaces:
    Single-assertion AC count:
    Unresolved decisions or ADR conflicts:
    Real blockers:
    Context authority:
    Context freshness:
    Context conflicts:
    Context anchors:
    Context economy:
    Downstream consumers and exit condition: <required for ENABLER>
    Proposed split: <only for SPLIT>

After the human-readable fields, return one machine block. Echo the review timestamp supplied in the Admission bundle; do not invent a different time:

```json
{
  "schema": "pi-ticket-planning:admission-review:v1",
  "reviewer": "ticket-readiness-reviewer",
  "reviewedAt": "<exact bundle review timestamp>",
  "graphVerdict": "READY | NEEDS_INFO",
  "candidates": [
    { "id": "<exact candidate identity>", "verdict": "READY | SPLIT | NEEDS_INFO", "executionLane": "AGENT | HUMAN" }
  ]
}
```

The JSON is a machine projection of the prose verdict, not a second judgment. Any disagreement between them makes the review malformed.

For a batch, add a Graph verdict first, then repeat the fields for every candidate. The admission bundle must include the exact normalized JSON under the parent's `## Ticket coverage`, the Delivery Graph checker result, one raw Ticket Context checker result per candidate, the parent Scenario list and handoffs, and the current child set. Compare them and report uncovered scenarios, broken or inferred handoffs, orphan candidates, overlapping outcomes, invalid ENABLER relationships, invalid dependency edges, Context-check mismatch/failure, and execution lanes. Do not repair or reinterpret a failed deterministic result. A READY candidate in the HUMAN lane does not make the graph NEEDS_INFO.

The batch output must include:

    Delivery graph contract: PASS | FAIL — <checker problems when FAIL>
    Scenario coverage: PASS | FAIL — <uncovered scenarios, orphan candidates, or stale mappings>
    Walking skeleton: PASS | FAIL — <ordered candidate IDs and covered scenarios, or the exact gap>
    Strict-frontier order: PASS | FAIL — <exact inverted edges when FAIL>

Graph READY requires every intended candidate to be individually READY and the Delivery Graph contract, Scenario coverage, walking skeleton, and strict-frontier order all to pass. Every parent Scenario needs direct coverage; every child needs a valid mapping; every ENABLER needs a current downstream consumer and exit condition. Every walking-skeleton member must be READY, each named handoff must have an explicit producer or external source, and the chain must close the smallest trigger-to-result loop. For every internal `blocker -> dependent` edge, `position(blocker) < position(dependent)`. External blockers are reported but are not orderable inside the map. Any non-READY candidate, malformed or stale snapshot, broken or inferred handoff, coverage gap, orphan, cycle, or order inversion makes the Graph verdict NEEDS_INFO.

Tie the verdict to the exact candidate bodies, parent spec, sources, graph, and updated timestamps supplied in the admission bundle. Any material drift requires a new review.

## Activation invariant

Activation follows this order:

1. Publish the parent and all children as needs-triage.
2. Create native parent-child and blocking relationships.
3. Run the Ticket Context checker for every candidate and the Delivery Graph checker, compare their snapshots with current children and native blockers, then review the complete graph in a fresh context.
4. Obtain explicit human confirmation.
5. Re-fetch, re-run every Ticket Context check, and confirm the reviewed snapshot is unchanged.
6. Add ready-for-agent to READY/AGENT children and ready-for-human to READY/HUMAN children.
7. Add ready-for-agent to the delivery parent last.

Keep Wayfinder maps and their decision tickets outside this activation sequence.
