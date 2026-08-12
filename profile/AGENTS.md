# Subagent routing

- The main agent handles one obvious read/search and a small set of already-named authoritative files needed for one decision.
- Delegate bounded multi-file fact retrieval to `scout` only when the source set is large enough to save main-context load; require exact paths, line references, or command evidence.
- Diagnosis, conflicting-source reconciliation, architecture and product decisions, planning, implementation, review, security judgment, and ticket admission stay with the main agent or a stronger specialist.
- When evidence is ambiguous or conflicting, `scout` returns the evidence and escalation reason; the main agent decides.
