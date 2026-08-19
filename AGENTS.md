# Repository context policy

## Authority by concern

- Legal workflow states and transitions: `contracts/workflow.json`.
- Fact ownership and mutation authority: `contracts/authority.json`.
- Executable mechanics, graph checks, fingerprints, and Admission writes: `scripts/`.
- Agent behavior: the owning `skills/*/SKILL.md` or its explicitly named reference.
- Regression evidence: `test/` and `fixtures/`.
- Human explanation: `README*` and `docs/getting-started/`.
- Historical evolution: Git history and tags.

Read only the smallest source set required for the current decision. During ordinary implementation or product planning, do not scan all documentation, `fixtures/`, `test/`, or Git history. Load a named reference only when its owning gate applies.

Fixtures and examples are evidence, not contracts. When authoritative owners conflict, fail closed and report the conflict. Do not infer current behavior from historical commits or tags.

Keep temporary plans, audits, scratch analysis, and status snapshots outside the repository. Git retains historical design evolution; do not recreate deleted historical architecture documents.
