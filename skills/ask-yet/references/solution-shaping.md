# Solution shaping contract

Use this reference only after an exact `COMMITTED` Release artifact is in an accepted remote delivery base. Close only the technical decisions the first Release needs before `to-spec`; do not create a workflow stage, public Skill, application scaffold, Delivery Spec, or Ticket.

## Contents

1. [Enter or skip](#1-enter-or-skip)
2. [Recover facts and separate unknowns](#2-recover-facts-and-separate-unknowns)
3. [Bound required-now decisions](#3-bound-required-now-decisions)
4. [Shape one minimum solution](#4-shape-one-minimum-solution)
5. [Assign decision authority](#5-assign-decision-authority)
6. [Check Technical Decision Sufficiency](#6-check-technical-decision-sufficiency)
7. [Persist decisions as ADRs](#7-persist-decisions-as-adrs)
8. [Respect Git and policy authority](#8-respect-git-and-policy-authority)
9. [Return to the delivery flow](#9-return-to-the-delivery-flow)

## 1. Enter or skip

Enter only when all three prerequisites hold:

1. A human has `COMMITTED` an exact Release revision.
2. That exact Release blob is reachable from the accepted remote delivery base; a local branch, unpublished commit, working tree, or draft ref is insufficient.
3. Git delivery setup exists and the current effective repository policy can be read from that base.

Otherwise return to the owning gate: unresolved product behavior returns to `PRODUCT`; missing Git or delivery setup returns to `setup-delivery-repository`; an unaccepted Release blob remains blocked before `SPEC`.

Require shaping when a fresh `to-spec` compiler would otherwise need to choose a load-bearing technical direction. Signals include:

- a greenfield repository with no executable application boundary;
- no stable primary behavioral seam for end-to-end verification;
- undecided state, data, or artifact ownership;
- undecided cross-scenario handoffs or shared schemas;
- a new public API, schema, event, or external integration;
- compatibility, migration, recovery, rollout, security, permission, privacy, or operations choices that affect Tickets;
- several Tickets that could make inconsistent versions of the same architecture decision; or
- an accepted architecture that cannot directly contain the committed behavior.

Skip shaping when accepted code, ADRs, policy, interfaces, and tests already close every applicable decision. Also skip it for:

- a decision-complete `QUICK` Ticket;
- a local implementation detail such as a file, function, class, or private helper name;
- a mechanical change that preserves existing boundaries;
- a normal addition inside an already accepted framework and interface;
- a future optimization, platform, integration, or reuse idea; or
- a feasibility question that needs measurement rather than an architecture choice.

For the last case, load [evidence-method-selection.md](evidence-method-selection.md) and select one bounded Technical Spike, benchmark, or canary. Keep `DELIVERY / SPEC` blocked until the result returns. When the protocol is shaped but not authorized or its target environment is absent, end with `DECISION` and directly ask the human to authorize it or provide that environment as the only question; a third-person handoff is not approval, and the response must not stop at the protocol text.

## 2. Recover facts and separate unknowns

Re-read, in this order:

1. the exact committed Release blob from the accepted base;
2. the effective repository policy from that base;
3. accepted ADRs and architecture facts from that base;
4. the smallest relevant README, code, configuration, tests, schemas, and runtime facts; and
5. supplied original constraint material whose identity and authority are known.

Preserve the Release ID, revision, actor, trigger, target outcome, smallest loop, included scenarios, primary signal, non-goals, appetite, and evidence window. If every viable technical direction changes any of those, stop and return to a new Product Frame or Commitment revision. If a direction merely exceeds the accepted appetite, return to Commitment instead of expanding delivery silently.

Classify each material input before recommending a solution:

- **Technical fact**: discoverable accepted code, configuration, runtime, interface, data owner, deployment, test, policy, ADR, or compatibility constraint. Read it directly; do not ask the human to repeat it.
- **Technical unknown**: a measurable fact such as target-hardware performance, model accuracy, integration stability, migration recovery, scale, network limits, or control feasibility. Route the single decision-changing unknown through Evidence Method Selection; do not infer it.
- **Architecture tradeoff**: a choice among viable boundaries, owners, interfaces, persistence, dependencies, recovery, or operating models. Shape alternatives only when their consequences materially differ.

A Technical Spike establishes only its frozen technical fact in its stated environment. It does not establish product value, select an architecture automatically, accept an ADR, or change the committed Release revision.

## 3. Bound required-now decisions

Treat a decision as `required_now` only when at least one condition holds:

- it changes user-observable behavior or the first Release's verification;
- it defines cross-Ticket state, data, artifact, interface, schema, or compatibility contracts;
- it assigns state or data ownership;
- it changes security, privacy, trust, migration, recovery, enablement, rollback, or operations boundaries;
- it introduces a material external dependency or operating burden;
- a fresh Worker cannot discover the answer from the accepted base; or
- deferral lets multiple Tickets make conflicting implementations.

Defer by default:

- internal names and directory layout;
- private helpers and replaceable libraries;
- optimization unrelated to the current Release;
- plugin systems, workflow engines, multi-tenant platforms, and speculative scale;
- adapters for unknown future integrations;
- abstractions without a second real consumer; and
- infrastructure unrelated to the primary verification seam.

If the decision cannot name the Ticket-level mistake that deferral would permit, keep it out of a load-bearing ADR. Record the deferral only when it bounds later work, and name the concrete condition that would reopen it.

## 4. Shape one minimum solution

Describe only:

```text
committed_behavior
delivery_constraints
existing_architecture
required_now_decisions
deferred_decisions
solution_boundary
state_and_data_ownership
interfaces_and_handoffs
verification_seam
failure_and_recovery
security_and_operations
decision_authority
```

Create two or three candidates only when two or more viable choices differ materially in boundary, ownership, interface, operating burden, failure recovery, compatibility, or first-Release verification. Do not manufacture simple/medium/complex variants. When accepted constraints yield one reasonable solution, recommend it directly and name the constraints that exclude the others.

For a greenfield minimum solution, explicitly state when accepted constraints rule out a database, service deployment, queue, or future platform so later Tickets do not reintroduce them.

Do not promote a deferred idea into a candidate. In particular, when the current Release has one entry point and no second real consumer, defer a reusable public library or API instead of offering it as an alternative.

Prefer, while preserving committed behavior:

- **Depth** — a small interface that hides meaningful current behavior and invariants instead of a shallow pass-through abstraction;
- **Locality** — the module or seam that keeps related change, knowledge, failure handling, and verification together instead of spreading them across callers;
- **Real seam** — an adapter seam only for a current variation, isolation, or verification need, never an imagined future implementation;
- **Deletion test** — if deleting the proposed module makes its complexity disappear instead of reappear in callers, treat that as evidence the abstraction does not earn its interface;
- **Interface as verification surface** — callers and the primary behavioral check use the same stable interface; routine private bypass is evidence that the seam is misplaced;
- the more reversible choice;
- consistency with accepted architecture;
- lower operating burden; and
- explicit failure and recovery behavior.

These are evaluation heuristics inside Solution Shaping, not additional gates, artifacts, fields, or required interfaces. Existing accepted architecture remains authoritative unless the committed Release requires a change.

Do not prefer novelty, distribution, services, events, plugins, AI, or theoretical extensibility by default. When a load-bearing human choice remains open, use the safe default: introduce no new persistence, external service, public interface, or production side effect; preserve the accepted behavior and fallback; remain `DELIVERY / SPEC` with `BLOCKED`.

For the recommended solution, state:

1. what system or module owns the first Release;
2. each load-bearing responsibility and its single owner;
3. what state, data, or artifacts are produced, owned, passed, and consumed, including an explicit no-persistence decision when applicable;
4. the minimum external inputs, cross-component handoffs, and terminal outputs;
5. one stable behavioral seam that proves the end-to-end Release, never lint, build, or full CI alone;
6. observable failures, retry, stop, fallback, and recovery behavior; and
7. applicable permission, privacy, credential, audit, runtime, cleanup, and operations boundaries.

Do not create source code, a package manifest, dependency installation, database, Dockerfile, CI, API implementation, page, or application scaffold. The first skeleton belongs to an accepted Spec and an admitted vertical Ticket or necessary ENABLER.

## 5. Assign decision authority

Require a named human authority unless accepted policy or an accepted ADR already decides:

- the primary greenfield language or runtime;
- deployment form;
- new persistent storage or data ownership;
- a new public API or schema;
- a new external SaaS or hosted dependency;
- permission, trust, retention, or privacy boundaries;
- an incompatible change or data migration;
- production enablement or rollback;
- long-term operating burden; or
- a dependency direction shared across Tickets.

Derive reversible local placement, an established framework pattern, fixture organization, or another choice uniquely implied by accepted repository conventions without asking again.

For a human choice, present the materially different options, one recommendation, its basis, main cost, safest default, decision owner, and exactly one current decision. Group choices only when they are inseparable as one boundary, such as “single local process with no persistence.” Confidence never substitutes for authority.

## 6. Check Technical Decision Sufficiency

Enter `to-spec` only when every applicable check passes:

1. **Source preserved** — the exact committed Release identity and behavior remain unchanged.
2. **Constraints known** — accepted runtime, compatibility, security, data, and operating constraints have been read; no unidentified hard constraint can change the recommendation.
3. **Minimal system boundary** — the first Release's owning system or module and each load-bearing responsibility have one owner.
4. **State and data ownership** — every persisted or transferred state, datum, and artifact has a producer, owner, and consumer; no-persistence is explicit when applicable.
5. **Interfaces and handoffs** — external inputs, cross-component handoffs, terminal outputs, and shared schemas are fixed enough that Tickets cannot invent competing contracts.
6. **Primary verification seam** — one stable behavioral interface proves the first end-to-end loop; support checks are not mistaken for the primary proof.
7. **Failure and recovery** — important failures are observable and retry, stop, fallback, rollback, or recovery behavior is bounded.
8. **Security and operations** — applicable permission, privacy, credentials, audit, runtime, cleanup, and operating constraints are closed.
9. **Required-now decisions closed** — every load-bearing cross-Ticket choice has an accepted source, so no Worker must make it.
10. **Deferred decisions bounded** — each deferral preserves first-Release behavior, interfaces, ownership, and verification, with a concrete reopening condition.

Passing means only that `to-spec` no longer has to guess a load-bearing technical decision. It does not accept a Delivery Spec, create Tickets, pass Admission, implement code, or publish a Release.

## 7. Persist decisions as ADRs

Reuse the repository's accepted ADR convention. If none exists but setup recorded `docs/adr`, use:

```text
docs/adr/<next-id>-<slug>.md
```

Normally create one bounded Solution ADR per Release. Split only when decisions have different owners, acceptance times, independent lifecycles, or replaceable system boundaries. Do not split mechanically by language, database, API, and test fields.

Adapt to the existing format. Otherwise use this minimum structure and omit empty inapplicable sections:

```markdown
# ADR-XXXX: <first-Release technical decision>

- Status: PROPOSED | ACCEPTED
- Date:
- Decision owner:
- Source Release: <release-id>/<revision>
- Accepted base: <base sha>

## Decision question
## Product behavior preserved
## Facts and constraints
## Options considered
## Decision
## System boundary and responsibilities
## State, data and handoffs
## Verification, failure and recovery
## Security and operations
## Deferred decisions
## Consequences
## Repository contract impact
```

Reference committed behavior rather than redefining or copying the Release. Record facts only from accepted or identified sources. Include only materially distinct options and their costs. Write no implementation checklist, per-file plan, Ticket, complete Spec, or hypothetical future platform.

## 8. Respect Git and policy authority

Treat conversation, previews, working-tree files, and unpublished commits as non-authoritative. Use this sequence:

1. Show the candidate ADR or minimum diff.
2. Obtain or reuse approval scoped to the exact target, decision, paths, and Git operations.
3. Write only the approved scope.
4. Optionally preserve the candidate on an approved remote draft ref.
5. Keep `to-spec` blocked while the ADR is only proposed, local, unpublished, or on the draft ref.
6. Put the accepted ADR into the accepted remote delivery base through the repository's authorized publication path.
7. Re-read the exact ADR blob from that base and verify its status, source Release, decision owner, and identity.
8. Re-resolve the base SHA, effective policy, and accepted ADR set.
9. Run the Repository Contract Impact Review from [release-loop.md](release-loop.md).
10. Enter `to-spec` only after that review closes.

Read the effective policy before shaping as a constraint. Re-run policy impact after accepting the technical decision because stable ownership, dependency, compatibility, security, side-effect, verification, rollback, or stop rules may now be visible. Keep Release-specific choices in the ADR; move only stable cross-Ticket rules that satisfy the release-loop policy test into repository policy.

Never let a candidate-branch ADR or policy govern the Worker that publishes its own prerequisite. Use the approved human-maintainer or configured pre-delivery publication path; the implementation Harness starts only after Admission.

## 9. Return to the delivery flow

Remain in the existing `DELIVERY / SPEC` stage:

- Use `SPEC_IN_PROGRESS` while the accepted source exists, shaping can continue through authorized reversible planning, and no new non-delegable human decision is currently required. An explicitly read-only run may still complete shaping and compile a read-only Spec draft; unavailable publication permission is not a technical-decision blocker.
- Use `BLOCKED` when a load-bearing human choice, Technical Spike, ADR acceptance, accepted-base publication, policy prerequisite, or conflict with committed behavior remains open.
- After all ten sufficiency checks pass from accepted sources, continue automatically to `to-spec` in the same run.

Use `DECISION` for one load-bearing human tradeoff, `REVIEW` for an exact ADR or policy mutation, and `RESULT` when accepted sources already close shaping and allow `to-spec` to continue. Say “确定第一版实现边界,” “哪部分负责什么,” “数据由谁保存和负责,” “各部分怎样交接,” “用什么方式证明第一版跑通,” “需要长期遵守的技术决定,” and “已接受的代码基线” by default. Do not expose an architecture questionnaire, an internal field table, `solution_shaping_required`, `required_now_decisions`, or `technical_decision_sufficiency` unless the human asks for diagnostic detail.

Ask no question when accepted constraints already imply the answer. When one human choice remains, ask only that decision and state what will continue automatically after acceptance.

When an accepted ADR lets shaping be skipped, name its exact ADR ID or path in the confirmed facts and the to-spec source. “An accepted ADR exists” is not a traceable identity.
