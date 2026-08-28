# Planning Case runtime

Use this contract whenever a package Skill reads or changes planning state.
Conversation is an input; the Planning Case is the resumable state.

## Enter

1. Resolve the exact target and run `pi-ticket-planctl case list --target <target> --json`.
2. Create one Case when none exists. Stop on ambiguity; never guess between
   Cases.
3. Run `pi-ticket-planctl case resume <case-id> --target <target> --json` in
   online mode. Treat its one `nextAction` and Context Manifest as the starting
   state. `--offline` is diagnostic only: it returns `DEGRADED` and cannot
   authorize an external mutation.

`resume.mutationScopes.planningPublication` covers reversible planning-artifact
publication only. `resume.compatibility` and
`resume.mutationScopes.legacyAdmission` are Legacy Herdr Admission diagnostics;
they do not gate a Delivery Spec or candidate Issue created under
`needs-triage`. The compatibility tuple becomes required only after the
operator explicitly selects Legacy Herdr. The legacy `mutationAllowed` field
retains its Admission-preflight meaning; planning publication must read the
scoped field instead.

## Record

Write each command input to a private temporary JSON file outside the target
repository. Use the narrow command that owns the fact:

| State change | Command |
| --- | --- |
| Candidate | `case select-candidate` / `case exclude-candidate` |
| Decision or uncertainty | `case record-decision`, `case record-unknown`, `case resolve-unknown` |
| Assumption | `case record-assumption`, `case revise-assumption` |
| Evidence | `case set-evidence-method`, `case record-evidence`, `case attach-fact` |
| Blocking or routing | `case set-blocker`, `case clear-blocker`, `case set-next-action` |
| External artifact | `case bind` / `case clear-binding` |
| Legal workflow state | `case transition --checkpoint ... --facts ... --next-action ...` |

Admission `plan/apply` owns `ADMISSION_*` transaction events and approval
consumption. Outcome commands own receipt and learning events. Never edit a
Case, event log, transaction, receipt, or consumed approval directly.

## Complete

Before responding, run `case verify`, then start a new process and run online
`case resume` without conversation history. The step is complete only when the
replayed Checkpoint, bindings, blocker, and single `nextAction` equal the state
you intend to report. Render natural language only after that readback.
