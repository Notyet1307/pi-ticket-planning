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
- In an existing Git repository, treat a Release revision as authoritative only when its exact artifact blob is reachable from the accepted remote delivery base. A human-approved remote draft ref may preserve an exact candidate commit and blob for `FRAME` and `EVIDENCE`, but it cannot feed `to-spec`.
- Never enter `SPEC` before a human commits an exact Release revision.
- Never let `to-spec`, a Ticket, or a Worker choose a load-bearing architecture, data owner, shared interface, or verification boundary missing from the accepted base.
- Never route the formal product path to `/skill:implement`. Admitted implementation tickets go to the configured Harness.
- Run only when invoked. `ask-yet` reconstructs current facts on demand; it is not a daemon and does not poll Harness.
- Continue through discoverable, reversible mechanical steps. Stop only for a non-delegable product decision, policy change, graph approval, Admission activation, an interview question awaiting a participant answer, forbidden operation, or material drift/failure.

## Choose the invocation mode

Infer one invocation mode; do not ask the human to choose it.

- `ORIENT`: no active Release is established, or the input needs classification.
- `ADVANCE`: progress the current stage to its next gate.
- `RESUME`: an authoritative Release artifact exists; inspect only its open blocker and facts added since its last durable record. Do not replay the full Release or prior checkpoint.
- `STATUS`: report current state without starting new discovery.

An active Evidence session in the current PI session owns routing before these modes are reconsidered. Use the latest participant or owner message with the already selected method and load its owning reference directly; do not replay `ORIENT`, rescan the repository or Issue graph, choose planning depth again, rerun Candidate-first, or compare Evidence methods again. Return to normal routing only after closeout, a safety stop, owner cancellation, or material drift invalidates the method.

Within an active interview, participant answers and owner controls are different inputs. Pause, status, resume, scoped write approval, factual correction of a redacted capture, and cancellation are owner controls, not participant Evidence. Ask one identity clarification and record no Evidence only when an active interview turn or explicitly attributed participant answer has a genuinely ambiguous speaker. A plain `继续` or ordinary product-shaping reply outside an active interview remains owner input; do not start consent or identity clarification merely because no speaker prefix exists. Ordinary users do not need a fixed prefix; a test or facilitated session may use `参与者：` and `产品负责人：` to remove ambiguity.

## Reconstruct the minimum true state

Read only facts that can change `planning_depth`, `control_mode`, `lane`, `stage`, `verdict`, `blocker`, or `next_action`, in this order:

1. The target and material explicitly supplied by the human.
2. The target repository identity, exact Git state, effective root policy, root README, and authoritative product entry points.
3. An active file under `docs/product/releases/`, if one exists.
4. Only the tracker, research, prototype, ADR, release, or Harness evidence needed for the current gate.
5. One human input that cannot be discovered and would change the next gate.

Do not scan the full issue graph or history during `ORIENT`. Read one obvious local fact directly. Use bounded multi-file retrieval only when necessary; keep product interpretation and conflicting-source decisions in the main context.

### Greenfield fallback

An empty directory, a non-Git directory, or an unborn Git repository is a valid `PRODUCT / ORIENT` starting point. Record absent code, commits, root policy, README, product entry points, and tracker support as absent facts, not blockers. If the human supplied a product intent, continue to `PRODUCT / FRAME` and use the candidate-first framing below.

During greenfield `FRAME` and `EVIDENCE`, do not initialize Git, bootstrap repository or tracker support, choose a stack or architecture, or create application code merely because those artifacts are absent. Repository bootstrap becomes eligible only after a human has `COMMITTED` an exact Release revision; apply it automatically only when standing approval covers the target operations.

## Shape vague intent candidate-first

During `ORIENT` or `FRAME`, when the input is not decision-complete, do this before asking a product question:

1. Separate **confirmed facts**, **candidate interpretations**, and **remaining unknowns**. Confirmed facts come only from the human's words or a live first-party source. Mark every candidate as an assumption. Keep only unknowns that can change the product outcome, scope, or verification.
2. For an existing product, inspect the smallest relevant set of README material, current product entry points, domain vocabulary, related interfaces or state, ADRs, and the nearest Issue or existing behavior. Resolve discoverable product and technical facts yourself. Return only recent customer experience, priority, business tradeoffs, and risk acceptance to the human.
3. When the evidence supports them, form two or three candidates with materially different product outcomes or work types. Label them `A`, `B`, and optionally `C`; use the human interface's compact `DECISION` form; recommend one from the confirmed facts; state its main tradeoff and what it defers; give the safest default. Use the narrowest reversible candidate as the default for further framing; use no action only when every candidate crosses an open evidence or risk boundary. The default never authorizes implementation. Ask exactly one easy choice question: which candidate is closer? Accept a letter or a correction. After the answer, automatically derive the first end-to-end flow and the next validation need.
4. If the input cannot support two real candidates, do not pad the list. Ask one concrete recent-event question in ordinary language and include one answer example: who was doing what, and which step failed or was omitted? While awaiting that answer, use `PRODUCT / FRAME · <identity or NONE> · FRAME_CANDIDATE`, not `ORIENT / ROUTED`. After the answer, derive the candidates and first flow automatically.

A selected candidate is a human-confirmed direction, not customer `FACT`, product Evidence, or `COMMITTED`. While awaiting the answer, use the existing `FRAME_CANDIDATE` verdict with the applicable identity after workflow-contract validation. Stay in `PRODUCT / FRAME`; do not create a Release artifact, Spec, Tickets, or Admission state until their existing gates are satisfied. Never expose `actor_and_trigger`, `current_workflow`, `smallest_closed_loop`, or other internal field names as a questionnaire.

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
- `STANDARD`: one Release-lite revision -> human `COMMITTED` -> repository setup and technical-boundary check -> `to-spec` -> `to-tickets` -> `admit-ticket`. Release-lite reuses the one Release artifact and omits inapplicable evidence work; it is not a second artifact type.
- `DISCOVERY`: `FRAME -> EVIDENCE -> COMMIT -> SPEC -> TICKETS -> ADMISSION`.

A Release decision is scoped to one stable Release ID, not the repository. When the human supplies a distinct outcome while another Release is `HOLD`, `REWORK`, or `DROP`, classify it independently; if the new outcome is the minimum surface needed to make missing evidence observable, follow the reference's **Evidence-enabling surface** rule before choosing `QUICK`, `STANDARD`, or `DISCOVERY`.

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

When `ORIENT`, `FRAME`, or `EVIDENCE` has one blocking unknown to close, read [references/evidence-method-selection.md](references/evidence-method-selection.md) in full before selecting a method or asking the human. A direct repository or runtime read counts as a method even when it closes the fact immediately. The reference distinguishes evidence-discoverable facts from non-delegable choices, identifies the truth owner, selects one valid bounded action, states what it cannot establish, and returns the result to the Release loop. Do not ask the human to choose a method name.

After an exact `COMMITTED` Release blob reaches an accepted remote delivery base, read [references/solution-shaping.md](references/solution-shaping.md) in full before `to-spec` when accepted code, ADRs, policy, and interfaces do not already close the first Release's load-bearing technical decisions. Keep this internal to `DELIVERY / SPEC`: route a decision-changing technical unknown through Evidence Method Selection, request only one non-delegable architecture choice, require any Solution ADR from the accepted base, and continue automatically to `to-spec` after Technical Decision Sufficiency passes.

For `STANDARD`, use the reference's Release-lite rule and consume existing evidence instead of manufacturing a new discovery action. For `DISCOVERY`, follow the full Release loop. A missing fact needed by the six readiness tests changes `STANDARD` to `DISCOVERY` rather than being filled from inference.

Progress only one stage:

