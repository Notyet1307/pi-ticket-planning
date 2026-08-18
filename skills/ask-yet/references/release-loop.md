# Release loop contract

Use this reference for `PRODUCT`, `CONTROLLED`, `COMMIT`, repository-contract review, and `OUTCOME`. It defines product evidence and gates; it does not replace a Delivery Spec, ticket readiness review, or Harness.

## 1. Evidence language

Every material claim is exactly one of:

- `FACT`: observed evidence with source identity, date, and limitation.
- `ASSUMPTION`: a belief that still needs evidence.
- `DECISION`: a choice made by the named authority, with date and tradeoff.
- `UNKNOWN`: a missing answer that can change the next gate.

In a Candidate Frame, a `FACT` may come only from an explicit human report of an occurred event, live repository code or configuration, an identifiable first-party source, a supplied primary artifact, or completed formal Evidence. State its source identity, date or locatable revision, and limitation. Use `ASSUMPTION` for inferred actors, triggers, workflows, problems, value, frequency, solution effect, and unobserved steps. A selected candidate is a `DECISION` to investigate one direction and temporarily exclude its alternatives; it is not customer evidence, Release Commitment, or approval to implement. Keep `UNKNOWN` only when the answer can change the target outcome, smallest loop, scope, evidence method, major risk, or `COMMIT | REWORK | DROP` decision.

Type each claim once in the Evidence ledger. Release-frame fields may reference or plainly restate that claim without changing its type; do not create a second authority or let the ledger and Frame contradict each other. Repository roles, interfaces, and code paths remain system facts whose limitation is that they do not establish customer behavior or value.

External research can establish public context, standards, or alternatives. It cannot prove that a particular customer has a problem. Code, a prototype, CI, a merged PR, or a canary can establish feasibility or delivery; none alone establishes value or usability.

Track product and delivery separately:

```yaml
product_stage: <what user evidence establishes>
delivery_stage: <what engineering, deployment, and release evidence establishes>
delivery_evidence_alignment: BALANCED | ENGINEERING_AHEAD | EVIDENCE_AHEAD | UNKNOWN
```

Keep workflow and evidence state separate. Router `stage` is the gate currently being worked; artifact `product_stage` is the highest product-evidence state already achieved. Creating a Frame or designing an unexecuted protocol routes the next work to `EVIDENCE` but does not by itself advance `product_stage` beyond `FRAME`.

## 2. One authoritative Release artifact

Before a candidate is selected, create no product file. Once the human approves the first write, use the repository's existing convention or:

```text
docs/product/releases/<release-id>-<slug>.md
```

Maintain one file per active Release. Do not split Product Context, Evidence Log, Pilot Plan, Decision Log, and status into duplicate files until at least two Releases demonstrate real reuse and copy drift. Link large primary artifacts instead of copying their conclusions.

Use Git as the durability boundary; add no parallel receipt:

- In an existing Git repository, a human-approved remote draft ref may preserve an exact Release candidate commit and regular-file blob during `FRAME` and `EVIDENCE`. Re-read the remote ref and blob after every update. A conversation, patch preview, working-tree file, staged file, or unpublished local commit remains non-durable; a remote draft candidate is durable planning evidence but cannot feed `to-spec`.
- A Release revision becomes authoritative only when its exact regular-file blob is reachable from the accepted remote delivery base. After the human chooses `COMMITTED`, record that decision in the same revision without changing its approved content, then put the resulting exact committed blob into the accepted base before `SPEC` or `to-spec`.
- Reuse one approved remote draft ref and its PR across revisions. Standing automation approval for the exact target and Release may cover its reversible remote draft updates; a changed ref, scope, policy, or risk requires new approval. Include the exact file write, paths to stage, commit message, remote draft ref, and permitted publication owner in the mutation plan. If repository policy forbids agent publication, prepare only the approved scope and stop with an exact human-maintainer or already-configured pre-delivery handoff. The implementation Harness/controller consumes admitted tickets and cannot publish the Release or setup needed to reach Admission. Report the candidate commit and blob while it is on the draft ref; report the revision as authoritative only after the live accepted ref contains it.
- In greenfield, the approved local artifact may carry the product revision through `COMMIT`, but the `setup-delivery-repository` helper must put that exact artifact into the first delivery base before `to-spec` is allowed.

