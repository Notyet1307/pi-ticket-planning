# Qualified Codex Controller mainline

## Status

The recommended execution path is the direct Planner-to-Controller handoff:

```text
pi-ticket-planning
→ exact Spec acceptance receipt
→ one accepted delivery-release-graph v3
→ human-approved execution handoff
→ Release Plan v2
→ operator executes Controller start
→ Controller run
```

The exact qualified Controller revision is owned by `compatibility/codex-controller-contract.json`. At the time of this qualification it is:

```text
50665339dce3fb94c24355fcc56015c3aadf0b36
```

The same lock pins Controller source-manifest digest `325e2914ec9d529704bdd9833dcc57dcc66c627b5811807f814db113c526be19`, build digest `5bf946759b0ed7c4449b7960ad933787e57109cee9aec3ef34833d51b8487c74`, and identity digest `af137f2ab44537588fe54ccf18a18c876b45fc5b6848af5e5babb09d2b23bb64`.

The machine scope is:

```text
integrationMode      = release-plan-v2-direct
dispatcherQualified  = false
operatorStartRequired = true
```

## What is qualified

- Controller `config validate`;
- Controller `plan validate`;
- Controller Oracle/protected-path checks before and after writing Workers, per-Issue/aggregate scope enforcement, and terminal replan on drift;
- Planner-owned Release Plan v2 schema bytes and canonical digest;
- the approved config digest, exact Controller revision, and complete provenance digest passed to the three v2 `start --expected-*` gates;
- live `doctor` config and Controller identity readback during handoff apply;
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

These commands are the required operator Git preflight. `execution-plan` additionally validates the public Controller identity/provenance readback against the compatibility lock; neither check replaces the other.

Then verify the cross-repository contract from the Planner checkout:

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run check:codex-controller-contract
npm run canary:codex-controller-contract -- --controller-root "$CONTROLLER_ROOT"
```

A PASS proves exact commit/runtime-identity readback, dirty-checkout rejection, schema bytes, config/Plan/provenance digest agreement, the v2 direct positive vector, closed-shape negatives, and Release Plan v1 exclusion. Dispatcher is not invoked or qualified. Handoff apply still performs the live `doctor` check with the approved config and Controller identity.

## Runtime sequence

`execution-plan apply` must only:

1. revalidate source, graph, review, policy, Controller config, Plan, provenance, and doctor;
2. materialize `release-plan.json`, `execution-handoff-plan.json`, and `execution-handoff-receipt.json`;
3. record `EXECUTION/HANDOFF_READY`;
4. consume the exact approval;
5. print the Controller `start --expected-config-digest ... --expected-controller-revision ... --expected-controller-provenance-digest ...` command.

It must not execute that command. The operator executes it to create the durable Controller Job, receives the Job ID, and separately runs `controller run`.

## Upgrade rule

A future Controller upgrade must be a new explicit compatibility change:

1. select one exact Controller commit;
2. verify the Release Plan v2 owner schema remains byte-identical or deliberately version the contract;
3. update the exact commit plus source-manifest/build/identity digests in the lock and its regression assertion;
4. run Controller `npm run verify`;
5. run Planner deterministic checks and the exact-source cross-repository canary;
6. keep Dispatcher excluded unless a separate admission authority, schema, tests, and evidence are introduced;
7. merge only after all required checks pass.

Never silently follow Controller `main`.
