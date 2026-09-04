---
name: to-tickets
description: Draft a traceable graph from an accepted Delivery Spec, then route it to an exact Goal or Controller handoff.
---

# To Tickets

Compile one accepted Delivery Spec into candidate tracer-bullet tickets. Publish candidates in `needs-triage`; the default next step is `/prepare-codex-release`. Use `/admit-ticket` only when the user explicitly chooses Legacy Herdr activation.

Read [the Planning Case runtime](../planning-case-runtime.md) before work. Resume the exact Case, verify its Spec binding, record each Candidate and the approved graph decision, transition through `TICKETS`, and bind the exact published graph before reporting completion.

The issue tracker and triage labels must be configured by `setup-delivery-repository`. Load `/ticket-readiness` before drafting.

## Process

### 1. Resolve the accepted Spec

Re-fetch the complete parent body, comments, label, and updated timestamp. Require:

- one valid `pi-ticket-planning:spec-acceptance:v1` receipt from the same Case whose Parent number/title/body hash and source base/content hash match exactly, and exactly one executable-Delivery-Spec Parent-kind marker with no Roadmap marker;
- one trusted source identity and exact delivery base;
- stable Scenario IDs with explicit entry/input, trigger, result/failure, exit/output, and Release signal mapping;
- one walking-skeleton target naming the ordered Scenario IDs and state/artifact handoffs in the smallest loop;
- an empty `Unresolved decisions` section;
- the human-approved Delivery Spec in `needs-triage`.

Fetch linked Release, ADR, Wayfinder, research, questionnaire, and prototype sources only when needed to interpret a stated decision. A conversation or plan is not a replacement for the accepted parent. Stop with `NEEDS_INFO` on missing scenarios or explicit handoffs, source drift, conflicting authority, or an unsafe ready-labelled parent. Do not infer an omitted producer, representation, or clearing transition for a state consumed by a later scenario.

Read the accepted Spec, named source, tracker, and policy directly; delegate only a genuinely large linked set. For local Markdown, use the tracked blob and latest commit identity/time; missing `## Comments` means none. Do not invent sidecars. One status plus minimal blob/commit checks establishes drift.

### 2. Draft vertical slices

Create one candidate per observable behavior. Cross only the schema, API, UI, migration, and test layers required for that behavior.

Each candidate must satisfy `/ticket-readiness`:

- one primary outcome and one primary verification;
- 3–8 single-assertion acceptance criteria;
- no more than three independent delivery surfaces;
- stable source Scenario IDs, closed decisions, real blockers, decision sources, and explicit out-of-scope work;
- an explicit starting state matching its Scenario entry or blocker-produced artifact, plus the invariants and guardrails it must preserve;
- enough durable context in the candidate body for a fresh executor to choose the first correct action from it and repository policy; links provide provenance or detail, not the only copy of required behavior or guardrails.
- cheap deterministic repository and environment facts remain in their owning code, configuration, scripts, or tool output; copy only stable behavior, acceptance criteria, invariants, guardrails, decided handoffs, non-obvious first-action pointers, and exact decision authority into the Ticket.
- when primary verification depends on Docker, Compose, a non-default runtime, or another configured tool, the stable requirement and canonical tracked validation entry are explicit. Live socket, daemon, credential, and machine availability stay out of the Ticket and are proven later by Admission readiness.
- explicit risks, scope, expected/protected paths, one seam, REPLAN triggers, integration declaration, and waivers; high-risk work additionally requires an exact Oracle with a closed independent verifier manifest, while normal/low work omits the Oracle section.

Add `## Context anchors` only when the first action has a non-obvious repository entry. Use zero to five bullets in this exact form:

    - `src/module/current-entry.ts` — When changing <branch or behavior>, locate the current behavior entry point.

Each anchor is an exact reviewed-base regular file with one short trigger and purpose. Reject directories, globs, absolute/`..`, draft/historical/example/fixture sources, or broad read instructions. Anchors navigate; never replace behavior or decisions. Omit obvious entries; over five cannot be READY.

Every `## Decision sources` item must name the concern it owns and an exact accepted identity. Discussions, summaries, examples, and navigation documents are not decision authorities.

Do not qualify a `READY` verdict. If an open decision can change the candidate's outcome, primary verification, acceptance criteria, or output contract, that candidate is `NEEDS_INFO` until the decision closes.

Use coverage role `DIRECT` for a user-observable scenario slice. Use `ENABLER` only when an independently green vertical slice is impossible; name its downstream candidate consumers, exit condition, source scenarios, and real blocking edges. An ENABLER with no current consumer is an orphan and cannot proceed.

Assign execution lane `AGENT` to every child of the current executable Release. Work requiring intentionally human-held access, external or isolated environment control, physical access, or non-delegable judgment belongs in the Roadmap or a separate Human Execution artifact; it must not enter `delivery-release-graph:v3`.

### 3. Prove Scenario coverage

Build this matrix before the blocker graph:

| Scenario ID | User-observable behavior | Entry -> exit / handoff | DIRECT candidate(s) | ENABLER candidate(s) | Primary verification | Release signal |
|---|---|---|---|---|---|---|

