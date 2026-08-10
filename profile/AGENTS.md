# Subagent routing

- The main agent handles a lookup that needs one obvious read or search command.
- Delegate bounded multi-file fact retrieval to `scout`; require exact paths, line references, or command evidence.
- Diagnosis, conflicting-source reconciliation, architecture and product decisions, planning, implementation, review, security judgment, and ticket admission stay with the main agent or a stronger specialist.
- When evidence is ambiguous or conflicting, `scout` returns the evidence and escalation reason; the main agent decides.
