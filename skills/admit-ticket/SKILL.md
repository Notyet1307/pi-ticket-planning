---
name: admit-ticket
description: Run the independent admission gate before an implementation issue or delivery map receives a ready label. Use after to-tickets, during triage, after candidate edits, or whenever a user asks to activate an implementation issue.
---

# Admit Ticket

Move candidate implementation issues through an independent fresh-context review, then activate only the unchanged READY result in its reviewed execution lane after human confirmation.

Use /ticket-readiness as the contract. The ticket-readiness-reviewer subagent is the sole scope and readiness judge; this skill owns deterministic graph-integrity checks, evidence gathering, user confirmation, and tracker mutation.

## Preconditions

Require:

- the configured issue tracker and triage-label mapping from /setup-matt-pocock-skills;
- the subagent tool;
- the ticket-readiness-reviewer agent;
- candidate issues in needs-triage or needs-info.

If the reviewer cannot run in a fresh context, stop with the candidates unchanged. The authoring context is not a review fallback.

## Process

### 1. Resolve the admission set

Accept one issue, a list of issues, or a delivery parent. For a delivery parent, include every implementation child and the complete native dependency graph. Exclude Wayfinder decision tickets.

### 2. Build the admission bundle

Re-fetch and include:

- repository and tracker identity;
- exact title, body, labels, comments containing the current agent brief, and updated timestamp for every candidate;
- parent delivery spec body and updated timestamp;
- child order, native sub-issue relationships, and blocking edges;
- linked ADRs, closed Wayfinder decisions, research findings, prototype decisions, and other sources needed by the ticket;
- any detected source conflict or missing artifact.

Use exact source text where practical. Summaries may orient the reviewer but never replace the candidate body or authoritative decision.

For a delivery map, run the configured tracker's strict-frontier order check against the fresh native graph. Include its complete output in the bundle. A failed or unavailable check is Graph NEEDS_INFO: keep every label unchanged, report the exact inverted edges or read failure, and do not accept a reviewer READY result. After a confirmed reorder, rebuild the bundle from scratch.

### 3. Dispatch the independent review

Invoke ticket-readiness-reviewer once in the foreground with context set to fresh. Pass only the admission bundle and the request to judge it. Do not include the author's intended verdict, suspected split, or arguments for approval.

The reviewer must return the /ticket-readiness output for every candidate plus a graph verdict for a batch. Treat a missing, malformed, or non-substantive result as NEEDS_INFO and leave tracker state unchanged.

### 4. Present the result

Show the verdicts, execution lanes, proposed splits, unresolved decisions, blockers, and graph findings. Ask the user to confirm the exact state changes. A reviewer result alone grants no mutation authority.

When a candidate is edited, a blocker edge changes, a source decision changes, or the user requests a different split, return to step 2 and review the new snapshot.

### 5. Apply the confirmed outcome

Re-fetch the admission set first. Compare bodies, sources, graph, and updated timestamps with the reviewed bundle. Re-run the strict-frontier order check for a delivery map before the first label mutation.

- On drift: stop and re-review.
- On a strict-frontier failure or read error: stop with every label unchanged and return to graph review.
- On READY + AGENT: post a concise admission comment containing the verdict, lane, and reviewed timestamps; remove needs-triage, needs-info, and ready-for-human; then add ready-for-agent.
- On READY + HUMAN: post the same admission evidence; remove needs-triage, needs-info, and ready-for-agent; then add ready-for-human.
- On SPLIT: keep needs-triage, remove both ready labels, and post the proposed split only after user confirmation.
- On NEEDS_INFO: replace needs-triage with needs-info after user confirmation, remove both ready labels, and list the exact unresolved questions.

For a delivery map, activate children in their reviewed lanes first. Add ready-for-agent to the parent only after every intended child has a READY verdict, all relationships are wired, and no unresolved implementation candidate remains. A READY/HUMAN child is resolved for graph admission. The parent is always the final activation write.

### 6. Report completion

Report issue identifiers, final labels, reviewer verdicts, execution lanes, reviewed timestamps, and whether the delivery parent was activated. A partial label update is a failed admission; surface it and stop rather than claiming success.
