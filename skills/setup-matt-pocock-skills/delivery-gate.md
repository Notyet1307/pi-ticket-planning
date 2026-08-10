# Delivery Gate

Implementation work moves through these states:

1. A delivery spec is created in needs-triage.
2. Candidate implementation issues are created as native children in needs-triage.
3. Native blocking edges and child order are completed.
4. /admit-ticket sends the exact graph to ticket-readiness-reviewer in a fresh context.
5. A human confirms the reviewer outcome.
6. READY children receive ready-for-agent for lane AGENT or ready-for-human for lane HUMAN.
7. The delivery parent receives ready-for-agent last.

Verdict and execution lane are independent: a complete human-only ticket is READY/HUMAN, not NEEDS_INFO. SPLIT candidates remain needs-triage. NEEDS_INFO candidates move to needs-info after confirmation. Any material change after review requires another admission run.

Wayfinder maps and wayfinder:* decision tickets are planning artifacts. They never receive the executable ready-for-agent label and are never reused as delivery parents.

The label strings used by this repository are defined in docs/agents/triage-labels.md. Tracker-specific relationship operations are defined in docs/agents/issue-tracker.md.
