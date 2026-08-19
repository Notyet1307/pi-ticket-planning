# Interview session contract

Use this reference to run a live customer-evidence session. It may discover a Candidate Frame or test one frozen hypothesis; it never invents answers, replaces Commitment, or authorizes delivery.

Load it when interview is the selected method and the human asks to start, confirms a participant is present, or supplies the participant's latest answer.

## Session continuity and authority

Within one PI session, keep the frozen guide or protocol, consent, speaker role, redacted working capture, next missing field, pause point, stop condition, and closeout state in the actual conversation context. Consume only the latest participant or owner input and continue the active interview; do not rerun Candidate-first, Evidence Method Selection, or the full `ask-yet` orientation on each turn. This is session context, not a new persisted Evidence state, service, ledger, or database.

The participant supplies Evidence. The owner may pause, request status, resume, cancel, approve a scoped write, relay clearly attributed participant words, or correct a factual redacted capture. Those controls are not participant answers. If speaker identity is genuinely ambiguous, ask only who is speaking, record nothing from that message, and do not continue the interview question. A fixed speaker prefix is optional outside fixtures.

In the same session, participant statements, clearly attributed relayed statements, owner-confirmed factual corrections, the frozen protocol, and the displayed redacted capture may be used. An assistant summary, product knowledge, owner interpretation, or an automatically compressed summary is only a lead until confirmed. Never use another session, another case, model memory, or invented completion as participant fact.

## Two independent axes

Identify both axes from current facts; never ask the human to choose them.

| Axis | Value | Meaning |
| --- | --- | --- |
| `purpose` | `EXPLORATORY` | Discover a recent event, correct the Candidate Frame, or form the next hypothesis. |
| `purpose` | `VALIDATION` | Test one frozen falsifiable hypothesis against precommitted evidence and thresholds. |
| `durability` | `FORMAL` | The applicable guide or protocol and participant satisfy the existing persistence contract. |
| `durability` | `INFORMAL` | The session may continue, but its result cannot close formal Evidence. |

These axes are orthogonal. All four combinations are valid: formal exploration may durably correct a Candidate Frame without proving a threshold; informal validation may rehearse a frozen protocol without closing its Evidence item.

Infer `EXPLORATORY` when the decision-changing unknown is the real actor, trigger, ordered workflow, current alternative, important failure, observable consequence, completion signal, or whether the Candidate Frame is wrong. Infer `VALIDATION` only when one explicit hypothesis and its decision rule were frozen before the participant answers.

Infer durability rather than offering it as a choice:

- `FORMAL`: the exact applicable guide or protocol revision is reachable from the human-approved remote draft ref or accepted remote delivery base, the participant matches it, live consent is obtained, and the session follows the frozen boundaries. Only a redacted result may update the Release artifact, and only after write approval.
- `INFORMAL`: any other live session. Keep the result in conversation. It cannot close blocking Evidence, change readiness to `PASS`, or support `READY_TO_COMMIT` until formal evidence is obtained under the existing contract.

Use ordinary language in the human response. Show `EXPLORATORY`, `VALIDATION`, `FORMAL`, `INFORMAL`, protocol identity, thresholds, or machine verdicts only for debugging, protocol review, or an explicit request.

## Freeze only what the purpose needs

For exploration, form this bounded guide before consent:

```yaml
purpose: EXPLORATORY
learning_question: <one thing to understand>
participant_role_candidate: <candidate role or UNKNOWN>
opening_story_question: <one recent real-event question>
follow_up_dimensions:
  - trigger
  - ordered steps
  - current alternative
  - important failure
  - observable consequence
  - completion signal
evidence_to_capture:
  - redacted event facts
  - explicit unknowns
privacy_and_safety: []
appetite: <question, time, or single-session ceiling>
stop_condition: <enough to form or correct one Candidate Frame>
return_format: <Candidate Frame changes and limitations>
```

Do not invent a pass threshold, fail threshold, generalization sample, Release artifact, six readiness passes, or Commitment detail to make this guide look like validation. Exploration may begin during `FRAME`, including in an empty or non-Git directory with no persisted Candidate Frame. Without an applicable guide on an approved remote draft ref or accepted base, it is informal; missing a Candidate Frame file, Git repository, or `EVIDENCE` state does not prevent listening to a present participant.

`follow_up_dimensions` bounds permissible questions; it is not a checklist that must be exhausted. Once the frozen stop condition is satisfied, close out even when another dimension could be explored. Do not extend the appetite merely to make every capture field known.

For validation, freeze every field below before the participant answers:

```yaml
purpose: VALIDATION
decision_question: <one decision this result can change>
riskiest_assumption: <one falsifiable hypothesis>
participant_criteria: <who qualifies>
scope_and_sample: <bounded sample>
opening_story_question: <one unaided question>
follow_up_boundaries: []
evidence_to_capture: []
privacy_and_safety: []
appetite: <question, time, or cost ceiling>
pass_threshold: <fixed evidence condition>
fail_or_stop_threshold: <fixed failure or stop condition>
return_format: <result relative to the hypothesis>
```

