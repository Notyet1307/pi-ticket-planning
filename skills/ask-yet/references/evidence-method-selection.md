# Evidence method selection contract

Use this reference only when one blocking unknown must be closed before a Candidate Frame, Release decision, or post-Commitment Solution Shaping decision can advance. It selects one valid method; it does not define the Release artifact, choose architecture, run an interview, implement a prototype or spike, accept an ADR, split Tickets, perform Admission, or control the Harness.

The classifications below are transient reasoning, not workflow state. Do not add a lane, stage, verdict, artifact, or persisted `uncertainty_type`.

Reason only over `decision_question`, `blocking_unknown`, `truth_owner`, transient `uncertainty_type`, `decision_impact`, `method_validity`, `action_cost`, `reversibility`, `safety_constraints`, and actual `tool_capability`. Do not start from an available helper or preferred solution.

## 1. Start from one decision

Fix exactly:

```yaml
decision_question: <one decision to make now>
blocking_unknown: <one unknown whose answer can change that decision or the Candidate Frame>
```

Discard an unknown that cannot change `COMMIT | REWORK | HOLD | DROP`, the target outcome, the Candidate Frame, or a required-now technical decision before `to-spec`. When several remain, choose in this order:

1. active harm, incident, or safety stop condition;
2. authority, privacy, compliance, or permission that could make the candidate impermissible;
3. an unknown likely to cause `DROP` or change the target outcome or smallest closed loop;
4. an unknown that could make the candidate impossible inside the appetite;
5. local interaction or implementation optimization;
6. later convenience.

Prefer higher decision impact and uncertainty when a valid bounded method exists. Do not prefer an unknown merely because it is easy to implement, measure, or consistent with a favored solution.

When product and technical unknowns coexist, do not impose a fixed order. Test technical feasibility first only when a technical constraint could make the whole candidate impossible inside the appetite. Test the real task first when a mature technical path exists but actor, workflow, or value remains unknown. Use Wayfinder only when the dependencies cannot be reduced to one decision-changing action.

A request to “use AI”, automation, or another technology is a `solution_hypothesis`. It does not become the target outcome, primary signal, or highest-risk unknown unless the user behavior is already decided and the only blocker is a fixed technical threshold. In the human card, say plainly that it is only a solution idea, not the user outcome or success signal.

## 2. Separate facts from choices

First decide whether the missing answer is discoverable evidence or a non-delegable human choice.

- A fact can be observed or tested: current code behavior, a current official capability, a recent real workflow, task completion, interaction comprehension, technical performance, or whether a signal can be observed.
- A choice has no uniquely discoverable answer: target segment, priority, appetite, architecture or compatibility tradeoff, data ownership, risk acceptance, scope expansion, Commitment, production enablement, or rollback.

For a human choice, create no further Evidence action. Name the decision owner and give one recommendation, its reason, main cost, safest default, and what the system will do after the answer. Record the answer as `DECISION`, never `FACT`, and use `NEEDS_DECISION` or the legal verdict for the current gate. Risk acceptance does not mean the risk disappeared.

For a fact, identify the `truth_owner` before considering tool availability. The owner is the repository or runtime, an identifiable primary source, a real participant or task environment, a target technical environment, or a signal-producing system. A convenient method that cannot observe that owner is invalid even when it is cheap.

## 3. Match truth owner to method

Choose the first bounded method that can answer the decision question.