1. `FRAME`: use candidate-first framing when the intent is vague. Before the human selects a candidate, keep the candidate framing and checkpoint in conversation and create no product file. Before or after selection, when interview is the chosen method because the real actor, trigger, workflow, alternative, failure, consequence, or completion signal is unknown, and the human starts it or a participant is present, load [references/interview-session.md](references/interview-session.md), infer exploration, and begin with consent even if no Candidate Frame file exists. Keep a legal `FRAME_CANDIDATE` or `FRAME_WRITE_AWAITING_APPROVAL` verdict; express session progress through the human interface. After the human selects or corrects a candidate, apply the reference's Candidate Frame Sufficiency rule: compile their ordinary wording and the minimum relevant repository facts into one falsifiable Frame, label inferred actor, trigger, problem, outcome, and smallest-loop claims without promoting them to facts, exclude adjacent directions, and name one riskiest assumption plus one bounded next Evidence question. If the Frame is sufficient, do not ask the human to fill product fields; ask one ordinary-language question only when no coherent Frame can be drafted. Otherwise propose the one Release artifact and obtain or reuse scoped write approval. For an existing Git target, include the exact stage, commit, and human-approved remote draft ref needed to preserve that artifact; after its exact commit and blob are re-read from that ref, continue to `EVIDENCE`. The artifact remains `product_stage: FRAME`; the candidate cannot enter `SPEC` until the human has `COMMITTED` it and the exact blob is in the accepted remote base. Never route draft or accepted-base publication through the implementation Harness, which starts only after Admission.
2. `EVIDENCE`: label claims, preserve the highest-risk unknown, and choose the cheapest bounded action that can change the Release decision. Design the applicable guide or protocol in conversation first. For interview, infer exploration when discovering real workflow facts and validation only when testing one hypothesis whose participant scope, questions, capture, appetite, and pass/fail or stop thresholds were fixed before answers; never ask the human to select the purpose. When the human starts or a participant is present, read [references/interview-session.md](references/interview-session.md) in full and conduct the session one question per turn. If validation was requested without its frozen contract, explain why it cannot count as validation and default to exploratory, informal consent unless the human insists on protocol design first. Keep redacted capture and stop after each question. Never invent an interviewee answer.
3. `COMMIT`: apply all six readiness tests. Only six `PASS` results permit `COMMITTED` and yield `READY_TO_COMMIT`. The human may instead choose `HOLD`, `REWORK`, or `DROP` even when readiness fails: `HOLD` pauses all evidence and delivery work for that Release until one recorded reopen condition occurs; `REWORK` keeps exactly one named evidence or scope action active; `DROP` stops the Release. Persist the exact human decision before emitting its verdict, and never choose for them. For `COMMITTED`, recommend standing automatic advancement for reversible planning work or stepwise mode so this choice is asked once.
   When resuming `HOLD` into `FRAME` or `EVIDENCE`, submit `release.reopenConditionMet` and `human.releaseReopened` to the machine workflow contract. When resuming `REWORK`, submit `release.reworkActionRecorded`. The sources must match `contracts/authority.json`; absent facts keep the transition blocked.
4. After `COMMITTED`, put the exact committed blob into the accepted remote delivery base before `SPEC` or `to-spec`. If the target is non-Git, unborn, or missing delivery setup, load and follow the `setup-delivery-repository` helper. Once the accepted base resolves, read its effective policy and accepted architecture sources, apply Solution Shaping only when a load-bearing decision is still open, and require any resulting ADR to enter that base. Re-resolve the accepted base, then run the Repository Contract Impact Review from the reference. A required stable policy change remains a human decision; show its minimum diff once and stop. Never let setup choose implementation behavior.
5. `OUTCOME`: evaluate only after release evidence and the stated evidence window. Return an outcome verdict and a candidate next decision, never a ready implementation ticket.

During `FRAME` and `EVIDENCE`:

- Treat repository roles, RBAC names, UI personas, and issue labels as system facts, not customer-actor evidence. Keep actor and trigger `ASSUMPTION` or `UNKNOWN` until recent customer evidence establishes them.
- Record a stated solution preference as `solution_hypothesis`; it cannot displace a higher-risk actor, workflow, or value unknown without new evidence. State the evidence whenever the riskiest assumption changes.
- While actor, workflow, or value remains blocking, keep AI and automation outside `smallest_closed_loop`, `primary_signal`, and the primary pass threshold. They may run as an isolated shadow only after the deterministic user loop is frozen.
- In the human-facing response, describe such a preference plainly as a solution idea, not the user outcome or success signal.
- Router `stage` names the gate currently being worked. Artifact `product_stage` names the highest evidence state already achieved. After an approved Frame write is reread, route to `EVIDENCE` while the artifact remains `product_stage: FRAME`; protocol design alone does not advance product evidence.

After the selection reference chooses primary-source research for a public fact, establish the Release loop's Research Contract and inspect actual capabilities first. A discoverable skill is not proof that network, browser, source access, background agents, or writes are available. Use high-trust primary sources when reachable. If required sources are unreachable, keep `NEEDS_RESEARCH` and render `Reason: CAPABILITY_GAP` plus the complete `Research Handoff` as required by the Release loop and human interface. In `STATUS`, keep it inside `仍然缺少`; in another form, keep it one compact indented block rather than creating a second response contract.

After the selection reference chooses customer evidence, use a bounded Exploration Guide to discover real workflow facts or a frozen Validation Protocol to test one explicit hypothesis; never answer on the customer's behalf. Conduct a live interview in this session when the human starts it or the participant is present, following [references/interview-session.md](references/interview-session.md). If an asynchronous questionnaire is the one next action because the participant cannot join this session, return an exact `/skill:to-questionnaire` command. If it chooses a prototype for one UI, state, or logic question, follow the available `prototype` skill only after the artifact write is authorized. Use `grilling` or `domain-modeling` only inside the current product question, not as competing entry points.

If Wayfinder is genuinely required, return only the destination, why one context cannot resolve it, and an exact command:

```text
/skill:wayfinder <destination and decision boundary>
```

### DELIVERY

If admitted tickets, ready labels, a Harness claim or terminal record, accepted Git/PR facts, a Release Record, or outcome evidence exists, read [references/execution-closeout.md](references/execution-closeout.md) in full before resolving or changing execution, closeout, release, or outcome state.

Advance through these gates by loading and following the named model-invoked helper. Continue in the same run until that helper reaches a human gate:

1. If Git `HEAD` does not resolve or repository tracker support is missing, follow `setup-delivery-repository` with the target repository. For greenfield, also pin the exact COMMITTED Release artifact and revision; without them, return to `PRODUCT` instead of bootstrapping.
2. With an exact `COMMITTED` Release revision whose artifact blob is present in the accepted remote delivery base, inspect accepted policy, ADRs, code, interfaces, and verification seams. If `to-spec` would need to choose a load-bearing technical direction, follow [references/solution-shaping.md](references/solution-shaping.md); otherwise skip it. After any required ADR is accepted into the base and Repository Contract Impact Review closes, follow `to-spec` with the Release path, revision, base, and accepted decision sources.
3. With an accepted Delivery Spec, follow `to-tickets` with its exact identity. Stop for the required split and graph approval before candidate publication.
4. After approved candidates are persisted, follow `admit-ticket` with the parent identity. Stop for the required activation confirmation after fresh review.
5. After Admission, report `ADMITTED` with the exact ticket, graph, base, source, policy, and execution lane. Any candidate or graph edit requires Admission again.
6. After activation, use the execution-closeout reference to resolve `HANDOFF_READY | IN_PROGRESS | BLOCKED | DELIVERED`; do not infer Harness state from tracker or PR state.

An explicitly read-only invocation forbids mutations, not analysis. When accepted sources close Solution Shaping, continue through read-only `to-spec` compilation and use `SPEC_IN_PROGRESS`; do not report `BLOCKED` merely because the Spec cannot be persisted or published in that invocation.

In the final `ask-yet` response, summarize a read-only `to-spec` draft as `RESULT`: name its exact Release and accepted ADR sources, Scenario IDs, and unresolved-decision status. Do not append the Spec body or reproduce the full draft.

### TRIAGE