The artifact contains these sections; omit empty optional subsections rather than inventing content:

```markdown
# <release id>: <outcome-oriented name>

## Metadata
- status: CANDIDATE | READY_TO_COMMIT | COMMITTED | HOLD | REWORK | DROP | RELEASED_AWAITING_EVIDENCE | REVIEWED
- revision: <stable revision>
- owner: <human decision owner>
- product_stage: <evidence state>
- delivery_stage: <delivery state>
- delivery_evidence_alignment: BALANCED | ENGINEERING_AHEAD | EVIDENCE_AHEAD | UNKNOWN

## Evidence ledger
| Type | Claim | Source and date | Limitation |

## Release frame
- actor_and_trigger
- observed_problem
- target_outcome
- solution_hypothesis
- smallest_closed_loop
- included_scenarios
- non_goals
- success baseline
- primary_signal
- guardrail
- evidence_window
- minimum_evidence
- risks: value, usability, feasibility, viability
- appetite
- blocking_unknowns
- false_positive_completion

## Current evidence protocol
## Readiness
## Commitment
## Delivery trace
## Release record
## Outcome review
```

Keep raw customer data, recordings, credentials, IPs, responses, and unredacted evidence in an approved location outside the repository. Record only a redacted finding, source identifier, date, and limitation.

Material changes to actor, target outcome, smallest loop, appetite, major risk acceptance, or evidence window create a new revision and invalidate an earlier Commitment. Editorial clarification does not.

Design and mutation are separate gates. Before any Release write:

```yaml
path: <exact authoritative artifact>
operation: CREATE | UPDATE
from_revision: <current revision or NONE>
target_revision: <same revision for editorial change, next revision for material change>
material_changes: []
```

Show the candidate content or minimum diff in conversation and wait for explicit write approval covering the displayed file and Git operations. Words such as “design”, “review”, “continue”, or content acceptance alone authorize conversation, not mutation. Apply only the approved scopes. For an existing Git target, re-fetch the approved remote draft ref and reread the exact blob before advancing from `FRAME` to `EVIDENCE`; after `COMMITTED`, record the decision and re-fetch the accepted ref to reread the resulting committed blob before `SPEC`. For greenfield, reread the approved local artifact and keep delivery blocked until bootstrap. Never silently rewrite a stable revision.

A human may grant standing automation approval for one exact target and Release. Reuse it for reversible planning writes and remote draft updates it clearly covers; do not request permission for each file, commit, tracker mutation, or approved draft-ref update. It expires on source, scope, target, policy, or risk drift. It never silently includes credentials, destructive actions, production effects, implementation, merge, or a repository-forbidden operation. Ticket-graph publication and Admission activation retain their own human confirmations.

### Release-lite for `STANDARD`

Release-lite is the compact use of this same Release artifact, revision, durability rule, and human Commitment. It is not another artifact kind, status, or schema.

Use it only when trusted existing sources already establish the actor and trigger, current behavior or alternative, target behavior, smallest closed loop, observable signal and guardrail, scope and non-goals, and bounded risk. Record those sources in the Evidence ledger, apply all six readiness tests, and omit `Current evidence protocol` when no new evidence action is needed. If any readiness item needs new research, interview, observation, prototype, or product decision, route the work through `DISCOVERY` instead of filling the gap or calling the draft Release-lite.

## 3. Frame one Release

A Release is the smallest end-to-end product bet that can produce new outcome evidence. It is not a feature list or a batch of issues.

A Frame may be wrong, but it must be coherent and falsifiable: it exists to decide what to verify next. A Commitment may not rely on unresolved assumptions that can change the target outcome, behavior, scope, or major risk.

### Candidate Frame and Commitment-ready Frame

A **Candidate Frame** may contain `FACT`, `ASSUMPTION`, `DECISION`, and decision-changing `UNKNOWN` claims. Keep `status: CANDIDATE` and `product_stage: FRAME`. Its actor, trigger, current workflow, observed problem, value, baseline, signal, or value/usability/feasibility risk may still be unverified. It may route the next work to `EVIDENCE`, but it cannot enter `to-spec`, `to-tickets`, Admission, or Harness.

A **Commitment-ready Frame** is the same Release artifact after all six readiness tests pass, no blocking unknown can change its outcome, behavior, scope, or major risk, and a human can decide on the exact revision. Continue to use `READY_TO_COMMIT` and `COMMITTED`; do not create another artifact type, status, or product stage.

