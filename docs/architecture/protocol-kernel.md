# Protocol kernel

The kernel is the small interface in `protocol/kernel.mjs` over five machine
owners: the Artifact Registry, Rule Registry, Lane-Stage matrix, workflow, and
authority contract. `protocol/workflow.json` and `protocol/authority.json` are
verified links to the existing canonical `contracts/` files, so compatibility
does not create a second enum owner.

Callers use the kernel to parse artifact identities, validate subject-bound Fact
Attestations, evaluate a transition or mutation, and obtain the model-checker
report. Unknown majors fail before shape handling. Legacy `{value, source}` facts
enter only through `protocol/legacy-adapter.mjs`; new Planning Cases use
`fact-attestation:v1`.

`npm run verify:protocol` checks Registry identity/path/reader/writer/migration
declarations, code Schema coverage, Rule owners, state reachability, dead ends,
Fact producers/consumers, Mutation postconditions, authority ambiguity, and
identity/rebind declarations. The report lists remain the CI interface.

The Admission Plan v1 fingerprint algorithm remains recursive key ordering,
`JSON.stringify`, UTF-8, and SHA-256. Reviewer input binding changes what the
current writer includes in `reviewedFingerprint`; it does not change the
algorithm or silently reinterpret an old digest.
