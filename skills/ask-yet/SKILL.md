---
name: ask-yet
description: Enter or resume the product-to-outcome workflow, reconstruct the current gate from repository facts, and advance automatically until a real human decision boundary.
disable-model-invocation: true
---

# Ask Yet

This is the single human entry point for product shaping and formal delivery. Route the work by loading the matching downstream helper; do not copy its contract into this Skill.

The human invokes:

```text
/skill:ask-yet [optional idea, issue, release artifact, or current goal]
```

## Non-negotiable boundaries

- Plan only the next evidence-producing Release, never a complete product backlog.
- Treat conversation and summaries as leads, not facts. Verify live repository, tracker, and Harness state when they control the next gate.
- Keep product evidence, delivery progress, release state, and outcome separate.
- Never turn an assumption into a fact, simulate customer evidence, or close a blocking external unknown from model memory.
- Treat mutation approval as scoped. A human request to advance an exact target and Release automatically is standing approval for reversible planning mutations within the stated boundaries; do not re-ask per file, commit, or tracker write. Require new approval on target, source, scope, policy, or risk drift, and for remote publication unless the standing approval includes it.
- In an existing Git repository, treat a Release revision as authoritative only when its exact artifact blob is reachable from the accepted remote delivery base. A working-tree file, patch preview, or unpublished local commit is still a draft.
- Never enter `SPEC` before a human commits an exact Release revision.
- Never route the formal product path to `/skill:implement`. Admitted implementation tickets go to the configured Harness.
- Continue through discoverable, reversible mechanical steps. Stop only for a non-delegable product decision, policy change, graph approval, Admission activation, forbidden operation, or material drift/failure.

## Choose the run mode

Infer one mode; do not ask the human to choose it.

- `ORIENT`: no active Release is established, or the input needs classification.
- `ADVANCE`: progress the current stage to its next gate.
- `RESUME`: an authoritative Release artifact exists; inspect only its open blocker and facts added since its recorded revision.
- `STATUS`: report current state without starting new discovery.

## Reconstruct the minimum true state

Read only facts that can change `lane`, `stage`, `verdict`, `blocker`, or `next_action`, in this order:

1. The target and material explicitly supplied by the human.
2. The target repository identity, exact Git state, effective root policy, root README, and authoritative product entry points.
3. An active file under `docs/product/releases/`, if one exists.
4. Only the tracker, research, prototype, ADR, release, or Harness evidence needed for the current gate.
5. One human input that cannot be discovered and would change the next gate.

Do not scan the full issue graph or history during `ORIENT`. Read one obvious local fact directly. Use bounded multi-file retrieval only when necessary; keep product interpretation and conflicting-source decisions in the main context.

### Greenfield fallback

An empty directory, a non-Git directory, or an unborn Git repository is a valid `PRODUCT / ORIENT` starting point. Record absent code, commits, root policy, README, product entry points, and tracker support as absent facts, not blockers. If the human supplied a product intent, continue to `PRODUCT / FRAME` and ask at most one product question needed to identify the actor, trigger, observed problem, target outcome, or smallest closed loop.

During greenfield `FRAME` and `EVIDENCE`, do not initialize Git, bootstrap repository or tracker support, choose a stack or architecture, or create application code merely because those artifacts are absent. Repository bootstrap becomes eligible only after a human has `COMMITTED` an exact Release revision; apply it automatically only when standing approval covers the target operations.

## Classify the lane

Choose exactly one:

- `PRODUCT`: a new product, uncertain feature, or bounded enhancement whose value or behavior still needs a decision.
- `DELIVERY`: an exact `COMMITTED` Release revision or another trusted, decision-complete delivery input exists.
- `TRIAGE`: an incoming issue or a previously committed behavior appears broken.
- `RISK`: maintenance, security, compliance, migration, or platform constraints drive the work.
- `INCIDENT`: users, data, security, or production are currently at risk.

Wayfinder is not a lane. Use it only when interdependent decisions cannot be reduced to one evidence action in one context.