### Candidate Frame Sufficiency

A selected direction is sufficient to design the next Evidence action when all eight conditions hold:

1. A human selected or explicitly corrected one candidate direction.
2. One user-visible target outcome can be stated.
3. One candidate actor and trigger can be proposed.
4. One candidate observed problem or current alternative can be described.
5. One smallest end-to-end loop can be described.
6. Adjacent but materially different candidate directions are temporarily excluded.
7. One assumption is named that is most likely to cause continuing, redirecting, narrowing, or stopping the Release.
8. One bounded next decision question can be asked whose answer would test that assumption.

Conditions 3–5 may be explicit `ASSUMPTION` claims; never present them as `FACT`. Frame Sufficiency does not require six readiness passes, a customer interview, a known baseline, a validated primary signal, a fixed evidence window, architecture or technology decisions, every scenario, every risk closed, or enough detail to generate Tickets. When all eight conditions hold, compile the Candidate Frame instead of asking the human to fill product fields one by one.

### Compile a selected candidate

After candidate-first selection, recover the selected direction, read only repository facts that can change it, separate repository facts and human statements from inference, and draft the Frame from the available material. Record the selection and excluded alternatives as a `DECISION`, inferred actor/trigger/problem/loop elements as `ASSUMPTION`, and only decision-changing gaps as `UNKNOWN`. Name one riskiest assumption and one next decision question; do not design the full evidence protocol yet. When showing the draft, make explicit that the selection chooses what to investigate rather than supplying customer evidence or Commitment.

Use the existing Evidence ledger, Release frame, `risks` or `blocking_unknowns`, and `Current evidence protocol` decision question rather than adding permanent fields or another file. Show the candidate artifact content and follow the existing scoped or standing write-approval rule. In a read-only request, show it without writing. Ask one ordinary-language question only when the available material cannot support any coherent, falsifiable Frame.

The same Release frame progressively fills these existing fields; absent or unverified values are not a questionnaire:

```yaml
actor_and_trigger: <who starts, in what recent situation>
observed_problem:
  facts: []
  evidence_refs: []
target_outcome: <what task or result improves>
solution_hypothesis: <the change believed to cause it>
smallest_closed_loop: <trigger -> key behavior -> observable result>
included_scenarios: []
non_goals: []
success:
  baseline: <current signal or UNKNOWN>
  primary_signal: <outcome signal>
  guardrail: <must not worsen>
  evidence_window: <when review occurs>
  minimum_evidence: <enough to judge>
risks:
  value: []
  usability: []
  feasibility: []
  viability: []
appetite: <time, cost, or ticket ceiling>
blocking_unknowns: []
false_positive_completion: <what looks shipped but is not success>
```

For a multi-step journey, describe a walking skeleton across the whole loop. For a narrow change, do not create a formal story map.

Repository roles, RBAC names, UI personas, and issue labels establish system vocabulary only. Until a recent customer story or observation establishes the actor and trigger, record them as `ASSUMPTION` or `UNKNOWN` rather than promoting repository vocabulary into a product fact.

A human preference for AI, automation, or another solution updates `solution_hypothesis`; it is not the `target_outcome`, `smallest_closed_loop`, or `primary_signal`, and it does not reprioritize the evidence risks by itself. Keep the target outcome implementation-independent. While actor, current workflow, or value is the higher-risk unknown, keep that solution outside the walking skeleton, primary signal, and primary pass threshold. If useful, evaluate it later as an isolated shadow against the same frozen evidence.

## 4. Pick one evidence action

Read [evidence-method-selection.md](evidence-method-selection.md) before choosing an action. Give it the current decision, `VALUE`, `USABILITY`, `FEASIBILITY`, and `VIABILITY` unknowns, then data loss, privilege expansion, irreversible external effects, and recovery. It distinguishes facts from human choices, selects one highest-impact blocking unknown, identifies its truth owner, chooses the cheapest valid method, checks actual capability, and returns one common Evidence Action Envelope.

Preserve that risk priority until new evidence changes it. A newly stated solution preference is not evidence; if the selected riskiest assumption changes, record the evidence and reason for the change.