Call the session validation only when a Candidate Frame exists and every field is fixed before answers. If the human says “start validation” without that contract and the participant is present, explain that no hypothesis and decision rule were fixed in advance, infer exploratory and informal, then proceed to consent. If the human insists on validation, finish and obtain product-owner confirmation of the protocol before asking the participant anything; the participant does not design the protocol they will answer.

If an existing guide or protocol requires an offline facilitator, forbids in-session answers, or waits for a documentation merge while the participant is present, do not refuse. State the conflict, run an `INFORMAL` session under this contract, and propose the minimum later amendment. A validation result from that session cannot close formal Evidence.

## Roles and legal workflow state

- `ask-yet` is interviewer, redacting scribe, and protocol judge.
- The product owner starts the session, may relay answers, and approves any writeback.
- The participant answers directly or through the owner. Treat relayed words as the participant's words, not the owner's interpretation.

Never answer on the interviewee's behalf. Silence, “I don't know”, or a skipped step is `UNKNOWN`; do not complete it from product knowledge.

During `FRAME`, run only exploration. Keep the legal `PRODUCT/FRAME · <identity or NONE> · FRAME_CANDIDATE`, or use `FRAME_WRITE_AWAITING_APPROVAL` when the next action is the existing Candidate Frame write approval. Render consent, opening, follow-up, redaction recovery, and resume as `DIALOGUE`; pause and closeout as `RESULT` or short `DIALOGUE`; and an explicit owner status request as `STATUS`. Do not use the `INTERVIEW_*` verdicts, which belong to `EVIDENCE`.

During `EVIDENCE`, either purpose may use the existing `INTERVIEW_AWAITING_CONSENT`, `INTERVIEW_IN_PROGRESS`, `INTERVIEW_RECORDED`, or `INTERVIEW_STOPPED` verdict with the exact Release identity. Never put a protocol, guide, or session identity in the Checkpoint identity field; keep `R301/r1-validation-v1`-style identities in the human review body and use the owning `R301/r1`-style Release identity in the Checkpoint. Purpose and durability never become a lane, stage, verdict, Checkpoint field, or new persisted state.

## First participant turn

Do exactly three things: explain the purpose and limit in ordinary language, state the redaction and exit boundary, and ask whether they consent. In the same boundary explanation, say whether the current source and participant facts meet the conditions for a formal redacted record or whether the result must remain only in this conversation; live consent is still required. Do not also ask for their role, recent event, workflow, or success metric, and do not preview later questions or actions.

Default exploratory wording:

> 这不是绩效考核，也不是产品演示。本轮只了解最近发生的一次真实事件，用于理解流程和形成或修正候选方向，不代表已经决定开发。请不要提供真实 IP、系统名、客户名、账号或凭据；你可以随时停止。你是否同意继续？

For validation, say instead that the session tests one already fixed hypothesis and that its participant scope, questions, and judgment rule will not change in response to the answers. Keep the same privacy and withdrawal boundary, then ask only for consent.

Stop with `INTERVIEW_STOPPED` in `EVIDENCE`, or the current legal `FRAME` verdict during Frame exploration, if consent is refused, the participant withdraws, or a live safety or privacy incident appears.

## Each later turn

Do exactly one action:

1. After consent, ask only the guide or protocol's unaided opening story question. Do not preview follow-ups or show a product.
2. If an answer contains a real IP, hostname, URL, system name, customer name, account, credential, filename, or verbatim dump, do not repeat it. Ask only for that part to be restated as a category.
3. After a usable answer, show one short redacted capture and ask one question for the next missing required field allowed by the guide or protocol.
4. When the stop condition is met, the appetite is exhausted, or the participant is done, ask nothing else and close out.

Do not use a feature-usefulness question as the opening, imply that the participant should feel pain, lead them toward the current candidate, present a question list, show or operate a product UI, or fill missing answers. Record facilitator or product exposure as contamination.

### Owner controls

- On pause, use `RESULT` or short `DIALOGUE`: confirm the pause and name the first missing field that will be resumed; ask no question and do not close out.
- On a status request, use `STATUS`: report only the categories already captured, the missing categories, and the next step; do not ask the participant anything or advance the session in that turn.
- On resume, return to `DIALOGUE` and ask only the first missing question from before the pause. Do not ask for consent again, replay the opening question or protocol, rerun Candidate-first, or repeat the STATUS card.
- When a proposed factual correction still needs confirmation, ask only for that confirmation. Once confirmed, show the corrected redacted fact and ask the first missing interview question allowed by the guide. An owner cannot edit a participant answer merely to pass a threshold.
- On cancellation, stop. Withdrawal or a privacy or safety stop uses the existing safety-stop semantics; an ordinary pause is not failure.

