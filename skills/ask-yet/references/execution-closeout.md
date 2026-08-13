# Execution and closeout contract

Use this reference only after Admission or when downstream execution, merge, release, or outcome facts already exist. `ask-yet` is invoked on demand; it never runs a planning daemon or duplicates Harness state.

## 1. Authority by fact

Resolve each fact from its owner. No source may overrule a fact outside its domain.

1. The exact Release artifact owns product intent, Commitment, evidence window, and minimum evidence.
2. Tracker bodies, relationships, labels, and comments own Spec, ticket graph, Admission activation, and planning closeout.
3. The Harness ledger or its durable operator projection owns selection, claim, run, review, recovery hold, and terminal execution state.
4. Accepted Git and PR state own the delivered source identity and merge fact.
5. The Release Record plus actual audience enablement, smoke evidence, and rollback state own release fact.
6. Signal evidence collected at or after the evidence window owns product outcome.

Read the smallest current slice needed from each applicable owner. A conversation, prior summary, PR alone, ready label alone, or Harness process presence cannot substitute for the owning source. If owning sources conflict or a required source is unavailable, report the exact conflict or missing evidence as `BLOCKED`; do not guess.

## 2. Resolve the current state

Use the first matching state whose required facts are established:

- `HANDOFF_READY`: Admission activation is durably confirmed and the exact ready labels/relationships are present, but Harness has no active claim. Harness may be offline; that is not a blocker and does not require a planning monitor.
- `IN_PROGRESS`: the Harness owner shows selected, claimed, running, or review-active work for the admitted ticket.
- `BLOCKED`: Harness shows an active recovery hold or terminal failure/cancellation, or required authoritative facts conflict or cannot be obtained.
- `DELIVERED`: Harness records successful terminal completion and the repository's required accepted Git/PR evidence identifies the delivered source. A merged PR without Harness terminal success is not enough; Harness terminal success without required accepted source evidence is not enough.

`DELIVERED`, `merged`, `released`, and `outcome achieved` are four different facts. Never promote one into another.

After delivery:

- Route to `PRODUCT / OUTCOME · AWAITING_EVIDENCE` only when a Release Record identifies the source and audience, the audience is actually enabled, and required smoke and rollback evidence exists.
- Before the evidence window, or while its minimum evidence is still accruing, remain `AWAITING_EVIDENCE`; this is not `UNEVALUABLE`.
- At or after the evidence window, use the Release signal, guardrail, and minimum evidence to choose `ACHIEVED | PARTIAL | NOT_ACHIEVED | UNEVALUABLE`.

## 3. Mutation ownership

Admission owns candidate, graph, relationship, and ready-label changes until activation. While Harness has an active claim or recovery hold, planning is read-only: do not edit the claimed ticket, graph, ready state, Harness ledger, branch, or PR. Report the exact Harness operator action required by its own policy.

Harness owns retry and recovery while work is active. A terminal failed or cancelled run records a delivery failure and stops this path. Do not create a corrective ticket, retry, re-admit, or rewrite scope automatically.

After all intended child tickets are terminal and no child is claimed or active, planning closeout may:

1. remove the delivery parent's ready label;
2. close the parent when repository policy and standing authority allow it; otherwise emit one consolidated exact human action;
3. record the delivered source and remaining release evidence in the Release artifact when the approved mutation scope covers it.

Closing a Delivery Parent means its intended engineering graph is terminal. It does not mean the Release is enabled or the product outcome succeeded.

## 4. Resume output

Compare current owned facts with the last durable Release, tracker, or Harness record. Report only the changed fact, current state, one next action, and one blocker. If no prior durable execution record exists, report the minimum current facts needed to establish the state. Do not repeat the entire Release, graph, ledger, or a large YAML status block.