For an evidence-discoverable fact, record that envelope in the existing `Current evidence protocol`; do not create another artifact or persist its uncertainty classification as workflow state. Method availability never overrides truth-owner fit. A human choice bypasses the envelope and creates no new Evidence action; record only its named `DECISION` and tradeoff.

For an interview, infer its purpose from the unknown rather than asking the human to choose:

- `EXPLORATORY`: discover or correct the real actor, trigger, ordered workflow, current alternative, important failure, observable consequence, completion signal, or Candidate Frame. It may run during `FRAME` and does not need a validation threshold.
- `VALIDATION`: test one already explicit falsifiable hypothesis against evidence conditions fixed before participant answers. It requires a Candidate Frame and a complete frozen validation protocol.

Purpose answers why the interview runs. `FORMAL | INFORMAL` durability answers whether its redacted result may become official Evidence; infer durability from the existing source, participant, and consent facts in [interview-session.md](interview-session.md), while writeback remains approval-gated. Do not merge the axes or add either to workflow state.

### Evidence-enabling surface

A `HOLD` decision applies only to its Release ID; it does not freeze the repository. Preserve the held artifact and require its reopen condition only when continuing that same Release.

When the blocking signal cannot be observed until a minimum surface exists:

- If an accepted product source, architecture, or mandate already fixes the behavior, scope, and risk boundaries, frame a distinct `QUICK` or `STANDARD` candidate for the smallest reversible, non-production surface. Its outcome is operability or observability only. Use fixtures or explicitly authorized data, retain existing authoritative results and fallback, and exclude production/default enablement and irreversible effects.
- Otherwise keep the current Release in `REWORK` and use one throwaway prototype as its active evidence action; create no Delivery Spec or implementation tickets.

Passing this surface can establish feasibility or make a later test possible. It cannot establish customer value, satisfy the held Release's reopen condition, or become evidence for that Release without the planned real participant or workflow signal.

For an exploratory interview, record only this bounded Exploration Guide:

```yaml
purpose: EXPLORATORY
learning_question: <one thing to understand>
participant_role_candidate: <candidate role or UNKNOWN>
opening_story_question: <one recent real-event question>
follow_up_dimensions: [trigger, ordered steps, current alternative, important failure, observable consequence, completion signal]
evidence_to_capture: [redacted event facts, explicit unknowns]
privacy_and_safety: []
appetite: <question, time, or one-session ceiling>
stop_condition: <enough to form or correct one Candidate Frame>
return_format: <Candidate Frame changes and limitations>
```

Do not invent pass/fail thresholds or require a persisted Release artifact, six readiness passes, or Commitment to run exploration. For a validation interview, freeze this complete protocol before answers:

```yaml
purpose: VALIDATION
decision_question: <one decision the evidence will change>
riskiest_assumption: <one falsifiable hypothesis>
participant_criteria: <who qualifies>
scope_and_sample: <bounded scope>
opening_story_question: <one unaided question>
follow_up_boundaries: []
evidence_to_capture: []
privacy_and_safety: []
appetite: <time or cost ceiling>
pass_threshold: <fixed before running>
fail_or_stop_threshold: <fixed before running>
return_format: <result relative to the hypothesis>
```

For every evidence action, wrap its method-specific guide or protocol in the selection reference's common Evidence Action Envelope without duplicating equivalent fields. For every non-interview action, retain these additional bounded fields:

```yaml
riskiest_assumption: <one>
participant_or_source: <role, data, or primary source>
scope_and_sample: <bounded scope>
task_or_questions: []
evidence_to_capture: []
privacy_and_safety: []
appetite: <time or cost ceiling>
pass_threshold: <fixed before running>
fail_or_stop_threshold: <fixed before running>
return_format: <what updates the Release artifact>
```

Do not expand discovery after the chosen action is sufficient to change the next decision.

When the chosen action is an interview and the human starts it or the participant is present, follow [interview-session.md](interview-session.md). Start exploration after its bounded guide; start validation only after its complete protocol is frozen. If validation was requested without that protocol and the participant is present, default to an exploratory informal session unless the human insists on finishing protocol design first. Only a redacted return block may later update the Release artifact under the existing durability and write-approval rules. Raw responses stay out of Git.

## 5. Capability-aware research

Before external research, freeze:

```yaml
decision_question: <one product decision>
required_claims: []
freshness: <current or explicit date boundary>
accepted_sources: <primary source types>
minimum_evidence: <evidence required to close the unknown>
blocking_gate: <gate that remains forbidden without it>
```

