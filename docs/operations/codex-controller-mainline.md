# Qualified Codex Controller mainline

## Status

The recommended execution path is the direct Planner-to-Controller handoff:

```text
pi-ticket-planning
→ accepted Delivery Graph v2
→ human-approved execution handoff
→ Release Plan v2
→ operator executes Controller start
→ Controller run
```

The exact qualified Controller revision is owned by `compatibility/codex-controller-contract.json`. At the time of this qualification it is:

```text
b1afa0127dd0b51e210757e9baf150d2d2851326
```

The machine scope is:

```text
integrationMode      = release-plan-v2-direct
dispatcherQualified  = false
operatorStartRequired = true
```

## What is qualified

- Controller `config validate`;
- Controller `plan validate`;
- Planner-owned Release Plan v2 schema bytes and canonical digest;
- the approved config digest passed to `start --expected-config-digest`;
- live `doctor` during handoff apply;
- operator-explicit creation of a Controller Job;
- Controller-owned execution, validation, aggregate review, PR, CI, and merge after the operator starts the Job.

## What is not qualified

- Controller `dispatch`;
- `ready-for-agent` as the authorization for this path;
- Dispatcher config or claim state;
- conversion of one approved multi-Issue Release Plan v2 into multiple per-Issue Release Plan v1 jobs;
- Planner reads of Controller private `job.json`;
- Controller result ingestion back into Planner before a stable public export/status contract exists.

The Controller repository may contain Dispatcher implementation and pinned model routing. Their presence does not change the Planner integration scope.

## Deployment procedure

Use an exact, clean Controller checkout:

```bash
CONTROLLER_ROOT=/absolute/herdr-codex-controller
LOCKED_COMMIT=$(node -p 'require("./compatibility/codex-controller-contract.json").commit')

git -C "$CONTROLLER_ROOT" fetch --all --tags --prune
git -C "$CONTROLLER_ROOT" checkout --detach "$LOCKED_COMMIT"
test -z "$(git -C "$CONTROLLER_ROOT" status --porcelain=v1 --untracked-files=all)"

npm --prefix "$CONTROLLER_ROOT" ci --ignore-scripts --no-audit --no-fund
npm --prefix "$CONTROLLER_ROOT" run verify
```

These commands are the required operator preflight. The `execution-plan` CLI does not infer or attest the Controller checkout or built CLI provenance; without this exact clean readback, do not build or apply a handoff.

Then verify the cross-repository contract from the Planner checkout:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check:codex-controller-contract
npm run canary:codex-controller-contract -- --controller-root "$CONTROLLER_ROOT"
```

A PASS proves the exact static schema and digest boundary. Handoff apply still performs the live `doctor` check with the approved config digest.

## Runtime sequence

`execution-plan apply` must only:

1. revalidate source, graph, review, policy, Controller config, Plan, and doctor;
2. materialize `release-plan.json`, `execution-handoff-plan.json`, and `execution-handoff-receipt.json`;
3. record `EXECUTION/HANDOFF_READY`;
4. consume the exact approval;
5. print the Controller `start --expected-config-digest ...` command.

It must not execute that command. The operator executes it to create the durable Controller Job, receives the Job ID, and separately runs `controller run`.

## Upgrade rule

A future Controller upgrade must be a new explicit compatibility change:

1. select one exact Controller commit;
2. verify the Release Plan v2 owner schema remains byte-identical or deliberately version the contract;
3. update the lock and its regression assertion;
4. run Controller `npm run verify`;
5. run Planner deterministic checks and the exact-source cross-repository canary;
6. keep Dispatcher excluded unless a separate admission authority, schema, tests, and evidence are introduced;
7. merge only after all required checks pass.

Never silently follow Controller `main`.