Return `Scenario coverage: PASS | FAIL` using all of these rules:

1. Every Spec Scenario ID has at least one `DIRECT` candidate.
2. Every candidate names one or more existing Scenario IDs.
3. Every `ENABLER` names a current downstream consumer and an objective exit condition.
4. No candidate duplicates an independently deliverable outcome already owned by another candidate.
5. No out-of-scope behavior or speculative platform work appears as a candidate.
6. Every downstream state or artifact is produced by an earlier scenario/candidate or named as an external input; every blocking or invalid state has a decided representation and clearing transition when completion depends on it.

Then name the earliest candidate chain that closes the Spec's smallest trigger-to-result loop. Return `Walking skeleton: PASS | FAIL` with the ordered candidate IDs, covered Scenario IDs, and named handoffs. Every member must be individually `READY`, appear in dependency-valid order, and consume a state produced by an earlier member or declared external input. A missing direct path, broken handoff, uncovered scenario, orphan candidate, or non-READY member is `NEEDS_INFO`; do not publish a partial graph.

Represent only the current executable Release. Put multi-Release/HUMAN work in a separate non-executable `pi-ticket-planning:roadmap-graph:v1`: `PLANNED`, no future base, no Admission/compiler route. Bind its `parent` to a separate fresh Umbrella containing one `<!-- pi-ticket-planning:parent-kind:roadmap -->`; never reuse the Delivery Spec Parent.

Graph review binds public Spec, result, decision, and handoff bytes on the execution base or descendant. Ordinal 2+ accepts only an ingested Controller Result or `goal-result-acceptance:v1`; a raw Goal Result is invalid. Persist its Plan digest, then rebuild.

```json
{
  "schema": "pi-ticket-planning:delivery-release-graph:v3",
  "kind": "EXECUTABLE_RELEASE",
  "executable": true,
  "readinessState": "SPEC_ACCEPTED",
  "releaseId": "R003-C1/r1",
  "releaseOrdinal": 1,
  "planningBaseSha": "<planning snapshot base>",
  "executionBaseSha": "<fresh current execution base>",
  "executionBasePolicy": "PLANNING_BASE_OR_DESCENDANT",
  "roadmapDigest": null,
  "predecessorReleaseId": null,
  "predecessorPlanDigest": null,
  "predecessorReceipt": null,
  "predecessorReceiptBinding": null,
  "specAcceptance": { "schema": "pi-ticket-planning:spec-acceptance:v1", "parent": {}, "source": {}, "decision": {}, "digest": "sha256:<exact receipt>" },
  "specAcceptanceBinding": { "path": "evidence/spec-acceptance.json", "baseSha": "<execution base>", "sha256": "sha256:<bytes>", "byteCount": 0 },
  "decisionManifest": { "schema": "pi-ticket-planning:decision-manifest:v1", "baseSha": "<execution base>", "policy": {}, "productRelease": {}, "decisions": [], "dependencyHandoffs": [], "digest": "sha256:<manifest>" },
  "decisionManifestBinding": { "path": "evidence/decision-manifest.json", "baseSha": "<execution base>", "sha256": "sha256:<bytes>", "byteCount": 0 },
  "decisionManifestDigest": "sha256:<same manifest bytes>",
  "source": { "identity": "<accepted Spec>", "revision": "<exact update>", "specContentHash": "sha256:<accepted Spec content>" },
  "scenarios": [
    { "id": "S1", "behavior": "<observable behavior>", "entry": "external:<input> or <artifact>", "exit": "<artifact>", "releaseSignal": "<signal>", "smallestLoop": true }
  ],
  "children": [
    { "id": "C01", "title": "<title>", "coverageRole": "DIRECT", "sourceScenarios": ["S1"], "blockedBy": [], "externalBlockers": [], "bodyHash": "sha256:<exact UTF-8 body>", "startingState": "<entry state>", "primaryVerification": "<behavioral check>", "primaryVerificationSeams": ["<one seam>"], "executionLane": "AGENT", "implementationOwner": "<worker identity>", "riskClasses": ["<RISK_CLASS>"], "scopeBudget": {"maxFiles": 8, "maxChangedLines": 1500}, "expectedPaths": ["src/module.ts"], "protectedPaths": ["fixtures/oracles/o01.json"], "replanTriggers": ["ACCEPTED_DECISION_CHANGE_REQUIRED", "THIRD_RISK_CLASS_DISCOVERED", "SCOPE_BUDGET_EXCEEDED", "DOWNSTREAM_RELEASE_BEHAVIOR_DISCOVERED"], "oracleBindingDigest": "sha256:<binding>", "integrationOnly": null, "waiverDigests": [] }
  ],
  "walkingSkeleton": ["C01"]
}
```

`blockedBy` contains only current-Release children; `externalBlockers` is empty. ENABLER adds consumers and exit. Default child limit is four, hard cap six. Hash exact child bodies; never modify the accepted Parent body.

