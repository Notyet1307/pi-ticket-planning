# Existing Issue: triage, shape, or admit it

English | [简体中文](existing-issue.zh-CN.md) · [Back to README](../../README.md)

## 1. Starting point

Use this path for a Bug, Enhancement, external pull request, existing candidate Ticket, or a request to make an Issue `ready-for-agent`. An Issue is an input, not proof that the work is decision-complete.

The system determines whether the report is a broken committed behavior, a new product behavior, a duplicate or rejected request, an already implemented change, or a delivery candidate. A direct activation request changes the requested destination, not the review gates.

## 2. What to say first

Reference a repository Issue directly:

```text
/skill:ask-yet owner/repo#39
```

Or state the desired judgment:

```text
/skill:ask-yet Tell me whether Issue #39 is ready for an agent.
```

```text
/skill:ask-yet This Bug is reproducible. Turn it into an executable Ticket.
```

```text
/skill:ask-yet Make this Issue ready-for-agent.
```

The last form still requires source checks, fresh review, an exact Admission Plan, and human confirmation.

## 3. What the system reads first

For the named target, the system reads the accessible Issue body, comments, labels, linked decisions, and only the repository facts needed for the current gate. It checks:

- whether the current behavior can be reproduced for a Bug;
- whether the behavior is already implemented;
- nearby duplicate requests and accepted rejections;
- accepted product and architecture decisions;
- the relevant code, tests, interfaces, and policy;
- whether the report describes one independent outcome and one primary verification.

An external pull request is also checked against the accepted behavior and source decision; existing code does not make an unapproved behavior valid.

## 4. How the system may reply

There are three common results.

**One Ticket:** current behavior, target behavior, verification, architecture, and risk are already decided.

```text
triage
→ durable standalone candidate under needs-triage
→ fresh readiness review
→ exact Admission Plan
→ human confirmation
→ ready label
```

**More shaping:** the Issue contains a new user result, multiple behaviors, or an open product or architecture decision. The system returns a Candidate Frame, Release, or Delivery Spec boundary instead of sending ambiguity to a Worker.

**More information:** the reply names confirmed facts, one critical gap, who owns its answer, and what resumes after it is supplied.

## 5. Decisions you need to make

For a Bug, you confirm any product interpretation not established by the accepted behavior and decide risk or rollout tradeoffs. For an Enhancement or external PR, you decide whether the proposed user behavior is wanted; code existence is not approval. For a multi-behavior Issue, you approve the product boundary before Ticket splitting.

For a candidate that passes review, you still confirm the exact Admission Plan fingerprint. `READY` is a review verdict, not mutation authority. A general “continue” and the phrase “make it ready” do not approve an unknown future snapshot.

## 6. Durable artifacts

A read-only triage creates nothing. When publication is approved, a standalone candidate or child Ticket begins as `needs-triage` and records its starting state, one outcome, primary verification, invariants, accepted decision sources, blockers, execution lane, and out of scope.

If the Issue needs product shaping, its Candidate Frame, Release, accepted ADR, Delivery Spec, and Ticket graph are kept as separate traceable artifacts. Admission records the confirmed Plan fingerprint in an idempotent comment and writes the controlled ready label only after all checks pass.

## 7. When Ticket splitting starts

A single Bug fix or wording correction stays one Ticket when it has one outcome, one verification, and no open product or architecture decision. Split only when the Issue contains independently deliverable outcomes, explicit handoffs, or dependencies that need separate verification.

For a split, the system first compiles stable Spec scenarios, then proves every scenario has direct coverage and identifies the earliest walking skeleton. It presents the exact child order, blockers, bodies, and write set for human approval. A partial or cyclic graph is not published as ready.

## 8. When work reaches the Harness

Admission cannot be bypassed. It checks the exact source and policy, current Issue body, controlled labels, blockers, graph when present, fresh readiness verdict, and operator-provided Harness compatibility assertion when applicable. A changed Issue or graph requires a new review and Plan.

Only `admit apply` owns ready-label writes. The final ready label plus Admission comment is the configured Harness handoff. The meanings remain distinct:

- `needs-triage`: candidate, not claimable;
- reviewer `READY`: review passed, human confirmation still required;
- `ready-for-agent`: the Harness may claim it;
- Harness completed: execution lifecycle ended, not necessarily accepted or released;
- merged: code entered a branch, not necessarily enabled;
- released: behavior was enabled and recorded, not necessarily effective;
- Outcome achieved: post-release Evidence met the accepted result rule.

## 9. Common mistakes

- treating an Issue title as a complete behavior contract;
- skipping reproduction because the report says “Bug”;
- treating an external pull request as product approval;
- assuming an existing candidate Ticket already passed fresh review;
- adding `ready-for-agent` directly after a reviewer says `READY`;
- forcing several behaviors into one Ticket to avoid a graph;
- equating merge, release, and Outcome.

## 10. Pause and resume

Use `pi-ticket-plan -c` or `pi-ticket-plan -r` from the same repository. On resume, the system rereads the named Issue, source, policy, review revision, and controlled labels when they can change the gate. It does not trust an old summary over current tracker or Git state.

If an Admission Plan is `PARTIAL`, resume only with the same Plan and fingerprint after rereading. If it is `CONFLICT`, build a fresh bundle, review, and Plan; do not force the old activation.

## 11. Complete example to the next gate

```text
Input: “This status command should print `Ready`, not `Ready.`; the accepted behavior and test seam are already in the repository.”
System: verifies the trusted behavior source, current output, one-file scope, primary string assertion, and absence of open product or architecture choices.
Result: one durable standalone candidate under needs-triage; no Release artifact or multi-Ticket Spec is needed.
Fresh review: checks starting state, exact outcome, verification, invariants, risk, and policy.
Human gate: confirms the exact Admission Plan fingerprint.
Next gate: Admission writes ready-for-agent; only then may the Harness claim the Ticket.
```

If the same Issue instead introduces a new user workflow or several undecided behaviors, the next gate is product or technical shaping, not Admission.

Maintainers can find the three live evaluation suites in [Development and release verification](../../README.md#development-and-release-verification).
