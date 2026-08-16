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

- For product work, plan only the next evidence-producing Release, never a complete product backlog. A decision-complete local change may instead use the one-ticket `QUICK` path.
- Treat conversation and summaries as leads, not facts. Verify live repository, tracker, and Harness state when they control the next gate.
- Keep product evidence, delivery progress, release state, and outcome separate.
- Never turn an assumption into a fact, simulate customer evidence, or close a blocking external unknown from model memory.
- Treat mutation approval as scoped. A human request to advance an exact target and Release automatically is standing approval for reversible planning mutations within the stated boundaries; do not re-ask per file, commit, or tracker write. Require new approval on target, source, scope, policy, or risk drift, and for remote publication unless the standing approval includes it.
- In an existing Git repository, treat a Release revision as authoritative only when its exact artifact blob is reachable from the accepted remote delivery base. A working-tree file, patch preview, or unpublished local commit is still a draft.
- Never enter `SPEC` before a human commits an exact Release revision.
- Never route the formal product path to `/skill:implement`. Admitted implementation tickets go to the configured Harness.
- Run only when invoked. `ask-yet` reconstructs current facts on demand; it is not a daemon and does not poll Harness.
- Continue through discoverable, reversible mechanical steps. Stop only for a non-delegable product decision, policy change, graph approval, Admission activation, an interview question awaiting a participant answer, forbidden operation, or material drift/failure.

## Choose the invocation mode

Infer one invocation mode; do not ask the human to choose it.

- `ORIENT`: no active Release is established, or the input needs classification.
- `ADVANCE`: progress the current stage to its next gate.
- `RESUME`: an authoritative Release artifact exists; inspect only its open blocker and facts added since its last durable record. Do not replay the full Release or prior checkpoint.
- `STATUS`: report current state without starting new discovery.

## Reconstruct the minimum true state

Read only facts that can change `planning_depth`, `control_mode`, `lane`, `stage`, `verdict`, `blocker`, or `next_action`, in this order:

1. The target and material explicitly supplied by the human.
2. The target repository identity, exact Git state, effective root policy, root README, and authoritative product entry points.
3. An active file under `docs/product/releases/`, if one exists.
4. Only the tracker, research, prototype, ADR, release, or Harness evidence needed for the current gate.
5. One human input that cannot be discovered and would change the next gate.

Do not scan the full issue graph or history during `ORIENT`. Read one obvious local fact directly. Use bounded multi-file retrieval only when necessary; keep product interpretation and conflicting-source decisions in the main context.

### Greenfield fallback

An empty directory, a non-Git directory, or an unborn Git repository is a valid `PRODUCT / ORIENT` starting point. Record absent code, commits, root policy, README, product entry points, and tracker support as absent facts, not blockers. If the human supplied a product intent, continue to `PRODUCT / FRAME` and ask at most one product question needed to identify the actor, trigger, observed problem, target outcome, or smallest closed loop.

During greenfield `FRAME` and `EVIDENCE`, do not initialize Git, bootstrap repository or tracker support, choose a stack or architecture, or create application code merely because those artifacts are absent. Repository bootstrap becomes eligible only after a human has `COMMITTED` an exact Release revision; apply it automatically only when standing approval covers the target operations.

## Choose planning depth and risk control

Infer both fields from current facts; never ask the human to choose them. Resolve an active incident first: current harm to users, data, or security routes to `INCIDENT` and stops ordinary planning.

First choose the planning depth:

1. `QUICK`: use only when one trusted, decision-complete source can become one durable `STANDALONE` candidate that already fits the `ticket-readiness` `READY` contract, with one primary outcome, one primary verification, and closed product and architecture decisions.
2. `STANDARD`: use when actor, trigger, current behavior, target behavior, and scope already have trusted support, so no new evidence action is needed, but the work needs a committed Release, Spec, or multiple tickets.
3. `DISCOVERY`: use for a new product, actor, core workflow, or any value or behavior unknown that can change what should be built. This is the safe default when the shorter path cannot be established from facts.