| Uncertainty and truth owner | Default method | Can establish | Cannot establish |
| --- | --- | --- | --- |
| Repository, code, tracker, Git, test, configuration, or runtime fact | Direct read or deterministic check; use bounded multi-file retrieval only when needed | Current implementation, state, configuration, tests, and constraints | Customer value, adoption, or a real customer workflow |
| Current public API, standard, regulation, compatibility, version, or market fact | Primary-source research under the Release loop Research Contract | Current official capability, rule, and public fact | A specific customer's need or which product tradeoff to choose |
| Actor, trigger, current workflow, alternative, failure, consequence, or completion signal | Observe the real task when available; otherwise recent-story exploratory interview | One or a few recent events and workflow facts | Prevalence, a validation threshold, or Commitment |
| One frozen customer hypothesis with precommitted evidence and thresholds | Validation interview or controlled Pilot, retaining the interview Purpose x Durability contract | Result against the frozen hypothesis in the stated sample | Technical performance, production stability, or automatic Commitment |
| Real or controlled task completion | Task observation or bounded Pilot | Behavior in the observed participants and environment | A conclusion beyond that sample and environment |
| Interaction, state, recovery, handoff, or business-logic comprehension | Observe the existing product if possible; otherwise throwaway prototype plus one controlled task observation | Whether the bounded interaction or state flow can be understood and completed | Product value, formal architecture, technical performance, or production fitness |
| Feasibility, performance, integration, model quality, migration recovery, or technical security control | Bounded spike, benchmark, or canary | The named technical fact in the fixed environment and input | Customer value, priority, adoption, or risk acceptance |
| A defined success signal that cannot currently be collected | Smallest Evidence-enabling surface | That the signal can be observed or the later test can run | That the original Release succeeded or has customer value |
| Product scope, priority, appetite, tradeoff, risk acceptance, Commitment, production enablement, or rollback | Named human authority | The chosen tradeoff and authorized boundary | That an objective fact occurred or a risk vanished |
| Several interdependent decisions that cannot yield one action in this context | Wayfinder | Decision structure and dependencies | A ready implementation Ticket or delivery approval |

Additional selection rules:

- Read discoverable repository facts instead of asking the human. One obvious fact stays in the main context; use bounded retrieval for a genuine multi-file question. If the read is insufficient, retain the exact `UNKNOWN`.
- For current public facts, search may discover a source but cannot replace the primary source. Do not ask a customer or product owner to guess an official fact, and do not close it from model memory.
- For workflow facts, prefer direct task observation. Use a recent-story interview when the event cannot be observed. Use a controlled Pilot when actual task completion is the question. Do not ask whether an abstract feature sounds useful.
- For interaction questions, do not build a prototype when the current product already exposes the task. A prototype uses fake data, stays out of production, has a discard condition, and never becomes Delivery source automatically.
- For technical questions, use fixed or explicitly authorized data, no real credentials, no default production connection, no complete implementation, and no threshold changes after seeing results. An insufficient result is `INCONCLUSIVE` or remains `UNKNOWN`.
- A technical spike has no workflow verdict of its own. During product Evidence, while authorization or its environment is missing, use the current legal `NEEDS_DECISION` or `EVIDENCE_WRITE_AWAITING_APPROVAL`; never reuse `NEEDS_PROTOTYPE` or invent `NEEDS_SPIKE`. During post-Commitment Solution Shaping, keep `DELIVERY / SPEC` with `BLOCKED` until the technical fact returns.
- Use an Evidence-enabling surface only after checking existing logs, tracker facts, tests, and runtime evidence. Follow the Release loop rule for whether it becomes a distinct `QUICK` or `STANDARD` candidate or remains one local prototype under `REWORK`.
- Wayfinder is not a response to many fields or general complexity. Use it only when no single valid action can isolate the highest-impact dependency.

Before a technical spike is authorized, fix at least:

```yaml
decision_question: <one technical decision>
technical_hypothesis: <falsifiable claim>
target_environment: <exact environment>
bounded_input_or_fixture: <fixed or authorized input>
primary_verification: <one runnable check>
pass_threshold: <fixed before execution>
fail_or_stop_threshold: <fixed before execution>
appetite: <time or cost ceiling>
safety_constraints: <credentials, data, production, and side-effect limits>
cleanup_or_discard_condition: <what is removed or retained>
result_to_record: <fact, limitation, and Release Evidence target>
```

## 4. Select the cheapest valid action

Validity comes before cost. The selected method must:

1. observe the truth owner and answer the decision question;
2. be capable of changing the decision or Candidate Frame;
3. have the smallest valid scope and cost;
4. be reversible, with an appetite and stop condition;
5. preserve authority, privacy, safety, and production boundaries; and
6. be executable with current capabilities or yield an exact handoff.

For an evidence-discoverable fact, record the common outer envelope in the existing `Current evidence protocol`; do not create another artifact or repeat method-specific fields already present:

