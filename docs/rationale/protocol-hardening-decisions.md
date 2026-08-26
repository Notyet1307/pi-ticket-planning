# Protocol hardening decisions

- **Versioned Artifact Registry:** current and readable majors, one writer,
  readers, fingerprint algorithm, and migration path are machine data.
- **Fact Attestation:** a fact binds target, subject, revision, digest, producer,
  freshness, and evidence; text is never authority.
- **Persistent Planning Case:** event replay and transaction intent replace chat
  continuity as the recovery mechanism.
- **Single Authority Placement:** protocol links preserve the existing canonical
  workflow/authority files rather than copying their enums.
- **Capability Negotiation:** runtime support requires active evidence; the
  exact tuple is qualified separately from configuration presence.
- **Trust Model:** repository, tracker, provider, Harness, operator, and local
  state cross distinct seams; all content metadata defaults to no authority.
- **Outcome Learning Gate:** Outcome ingestion is read-only. Global learning
  requires a single-consume human attestation and still does not edit Kernel
  automatically.
- **Local JSON Schema runtime:** `ajv@8.20.0` and `ajv-formats@3.0.1` are exact
  runtime pins because Node has no Draft 2020-12 validator. The dispatcher loads
  only repository schemas, has no asynchronous/remote loader, and compiles every
  local `$id` under strict mode. Lockfile drift is therefore reviewable and no
  network-fetched Schema can influence a runtime decision.