Then set `control_mode` to `CONTROLLED` when the change affects security, privacy, credentials, privilege, compliance, audit, destructive or hard-to-reverse data migration, a high-risk production cutover, enablement or rollback mechanics, irreversible external effects, or a broad blast radius; otherwise set it to `NORMAL`. Ordinary reversible deployment alone does not trigger `CONTROLLED`. Control mode adds only the applicable authority, protected-asset, verification, recovery, approval, staged-release, smoke, audit, and stop-condition gates. It does not force customer discovery or a multi-ticket Delivery Spec when the underlying behavior is already decision-complete.

Planning depth controls planning work; control mode controls risk gates. Neither grants mutation authority or replaces lane, stage, or verdict. Derive both again on every run. Increase depth on new behavioral uncertainty, add controls immediately on new risk, and remove either only when authoritative facts close the reason.

Use the shortest matching path:

- `QUICK`: trusted source -> one candidate through `triage` -> fresh readiness inside `admit-ticket` -> human activation confirmation. Create no Release artifact, Delivery Spec, Delivery Parent, or graph.
- `STANDARD`: one Release-lite revision -> human `COMMITTED` -> `to-spec` -> `to-tickets` -> `admit-ticket`. Release-lite reuses the one Release artifact and omits inapplicable evidence work; it is not a second artifact type.
- `DISCOVERY`: `FRAME -> EVIDENCE -> COMMIT -> SPEC -> TICKETS -> ADMISSION`.

When `control_mode` is `CONTROLLED`, start at the earliest unresolved gate of the selected planning depth and carry applicable controls through Admission and release. Thus a decision-complete one-ticket production change can remain `QUICK + CONTROLLED`, while an uncertain high-risk product change becomes `DISCOVERY + CONTROLLED`.

## Classify the lane

Choose exactly one:

- `PRODUCT`: a new product, uncertain feature, or bounded enhancement whose value or behavior still needs a decision.
- `DELIVERY`: an exact `COMMITTED` Release revision or another trusted, decision-complete delivery input exists.
- `TRIAGE`: an incoming issue, a previously committed behavior appears broken, or a decision-complete `QUICK` change can become one standalone candidate.
- `RISK`: maintenance, security, compliance, migration, or platform constraints drive the work.
- `INCIDENT`: users, data, security, or production are currently at risk.

Wayfinder is not a lane. Use it only when interdependent decisions cannot be reduced to one evidence action in one context.

## Route the current gate

### PRODUCT or OUTCOME

Read [references/release-loop.md](references/release-loop.md) in full before shaping, evaluating readiness, changing a Release revision, reviewing repository policy, or judging outcome.

For `STANDARD`, use the reference's Release-lite rule and consume existing evidence instead of manufacturing a new discovery action. For `DISCOVERY`, follow the full Release loop. A missing fact needed by the six readiness tests changes `STANDARD` to `DISCOVERY` rather than being filled from inference.

Progress only one stage:

1. `FRAME`: identify one actor, trigger, observed problem, target outcome, and smallest closed loop. Before the human selects a candidate, keep only the checkpoint in conversation. After selection, propose the one Release artifact and obtain or reuse scoped write approval. For an existing Git target, include the exact stage, commit, and permitted pre-delivery publication handoff needed to make that artifact durable; remain in `FRAME` until the accepted remote base contains the approved blob. Never route this publication through the implementation Harness, which starts only after Admission.
2. `EVIDENCE`: label claims, preserve the highest-risk unknown, and choose the cheapest bounded action that can change the Release decision. Design the protocol in conversation first. Fix appetite, pass/fail threshold, evidence to capture, and stop condition before requesting approval for the exact artifact revision. When that action is a customer interview and the human asks to start or the participant is present, read [references/interview-session.md](references/interview-session.md) in full and conduct it in this session: one question per turn, redacted capture, follow-up for the next missing field, then a recommended verdict. Stop after each question. Never invent an interviewee answer.
3. `COMMIT`: apply all six readiness tests. `READY_TO_COMMIT` requires a human choice of `COMMITTED | HOLD | REWORK | DROP`; never choose for them. In the same decision, recommend standing automatic advancement for reversible planning work or stepwise mode so this choice is asked once.
4. After `COMMITTED`, require a real delivery base containing the exact Release blob. If the target is non-Git, unborn, or missing delivery setup, load and follow the `setup-delivery-repository` helper. Once `HEAD` resolves, run the Repository Contract Impact Review from the reference. A required stable policy change remains a human decision; show its minimum diff once and stop. Never let setup choose implementation behavior.
5. `OUTCOME`: evaluate only after release evidence and the stated evidence window. Return an outcome verdict and a candidate next decision, never a ready implementation ticket.

