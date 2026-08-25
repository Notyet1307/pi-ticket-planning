const STATUSES = new Set(["COMPLETE", "PARTIAL", "CONFLICT", "BLOCKED", "UNSUPPORTED", "INVALID", "DEGRADED"]);

export function resultEnvelope({
  command,
  status,
  data = {},
  problems = [],
  recovery = null,
  meta,
}) {
  if (typeof command !== "string" || !/^[a-z][a-z0-9.-]{0,127}$/.test(command)) throw new TypeError("invalid result command");
  if (!STATUSES.has(status)) throw new TypeError("invalid result status");
  if (!Array.isArray(problems) || problems.some(({ code }) => !/^[A-Z][A-Z0-9_]{0,127}$/.test(code ?? ""))) {
    throw new TypeError("invalid result problems");
  }
  return {
    schema: "pi-ticket-planning:result-envelope:v1",
    command,
    ok: status === "COMPLETE",
    status,
    data,
    problems,
    recovery,
    meta,
  };
}
