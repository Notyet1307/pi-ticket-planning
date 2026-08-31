# Delivery Gate

Planning artifacts and execution authority remain separate.

## Candidate state

- A standalone QUICK implementation candidate is created with `needs-triage`.
- A Delivery Spec parent and every implementation child are also created with `needs-triage`.
- Candidate creation, review, and Controller handoff do not add a ready label or start execution.
- `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix` use the mappings in `docs/agents/triage-labels.md`.

## Readiness

Before a candidate can leave planning, require the current `ticket-readiness` contract:

- one primary outcome and one primary verification seam;
- bounded acceptance criteria, risks, scope, write families, and REPLAN triggers;
- exact source and accepted-base identity;
- a frozen Oracle with an independent owner and closed verifier manifest;
- a passing Ticket Context check;
- for a Delivery Spec, one accepted immutable Parent, a current `delivery-release-graph:v3`, complete Scenario coverage and handoffs, a passing walking skeleton, and strict-frontier order;
- one fresh, binding-bound independent review.

Any source, body, Oracle, graph, order, blocker, policy, or base drift requires a fresh check and review. Missing or conflicting authority fails closed.

## Recommended Controller handoff

A bounded all-AGENT `delivery-release-graph:v3` may proceed through `prepare-codex-release`. The operator must approve the exact handoff fingerprint before private Controller inputs are materialized. All Issues remain `needs-triage`, and the Planner never starts the Controller.

Standalone QUICK work remains a reviewed standalone candidate unless a supported execution handoff is explicitly selected. Do not infer execution authorization from candidate publication or review.

## Explicit Legacy Herdr exception

Only an operator's explicit Legacy Herdr selection may invoke `admit-ticket` and apply `ready-for-agent` or `ready-for-human`. That path requires its own fresh readiness, exact mutation Plan, and human confirmation. Parent-last label activation applies only to that Legacy path.

## Authority boundary

GitHub owns Issue, label, PR, commit, check, and merge facts. The configured Controller or Harness owns execution facts. Planning Cases own planning workflow records. None of these facts may be inferred from chat, README examples, fixtures, or another system's projection.
