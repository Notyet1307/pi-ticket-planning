# Domain Navigation

Read only the glossary or context index that can change the current terminology or boundary decision.

- `CONTEXT.md` is a glossary and navigation aid. Read it only when its vocabulary can change the current work.
- `CONTEXT-MAP.md` selects the relevant bounded context. When one context is in scope, follow only that context; do not load every mapped context.
- Accepted ADRs own load-bearing technical decisions. Read only ADRs the accepted task source or current behavior depends on.

## Resolve only decision-changing ambiguity

Treat terminology as a planning defect only when one term names materially different concepts, distinct concepts have been collapsed into one name, accepted repository language conflicts with the human's term, or the ambiguity can change a decision, Scenario, handoff, ownership or verification seam, or a fresh executor's first correct action. Resolve discoverable language from the accepted repository context. Ask for one canonical term only when the distinction changes the current decision.

CONTEXT files clarify existing facts and decisions. They do not create Evidence, Commitment, ADR or Admission authority, or own product behavior, architecture, data ownership, repository policy, or current implementation facts. They cannot override an accepted Release, Spec, Ticket, ADR, effective root policy, or code and tests at the reviewed base. They must not copy Release behavior, Ticket acceptance criteria, complete architecture decisions, or directory tours.

If these files do not exist, proceed silently; this check never requires creating them. Create `CONTEXT.md` only after real terminology ambiguity exists and a stable cross-Release term must be shared, and create `CONTEXT-MAP.md` only after at least two real bounded contexts exist.

## Optional file structure

Single-context repo (most repos):

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

Multi-context repo (presence of `CONTEXT-MAP.md` at the root):

```
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← system-wide decisions
└── src/
    ├── ordering/
    │   ├── CONTEXT.md
    │   └── docs/adr/                  ← context-specific decisions
    └── billing/
        ├── CONTEXT.md
        └── docs/adr/
```

## Use a relevant glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept is absent, do not invent a glossary entry during unrelated work. Resolve decision-changing ambiguity inside the current planning gate; it creates no separate stage or artifact.

## Flag ADR conflicts

If the selected CONTEXT source or current output contradicts an applicable accepted ADR, fail closed, name both sources and their concern, and return the decision to its owner.