Ordinal 2+ uses `PREDECESSOR_MERGE_OR_DESCENDANT` with exact Roadmap/result identity; the base is the accepted Result `mergeSha` or descendant. Unsupported Result contracts return `INVALID_RELEASE_RESULT`.

`decision-manifest:v1` binds policy, product Release, `ACCEPTED` ADRs, and handoffs by bytes. Risk classes come from `contracts/risk-class-registry.json`; `expectedPaths` are complete write families with literal first segments, distinct from Context anchors.

```sh
node "$PI_TICKET_PLANNING_ROOT/scripts/check-delivery-graph.mjs" --input -
```

Require `contract`, `scenarioCoverage`, `walkingSkeleton`, and `strictFrontier` to pass. This checker proves structural consistency only; semantic overlap and individual Ticket readiness still require review.

Also run each exact proposed candidate body through:

```sh
node "$PI_TICKET_PLANNING_ROOT/scripts/check-ticket-context.mjs" --repo <absolute-repository-path> --base <exact-base-sha> --input <candidate-body-file>
```

No anchors is a valid PASS. Any failed Context check is `NEEDS_INFO`, not a graph repair or a reason to infer a path.

### 4. Build and approve the graph

Assign only real blocking edges. Compute a stable topological order: for every internal `blocker -> dependent` edge, the blocker appears earlier in native child order. Preserve the approved order among simultaneously unblocked candidates. A cycle is `NEEDS_INFO`.

Present together:

- the Scenario coverage matrix and verdict;
- the walking-skeleton chain and verdict;
- exact numbered child order and blocker edges;
- each candidate's title, source scenarios, coverage role, primary outcome, primary verification, execution lane, AC count, delivery surfaces, blockers, and out of scope;
- the exact write set: current-Release child creation, parent-child links, blocker edges, and the Planning Case graph binding. The Parent body is not in the write set.
- the deterministic Delivery Graph checker result.

Wait for explicit approval of this exact split, graph, and write set. Approval does not authorize a ready label.

### 5. Publish the approved snapshot

Create every child with `needs-triage`, then attach native parent-child relationships and blocking edges in the approved stable topological order. Re-fetch the graph and run the configured strict-frontier check.

Use this child body:

    ## Parent
    Link to the accepted Delivery Spec and exact source/base identity.

    ## Source scenarios
    Stable Scenario IDs from the parent Spec.

    ## Coverage role
    DIRECT, or ENABLER with downstream consumers and an objective exit condition.

    ## Starting state
    The pre-existing state, input, or blocker-produced artifact from which work begins.

    ## What to build
    One sentence describing the observable or enabling outcome.

    ## Invariants and guardrails
    Stable source or repository rules that must remain true; use None only when none apply.

    ## Primary verification
    One behavioral seam or scenario that proves the outcome.

    ## Execution lane
    AGENT. HUMAN work uses Roadmap or a separate Human Execution artifact.

    ## Acceptance criteria
    - [ ] One independently verifiable assertion per item.

    ## Oracle binding
    High-risk only: one JSON fence with exact `pi-ticket-planning:oracle-binding:v1` fields and a closed `herdr-codex-controller:oracle-verifier-manifest:v1`. Omit this whole section for normal/low work.

    ## Execution constraints
    One JSON fence containing `implementationOwner`, `riskClasses`, `scopeBudget`, `expectedPaths`, `protectedPaths`, `replanTriggers`, `primaryVerificationSeams`, `integrationOnly`, and `waivers`.

    ## Blocked by
    Real prerequisites, or None.

    ## Decision sources
    Exact accepted identities, each stating the concern it decides.

    ## Out of scope
    Adjacent behavior excluded from this ticket.

Bind exactly one `pi-ticket-planning:delivery-release-graph:v3` artifact in the same Planning Case, using real tracker child identities throughout. The JSON is the durable current-Release Scenario matrix, handoff chain, child order, verifications, and blocker graph. Keep the exact Spec acceptance receipt inside it and leave the accepted Parent title/body untouched. Mapping proposed IDs to newly created tracker identities is mechanical; any changed behavior, mapping, role, verification, order, edge, receipt, or base requires renewed approval.

Re-fetch the bundle. `check-admission-state.mjs` re-reads Oracle/verifier bytes and the script definition, checks owner/body/v3 metadata, and rejects Release-global verifier/write overlap.

Any failed graph, coverage, skeleton, or frontier check leaves the parent and children in `needs-triage`. Any candidate, source, matrix, order, or blocker change requires renewed human approval and a rebuilt snapshot.

### 6. Prepare the recommended release handoff

Re-fetch the persisted parent, receipt, v3 graph, and current children. Report their identities, readiness state, both coverage verdicts, strict-frontier verdict, and current labels to `ask-yet`, then follow `prepare-codex-release`. Keep every child in `needs-triage`: the recommended path reviews and compiles exactly this one all-AGENT Release before selecting Goal or Controller. Roadmap, future `PLANNED` candidates, HUMAN work, legacy v2 graphs, and external blockers never enter either input. This route never writes ready labels. Only when the operator explicitly chooses Legacy Herdr per-ticket activation may it continue to `admit-ticket`.
