# Testing tiers

| Tier | Command | What it proves | Current evidence |
| --- | --- | --- | --- |
| L1 deterministic | `npm run verify:ci` | Protocol/context checks, tests, and local performance threshold | Executed locally |
| L2 model behavioral | `npm run test:model` | Real Pi/model behavior with first-pass and retry attempts | Not executed for this branch |
| L3 real disposable integration | `npm run test:integration:live` | Allowlisted real adapter scenarios and cleanup | Runner/guards exist; no live adapter report |
| L4 release qualification | `npm run release:qualify` | >=50 controlled executions, >=1 exact supported tuple, >=60 first attempts, >=95% first-pass, 100% eventual/recovery/cleanup, zero unauthorized/unclassified failures | Correctly BLOCKED without attested reports |

`npm run test:integration:mock` is L1/Mock evidence. It does not become L3 by
using a realistic fixture. `npm run benchmark` exercises 100/500/1000 Ticket
graphs and 10/50 Planning Cases and reports CPU, memory, filesystem estimates,
P50/P95, and zero external/model calls.

`npm run test:coverage` fails below 90% aggregate line, branch, or function
coverage across the Kernel/Schema dispatcher, Planning Case store/events/online
bindings, and Admission apply/recovery/postconditions core. The report retains
each file row; a low file is not described as 90% by itself. `npm run
test:coverage:all` separately reports the whole repository without relabeling
the selected-core percentage as whole-repository coverage.

Every L3 resource is tagged `ptp-e2e:<run-id>`. A write run additionally requires
the enable flag, exact allowlisted repository, and run-bound confirmation. A
missing real adapter remains `UNTESTED`.
Recovery rate is successful eventual outcomes divided by scenarios that actually
attempted recovery; no recovery attempts produce `0`, not synthetic success.
