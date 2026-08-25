# Admission boundary

Admission is split by concern under `admission/`: domain and fingerprint rules,
Plan construction, validation, apply, recovery/readback, GitHub adapter, Reviewer
transport, and CLI. `scripts/admit.mjs` preserves the existing command and named
exports as a compatibility entry.

The current writer projects refreshed Tracker/Source/Policy/Context/Harness data
into one private Reviewer input. A child-only read guard captures the single 0600
file through a descriptor and serves only those bytes and the configured Skill.
The Reviewer echoes the safe binding; Plan construction recomputes it, stores it
inside the reviewed state, and therefore binds it through the unchanged Plan v1
fingerprint algorithm.

The formal CLI also requires a fresh Capability Receipt and an exact
`SUPPORTED` compatibility tuple before Plan or Apply. The development matrix is
empty, so formal Admission is intentionally blocked until active probes and
release qualification create evidence.

Apply preserves the v0.4 invariants: exact expected fingerprint; all drift checks;
blocker-first children; comment then labels; claim check before each write;
parent activation last; exact author/body marker readback; ambiguous-write
recovery; final readback; and distinct `COMPLETE`, `PARTIAL`, and `CONFLICT`.
The actual mutation is authorized by the v0.5 protocol kernel with exact
FactAttestations for Source, Policy, Graph, Reviewer, and human activation. The
human attestation is read from the target-partitioned Planning Case and consumed
only after final readback; a completed approval cannot authorize another Apply.
