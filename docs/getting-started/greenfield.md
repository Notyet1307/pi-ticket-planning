# Greenfield: start with a rough idea

English | [简体中文](greenfield.zh-CN.md) · [Back to README](../../README.md)

## 1. Starting point

Greenfield can mean three different things:

- **The product starts from zero:** the user and smallest useful result are still uncertain.
- **The repository starts from zero:** the working directory may be empty or not yet use Git.
- **The implementation starts from zero:** no application boundary, stack, or code exists.

One sentence of product intent is enough to start shaping. An empty directory is not a blocker. During product framing the system does not initialize Git, choose a stack, or create application code. After a person commits an exact Release, repository setup may create the minimum delivery container. Application scaffolding belongs to an admitted Ticket and a configured Harness, not to product framing.

## 2. What to say first

Start PI in the empty or existing project directory, then use one of these forms:

```text
/skill:ask-yet I want to help independent designers miss fewer delivery steps, but I have not worked out the product yet.
```

```text
/skill:ask-yet I want an internal tool that helps security operators judge alerts faster, but I do not know what version one should do.
```

```text
/skill:ask-yet I have an idea for automating work, but I do not know which step users actually need help with.
```

Do not choose a workflow mode or a stack. Describe the intent in ordinary language.

## 3. What the system reads first

The system starts with the supplied intent and the smallest first-party context that can change the next question. In an empty directory it records Git, policy, README, code, and tracker support as absent facts rather than blockers. If files already exist, it reads only the relevant facts; their existence does not become customer Evidence.

It separates confirmed words from candidate interpretations and unknowns. It does not scan for a reason to invent an implementation.

## 4. How the system may reply

A typical first exchange is short:

> **User:** I want to help small teams miss fewer delivery steps, but I have not worked out the product.
>
> **System:** This could mean A) a pre-handoff completeness check, B) a team handoff aid, or C) an earlier process warning. I recommend A first because it is the narrowest reversible loop; it defers collaboration and prediction. Which is closer: A, B, C, or a correction?
>
> **User:** A, start with the pre-handoff check.
>
> **System:** I will treat A as the candidate direction, not as customer Evidence or delivery approval. In the most recent matching handoff, what was omitted and what observable consequence followed?

This illustrates the `DECISION` then `DIALOGUE` interaction shape; it is not a fixed output template. The actual reply may use different wording and always ends with its machine Checkpoint.

## 5. Decisions you need to make

You choose or correct the candidate direction and supply recent real events that the repository cannot contain. Candidate selection only chooses what to investigate; it is not customer Evidence, Commitment, or implementation approval.

Exploratory interviews can discover the actor, trigger, ordered workflow, failure, consequence, and completion signal. Validation Evidence tests one frozen hypothesis against a rule fixed before answers. Before Commitment, the system checks in ordinary language that:

- the actor, recent trigger, workflow, alternative, and important failure have Evidence;
- the smallest user loop closes end to end;
- success, guardrails, observation window, and minimum Evidence are observable;
- the highest risk is tested or bounded within the accepted appetite;
- non-goals and major risk boundaries are explicit.

Only when all six runtime readiness checks pass does a person choose `COMMITTED`, `HOLD`, `REWORK`, or `DROP`. The system may recommend; it cannot choose.

## 6. Durable artifacts

Before a candidate is selected, the conversation creates no product file. A Candidate Frame may later preserve the selected direction, smallest loop, exclusions, highest-risk assumption, and next decision while remaining a candidate. Approved formal Evidence may add only a redacted result; raw interview answers and identifiers stay outside Git.

Commitment binds an exact Release revision. That exact blob must reach the accepted remote delivery base before delivery compilation. A draft ref or local working tree is not enough.

## 7. When Ticket splitting starts

Ticket splitting does not start from the rough idea. After Commitment:

```text
accepted Release
→ setup-delivery-repository when a delivery base is absent and authorized
→ Solution Shaping / accepted ADR
→ Repository Contract Impact Review
→ Delivery Spec
→ candidate Tickets and dependency graph
```

Repository setup creates only the delivery container. Solution Shaping closes load-bearing first-version decisions and creates no implementation code. The Delivery Spec defines verifiable scenarios. Ticket generation covers those scenarios and identifies the smallest trigger-to-result walking skeleton.

## 8. When work reaches the Harness

Candidate Tickets begin as `needs-triage`. A fresh-context reviewer checks each Ticket plus scenario coverage, handoffs, the walking skeleton, dependency order, source revision, and policy. Admission then prepares an exact Plan and waits for a person to confirm its fingerprint.

Only the confirmed Admission transaction writes ready labels. A ready label plus its Admission record lets a configured Harness claim work. This is later than Commitment and later than Ticket creation.

## 9. Common mistakes

- choosing a complete stack before the first product result is known;
- designing a full platform or long-term backlog at the start;
- treating the word “AI” as a reason to run a model benchmark first;
- treating an internal canary or technical feasibility result as customer-value Evidence;
- asking the first Ticket to create the whole system;
- letting a Worker choose a load-bearing architecture before an ADR is accepted.

The minimum useful default is one product loop, one riskiest assumption, and one next Evidence action.

## 10. Pause and resume

Use `pi-ticket-plan -c` or `pi-ticket-plan -r` from the same directory. Inside PI, `/session` shows the current session and `/resume` selects one.

A paused interview resumes at the first missing question. A new session cannot reconstruct unpersisted participant answers from model memory or summaries, so restore the original session. An owner may instead supply a redacted return block and explicitly confirm its factual accuracy; it can resume the conversation, but only an approved result that satisfies the formal contract can close formal Evidence.

## 11. Complete example to the next gate

```text
Input: “Help small teams miss fewer delivery steps.”
System: forms pre-handoff check / handoff aid / process-warning candidates and recommends the narrowest one.
Human: selects the pre-handoff check.
System: forms a Candidate Frame and asks for one recent real omission and consequence.
Evidence: exploration may correct the workflow; later validation tests one frozen highest-risk hypothesis.
Human gate: after all readiness items pass, the owner decides whether to commit the exact Release.
Next gate: after Commitment, create the authorized delivery base and close the minimum technical boundary before the Delivery Spec.
```

Nothing in this example implies that a candidate was already valuable, that a repository or application was created during framing, or that work reached the Harness.