After sensitive material appears, do only the redaction recovery action: repeat none of the sensitive text and ask for a category description. Do not ask the next business question in the same turn. After the participant supplies safe categories, return to the first missing interview fact.

## Validation drift

Keep the decision question, participant criteria, sample, questions, evidence fields, and thresholds frozen during validation. Stop the original judgment if the participant is outside the target role, the answers describe another workflow or trigger, the Frame is wrong, a question is materially leading, or the sample or threshold no longer applies.

Record the deviation, explain why the protocol no longer answers its decision question, and recommend either a Frame correction or one explicit `REWORK` action. Do not swap actor, hypothesis, sample, or threshold and continue counting the same session; do not reinterpret a different positive finding as the original hypothesis passing.

## Capture and privacy

For exploration, capture only redacted facts about the recent event: participant role category and personal action, recency, trigger, ordered steps, current alternative, handoffs by role and information category, important failure and observable consequence, completion or recheck signal, explicit unknowns, and contamination.

For validation, capture only the protocol fields needed to compare the frozen hypothesis with its thresholds. Keep raw answers, recordings, names, identifiers, credentials, IPs, and unredacted material outside Git in an approved location.

Never change a threshold after seeing an answer.

Maintain one compact redacted working capture in the session. It may contain participant role category, event recency, trigger, ordered steps, current alternative, role-and-information handoffs, important failure, observable consequence, completion signal, explicit unknowns, and facilitator contamination. Record only participant-stated facts, write missing fields as `UNKNOWN`, and show only the small addition or correction from the latest turn. Do not repeat the full history or automatically write this working capture to Git.

Do not repeat or persist real names, customer names, system names, hostnames, IPs, URLs, accounts, credentials, filenames, or raw dumps. Raw answers and the PI session itself remain outside the target repository; only an approved redacted formal result may cross the Git durability boundary.

## Fresh-context recovery

A new PI session cannot recover raw answers or authoritative facts from model memory, an assistant summary, or a reconstructed transcript. Without an approved redacted checkpoint, recommend restoring the original PI session. The only alternative is an owner-supplied redacted return block whose factual accuracy the owner explicitly confirms. Until one of those exists, do not guess prior questions, rebuild the working capture, or continue Evidence.

## Closeout

Exploratory closeout must include:

- recent-event facts observed in this session
- what remains unknown
- suggested Candidate Frame changes
- what this result cannot prove
- the next Evidence item

Describe the next step as collecting the next Evidence item. Keep the purpose exploratory even when the router stage is `EVIDENCE`; reserve “validation phase” for a frozen validation protocol.

The optional labels remain `FRAME_SUPPORTED | ACTOR_REWORK | PROBLEM_REWORK | INCONCLUSIVE | STOP_SAFETY`. `FRAME_SUPPORTED` means only that this participant's recent story supports retaining the Candidate Frame for further evidence. It does not establish prevalence, sufficient value, any readiness `PASS`, `READY_TO_COMMIT`, or `COMMITTED`.

The owner may correct a factual capture. They may not choose `FRAME_SUPPORTED` to be polite.

Validation closeout must include the protocol identity and purpose, actual participant and sample, redacted evidence summary, result against the frozen thresholds, limitations and contamination, the one hypothesis supported or disproved, readiness items still open, and one next action. A valid result may close only the named Evidence item or small set named by the protocol; it never automatically produces `READY_TO_COMMIT`, `COMMITTED`, Spec, Tickets, Admission, or `ready-for-agent`.

In `EVIDENCE`, use `INTERVIEW_RECORDED` for a normal closeout when required fields are complete, appetite is exhausted, or the participant is done. Reserve `INTERVIEW_STOPPED` for refused consent, withdrawal, or a safety or privacy stop. During `FRAME`, keep the current legal Frame verdict.

For a formal closeout, request approval for the minimum redacted Release-artifact update and do not write before approval. For an informal closeout, keep the summary in conversation and state that it cannot close the blocking gate; rerun formally if that evidence is required.

For a formal write, show the exact target Release artifact, `from_revision`, `target_revision`, redacted claims, excluded raw content, and permitted Git operation. A completed formal Evidence result updates the named Evidence item and advances artifact `product_stage` to `EVIDENCE` while keeping `status: CANDIDATE`; it does not change readiness or Commitment. Do this in the same formal closeout turn and make exact scoped approval the only owner action; do not defer the write plan to a hypothetical later turn or say no decision is needed. Wait for scoped approval, write only that scope, then reread the exact remote ref and artifact blob before reporting `EVIDENCE_RECORDED`. Never persist raw answers, identifiers, sensitive material, assistant-inferred steps, or unrelated Frame edits. Informal wording such as “记一下” does not upgrade the source to formal.

After any closeout, return the bounded redacted result and limitations to `release-loop.md`. Exploration may retain or correct a Candidate Frame and validation may close only its named Evidence item; neither result creates Commitment, Spec, Tickets, Admission, a ready label, or Harness handoff.
