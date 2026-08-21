---
name: ask-yet
description: Enter or resume the product-to-outcome workflow, reconstruct the current gate from repository facts, and advance automatically until a real human decision boundary.
disable-model-invocation: true
---

# Ask Yet

This is the single human entry point for product shaping and formal delivery. Route each gate to its owner; do not copy the owner's contract here.

```text
/skill:ask-yet [optional idea, issue, release artifact, or current goal]
```

## Non-negotiable boundaries

- Plan only the next evidence-producing Release, never a complete product backlog. A decision-complete local change may use one `QUICK` Ticket.
- Treat conversation and summaries as leads, not facts. Verify live repository, tracker, and Harness state when they control the next gate.
- Keep product evidence, delivery progress, release state, and outcome separate. Never promote assumptions, model memory, or simulated customer evidence into facts.
- Treat mutation approval as scoped. Reuse standing approval only for the exact reversible planning scope it covers; require approval again on target, source, scope, policy, risk, or publication drift.
- An existing-Git Release is authoritative only when its exact blob is reachable from the accepted remote delivery base. A human-approved draft ref may preserve a candidate during `FRAME` or `EVIDENCE`, but cannot feed `to-spec`.
- Never enter `SPEC` before a human commits an exact Release revision, and never let downstream delivery choose a missing load-bearing architecture, data owner, shared interface, or verification boundary.
- Never route formal delivery to `/skill:implement`; admitted Tickets go to the configured Harness.
- Run only when invoked. Reconstruct current facts on demand; do not poll or duplicate Harness state.
- Continue through discoverable, reversible mechanics. Stop at a non-delegable decision, required approval, interview answer, forbidden operation, authoritative conflict, or material drift/failure.

## Enter and reconstruct

Infer one mode:

- `ORIENT`: no active Release is established or the input needs classification.
- `ADVANCE`: progress the current stage to its next gate.
- `RESUME`: an authoritative Release exists; inspect only its open blocker and facts added since its last durable record.
- `STATUS`: report current state without starting or advancing work.

An active Evidence method in the current PI session owns routing until closeout, cancellation, a safety stop, or material drift. Load that method's owner directly; do not repeat orientation or method selection. Participant answers are Evidence; pause, status, resume, cancellation, scoped approval, and factual redaction corrections are owner controls. Ask one speaker-identity question only when the speaker is genuinely ambiguous.

Read only facts that can change `planning_depth`, `control_mode`, `lane`, `stage`, `verdict`, `blocker`, or `next_action`, in this order:

1. Human-supplied target and material.
2. Target identity, exact Git state, effective root policy, root README, and authoritative product entry points.
3. The active `docs/product/releases/` file, when one exists.
4. Only the tracker, Evidence, ADR, Release, or Harness facts required by the current gate.
5. One undiscoverable human input that would change the next gate.

An empty directory, non-Git directory, or unborn repository is a valid `PRODUCT / ORIENT` start. Record absent code, Git, policy, and tracker facts as absent, not blocking. Before an exact Release is `COMMITTED`, do not bootstrap Git, tracker, stack, architecture, or application code.

## Classify the work

For vague intent, first separate confirmed facts, candidate interpretations, and decision-changing unknowns. Read the smallest relevant current-product facts, then form two or three materially different candidates labelled `A`, `B`, and optionally `C`. Use the human interface's compact decision form: recommend one from confirmed facts, state its main cost or deferral and safest default, and ask exactly one choice question naming the candidates. Candidate selection chooses what to investigate; it is not customer Evidence, Commitment, or implementation approval. While awaiting that choice, use `PRODUCT / FRAME · <identity or NONE> · FRAME_CANDIDATE`.

When the facts cannot support two real candidates, ask one recent-event question instead and use `PRODUCT / FRAME · <identity or NONE> · FRAME_CANDIDATE`, never `ORIENT / ROUTED`. Route the resulting selected direction to the Release loop for the authoritative Candidate Frame.

Infer planning depth:

- `QUICK`: one trusted, decision-complete source can become one durable standalone Ticket that already fits the readiness contract.
- `STANDARD`: trusted facts close product behavior, but the work needs a committed Release, Spec, or multiple Tickets.
- `DISCOVERY`: actor, workflow, value, or behavior remains decision-changing and needs Evidence. Use this when a shorter path is not established.

When reporting the inferred tier, name its durable next unit explicitly: `QUICK` means one standalone Ticket; `STANDARD` means one Release-lite revision and its human Commitment owner. Do not substitute a generic item or an unspecified human.

Set `control_mode` to `CONTROLLED` for security, privacy, credentials, privilege, compliance, destructive migration, high-risk production cutover, irreversible effects, or broad blast radius; otherwise use `NORMAL`. Control mode adds applicable risk gates without changing planning depth or granting authority.

Choose one lane:

- `PRODUCT`: product value or behavior still needs a decision.
- `DELIVERY`: an exact committed or otherwise trusted delivery source exists.
- `TRIAGE`: an issue, confirmed regression, or decision-complete standalone change needs classification.
- `RISK`: maintenance, security, compliance, migration, or platform constraints drive the work.
- `INCIDENT`: users, data, security, or production are currently at risk.

## Route the current gate

Load each named owner in full only when its gate applies:

| Gate or fact | Owner |
| --- | --- |
| Product framing, Release state, Commitment, controlled product gates, repository-contract review, or Outcome | [Release loop](references/release-loop.md) |
| One blocking fact before a Candidate Frame, Release decision, or post-Commitment technical decision | [Evidence method selection](references/evidence-method-selection.md) |
| A selected live interview starts, resumes, or receives an answer | [Interview session](references/interview-session.md) |
| A committed Release is on the accepted base but `to-spec` would need a load-bearing technical choice | [Solution shaping](references/solution-shaping.md) |
| Git, policy, tracker, or delivery setup is missing after Commitment | `setup-delivery-repository` |
| A `QUICK` source, incoming issue, or confirmed regression needs one candidate | `triage` |
| An accepted product source is ready for scenario compilation | `to-spec` |
| An accepted Delivery Spec is ready for candidate Tickets | `to-tickets` |
| Approved candidates need fresh review and transactional activation | `admit-ticket` |
| Admission, Harness, Git/PR, enablement, release, or post-window facts exist | [Execution and closeout](references/execution-closeout.md) |

For `RISK`, load the Release loop and retain every applicable control. For `INCIDENT`, stop ordinary planning and follow the repository's incident and recovery policy. Use Wayfinder only when interdependent decisions cannot be reduced to one decision-changing action; use `to-questionnaire` only when an asynchronous questionnaire is the selected next human interaction. Print the exact command and stop when either separate interaction is required.

The human needs to remember only `/skill:ask-yet`. The named package helpers are model-invoked and may be called directly only for recovery.

## Render and validate

Before every user-visible response, read [the human interface contract](references/human-interface.md) in full and apply its form-selection, direct-action, and first-use explanation rules. Use `STATUS` only when the human explicitly asks for state or recovery orientation; a completed read or closeout judgment uses `RESULT`. Preserve every identity, approval subject, limitation, safety control, and recovery boundary owned by the active gate.

The machine source for lanes, stages, verdicts, legal transitions, required facts, and provenance is `contracts/workflow.json` plus `contracts/authority.json`. Before a state-bearing write or final Checkpoint, read both from `$PI_TICKET_PLANNING_ROOT` and validate the current state, proposed state, and provenance-bearing facts with:

```sh
node "$PI_TICKET_PLANNING_ROOT/scripts/workflow-contract.mjs" --input -
```

Only `allowed: true` legalizes the proposal. On missing or conflicting authoritative facts, fail closed and report the conflict.

End every response with exactly one unfenced final non-empty line. The identity is `NONE`, `<release-id>/<revision>`, or `<ticket-or-map-id>@<reviewed-revision>`.

```text
Checkpoint: <LANE>/<STAGE> · <authoritative work identity or NONE> · <allowed verdict>
```

Append nothing after it.
