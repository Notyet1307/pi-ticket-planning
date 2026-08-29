---
name: ticket-readiness
description: Judge candidate implementation issues before they enter an agent or human execution queue. Use when drafting, splitting, triaging, reviewing, or activating issues with a ready label, and when another skill needs the READY, SPLIT, or NEEDS_INFO contract.
---

# Ticket Readiness

Use this as the single source of truth for implementation-ticket scope and readiness. Evaluate and report; `prepare-codex-release` owns the recommended read-only handoff path, while `admit-ticket` alone owns Legacy Herdr tracker mutations.

## Artifact roles

- A **Wayfinder map** contains decision tickets. It produces decisions, research, prototypes, and human input. It never enters the implementation queue.
- A **delivery spec** is a parent planning issue. Keep it in needs-triage while its implementation graph is incomplete.
- A **candidate ticket** is a proposed implementation child in needs-triage.
- A **Release child** is a Controller-owned commit boundary inside one Release Plan: it is not an independent PR, publication, or runtime Reviewer job.
- A Legacy **admitted ticket** has passed Herdr-specific confirmation and then receives the ready label for its execution lane.

Create a delivery spec separate from any Wayfinder map. A closed decision ticket may be a source for an implementation ticket; it is not itself an implementation ticket.

## READY contract

Return READY only when every condition holds:

1. **One primary outcome.** State one externally observable result in one sentence.
2. **One primary verification.** Name one behavioral seam or scenario that proves the outcome: one API scenario, one state-machine suite, or one UI flow. Lint, typecheck, build, and full CI remain merge gates, not the primary verification.
3. **Bounded assertions.** Use 3–8 single-assertion acceptance criteria.
4. **Bounded delivery surface.** The ticket has no more than three independently useful delivery surfaces. A necessary schema, API, and UI path for one behavior may still be one vertical slice; layers are not automatically independent surfaces.
5. **Decisions are closed.** Product behavior, architecture, data ownership, compatibility, and rollout choices needed to start are already decided and do not conflict with linked ADRs.
6. **Dependencies are real.** Blocked by lists prerequisites without which the ticket cannot be completed and pass its primary verification independently. Preferred order is not a blocker when an available stable contract still permits independent completion.
7. **Scope is explicit.** Out of scope names the adjacent work this ticket intentionally leaves behind.
8. **Fresh-start sufficiency.** The ticket body names its starting state or available inputs, primary outcome and verification, behavior-defining decisions, and invariants or guardrails. A fresh executor can choose the first correct action from the ticket plus repository policy; parent and decision links provide provenance or detail, never the only copy of behavior or a guardrail required to start.
9. **Coverage is traceable.** A Delivery-Spec child names stable source Scenario IDs and a coverage role. `DIRECT` implements user-observable behavior. `ENABLER` names current downstream consumers, an objective exit condition, and the real blocker edges that make it necessary. A standalone triage or risk ticket uses `STANDALONE` and names its exact source behavior or reproduction instead.
10. **Oracle is frozen.** Every AGENT Ticket embeds exact `pi-ticket-planning:oracle-binding:v1` path/format/base/bytes, an independent owner, an exact reviewed-base `npm run verify:*` script, and a protected path outside its write set.
11. **Execution is bounded.** Declare risks, one seam, file/line budget, at most eight expected paths, protected paths, and REPLAN triggers. Defaults: two risks, eight files, 1500 lines. Exceptions need exact waiver; four risks always SPLIT; over 2500 lines needs `MECHANICAL_MIGRATION`.
12. **Integration-only is closed.** Declare no new behavior/schema/duplicate logic and missing behavior as `REPLAN_REQUIRED`.

Prefer a vertical slice through only the layers needed for the observable result. Preserve wide mechanical refactors as expand–migrate–contract sequences when no independently green vertical slice exists.

## Context quality

READY additionally requires all of these findings:

