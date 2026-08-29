# Fixtures

`execution-plan-cases.json` is a deterministic contract fixture for the recommended Controller route. It is not model, live Controller, Provider, or GitHub-write evidence.

`ticket-readiness-contract-cases.json` and `oracles/accord/o01.json` cover Oracle/risk/scope readiness failures and one frozen positive Oracle; they are deterministic regression evidence, not customer or runtime proof.

`fresh-handoff-cases.json` pins the cross-repository C1/C2 freshness and drift vectors. A passing canary proves the public Planner/Controller contract only; it does not prove a live Job, Codex run, PR, merge, or deployment.

Fixtures are regression inputs and evidence. They do not define current behavior, and quarantined cases are not Release requirements.

Ordinary agents should not load the entire fixture corpus. When changing one evaluation behavior, read only the applicable manifest and named cases.

On conflict, `contracts/` and the owning Skills or references take precedence.
