# Documentation

`docs/getting-started/` contains human-oriented guides for common starting points. Architecture, operations, migrations, security, rationale, and reports are grouped in their named directories. These guides explain the current workflow; they are not authoritative.

- Protocol Registry and machine links: `protocol/`.
- Workflow states and transitions: `contracts/workflow.json`.
- Fact and mutation authority: `contracts/authority.json`.
- Agent behavior: the owning `skills/*/SKILL.md` or its named reference.
- Executable mechanics: `scripts/`.
- Recommended Controller handoff contract: `execution-plan/contract.md`; Legacy Herdr activation remains under `admission/`.
- Qualified direct Controller deployment and upgrade procedure: `docs/operations/codex-controller-mainline.md`.
- Release authority, Oracle execution, path ownership, and Roadmap continuity: `docs/operations/release-closure-guardrails.md`.
- Evaluation evidence: `test/` and `fixtures/`.

Historical design evolution is available in Git history.
