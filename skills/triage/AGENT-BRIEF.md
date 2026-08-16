# Writing Candidate Briefs

The candidate brief is the authoritative implementation contract attached before /admit-ticket runs. A fresh executor must be able to choose the first correct action from this brief and repository policy. Original discussion and linked sources provide provenance or detail; they are never the only copy of required behavior or guardrails.

Write behavior and durable interfaces, not file paths, line numbers, or a procedural edit list. Satisfy the /ticket-readiness contract.

Use this structure:

    ## Agent Brief

    **Category:** bug | enhancement

    ## Coverage role
    STANDALONE

    ## What to build
    One sentence describing one observable outcome.

    ## Starting state
    What exists before work begins, including the verified current behavior, reproduction, input, or prerequisite artifact.

    ## Desired behavior
    What the user or system observes after completion, including important failure behavior.

    ## Primary verification
    One behavioral seam or scenario that proves the outcome.

    ## Invariants and guardrails
    Stable source or repository rules that must remain true; use None only when none apply.

    ## Execution lane
    AGENT, or HUMAN with the non-delegable reason.

    ## Acceptance criteria
    - [ ] One independently verifiable assertion per item.

    ## Blocked by
    Real prerequisites, or None.

    ## Decision sources
    Parent issue, ADRs, domain terms, research, prototype decisions, and verified evidence.

    ## Out of scope
    Adjacent behavior intentionally excluded.

Use 3–6 acceptance criteria and no more than eight. Name stable types, interfaces, or contracts only when they help a fresh executor find the behavior without constraining implementation unnecessarily.

For a PR, Starting state describes the submitted diff and What to build describes the bounded work needed to make that diff acceptable.
