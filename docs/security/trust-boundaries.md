# Trust boundaries

Trust metadata is descriptive and never grants authority:

```yaml
trust:
  source: repository | tracker | operator | provider | harness | local-state
  level: untrusted | authenticated | authoritative
  mayInfluenceContent: true
  mayGrantAuthority: false
```

| Crossing | Transferred data or authority | Enforcing control |
| --- | --- | --- |
| Repository/Issue -> planner | Text, policy hints, candidate bodies | Treated as data; Fact producers are allowlisted by `PTP-AUTH-001` |
| Parent -> fresh Reviewer | One digest-bound projected input | Reviewer-only held-byte read adapter; output echoes the binding |
| Provider -> Admission | Review content only | Exact input binding plus deterministic Plan validation; model output grants no mutation authority |
| Operator -> Admission | One exact Plan approval | Subject-bound, single-consume Human Approval |
| Admission -> GitHub | Planned comments and controlled labels | Actor check, pre-read drift checks, claim check, exact readback, parent last |
| Harness -> planner | Capability/readiness and Outcome Receipts | Exact repo/base/config/producer/freshness projection; read-only Outcome ingestion |
| Process -> local state | Case events, snapshots, transactions | Realpath containment, 0700/0600, no links, exclusive lock, digest chain, roll-forward recovery |

Authenticated Tracker state can establish a Tracker Fact. It cannot establish a
human Commitment. An operator approval authorizes one mutation subject. It does
not make Provider, Tracker, repository, or Harness content authoritative for a
different subject.
