---
name: to-spec
description: Turn the current conversation or a completed Wayfinder map into a detailed delivery spec on the configured issue tracker. The spec remains a draft until implementation tickets pass admission.
disable-model-invocation: true
---

# To Spec

Synthesize existing decisions into a durable parent delivery spec. Do not interview the user or invent missing decisions.

The issue tracker, domain-doc layout, and triage labels must already be configured by /setup-matt-pocock-skills. Use /ticket-readiness for artifact roles and activation invariants.

## Process

### 1. Resolve the source

Use the current conversation, a supplied plan/spec, or a Wayfinder map.

For a Wayfinder map:

1. Read the destination, notes, decisions-so-far, not-yet-specified, out-of-scope, and every open child.
2. Fetch closed decision tickets and linked research, prototype, questionnaire, and ADR sources as needed to recover the authoritative decisions.
3. Treat an open decision or material fog as NEEDS_INFO when it prevents a buildable plan.
4. Create a separate delivery spec. Keep the Wayfinder map and its decision tickets outside the implementation queue.

### 2. Reconcile the repo

Explore the current codebase. Use the domain glossary vocabulary and respect ADRs. Report any conflict between the source decisions and current repo state rather than silently choosing a side.

### 3. Choose verification seams

Identify the highest stable behavioral seams that can verify the planned outcomes. Prefer existing public interfaces. Record why any new seam is required.

The parent spec may contain several outcomes and verification seams; /to-tickets will later isolate them into bounded implementation tickets.

### 4. Write the delivery spec

Use this structure:

    ## Problem statement
    The user-visible problem and present consequence.

    ## Delivery outcome
    The observable state that marks this spec complete.

    ## Behavioral scenarios
    Numbered actor, trigger, observable result, and important failure behavior.

    ## Decisions
    Product, architecture, data, compatibility, rollout, schema, API, and interaction decisions already made.
    Link each non-obvious decision to its Wayfinder ticket, ADR, research, questionnaire, or prototype source.

    ## Verification strategy
    Behavioral seams, representative scenarios, and relevant prior art in the repo.

    ## Constraints and dependencies
    External systems, migration constraints, sequencing constraints, and real prerequisites.

    ## Out of scope
    Adjacent behavior intentionally excluded from this delivery.

    ## Unresolved decisions
    Empty when build planning can proceed; otherwise exact questions and owners.

Avoid implementation task lists, transient file paths, and working code. Include a short prototype-derived state machine, schema, reducer, or type shape only when it is the clearest authoritative decision.

### 5. Publish as a draft

Publish the spec to the configured tracker with needs-triage. Keep ready-for-agent absent. Link the source conversation artifact or Wayfinder map.

If unresolved decisions prevent ticketing, use needs-info instead and stop before /to-tickets.

### 6. Complete

Report the spec identifier, source links, current state label, verification seams, and any unresolved decisions. The completion criterion is a durable draft suitable for /to-tickets, not an executable issue.