During `FRAME` and `EVIDENCE`:

- Treat repository roles, RBAC names, UI personas, and issue labels as system facts, not customer-actor evidence. Keep actor and trigger `ASSUMPTION` or `UNKNOWN` until recent customer evidence establishes them.
- A solution preference may update `solution_hypothesis`; it cannot displace a higher-risk actor, workflow, or value unknown without new evidence. State the evidence whenever the riskiest assumption changes.
- While actor, workflow, or value remains blocking, keep AI and automation outside `smallest_closed_loop`, `primary_signal`, and the primary pass threshold. They may run as an isolated shadow only after the deterministic user loop is frozen.
- Router `stage` names the gate currently being worked. Artifact `product_stage` names the highest evidence state already achieved. After an approved Frame write is reread, route to `EVIDENCE` while the artifact remains `product_stage: FRAME`; protocol design alone does not advance product evidence.

For public facts, establish a Research Contract and inspect actual capabilities first. A discoverable skill is not proof that network, browser, source access, background agents, or writes are available. Use high-trust primary sources when reachable. If required sources are unreachable, keep `NEEDS_RESEARCH` and put `Reason: CAPABILITY_GAP` plus the reference's complete `Research Handoff` under `仍然缺少` (or its translation). Indent any continuation lines so the handoff remains content of that field, not a sixth top-level heading.

For customer behavior, produce a story-interview, task-observation, or controlled-Pilot protocol; never answer it on the customer's behalf. After the protocol is frozen, conduct a live interview in this session when the human starts it or the participant is present; follow [references/interview-session.md](references/interview-session.md). If an asynchronous questionnaire is the one next action because the participant cannot join this session, return an exact `/skill:to-questionnaire` command. For one UI, state, or logic question, follow the available `prototype` skill only after the artifact write is authorized. Use `grilling` or `domain-modeling` only inside the current product question, not as competing entry points.

If Wayfinder is genuinely required, return only the destination, why one context cannot resolve it, and an exact command:

```text
/skill:wayfinder <destination and decision boundary>
```

### DELIVERY

If admitted tickets, ready labels, a Harness claim or terminal record, accepted Git/PR facts, a Release Record, or outcome evidence exists, read [references/execution-closeout.md](references/execution-closeout.md) in full before resolving or changing execution, closeout, release, or outcome state.

Advance through these gates by loading and following the named model-invoked helper. Continue in the same run until that helper reaches a human gate:

1. If Git `HEAD` does not resolve or repository tracker support is missing, follow `setup-delivery-repository` with the target repository. For greenfield, also pin the exact COMMITTED Release artifact and revision; without them, return to `PRODUCT` instead of bootstrapping.
2. With an exact `COMMITTED` Release revision whose artifact blob is present in the accepted delivery base, and the repository contract ready, follow `to-spec` with the artifact path, revision, and base.
3. With an accepted Delivery Spec, follow `to-tickets` with its exact identity. Stop for the required split and graph approval before candidate publication.
4. After approved candidates are persisted, follow `admit-ticket` with the parent identity. Stop for the required activation confirmation after fresh review.
5. After Admission, report `ADMITTED` with the exact ticket, graph, base, source, policy, and execution lane. Any candidate or graph edit requires Admission again.
6. After activation, use the execution-closeout reference to resolve `HANDOFF_READY | IN_PROGRESS | BLOCKED | DELIVERED`; do not infer Harness state from tracker or PR state.

### TRIAGE

For `QUICK`, load and follow `triage` with the exact trusted source. The candidate must persist the complete standalone implementation contract before Admission; conversation may authorize or orient the change but cannot remain its only durable specification. If one `READY` candidate cannot express the work, increase planning depth to `STANDARD` or `DISCOVERY` before any ready-label change. `CONTROLLED` remains a risk overlay rather than a fallback planning depth.