## Route the current gate

### PRODUCT or OUTCOME

Read [references/release-loop.md](references/release-loop.md) in full before shaping, evaluating readiness, changing a Release revision, reviewing repository policy, or judging outcome.

Progress only one stage:

1. `FRAME`: identify one actor, trigger, observed problem, target outcome, and smallest closed loop. Before the human selects a candidate, keep only the checkpoint in conversation. After selection, propose the one Release artifact and obtain or reuse scoped write approval. For an existing Git target, include the exact stage, commit, and permitted pre-delivery publication handoff needed to make that artifact durable; remain in `FRAME` until the accepted remote base contains the approved blob. Never route this publication through the implementation Harness, which starts only after Admission.
2. `EVIDENCE`: label claims, preserve the highest-risk unknown, and choose the cheapest bounded action that can change the Release decision. Design the protocol in conversation first. Fix appetite, pass/fail threshold, evidence to capture, and stop condition before requesting approval for the exact artifact revision, and before running it.
3. `COMMIT`: apply all six readiness tests. `READY_TO_COMMIT` requires a human choice of `COMMITTED | HOLD | REWORK | DROP`; never choose for them. In the same decision, recommend standing automatic advancement for reversible planning work or stepwise mode so this choice is asked once.
4. After `COMMITTED`, require a real delivery base containing the exact Release blob. If the target is non-Git, unborn, or missing delivery setup, load and follow the `setup-matt-pocock-skills` helper. Once `HEAD` resolves, run the Repository Contract Impact Review from the reference. A required stable policy change remains a human decision; show its minimum diff once and stop. Never let setup choose implementation behavior.
5. `OUTCOME`: evaluate only after release evidence and the stated evidence window. Return an outcome verdict and a candidate next decision, never a ready implementation ticket.

During `FRAME` and `EVIDENCE`:

- Treat repository roles, RBAC names, UI personas, and issue labels as system facts, not customer-actor evidence. Keep actor and trigger `ASSUMPTION` or `UNKNOWN` until recent customer evidence establishes them.
- A solution preference may update `solution_hypothesis`; it cannot displace a higher-risk actor, workflow, or value unknown without new evidence. State the evidence whenever the riskiest assumption changes.
- While actor, workflow, or value remains blocking, keep AI and automation outside `smallest_closed_loop`, `primary_signal`, and the primary pass threshold. They may run as an isolated shadow only after the deterministic user loop is frozen.
- Router `stage` names the gate currently being worked. Artifact `product_stage` names the highest evidence state already achieved. After an approved Frame write is reread, route to `EVIDENCE` while the artifact remains `product_stage: FRAME`; protocol design alone does not advance product evidence.

For public facts, establish a Research Contract and inspect actual capabilities first. A discoverable skill is not proof that network, browser, source access, background agents, or writes are available. Use high-trust primary sources when reachable. If they are not reachable, keep `NEEDS_RESEARCH` and emit the reference's Research Handoff.

For customer behavior, produce a story-interview, task-observation, or controlled-Pilot protocol; never answer it on the customer's behalf. If an asynchronous questionnaire is the one next action, return an exact `/skill:to-questionnaire` command. For one UI, state, or logic question, follow the available `prototype` skill only after the artifact write is authorized. Use `grilling` or `domain-modeling` only inside the current product question, not as competing entry points.

If Wayfinder is genuinely required, return only the destination, why one context cannot resolve it, and an exact command:

```text
/skill:wayfinder <destination and decision boundary>
```

### DELIVERY

Advance through these gates by loading and following the named model-invoked helper. Continue in the same run until that helper reaches a human gate:

1. If Git `HEAD` does not resolve or repository tracker support is missing, follow `setup-matt-pocock-skills` with the target repository. For greenfield, also pin the exact COMMITTED Release artifact and revision; without them, return to `PRODUCT` instead of bootstrapping.
2. With an exact `COMMITTED` Release revision whose artifact blob is present in the accepted delivery base, and the repository contract ready, follow `to-spec` with the artifact path, revision, and base.
3. With an accepted Delivery Spec, follow `to-tickets` with its exact identity. Stop for the required split and graph approval before candidate publication.
4. After approved candidates are persisted, follow `admit-ticket` with the parent identity. Stop for the required activation confirmation after fresh review.
5. After Admission, report `ADMITTED` with the exact ticket, graph, base, source, policy, and execution lane. Any candidate or graph edit requires Admission again.

### TRIAGE

If the symptom is not yet a confirmed bug, obtain the smallest reproduction or diagnosis signal. Then load and follow the `triage` helper with the exact issue and signal.

If the issue is actually a new outcome or behavior choice, return to `PRODUCT`. Do not use triage to bypass Commitment or Admission.

### RISK

Fix the required verification, rollback, blast radius, manual approval, and stop conditions. Once decision-complete, use the same `SPEC -> TICKETS -> ADMISSION` gates. Never simplify away security, privacy, audit, migration, or recovery controls.

### INCIDENT

Stop ordinary planning. Preserve evidence and follow the repository's incident and recovery policy. Do not create a Release or implementation backlog while impact is active.

## Invocation rule

The human needs to remember only `/skill:ask-yet`. `setup-matt-pocock-skills`, `triage`, `to-spec`, `to-tickets`, and `admit-ticket` are model-invoked helpers: read their `SKILL.md` when their gate matches and follow them in the current run. A human may still invoke one directly for recovery.

`wayfinder` and `to-questionnaire` remain separate human interactions. When either is genuinely required, print one exact command and stop.

Model-invoked helpers such as `research`, `prototype`, `grilling`, `domain-modeling`, and `diagnosing-bugs` may be followed only when their real tool and authorization requirements are satisfied.

## Response contract

Lead with the inferred repository, lane, stage, and source boundary. Ask at most one question by default; group no more than three only when they are inseparable. For every human decision, give a recommendation, reason, tradeoff, and safest default. Keep proof and explanation in the body; do not repeat them in the footer.

Use only these stage verdicts:

| Stage | Verdict |
|---|---|
| `ORIENT` | `NEEDS_TARGET`, `ROUTED` |
| `FRAME` | `FRAME_CANDIDATE`, `FRAME_WRITE_AWAITING_APPROVAL` |
| `EVIDENCE` | `EVIDENCE_ACTION_NEEDED`, `EVIDENCE_WRITE_AWAITING_APPROVAL`, `EVIDENCE_DESIGNED_NOT_AUTHORIZED`, `EVIDENCE_AUTHORIZED`, `EVIDENCE_RECORDED` |
| `COMMIT` | `NOT_READY`, `READY_TO_COMMIT`, `COMMITTED`, `HOLD`, `REWORK`, `DROP` |
| `SPEC` | `SPEC_IN_PROGRESS`, `SPEC_ACCEPTED`, `BLOCKED` |
| `TICKETS` | `TICKET_GRAPH_CANDIDATE`, `TICKETS_ACCEPTED`, `BLOCKED` |
| `ADMISSION` | `REVIEW_IN_PROGRESS`, `ACTIVATION_AWAITING_CONFIRMATION`, `ADMITTED`, `BLOCKED` |
| `EXECUTION` | `HANDOFF_READY`, `IN_PROGRESS`, `BLOCKED`, `DELIVERED` |
| `OUTCOME` | `ACHIEVED`, `PARTIAL`, `NOT_ACHIEVED`, `UNEVALUABLE` |

The lane is one of `PRODUCT | DELIVERY | TRIAGE | RISK | INCIDENT`. End every response with exactly four short, unfenced lines; keep each under 120 characters and put any exact command once in the body:

```text
Checkpoint: <LANE>/<STAGE> · <release id and revision or NONE> · <allowed verdict>
Next: <one smallest action>
Need: <one exact evidence, decision, approval, or NONE>
Blocked: <next forbidden gate or NONE>
```

Do not append a roadmap, secondary actions, or alternative skill menu after the checkpoint.
