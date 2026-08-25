# Compatibility matrix

`compatibility/matrix.json` is the only compatibility status definition. Matrix
v2 matches the exact Pi version and binary digest, Subagent version, Provider,
model, Thinking, Profile digest, Harness version/config digest, package commit,
observation/review window, status, reason code, and four evidence references.
Wildcards are not accepted.

The v0.5 development baseline contains no qualified tuple, so every tuple is
`UNTESTED`. Configuration presence, a version whitelist, deterministic tests,
or an expired receipt cannot promote it. A future `SUPPORTED` or `DEGRADED`
entry requires retained active Capability, L2 model, L3 disposable integration,
and L4 Qualification evidence.

Use `pi-ticket-planctl compatibility propose --qualification FILE --capability
FILE --out FILE`, inspect the proposal, then apply it with
`compatibility apply --proposal FILE --qualification FILE --capability FILE
--expected-digest <proposal-digest>`.
Proposal and apply both fail when the Qualification, tuple, package commit,
Capability subject, or Matrix digest differs. Direct JSON editing is not a
supported promotion path.

Release artifact construction consumes the verified proposal as an immutable
overlay and writes the resulting Matrix into the installable archive. A source
Matrix apply changes Git HEAD, so it belongs in a separate PR followed by a new
Qualification; it is never treated as if the previous commit evidence covered
the new commit.
