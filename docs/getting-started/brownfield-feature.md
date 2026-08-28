# Brownfield: add a capability to an existing project

English | [简体中文](brownfield-feature.zh-CN.md) · [Back to README](../../README.md)

## 1. Starting point

Use this path when a repository and product already exist but the requested capability may mean more than one product outcome. The system reads the current boundary before it asks you to restate anything discoverable. It still treats repository facts and customer Evidence as different things.

A narrow, decision-complete correction may become one standalone Ticket. A feature with known behavior but several delivery surfaces may need a small Release, Delivery Spec, and Ticket graph. If the user, workflow, or value remains uncertain, it first needs a Candidate Frame and Evidence. The system infers that depth; you do not choose it.

## 2. What to say first

Start from the repository root and describe the uncertainty directly:

```text
/skill:ask-yet I want bulk import in the existing system, but I do not know whether that means bulk creation, historical migration, or continuous synchronization.
```

```text
/skill:ask-yet I want AI analysis on the alert detail page, but I do not know the real user task.
```

```text
/skill:ask-yet I want a new approval state, but I am not sure how the page, API, and data boundary should change.
```

Do not translate the request into internal stages. State the desired change and what is still unclear.

## 3. What the system reads first

The system reads the smallest relevant set of:

- README and repository policy;
- related entry points and nearby behavior;
- tests and configuration;
- domain terms and accepted ADRs;
- nearby Issues;
- current interfaces, state, and data ownership.

It does not ask you to repeat discoverable technical facts. A repository role or UI persona is not proof of a real customer task. Existing code can prove that a single-record creation path and field validation exist; it cannot prove that administrators need bulk creation or that repeated entry is an important problem.

## 4. How the system may reply

For a bulk-import request, the exchange may look like this:

> **System:** The repository confirms one-record creation and required-field validation. It does not contain customer Evidence for a batch task. The request could mean A) create several new records, B) migrate old records once, or C) keep records synchronized. I recommend A as the narrowest extension of the accepted path; it defers migration cleanup and an ongoing integration. Which is closer?
>
> **User:** A, bulk creation.
>
> **System:** I will preserve the existing validation path as a technical fact and treat the real batch task as a hypothesis. In the most recent event, who entered several records, what triggered it, and where did rework appear?

This is an interaction example, not a golden response. The system can recommend a different candidate when repository facts differ.

## 5. Decisions you need to make

You choose the product interpretation, provide real workflow facts, and decide priority, appetite, risk acceptance, and Commitment. The system chooses the shortest path from evidence:

- one trusted, decision-complete behavior with one outcome and verification can become one Ticket;
- established behavior that needs multiple Tickets gets a bounded Release and Spec;
- an uncertain actor, workflow, outcome, or value stays in Candidate Frame and Evidence;
- security, privacy, credentials, migration, or production risk adds controls without forcing unnecessary customer discovery.

For an “AI analysis” request, keep this boundary explicit:

```text
AI is a solution hypothesis.
AI is not the target outcome.
AI is not the primary signal.
```

First establish who is making a judgment, what triggers it, which information is missing, and which error matters. Usually the real user loop comes first. A bounded Technical Spike may come first only when one fixed technical constraint could make the whole candidate infeasible within its appetite; otherwise model capability must wait until it is the decision-changing technical unknown.

## 6. Durable artifacts

Read-only orientation creates no files. A selected but unproven direction may become a Candidate Frame. Formal Evidence can add an approved redacted result. Commitment binds and records an exact `COMMITTED` Release revision; its exact blob must still enter the accepted remote delivery base. Any new load-bearing technical choice is then recorded in an accepted ADR. The Delivery Spec and candidate Ticket graph trace back to those accepted sources.

Candidate Tickets remain `needs-triage`. Repository facts, customer Evidence, product decisions, ADRs, Spec, Tickets, Admission, and execution status retain separate owners.

## 7. When Ticket splitting starts

Splitting starts only after product behavior and required technical boundaries are closed. Solution Shaping is needed when the feature introduces an unresolved public interface, data owner, cross-Ticket schema, security boundary, recovery rule, or primary verification seam.

It is skipped when accepted code, ADRs, interfaces, ownership, and tests already contain the committed behavior. A performance or integration uncertainty gets one bounded Spike instead of a speculative architecture choice. Solution Shaping creates no application code and no Ticket.

The Delivery Spec then defines stable scenarios. Ticket generation proves scenario coverage and the walking skeleton before proposing the exact split and dependency graph for human approval.

## 8. When work reaches execution

Creating or reviewing an Issue does not start execution. The recommended graph path rereads the accepted source, effective policy, exact Ticket bodies, blockers, coverage, walking skeleton, and dependency order. One fresh reviewer returns `READY`, `SPLIT`, or `NEEDS_INFO`; an all-AGENT, blocker-free READY graph is compiled into one exact Controller Release Plan v2.

One human approval binds the Handoff fingerprint. Apply writes three private input files and prints—but does not run—the Controller `start` command with the approved config digest, Controller revision, and provenance digest; Tickets remain `needs-triage`. Legacy Herdr ready-label activation is an explicit compatibility choice. Controller completion, merge, Release Record, and Outcome are later and distinct facts.

## 9. Common mistakes

- asking the user to repeat facts already visible in code or tests;
- treating an administrator role in the UI as proof that administrators need the feature;
- treating existing technical capability as proof of product value;
- turning “bulk import” into a single design before distinguishing creation, migration, and synchronization;
- benchmarking a model before the alert-review task and important error are known;
- creating a new ADR when an accepted interface already closes the decision;
- letting separate Tickets choose incompatible schemas or ownership.

## 10. Pause and resume

Use `pi-ticket-plan -c` or `pi-ticket-plan -r` in the same repository. A status-only request shows what is confirmed and the single open decision without advancing. An active interview resumes at its first missing field; restore the original session when possible. An owner-confirmed redacted return block may resume the conversation, but it closes formal Evidence only under the existing formal contract.

If Git, Issue, ADR, or policy state changed while paused, the system rereads only the facts that can change the next gate.

## 11. Complete example to the next gate

```text
Input: “Add bulk import, but creation, migration, and sync are still mixed together.”
Repository facts: one-record creation and validation exist; no customer event establishes a bulk problem.
System: forms three candidates, recommends bounded bulk creation, and states the deferred costs.
Human: chooses bulk creation.
System: forms the smallest create-many loop and names the real repeated-entry task as the highest-risk hypothesis.
Evidence: one bounded method tests that task; code existence is not counted as customer Evidence.
Human gate: after readiness passes, the owner commits the exact Release.
Next gate: reuse accepted interfaces where sufficient; otherwise accept the minimum ADR, then compile the Delivery Spec.
```

The feature is not split into Tickets until the product behavior and any load-bearing technical decisions are accepted.

Maintainers can find the three live evaluation suites in [Development and release verification](../../README.md#development-and-release-verification).
