# Compatibility matrix

`compatibility/matrix.json` is the only compatibility status definition. It
matches the exact Pi version, Subagent version, Provider, model, Profile digest,
and Harness config digest from a fresh Capability Receipt. Wildcards are not
accepted.

The v0.5 development baseline contains no qualified tuple, so every tuple is
`UNTESTED`. Configuration presence, a version whitelist, deterministic tests,
or an expired receipt cannot promote it. A future `SUPPORTED` or `DEGRADED`
entry requires retained active-probe and release-qualification evidence.
