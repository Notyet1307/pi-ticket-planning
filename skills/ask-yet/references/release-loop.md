# Release loop contract

Use this reference for `PRODUCT`, `COMMIT`, repository-contract review, and `OUTCOME`. It defines product evidence and gates; it does not replace a Delivery Spec, ticket readiness review, or Harness.

## 1. Evidence language

Every material claim is exactly one of:

- `FACT`: observed evidence with source identity, date, and limitation.
- `ASSUMPTION`: a belief that still needs evidence.
- `DECISION`: a choice made by the named authority, with date and tradeoff.
- `UNKNOWN`: a missing answer that can change the next gate.

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

- In an existing Git repository, a Release revision becomes authoritative only when its exact regular-file blob is reachable from the accepted remote delivery base. A conversation, patch preview, working-tree file, staged file, or unpublished local commit is a draft and cannot feed `to-spec`.
- Include the exact file write, paths to stage, commit message, and permitted pre-delivery publication owner in the mutation plan. If repository policy forbids agent publication, prepare only the approved scope and stop with an exact human-maintainer or already-configured pre-delivery handoff. The implementation Harness/controller consumes admitted tickets and cannot publish the Release or setup needed to reach Admission. Do not report the revision as recorded until the live accepted ref contains it.
- In greenfield, the approved local artifact may carry the product revision through `COMMIT`, but `/skill:setup-matt-pocock-skills` must put that exact artifact into the first delivery base before `to-spec` is allowed.

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

Show the candidate content or minimum diff in conversation and wait for explicit write approval covering the displayed file and Git operations. Words such as “design”, “review”, “continue”, or content acceptance alone authorize conversation, not mutation. Apply only the approved scopes. For an existing Git target, re-fetch the accepted ref and reread the exact blob before advancing beyond `FRAME`; for greenfield, reread the approved local artifact and keep delivery blocked until bootstrap. Never silently rewrite a stable revision.

## 3. Frame one Release

A Release is the smallest end-to-end product bet that can produce new outcome evidence. It is not a feature list or a batch of issues.

Minimum frame:

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

A human preference for AI, automation, or another solution updates `solution_hypothesis`; it does not reprioritize the evidence risks by itself. While actor, current workflow, or value is the higher-risk unknown, keep that solution outside the walking skeleton, primary signal, and primary pass threshold. If useful, evaluate it later as an isolated shadow against the same frozen evidence.

## 4. Pick one evidence action

Scan `VALUE`, `USABILITY`, `FEASIBILITY`, and `VIABILITY`, then data loss, privilege expansion, irreversible external effects, and recovery. Select the one assumption most likely to change `COMMIT`, `REWORK`, `PIVOT`, or `DROP`.

Preserve that risk priority until new evidence changes it. A newly stated solution preference is not evidence; if the selected riskiest assumption changes, record the evidence and reason for the change.

Choose the cheapest valid method:

- Public capability, market, standard, rule, or API unknown: primary-source research.
- Actor, trigger, current workflow, or alternative unknown: recent-story interview.
- Task completion unknown: controlled task observation or Pilot.
- UI, state, or business-logic unknown: throwaway prototype.
- Technical feasibility unknown: bounded spike or canary with a pass/fail signal.
- Several interdependent decisions that cannot close in one context: Wayfinder.

Before action, record:

```yaml
decision_question: <one decision the evidence will change>
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

Do not expand discovery after this action is sufficient to change the next decision.

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

Missing research capability is `CAPABILITY_GAP`, not a product answer and not a request for the human to guess a searchable fact.

## 6. Readiness and human Commitment

Judge each item `PASS | FAIL | UNKNOWN`:

1. The target actor, recent trigger, and current workflow have evidence.
2. The current alternative and its important failure have evidence.
3. The smallest user loop closes end to end.
4. Primary signal, guardrail, evidence window, and minimum evidence are observable.
5. The highest risk is validated or bounded inside an accepted appetite.
6. Non-goals, false-positive completion, and major risk boundaries are explicit.

Only six `PASS` results with no blocking unknown yield `READY_TO_COMMIT`. High-uncertainty work cannot pass items 1 or 2 using only market articles, competitor existence, or technical feasibility.

The human then chooses:

- `COMMITTED`: freeze the exact revision and permit repository-contract review, then Delivery Spec.
- `HOLD`: evidence is adequate but this Release does not take the delivery slot.
- `REWORK`: return to one named evidence or scope item.
- `DROP`: stop and record the disproved assumption plus the fact required to reopen.

The agent may recommend but cannot choose.

## 7. Repository Contract Impact Review

Run this after `COMMITTED` and before `to-spec`.

If the target is non-Git or has an unborn `HEAD`, first route to the repository setup Skill with the exact COMMITTED Release artifact and revision. That decision authorizes only a displayed, explicitly approved delivery-bootstrap plan. The bootstrap may establish Git, the committed Release artifact, minimal Agent/tracker policy, and a remote; it may not choose an application stack or create implementation scaffolding. Return here after a real base SHA exists.

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

Keep these facts distinct:

- `merged`: the accepted diff reached a branch.
- `released`: a specific artifact/SHA is enabled for a stated audience or environment, with smoke and rollback evidence.
- `outcome achieved`: post-release evidence satisfies the Frame's signal and guardrail after its evidence window.

The Release Record includes Release ID and revision, source SHA and artifact identity, environment and enabled scope, migration or flag state, smoke/health evidence, rollback condition and result, and responsible human.

At the evidence window, assess baseline validity, primary signal, guardrail, qualitative explanation, sample or instrumentation limits, and supported or disproved assumptions. Return exactly one outcome verdict:

- `ACHIEVED`
- `PARTIAL`
- `NOT_ACHIEVED`
- `UNEVALUABLE`

Then recommend one human decision: `CONTINUE | ITERATE | PIVOT | STOP | MEASURE_AGAIN`. `MEASURE_AGAIN` requires a specific evidence defect and a new window. Outcome may create a candidate opportunity, never an admitted or ready ticket.

## 9. Admission to Harness

Admission provides Scenario-coverage, state/artifact-handoff, walking-skeleton, and strict-frontier checks, a fresh readiness review, snapshot comparison, and human confirmation. After confirmation, the tracker ready label and admission comment are the handoff to Harness. Any source, matrix, candidate, or graph edit requires Admission again. Keep Harness within its existing execution contract; add no second handoff protocol without an observed failure that requires one.
