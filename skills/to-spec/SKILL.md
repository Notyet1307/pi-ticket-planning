---
name: to-spec
description: Compile an exact COMMITTED Release revision or another trusted, decision-complete delivery source into a traceable draft Delivery Spec on the configured issue tracker.
disable-model-invocation: true
---

# To Spec

Compile decided behavior into one durable parent Delivery Spec. Do not interview the human, choose product behavior, or recover authority from conversation memory.

The repository, issue tracker, triage labels, and exact Git base must already be configured by `/skill:setup-matt-pocock-skills`. Use `/ticket-readiness` for artifact roles and activation invariants.

## Process

### 1. Resolve one trusted source

Classify the source:

- `PRODUCT_RELEASE`: a new product, uncertain feature, or bounded enhancement. Require the Release artifact path, Release ID, exact revision, and `status: COMMITTED`. Re-read that revision; a candidate Frame, conversation, plan, or completed Wayfinder map is not a substitute for human Commitment.
- `OPERATING_SOURCE`: a confirmed bug, mandatory maintenance/risk change, or incident follow-up with an exact issue, reproduction, policy, ADR, or other decision-complete authority. Record why the shorter product path is valid.

Completed Wayfinder decisions, research, prototypes, and questionnaires may support either source. Fetch the exact linked artifacts needed to recover a decision. An open decision or conflicting authority that changes behavior is `NEEDS_INFO`.

### 2. Pin the delivery base

Require a Git repository with a valid `HEAD`. Record the repository identity, exact base SHA, effective root policy path and digest, and tracker identity. Reconcile the source against current code, domain vocabulary, ADRs, and compatibility constraints.

If the target is non-Git, has an unborn `HEAD`, lacks tracker configuration, or depends on an unmerged policy change, stop before publishing and return to `/skill:ask-yet`. Never invent a base or let a candidate-branch policy govern its own Worker.

### 3. Define stable behavioral scenarios

Assign each included behavior a stable Scenario ID: `S1`, `S2`, and so on. Preserve the source's actor, explicit entry state or external input, trigger, observable result, important failure behavior, exit state or produced artifact, and Release signal relationship. Every included Release scenario appears exactly once; out-of-scope behavior does not receive a Scenario ID. If a later scenario consumes a state such as `invalid`, `reviewable`, or `confirmed`, name the earlier producer and the transition or clearing condition; do not leave the delivery compiler to infer it.

Identify the highest stable behavioral seams that can verify the scenarios. Prefer existing public interfaces and record why any new seam is required.

### 4. Draft the Delivery Spec

Use this structure:

    ## Source
    Source kind, authoritative identity, Release ID and exact revision when applicable,
    repository identity, exact base SHA, effective policy identity, and tracker identity.

    ## Problem statement
    The user-visible problem and present consequence.

    ## Delivery outcome
    The observable state that marks this spec complete.

    ## Behavioral scenarios
    ### S1: <outcome-oriented name>
    Actor:
    Entry state or external input:
    Trigger:
    Observable result:
    Important failure behavior:
    Exit state or produced artifact:
    Source reference:

    ## Release signal mapping
    Map every Scenario ID to the relevant primary signal or guardrail.

    ## Walking skeleton target
    Ordered Scenario IDs for the smallest trigger-to-observable-result loop, including its entry,
    each named state or artifact handoff, and terminal result.

    ## Decisions
    Product, architecture, data, compatibility, rollout, schema, API, and interaction decisions already made.
    Link each non-obvious decision to its Release revision, ADR, Wayfinder decision, research, questionnaire, or prototype source.

    ## Verification strategy
    Scenario ID to behavioral seam, representative check, and relevant prior art.

    ## Constraints and dependencies
    External systems, migration constraints, sequencing constraints, and real prerequisites.

    ## Out of scope
    Adjacent behavior intentionally excluded from this delivery.

    ## Unresolved decisions
    Empty when ticket planning can proceed; otherwise exact questions, owners, and the blocked scenarios.

Avoid implementation task lists, transient file paths, and working code. Include a short prototype-derived state machine, schema, reducer, or type shape only when it is the clearest authoritative decision.

### 5. Approve and publish the draft

Show the complete body, source identity, base SHA, Scenario IDs, and exact tracker mutation. Wait for explicit approval before publishing.

Publish the approved parent with `needs-triage`; keep both ready labels absent. If unresolved decisions block stable ticketing, use `needs-info` and stop before `/skill:to-tickets`.

### 6. Complete

Re-fetch the parent and report its identifier, source identity, exact base, Scenario IDs, walking-skeleton target, label, verification seams, and unresolved decisions. Completion means a human-approved, durable Delivery Spec suitable for `/skill:to-tickets`, not an executable issue.