For `QUICK`, load and follow `triage` with the exact trusted source. The candidate must persist the complete standalone implementation contract before Admission; conversation may authorize or orient the change but cannot remain its only durable specification. If one `READY` candidate cannot express the work, increase planning depth to `STANDARD` or `DISCOVERY` before any ready-label change. `CONTROLLED` remains a risk overlay rather than a fallback planning depth.

If the symptom is not yet a confirmed bug, obtain the smallest reproduction or diagnosis signal. Then load and follow the `triage` helper with the exact issue and signal.

If the issue is actually a new outcome or behavior choice, return to `PRODUCT`. Do not use triage to bypass Commitment or Admission.

### RISK

When `control_mode` is `CONTROLLED`, read [references/release-loop.md](references/release-loop.md) in full. Fix the applicable authority, protected assets, verification, rollback or recovery, blast radius, manual approvals, staged release, smoke signal, and stop conditions. Then resume the selected planning depth: a standalone `QUICK` candidate uses the same transactional Admission without creating a Release or Spec solely because risk exists; `STANDARD` and `DISCOVERY` retain their normal Release/Spec gates. Every controlled path retains an explicit human production release gate. Never simplify away security, privacy, audit, migration, or recovery controls.

### INCIDENT

Stop ordinary planning. Preserve evidence and follow the repository's incident and recovery policy. Do not create a Release or implementation backlog while impact is active.

## Invocation rule

The human needs to remember only `/skill:ask-yet`. `solution-shaping.md` is an internal reference, not a public Skill or menu item. `setup-delivery-repository`, `triage`, `to-spec`, `to-tickets`, and `admit-ticket` are model-invoked helpers: read their `SKILL.md` when their gate matches and follow them in the current run. A human may still invoke one directly for recovery.

`wayfinder` and `to-questionnaire` remain separate human interactions. When either is genuinely required, print one exact command and stop.

Model-invoked helpers such as `research`, `prototype`, `grilling`, `domain-modeling`, and `diagnosing-bugs` may be followed only when their real tool and authorization requirements are satisfied.

## Response contract

Before rendering any user-visible response, read [references/human-interface.md](references/human-interface.md) in full. Internally retain `goal`, `confirmed_facts`, `missing_fact_or_decision`, `blocker`, and `human_action`. Infer one non-persistent response form in this order: explicit state request -> `STATUS`; exact artifact or mutation approval -> `REVIEW`; non-delegable tradeoff -> `DECISION`; completed action or closeout -> `RESULT`; otherwise one natural question -> `DIALOGUE`. Only `STATUS` renders the complete five-field card. The response form never enters workflow state or the Checkpoint.

Ask at most one main question. Preserve every Gate-required identity, approval subject, limitation, safety control, and recovery boundary described by the owning reference. A read-only request or drafted protocol is not execution authorization. Do not use natural language to hide a fingerprint, revision, mutation, production impact, rollback, or stop condition.

The machine source for lanes, stages, verdicts, legal stage transitions, required facts, and their trusted provenance is `contracts/workflow.json` plus `contracts/authority.json`. Before emitting a final Checkpoint or performing a state-bearing write, read those files from `$PI_TICKET_PLANNING_ROOT` and pipe the current state, proposed state, and provenance-bearing facts as JSON to `node "$PI_TICKET_PLANNING_ROOT/scripts/workflow-contract.mjs" --input -`. The model proposes the state; only an `allowed: true` result legalizes it. Prompt prose, conversation, or an invented fact source cannot add a state or transition.

The lane is one of `PRODUCT | DELIVERY | TRIAGE | RISK | INCIDENT`. End every response with one unfenced `Checkpoint` line as the final non-empty line. The identity field is exactly `NONE`, `<release-id>/<revision>`, or `<ticket-or-map-id>@<reviewed-revision>`; put draft, local, source, and status qualifiers in the human response, never in that field.

```text
Checkpoint: <LANE>/<STAGE> · <authoritative work identity or NONE> · <allowed verdict>
```

Do not append anything after the checkpoint.