```yaml
decision_question: <one current decision>
blocking_unknown: <one decision-changing unknown>
truth_owner: <repository, primary source, participant, environment, or signal-producing system>
selected_method: <one method for this invocation>
why_this_method: <why it can observe the answer>
can_establish: <strongest valid conclusion>
cannot_establish: <conclusion this method cannot support>
scope_and_appetite: <bounded scope and cost>
stop_condition: <when to stop>
return_to: <Candidate Frame or Evidence item>
```

`cannot_establish` is load-bearing. If a result is used beyond that boundary, keep the claim `UNKNOWN` or return to `FRAME` or `REWORK` instead of advancing.

A non-delegable human choice bypasses this envelope and `Current evidence protocol`. Return only the named `DECISION`, recommendation, reason, main cost, safest default, and current legal verdict.

Activate only one next action per invocation: one decision question, one blocking unknown, one method, and one action. A later conditional path may be named, but research, interview, prototype, and spike must not run in parallel by default.

### Active method owns later session turns

Once the selected method starts, it owns later turns in the same PI session until its stop condition, safety stop, owner cancellation, closeout, or material drift makes the original decision question or method invalid. Consent, an ordinary answer, `继续`, pause and resume, or a new solution preference does not rerun this selection contract.

When an active non-interview method is waiting for an external result, a continue or status turn returns the same compact handoff rather than redesigning it. Retain its exact target environment, frozen input, primary verification, pass and fail or stop thresholds, appetite, safety boundary, cleanup condition, expected result artifact, and return target. Once the raw result arrives, read it, identify its artifact and source class, and judge only against those frozen fields.

Reroute only when the participant no longer matches and the decision question is invalid, an active incident appears, consent is withdrawn, the protocol is leading or unsafe, the Frame's actor, trigger, or target outcome materially changes, the owner cancels the method, or closeout has completed. Keep this ownership in session context; do not add a persisted `active_method` field or workflow state.

## 5. Route around capability gaps without changing the question

After selecting the valid method, inspect the environment's real read, web, browser, execution, data, and write capabilities plus its authorization. A discoverable helper name does not prove the capability is usable.

A read-only instruction or completed protocol design is not permission to execute. Without explicit authorization, do not mark an action authorized; request only the required authorization or environment and keep the current gate open.

If the capability exists, follow its contract and authorization boundary. If it does not, do not substitute a method that cannot answer the question. Return a precise handoff and keep the gate open:

```yaml
selected_method: <same valid method>
required_environment: <missing capability>
required_inputs: <primary artifacts, frozen fixtures, or authorized redacted data>
bounded_action: <one action, scope, appetite, and stop condition>
evidence_to_return: <result, source or environment identity, date, and limitation>
safety_constraints: <production, credentials, data, and cleanup limits>
return_to: <Release revision and Evidence item or Candidate Frame>
```

For research, use the Release loop's complete `Research Handoff` instead of duplicating it. For a prototype or spike, the common handoff above is sufficient. Missing web access does not turn an official fact into an interview question; missing a prototype environment does not make an interview prove usability; missing a test environment does not make model memory prove performance.

When the human can provide official documentation, original logs, a frozen fixture, redacted samples, an existing prototype, or a benchmark report, read that material directly. A human summary is a lead, not automatic closure of the blocking unknown.

## 6. Return to the owning contract

- Direct reads and deterministic checks return a sourced `FACT` and its limitation to the Candidate Frame or Evidence ledger.
- Primary-source research returns through the Release loop Research Contract.
- A selected interview loads `interview-session.md`; selection does not change its `EXPLORATORY | VALIDATION` purpose or `FORMAL | INFORMAL` durability rules.
- Task observation, prototype, spike, benchmark, and canary return only the result allowed by `can_establish`, plus limitations and cleanup status.
- An Evidence-enabling surface returns to the Release loop and cannot count as success of the original Release.
- A human choice returns as a named `DECISION` with its tradeoff.
- A post-Commitment technical result returns to `solution-shaping.md`; it does not select the architecture, accept an ADR, or revise committed product behavior automatically.
- Wayfinder returns decisions or one later research, prototype, or human-input action, never implementation readiness.

After the return, `release-loop.md` alone updates the Release, readiness, Commitment, or outcome gate. No single method result automatically produces `READY_TO_COMMIT`, `COMMITTED`, Spec, Tickets, Admission, a ready label, or Harness handoff.
