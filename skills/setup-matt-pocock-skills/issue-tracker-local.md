# Issue tracker: Local Markdown

Issues and specs for this repo live as markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01` — never a single combined tickets file
- Triage state is recorded as a `Status:` line near the top of each issue file (see `triage-labels.md` for the role strings)
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## When a skill says "publish to the issue tracker"

Create a new file under `.scratch/<feature-slug>/` (creating the directory if needed).

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a file with one **child** file per ticket.

- **Map**: `.scratch/<effort>/map.md` — the Notes / Decisions-so-far / Fog body.
- **Child ticket**: `.scratch/<effort>/issues/NN-<slug>.md`, numbered from `01`, with the question in the body. A `Type:` line records the ticket type (`research`/`prototype`/`grilling`/`task`); a `Status:` line records `claimed`/`resolved`.
- **Blocking**: a `Blocked by: NN, NN` line near the top. A ticket is unblocked when every file it lists is `resolved`.
- **Frontier**: scan `.scratch/<effort>/issues/` for files that are open, unblocked, and unclaimed; first by number wins.
- **Claim**: set `Status: claimed` and save before any work.
- **Resolve**: append the answer under an `## Answer` heading, set `Status: resolved`, then append a context pointer (gist + link) to the map's Decisions-so-far in `map.md`.

## Delivery-map operations

- **Draft parent**: store the accepted Delivery Spec at `.scratch/<feature>/spec.md` with `Status: needs-triage`.
- **Candidate child**: create one numbered file per candidate containing stable source Scenario IDs, coverage role, and the parent path.
- **Coverage**: keep one `## Ticket coverage` section in `spec.md` containing exactly one `<!-- pi-ticket-planning:delivery-graph:v1 -->` marker and its JSON fence. It is the normalized Scenario handoff, source/base, child path, role, verification, lane, walking-skeleton, and blocker snapshot; create no duplicate prose matrix or receipt.
- **Graph check**: `node "$PI_TICKET_PLANNING_ROOT/scripts/check-delivery-graph.mjs" --input .scratch/<feature>/spec.md`. PASS is mandatory before Admission or an execution-ready state.
- **Blocking and order**: use `Blocked by: NN` and require every blocker file number to sort before its dependent.
- **Admission**: validate coverage, state/artifact handoffs, walking skeleton, file order, and blockers before fresh review and again before changing `Status` to an execution-ready state.
- **Harness boundary**: local Markdown supports planning and review only; HerdrHarness Lite activation remains unavailable.
