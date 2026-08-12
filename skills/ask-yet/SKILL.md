---
name: ask-yet
description: Enter or resume the product-to-outcome workflow, reconstruct the current gate from repository facts, and return one next action or explicit PI skill command.
disable-model-invocation: true
---

# Ask Yet

This is the single human entry point for product shaping and formal delivery. Route the work; do not copy or silently perform the jobs of downstream user-invoked skills.

The human invokes:

```text
/skill:ask-yet [optional idea, issue, release artifact, or current goal]
```

## Non-negotiable boundaries

- Plan only the next evidence-producing Release, never a complete product backlog.
- Treat conversation and summaries as leads, not facts. Verify live repository, tracker, and Harness state when they control the next gate.
- Keep product evidence, delivery progress, release state, and outcome separate.
- Never turn an assumption into a fact, simulate customer evidence, or close a blocking external unknown from model memory.
- Treat mutation approval as scoped: approval to discuss, design, review, continue, or accept content is not write approval. Name the exact target and operation; for a Release change also name the current and target revision, then wait for explicit approval covering that mutation.
- Never enter `SPEC` before a human commits an exact Release revision.
- Never route the formal product path to `/skill:implement`. Admitted implementation tickets go to the configured Harness.
- Stop once one next action or one non-delegable human input is known.

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

During greenfield `FRAME` and `EVIDENCE`, do not initialize Git, bootstrap repository or tracker support, choose a stack or architecture, or create application code merely because those artifacts are absent. Repository bootstrap becomes eligible only after a human has `COMMITTED` an exact Release revision; every write still requires explicit approval for its target and operation.

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

1. `FRAME`: identify one actor, trigger, observed problem, target outcome, and smallest closed loop. Before the human selects a candidate, keep only the checkpoint in conversation. After selection, propose the one Release artifact and obtain write approval before creating it.
2. `EVIDENCE`: label claims, preserve the highest-risk unknown, and choose the cheapest bounded action that can change the Release decision. Design the protocol in conversation first. Fix appetite, pass/fail threshold, evidence to capture, and stop condition before requesting approval for the exact artifact revision, and before running it.
3. `COMMIT`: apply all six readiness tests. `READY_TO_COMMIT` requires a human choice of `COMMITTED | HOLD | REWORK | DROP`; never choose for them.
4. After `COMMITTED`, require a real delivery base. If the target is non-Git or has an unborn `HEAD`, route first to `/skill:setup-matt-pocock-skills <target, Release artifact, and exact revision>`; Commitment authorizes only the displayed bootstrap plan, not implementation. Once `HEAD` resolves, run the Repository Contract Impact Review from the reference. If a new stable cross-ticket rule is required, show the effective policy path and minimal diff, then wait for approval and merge it into the target base before delivery depends on it.
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

Advance through these visible gates; do not invoke them silently:

1. If Git `HEAD` does not resolve or repository tracker support is missing, return `/skill:setup-matt-pocock-skills` with the target repository. For greenfield, also pin the exact COMMITTED Release artifact and revision; without them, return to `PRODUCT` instead of bootstrapping.
2. With an exact `COMMITTED` Release revision and repository contract ready, return `/skill:to-spec <release artifact path and revision>`.
3. With an accepted Delivery Spec, return `/skill:to-tickets <spec identity>`.
4. With a candidate ticket graph, return `/skill:admit-ticket <parent identity>`.
5. After Admission, report `ADMITTED` with the exact ticket, graph, base, source, policy, and execution lane. Any candidate or graph edit requires Admission again.

### TRIAGE

If the symptom is not yet a confirmed bug, obtain the smallest reproduction or diagnosis signal. Then return:

```text
/skill:triage <issue identity and verified signal>
```

If the issue is actually a new outcome or behavior choice, return to `PRODUCT`. Do not use triage to bypass Commitment or Admission.

### RISK

Fix the required verification, rollback, blast radius, manual approval, and stop conditions. Once decision-complete, use the same `SPEC -> TICKETS -> ADMISSION` gates. Never simplify away security, privacy, audit, migration, or recovery controls.

### INCIDENT

Stop ordinary planning. Preserve evidence and follow the repository's incident and recovery policy. Do not create a Release or implementation backlog while impact is active.

## Explicit command rule

The user-invoked skills `/skill:setup-matt-pocock-skills`, `/skill:wayfinder`, `/skill:to-questionnaire`, `/skill:triage`, `/skill:to-spec`, `/skill:to-tickets`, and `/skill:admit-ticket` require human invocation. When one is the next gate:

1. Name why it is now allowed.
2. Pin its authoritative input.
3. Print exactly one copyable command.
4. Stop.

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
| `SPEC` | `SPEC_COMMAND_READY`, `SPEC_ACCEPTED`, `BLOCKED` |
| `TICKETS` | `TICKETS_COMMAND_READY`, `TICKET_GRAPH_CANDIDATE`, `BLOCKED` |
| `ADMISSION` | `ADMISSION_COMMAND_READY`, `ADMITTED`, `BLOCKED` |
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