1. Product behavior, current implementation, load-bearing technical decisions, global policy, and live state each come from their owning authority.
2. Every Git source is read from the reviewed base and tracker facts are fresh reads from their owning system. Executor runtime readiness belongs to the selected execution path, not this content verdict.
3. No same-concern conflict can change the outcome, primary verification, acceptance criteria, guardrails, or first correct action.
4. Historical, example, fixture, draft, working-tree, and conversation-summary material is not used as authority.
5. The Ticket body itself contains the required behavior, decisions, invariants, guardrails, blockers, and out-of-scope boundary.
6. Optional Context anchors are exact reviewed-base regular files, relevant to the first action, unique, and limited to five; each description states the branch of work that makes the file relevant and the first-action purpose. Zero is valid.
7. The Ticket never asks the executor to scan a repository or decide which source is true.
8. The effective root policy contains only stable global rules and does not conflict with accepted code or ADRs through stale implementation detail.
9. The deterministic `pi-ticket-planning:ticket-context-check:v1` result is PASS and matches the candidate identity, exact body hash, and exact base SHA.
10. A fresh executor can choose the first correct action directly from the Ticket, repository policy, and bounded anchors.
11. Every Release-graph `AGENT` child is a bounded Controller-owned commit boundary: it has a first correct action, only earlier dependencies, and can remain buildable and verifiable after completion. Standalone lane classification remains independent. Controller, credential, Docker, Provider, and merge readiness are execution facts, not Ticket-quality facts.

An older accepted ADR remains authoritative until a valid supersession, same-concern conflict, missing reviewed-base path, or explicit historical/deprecated status proves otherwise. A current implementation that differs from a COMMITTED target normally describes `current state -> target state`; it is not itself a conflict. Missing or conflicting Context Quality is NEEDS_INFO. Use SPLIT only when the same evidence also proves multiple independent outcomes.

## Verdicts

- **READY** — the candidate satisfies the full contract.
- **SPLIT** — the objective is decided, but the candidate contains multiple outcomes or verification seams, four or more risks/surfaces, work that can land independently, Provider Attempt recovery plus Publication recovery, Provider boundary plus persistence plus UI, Reviewer plus Writer plus Artifact eligibility, or Approval plus publication plus crash recovery.
- **NEEDS_INFO** — a product or architecture decision, contradictory source, missing behavior, unavailable required input, or unclear blocker prevents a stable ticket.

Use NEEDS_INFO before SPLIT when the missing decision prevents a trustworthy split.

## Execution lane

Classify the execution lane independently from the verdict:

- **AGENT** — an AFK agent can complete the work and primary verification with the repository and configured tools.
- **HUMAN** — completion or primary verification requires intentionally human-held access, control of an external or isolated environment, physical access, or non-delegable judgment.

A complete human-only ticket is READY with execution lane HUMAN. Human ownership alone is not missing information, and ready-for-human is an activation label rather than a fourth verdict. Use NEEDS_INFO only when a required decision or input is actually unavailable.

## Activation boundary

Controller handoff reviews one bounded all-AGENT v3 Release; HUMAN work stays outside it. Children remain `needs-triage`; the fresh review binds Oracle/risk/scope and creates no ready labels or runtime Reviewer work.

Legacy Herdr Admission may separately activate ready labels and require Harness execution evidence. Do not project those runtime facts back into this READY content contract.

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
    Risk classes and count:
    Scope budget:
    Expected paths:
    Protected Oracle paths:
    Oracle binding verdict and digest:
    REPLAN triggers:
    Code hotspot overlap:
    Integration-only verdict:
    Downstream consumers and exit condition: <required for ENABLER>
    Proposed split: <only for SPLIT>

After the human-readable fields, return one machine block. Echo the review timestamp supplied in the Admission bundle; do not invent a different time:

```json
{
  "schema": "pi-ticket-planning:admission-review:v1",
  "reviewer": "ticket-readiness-reviewer",
  "reviewedAt": "<exact bundle review timestamp>",
  "source": { "identity": "<exact source identity>", "revision": "<exact source revision>", "baseSha": "<exact base SHA>" },
  "axes": { "candidateReadiness": "PASS | FAIL | NEEDS_INFO", "contextQuality": "PASS | FAIL | NEEDS_INFO", "deliveryGraph": "PASS | FAIL | NEEDS_INFO", "scenarioCoverage": "PASS | FAIL | NEEDS_INFO", "walkingSkeleton": "PASS | FAIL | NEEDS_INFO", "strictFrontier": "PASS | FAIL | NEEDS_INFO", "executionLane": "PASS | FAIL | NEEDS_INFO", "inputBinding": "PASS | FAIL | NEEDS_INFO" },
  "graphVerdict": "READY | NEEDS_INFO",
  "candidates": [
    { "id": "<candidate>", "verdict": "READY | SPLIT | NEEDS_INFO", "executionLane": "AGENT | HUMAN", "riskClasses": [], "riskCount": 0, "primaryVerificationSeams": [], "scopeBudget": null, "expectedPaths": [], "protectedOraclePaths": [], "oracleBindingDigest": null, "oracleBindingVerdict": "PASS | FAIL | NOT_APPLICABLE", "replanTriggers": [], "codeHotspotOverlap": [], "integrationOnlyVerdict": "PASS | FAIL | NOT_APPLICABLE", "waiverDigests": [] }
  ],
  "inputBinding": {
    "schema": "pi-ticket-planning:admission-review-binding:v1",
    "subject": {
      "target": "<exact target>",
      "kind": "admission-review",
      "id": "<exact review target>",
      "revision": "<exact source revision>",
      "digest": "<exact sha256>"
    },
    "inputDigest": "<exact sha256>",
    "byteCount": 0,
    "createdAt": "<exact timestamp>"
  }
}
```

Echo the held `source` and `inputBinding` exactly and include every axis. READY requires all eight axes to PASS; omission or disagreement is malformed.

For a batch, add a Graph verdict first, then repeat the fields for every candidate. The admission bundle must include the immutable Parent, exact `spec-acceptance:v1` receipt, separately bound current `delivery-release-graph:v3`, its checker result, one raw Ticket Context checker result per candidate, the Parent Scenario list and handoffs, and the current child set. Compare them and report uncovered scenarios, broken or inferred handoffs, orphan candidates, overlapping outcomes, invalid ENABLER relationships, invalid dependency edges, Context-check mismatch/failure, and execution lanes. Do not repair or reinterpret a failed deterministic result. HUMAN work is valid in a Roadmap or standalone Human Execution artifact, never in the executable Release graph.

The batch output must include:

    Delivery graph contract: PASS | FAIL — <checker problems when FAIL>
    Scenario coverage: PASS | FAIL — <uncovered scenarios, orphan candidates, or stale mappings>
    Walking skeleton: PASS | FAIL — <ordered candidate IDs and covered scenarios, or the exact gap>
    Strict-frontier order: PASS | FAIL — <exact inverted edges when FAIL>

Graph READY requires every candidate READY plus passing Graph, coverage, skeleton, frontier, Oracle, risk/scope, protected-path, REPLAN, and integration checks. Review metadata must equal body/v3; deterministic breadth findings require SPLIT.

Tie the verdict to the exact candidate bodies, parent spec, sources, graph, and updated timestamps supplied in the admission bundle. Any material drift requires a new review.

## Legacy Herdr activation invariant

Only an operator's explicit Legacy Herdr selection follows this ready-label activation order:

1. Publish the parent and all children as needs-triage.
2. Create native parent-child and blocking relationships.
3. Run the Ticket Context checker for every candidate and the Delivery Graph checker, compare their snapshots with current children and native blockers, then review the complete graph in a fresh context.
4. Obtain explicit human confirmation.
5. Re-fetch, re-run every Ticket Context check, and confirm the reviewed snapshot is unchanged.
6. Add ready-for-agent to READY/AGENT executable-Release children; standalone HUMAN work uses its separate ready-for-human route.
7. Add ready-for-agent to the delivery parent last.

Keep Wayfinder maps and their decision tickets outside this activation sequence.