Then use the shortest capability that actually exists:

1. Read repository source, local documents, or frozen supplied artifacts when sufficient.
2. Read a known official URL directly when the environment permits it.
3. Use search only to discover sources, then verify claims in official documentation, standards, source code, or first-party APIs.
4. Ask the human to supply an original file or official link when another environment has access.
5. If required primary sources cannot be read, emit the handoff below and remain `NEEDS_RESEARCH`.

Never use model memory or a secondary summary to close a blocking current claim. Mark returned evidence as:

- `live-verified`: the research environment read an identifiable primary source.
- `provided-artifact`: the human supplied readable original material.
- `summary-only`: a retelling; insufficient for a blocking unknown.

Research Handoff:

```yaml
decision_question: <same question>
why_it_blocks: <decision or gate>
sources_to_prefer: []
claims_to_verify: []
freshness: <date requirement>
output_required:
  - claim-to-source mapping
  - source URL or artifact identity
  - access date
  - limitations
return_to:
  release_id: <id and revision>
  evidence_item: <ledger item>
```

When `ask-yet` renders this handoff, keep it inside the human card's `仍然缺少` field (or its translation). Put `Reason: CAPABILITY_GAP` and `Research Handoff:` in that field and indent the remaining lines; do not create another top-level status section.

Missing research capability is `CAPABILITY_GAP`, not a product answer and not a request for the human to guess a searchable fact.

## 6. Readiness and human Commitment

Apply these six tests at the `COMMIT` gate. They define Commitment Readiness, not Candidate Frame Sufficiency or permission to design the next Evidence action.

Judge each item `PASS | FAIL | UNKNOWN`:

1. The target actor, recent trigger, and current workflow have evidence.
2. The current alternative and its important failure have evidence.
3. The smallest user loop closes end to end.
4. Primary signal, guardrail, evidence window, and minimum evidence are observable.
5. The highest risk is validated or bounded inside an accepted appetite.
6. Non-goals, false-positive completion, and major risk boundaries are explicit.

Only six `PASS` results with no blocking unknown yield `READY_TO_COMMIT`. High-uncertainty work cannot pass items 1 or 2 using only market articles, competitor existence, or technical feasibility.

When `control_mode` is `CONTROLLED`, also require a decision-complete control record in the Release artifact or trusted operating source:

```yaml
authority_and_scope: <mandate, policy, incident follow-up, or named human decision>
protected_assets_and_data: []
blast_radius: <affected users, data, systems, and environments>
pre_release_verification: []
rollback_or_recovery: <trigger, owner, exact safe action, and verification>
approval_owners: []
staged_release: <order, bounded first audience or environment, and hold points>
smoke_and_stop_conditions: []
audit_evidence: <what is retained, where, and by whom>
```

Carry applicable controls into the standalone Ticket or Delivery Spec constraints, Ticket invariants and guardrails, Admission bundle, and Release Record. A missing applicable control is `NEEDS_INFO` or `BLOCKED`, not an implementation detail. Human approval remains mandatory for risk acceptance, Admission activation, and production enablement or rollback. A small diff never removes these controls, but a decision-complete `QUICK + CONTROLLED` change does not need a product Release artifact, customer discovery, or multi-ticket Spec solely because it is risky. When product behavior is uncertain, use `DISCOVERY + CONTROLLED` and complete the evidence gates.

At the decision gate, the human chooses. `COMMITTED` is available only after all six readiness checks pass; the other decisions may close or redirect a not-ready candidate without fabricating readiness:

- `COMMITTED`: bind the decision to the exact draft revision, record `status: COMMITTED` without changing its approved content, then put the resulting exact committed blob into the accepted remote delivery base before repository-contract review and Delivery Spec.
- `HOLD`: pause all evidence and delivery work for that Release. Record `next_evidence_action: NONE` and one externally observable `reopen_condition`; resume only after that condition occurs and the human reopens the Release.
- `REWORK`: keep exactly one named evidence or scope action active, with its owner, appetite, and stop condition.
- `DROP`: stop and record the disproved assumption plus the fact required to reopen.

The agent may recommend but cannot choose.

## 7. Repository Contract Impact Review

Run this after `COMMITTED` and after the exact committed blob is in the accepted remote delivery base, before `to-spec`.

