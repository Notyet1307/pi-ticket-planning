# Interview session contract

Use this reference only to run an already designed customer-evidence protocol. It does not design a Frame, invent answers, or replace Commitment.

Load it when the current evidence action is a story interview, task observation, or live protocol, and the human asked to start, confirmed the participant is present, or the latest message is a participant answer.

## Roles

- `ask-yet` is the interviewer, redacting scribe, and protocol judge.
- The product owner starts the session, may relay answers, and approves any writeback.
- The interviewee answers. They may type directly. Relayed answers are treated as the interviewee's words, not the owner's interpretation.

Never answer on the interviewee's behalf. Silence, "I don't know", or a skipped step is `UNKNOWN`. Do not complete a missing step from product knowledge.

## Formal or informal

- `FORMAL`: the exact protocol revision is reachable from the accepted remote delivery base, the participant still matches the protocol, and live consent is obtained. Only then may results update the Release artifact.
- `INFORMAL`: any other live session. Ask the same questions. Say clearly that the result cannot be written as formal Evidence until the protocol blob is on the accepted base.

Do not block an informal session just because a documentation PR is unmerged.

## Start

If the protocol is not yet frozen, finish protocol design first. Do not interview during `FRAME`.

If the human asks to start a live interview and the current protocol forbids in-session answers, requires an offline human facilitator, or waits for a documentation PR to merge: do not refuse. State the conflict in one sentence, treat the start request as approval to run an `INFORMAL` session under this contract, and later propose the minimum protocol amendment. Then continue.

On the first interview turn, state `FORMAL` or `INFORMAL`, then ask only the consent and boundary question. Default if the protocol has none:

> This is not an evaluation or a product demo. Please describe a recent real event. Do not give real IPs, hostnames, system names, customer names, accounts, or credentials. We will only keep process categories. You may stop at any time. Do you agree to continue?

Stop with `INTERVIEW_STOPPED` if consent is refused, a live incident appears, or the participant withdraws.

## Each later turn

Do exactly one of these:

1. After consent: ask only the protocol's unaided opening story question. Do not preview later questions or show a product.
2. After an answer that contains a real IP, hostname, URL, system name, customer name, account, credential, filename, or verbatim dump: do not repeat the secret. Ask them to restate that part as a category. Keep `INTERVIEW_IN_PROGRESS`.
3. After a usable answer: show a short redacted capture of what is now known, then ask one question for the next missing required field.
4. When required fields are filled, the stated appetite is exhausted, or the participant is done: stop asking. Produce the closeout.

Do not recap the whole protocol each turn. Do not ask leading questions such as whether the work is painful or whether a product would help. Do not show, translate, or operate a product UI. Record any such contamination as a limitation.

## What to capture

Use the protocol's `evidence_to_capture` and `return_format` when present. Otherwise capture only:

- participant role category and what they personally did
- how recent the event was
- trigger
- current alternative, as a tool or channel category
- ordered steps
- handoffs: role category and information category
- one important failure and its observable consequence
- how they knew it was finished, and whether anyone rechecked
- explicit `UNKNOWN` items
- facilitator contamination, if any

Keep a running redacted capture in conversation. Do not write raw answers, names, or identifiers into Git, Issues, or the Release artifact.

## Closeout

Recommend one protocol verdict from the protocol's own thresholds. If the protocol has none, use:

- `FRAME_SUPPORTED`: unaided recent real event, personal role in the loop, unprompted important failure or cost, and a real completion or explicit lack of retest
- `ACTOR_REWORK`: recent event, but this person is not in the target loop
- `PROBLEM_REWORK`: they are in the loop, but no important failure, cost, or relevant outcome
- `INCONCLUSIVE`: no recent concrete event, only general opinions, or the session did not finish
- `STOP_SAFETY`: consent, privacy, or incident stop

The owner may correct a factual capture. They may not choose `FRAME_SUPPORTED` to be polite.

Then show the redacted return block and:

- `FORMAL`: request write approval for the minimum Release-artifact update. Do not write until approved.
- `INFORMAL`: keep the summary in conversation. Next action is to publish the protocol revision, then rerun closeout, or accept the session as non-durable.

A completed interview updates product evidence only. It does not enter `COMMIT`, `SPEC`, or tickets.