If the symptom is not yet a confirmed bug, obtain the smallest reproduction or diagnosis signal. Then load and follow the `triage` helper with the exact issue and signal.

If the issue is actually a new outcome or behavior choice, return to `PRODUCT`. Do not use triage to bypass Commitment or Admission.

### RISK

When `control_mode` is `CONTROLLED`, read [references/release-loop.md](references/release-loop.md) in full. Fix the applicable authority, protected assets, verification, rollback or recovery, blast radius, manual approvals, staged release, smoke signal, and stop conditions. Then resume the selected planning depth: a standalone `QUICK` candidate uses the same transactional Admission without creating a Release or Spec solely because risk exists; `STANDARD` and `DISCOVERY` retain their normal Release/Spec gates. Every controlled path retains an explicit human production release gate. Never simplify away security, privacy, audit, migration, or recovery controls.

### INCIDENT

Stop ordinary planning. Preserve evidence and follow the repository's incident and recovery policy. Do not create a Release or implementation backlog while impact is active.

## Invocation rule

The human needs to remember only `/skill:ask-yet`. `setup-delivery-repository`, `triage`, `to-spec`, `to-tickets`, and `admit-ticket` are model-invoked helpers: read their `SKILL.md` when their gate matches and follow them in the current run. A human may still invoke one directly for recovery.

`wayfinder` and `to-questionnaire` remain separate human interactions. When either is genuinely required, print one exact command and stop.

Model-invoked helpers such as `research`, `prototype`, `grilling`, `domain-modeling`, and `diagnosing-bugs` may be followed only when their real tool and authorization requirements are satisfied.

## Response contract

Render one human status card with exactly five fields in this order, translated to the human's language. In Simplified Chinese, use these exact labels:

```text
当前目标：<one user-visible outcome>
已经确认：<only the few facts needed to trust the route>
仍然缺少：<one gate-critical fact, decision, approval, or 无>
为什么现在不能继续：<one plain-language blocker, or 没有阻塞>
你只需要决定：<one human action; then state what the system will do automatically>
```

Do not lead with repository, source boundary, planning depth, control mode, lane, stage, or verdict fields. Put relevant repository and source facts in `已经确认` in plain language. Explain the derived human-facing path exactly once as one sentence inside `已经确认`; do not expose `planning_depth`, `control_mode`, or rejected alternatives. In Simplified Chinese, use exactly `快速路径`, `标准路径`, or `完整发现路径` when control mode is normal, and `受控路径` whenever control mode is controlled. For an active incident, say that containment must finish before ordinary planning instead of assigning a path. Keep internal lane, stage, and verdict names out of the card.

Ask at most one question by default; group no more than three only when they are inseparable. For every human decision, give a recommendation, reason, tradeoff, and safest default inside the five fields. Put any exact command once in `你只需要决定`. If no human action is needed, say so and state what the system completed or will re-read on the next invocation. Keep each field concise; the complete indented Research Handoff is the only multiline exception. Do not add another top-level heading, roadmap, secondary action, or skill menu.

The machine source for lanes, stages, verdicts, legal stage transitions, required facts, and their trusted provenance is `contracts/workflow.json` plus `contracts/authority.json`. Before emitting a final Checkpoint or performing a state-bearing write, read those files from `$PI_TICKET_PLANNING_ROOT` and submit the current state, proposed state, and provenance-bearing facts to `workflow-contract.mjs --input -`. The model proposes the state; only an `allowed: true` result legalizes it. Prompt prose, conversation, or an invented fact source cannot add a state or transition.

The lane is one of `PRODUCT | DELIVERY | TRIAGE | RISK | INCIDENT`. End every response with one unfenced `Checkpoint` line as the final non-empty line. The identity field is exactly `NONE`, `<release-id>/<revision>`, or `<ticket-or-map-id>@<reviewed-revision>`; put draft, local, source, and status qualifiers in the card, never in that field.

```text
Checkpoint: <LANE>/<STAGE> · <authoritative work identity or NONE> · <allowed verdict>
```

Do not append anything after the checkpoint.