If the target is non-Git or has an unborn `HEAD`, first route to the repository setup Skill with the exact COMMITTED Release artifact and revision. Apply a delivery-bootstrap plan when the standing automation approval clearly covers it; otherwise present one consolidated approval request. The bootstrap may establish Git, the committed Release artifact, minimal Agent/tracker policy, and a remote; it may not choose an application stack or create implementation scaffolding. Return here after a real base SHA exists.

At the target delivery base SHA, the effective root repository policy is the first regular Git blob in this precedence:

```text
AGENTS.override.md
AGENTS.md
AGENTS.MD
CLAUDE.md
CLAUDE.MD
```

Inspect the exact base, not merely the working tree. Only one file is effective; a lower-precedence file is shadowed. Subdirectory instruction files are not part of the current Harness governance boundary.

Move a new rule into the effective policy only if all are true:

1. It is stable beyond one ticket.
2. It applies across all or a clear class of tickets.
3. It cannot be reliably discovered from code, configuration, or the task runner.
4. A fresh Worker or Reviewer could otherwise make a materially wrong choice.

Good policy content includes stable invariants, dependency direction, compatibility and migration rules, external-side-effect handling, non-discoverable verification constraints, privacy, credentials, human confirmation, and stop conditions.

Keep Release behavior, current scope, acceptance criteria, temporary implementation advice, and unconfirmed design in the Release artifact, Spec, ADR, or ticket. Do not copy commands or paths already discoverable from the repository. Do not create a policy file when no durable rule exists.

When a policy change is required:

1. Report target base SHA, effective path, and precedence.
2. Show the minimum diff and request human approval.
3. Merge the policy change into the target base before admitting dependent tickets.
4. Re-resolve exact base SHA, effective path, and content digest.

A candidate-branch policy cannot govern the Worker that creates it. If the Release depends on the new rule, make the policy change an independent prerequisite and refresh the base before admission.

## 8. Delivery, release, and outcome

The committed artifact revision is the product source for `to-spec`; the accepted Spec assigns stable Scenario IDs and explicit state/artifact handoffs; `to-tickets` persists the Scenario coverage matrix, walking skeleton, and candidate graph; the unchanged snapshot goes through independent Admission. Do not make downstream stages guess a product decision.

Execution fact ownership, no-daemon resume, parent closeout, and delivery failure behavior are defined in [execution-closeout.md](execution-closeout.md). The `ask-yet` entry point must load it directly when those facts exist.

Keep these facts distinct:

- `merged`: the accepted diff reached a branch.
- `released`: a specific artifact/SHA is enabled for a stated audience or environment, with smoke and rollback evidence.
- `outcome achieved`: post-release evidence satisfies the Frame's signal and guardrail after its evidence window.

The Release Record includes Release ID and revision, source SHA and artifact identity, environment and enabled scope, migration or flag state, smoke/health evidence, rollback condition and result, and responsible human. When `control_mode` is `CONTROLLED`, also record the approving authority, staged-release step, stop-condition result, and retained audit-evidence identity.

Before the evidence window, or while its stated minimum evidence is still accruing, return `AWAITING_EVIDENCE`; do not call ordinary waiting `UNEVALUABLE`.

At or after the evidence window, assess baseline validity, primary signal, guardrail, qualitative explanation, sample or instrumentation limits, and supported or disproved assumptions. Return exactly one outcome verdict:

- `ACHIEVED`
- `PARTIAL`
- `NOT_ACHIEVED`
- `UNEVALUABLE`

Then recommend one human decision: `CONTINUE | ITERATE | PIVOT | STOP | MEASURE_AGAIN`. `MEASURE_AGAIN` requires a specific evidence defect and a new window. Outcome may create a candidate opportunity, never an admitted or ready ticket.

## 9. Admission to Harness

Admission provides Scenario-coverage, state/artifact-handoff, walking-skeleton, and strict-frontier checks, a fresh readiness review, snapshot comparison, and human confirmation of one exact Plan fingerprint. For a GitHub delivery map, `admit apply` reconciles that plan blockers-first and writes the parent last; `PARTIAL` resumes the same plan and `CONFLICT` requires review again. The tracker ready label and idempotent admission comment remain the only handoff to Harness, so this adds no second protocol or receipt artifact. Any source, matrix, candidate, or graph edit requires Admission again.
