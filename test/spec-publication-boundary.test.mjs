import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { requireAdmissionCapabilities } from "../capabilities/admission.mjs";
import { createPlanningCaseStore } from "../planning-case/store.mjs";
import { verifyPlanningCaseBindings } from "../planning-case/bindings.mjs";
import { createFactAttestation, loadProtocol, producerAttestationSource } from "../protocol/kernel.mjs";
import { EXECUTABLE_DELIVERY_SPEC_MARKER, ROADMAP_GRAPH_MARKER } from "../scripts/check-delivery-graph.mjs";
import { runSpecPublicationCli } from "../spec-publication/cli.mjs";
import {
  applySpecPublication,
  buildSpecPublicationPlan,
  createSpecPublicationApproval,
  digestBytes,
  recordSpecPublicationArtifacts,
  verifySpecPublicationContext,
} from "../spec-publication/publication.mjs";
import { qualifiedCapability } from "./capability-fixture.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const TARGET = "github:Notyet1307/example";
const REPO = "Notyet1307/example";
const BASE = "a".repeat(40);
const NOW = "2026-08-28T01:00:00.000Z";
const SUBJECT = {
  target: TARGET,
  kind: "release",
  id: "R003",
  revision: "r1",
  digest: `sha256:${"b".repeat(64)}`,
};

const hash = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

function specCase(t, storeOptions = {}) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-spec-publication-"));
  t.after(() => fs.rmSync(stateDir, { recursive: true, force: true }));
  const store = createPlanningCaseStore({ stateDir, clock: () => NOW, ...storeOptions });
  const caseId = "PC-existing-spec";
  store.create({ target: TARGET, caseId });
  const protocol = loadProtocol();
  let ordinal = 0;
  const facts = (names, mutationId = null) => names.map((name) => {
    const rule = { ...protocol.authority.factDefaults, ...protocol.authority.facts[name] };
    const sourceKind = rule.sources[0];
    const producer = protocol.producers.sources[sourceKind].producers[0];
    ordinal += 1;
    return createFactAttestation({
      id: `F-spec-boundary-${ordinal}`,
      fact: name,
      value: true,
      subject: SUBJECT,
      source: producerAttestationSource(sourceKind, producer, { protocol, producerVersion: "test" }),
      observedAt: NOW,
      expiresAt: rule.freshness?.mode === "max-age"
        ? new Date(Date.parse(NOW) + rule.freshness.maxAgeMs).toISOString()
        : null,
      ...(rule.freshness?.mode === "same-mutation" ? { mutationId } : {}),
      evidence: { kind: rule.owner === "human" ? "operator" : "artifact", ref: `spec-boundary:${name}:${ordinal}`, digest: hash(`${name}:${ordinal}`) },
    });
  });
  const nextAction = { kind: "SKILL", command: null, skill: "to-spec", requiredInputs: [], blockingFacts: [], contextRoute: "DELIVERY/SPEC/SPEC_IN_PROGRESS", reasonCode: "DELIVERY_SPEC_DRAFT_IN_PROGRESS" };
  const transition = (lane, stage, verdict, names, rebind = false) => store.transition({
    caseId,
    target: TARGET,
    checkpoint: { schema: "pi-ticket-planning:checkpoint:v2", lane, stage, verdict, subject: SUBJECT },
    facts: facts(names),
    rebind,
    nextAction,
  });
  transition("PRODUCT", "FRAME", "FRAME_CANDIDATE", ["human.targetSelected"], true);
  transition("PRODUCT", "EVIDENCE", "EVIDENCE_RECORDED", ["evidence.persisted"]);
  transition("PRODUCT", "COMMIT", "COMMITTED", ["release.readinessPassed", "human.commitment", "release.persisted"]);
  transition("DELIVERY", "SPEC", "SPEC_IN_PROGRESS", ["human.commitment", "release.persisted", "release.accepted", "git.deliveryBase"]);
  return { store, caseId, stateDir };
}

function publicationContext(caseId) {
  return {
    caseId,
    repo: REPO,
    source: {
      identity: "R003",
      revision: "r1",
      status: "COMMITTED",
      baseRef: "refs/remotes/origin/main",
      baseSha: BASE,
      path: "docs/product/releases/r003.md",
      blobDigest: `sha256:${"d".repeat(64)}`,
      digest: SUBJECT.digest,
    },
    policy: { identity: `AGENTS.md@${BASE}`, path: "AGENTS.md", digest: `sha256:${"e".repeat(64)}`, accepted: true },
    adrs: [{ identity: `ADR-0003@${BASE}`, path: "docs/adr/0003-boundary.md", digest: `sha256:${"f".repeat(64)}`, accepted: true }],
    tracker: {
      kind: "GITHUB",
      repo: REPO,
      configured: true,
      labels: ["needs-triage"],
      issueTracker: { path: "docs/agents/issue-tracker.md", digest: `sha256:${"1".repeat(64)}` },
      triageLabels: { path: "docs/agents/triage-labels.md", digest: `sha256:${"2".repeat(64)}` },
    },
  };
}

class MemorySpecTracker {
  constructor({ loseCreateResponse = false } = {}) {
    this.calls = [];
    this.issues = [];
    this.loseCreateResponse = loseCreateResponse;
  }

  findByMarker(marker) {
    this.calls.push({ operation: "find", marker });
    return this.issues.filter(({ body }) => body.includes(marker)).map((issue) => structuredClone(issue));
  }

  createIssue({ title, body, labels }) {
    this.calls.push({ operation: "create", title, body, labels: [...labels] });
    const issue = { number: String(40 + this.issues.length), title, body, labels: [...labels], state: "open", updatedAt: NOW };
    this.issues.push(issue);
    if (this.loseCreateResponse) {
      this.loseCreateResponse = false;
      throw new Error("CREATE_RESPONSE_LOST");
    }
    return structuredClone(issue);
  }

  readIssue(number) {
    this.calls.push({ operation: "read", number: String(number) });
    return structuredClone(this.issues.find((issue) => issue.number === String(number)));
  }
}

function publicationSetup(t, trackerOptions, releaseOverrides = {}) {
  let tracker;
  const execute = (command, args) => {
    if (command !== "gh") return { status: 1, stdout: "", stderr: "unsupported" };
    const number = args.at(-1).split("/").at(-1);
    const issue = tracker?.issues.find((item) => item.number === number);
    return issue
      ? { status: 0, stdout: JSON.stringify({ ...issue, updated_at: issue.updatedAt }), stderr: "" }
      : { status: 1, stdout: "", stderr: "missing" };
  };
  const bindingVerifier = (bindings, snapshot, options) => verifyPlanningCaseBindings(bindings, snapshot, { ...options, execute });
  const ready = specCase(t, { bindingVerifier });
  const context = publicationContext(ready.caseId);
  ready.store.bind({
    caseId: ready.caseId,
    target: TARGET,
    name: "release",
    binding: {
      schema: "pi-ticket-planning:release-projection:v1",
      target: TARGET,
      id: context.source.identity,
      revision: context.source.revision,
      status: "COMMITTED",
      source: {
        ref: releaseOverrides.baseRef ?? context.source.baseRef,
        baseSha: releaseOverrides.baseSha ?? context.source.baseSha,
        path: releaseOverrides.path ?? context.source.path,
        blobDigest: releaseOverrides.blobDigest ?? context.source.blobDigest,
      },
      digest: releaseOverrides.digest ?? context.source.digest,
    },
  });
  const draft = `# R003 Delivery Spec

## Source
R003/r1 at ${BASE}; policy AGENTS.md; ADR-0003.

## Problem statement
One problem.

## Delivery outcome
One outcome.

## Behavioral scenarios
### S1: One scenario
One observable result.

## Release signal mapping
S1 maps to one signal.

## Walking skeleton target
S1 closes the loop.

## Decisions
Decided.

## Verification strategy
Verify S1.

## Constraints and dependencies
None.

## Out of scope
Everything else.

## Unresolved decisions
None.
`;
  const contextPath = path.join(ready.stateDir, "spec-publication-context.json");
  const draftPath = path.join(ready.stateDir, "r003-delivery-spec-draft.md");
  const planPath = path.join(ready.stateDir, "spec-publication-plan.json");
  const contextBytes = Buffer.from(`${JSON.stringify(context, null, 2)}\n`);
  fs.writeFileSync(contextPath, contextBytes, { mode: 0o600 });
  fs.writeFileSync(draftPath, draft, { mode: 0o600 });
  const plan = buildSpecPublicationPlan({ context, draftBytes: Buffer.from(draft), artifacts: { contextPath, contextDigest: digestBytes(contextBytes), draftPath, planPath } });
  assert.equal(plan.draftDigest, hash(draft));
  assert.equal(plan.issue.bodyDigest, hash(plan.issue.body));
  assert.equal(plan.issue.body.split(EXECUTABLE_DELIVERY_SPEC_MARKER).length - 1, 1);
  fs.writeFileSync(planPath, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600 });
  recordSpecPublicationArtifacts({ plan, store: ready.store, clock: () => NOW });
  const approval = createSpecPublicationApproval({ plan, correlationId: "C-spec-publication", observedAt: NOW });
  ready.store.addApproval({ caseId: ready.caseId, target: TARGET, approval });
  tracker = new MemorySpecTracker(trackerOptions);
  const applyWithStore = (store) => applySpecPublication({
    plan,
    preflight: ({ context: fresh }) => fresh,
    adapter: tracker,
    store,
    caseId: ready.caseId,
    approvalId: approval.id,
    expectedFingerprint: plan.planFingerprint,
    clock: () => NOW,
  });
  const apply = () => applyWithStore(ready.store);
  const reopenStore = () => createPlanningCaseStore({ stateDir: ready.stateDir, clock: () => NOW, bindingVerifier });
  return { ...ready, context, draft, plan, approval, tracker, apply, applyWithStore, reopenStore, contextPath, draftPath, planPath };
}

test("Controller-direct SPEC publication succeeds with no Legacy compatibility tuple", (t) => {
  const ready = publicationSetup(t);
  const resumed = ready.store.resume({ caseId: ready.caseId, target: TARGET });
  assert.equal(resumed.compatibility.capabilities, "UNTESTED");
  assert.equal(resumed.mutationAllowed, false);
  assert.deepEqual(resumed.mutationScopes, {
    planningPublication: { allowed: true, reasonCode: "ONLINE_PLANNING" },
    legacyAdmission: { allowed: false, reasonCode: "CAPABILITY_RECEIPT_MISSING" },
  });
  assert.equal(ready.apply().status, "COMPLETE");
  const snapshot = ready.store.get({ caseId: ready.caseId, target: TARGET });
  assert.equal(snapshot.checkpoint.verdict, "SPEC_ACCEPTED");
  assert.equal(snapshot.bindings.spec.contentDigest, hash(ready.plan.issue.body));
  assert.equal(snapshot.bindings.spec.acceptance.parent.bodyHash, ready.plan.issue.bodyDigest);
  assert.equal(snapshot.bindings.spec.acceptance.decision.approvalId, ready.approval.id);
  assert.equal(ready.apply().acceptance.digest, snapshot.bindings.spec.acceptance.digest);
  assert.equal(applySpecPublication({
    plan: ready.plan,
    current: { context: ready.context, draftBytes: Buffer.from(ready.draft) },
    preflight: ({ context }) => context,
    adapter: ready.tracker,
    store: ready.store,
    caseId: ready.caseId,
    approvalId: ready.approval.id,
    expectedFingerprint: ready.plan.planFingerprint,
    clock: () => "2026-08-28T03:00:00.000Z",
  }).status, "COMPLETE");
  assert.equal(ready.tracker.calls.filter(({ operation }) => operation === "create").length, 1);
  ready.tracker.issues[0].body += "drift";
  assert.throws(() => ready.store.resume({ caseId: ready.caseId, target: TARGET }), (error) => error.code === "BINDING_READBACK_DRIFT");
});

test("Spec publication uses the latest attestation when an older duplicate was superseded", (t) => {
  const ready = publicationSetup(t);
  const accepted = ready.store.get({ caseId: ready.caseId, target: TARGET }).facts.find(({ fact }) => fact === "release.accepted");
  for (const [suffix, value] of [["superseded", false], ["current", true]]) {
    ready.store.record({
      caseId: ready.caseId,
      target: TARGET,
      type: "FACT_ATTACHED",
      data: {
        fact: {
          ...structuredClone(accepted),
          id: `F-release-accepted-${suffix}`,
          value,
          evidence: { kind: "artifact", ref: `spec-boundary:release.accepted:${suffix}`, digest: hash(suffix) },
        },
      },
    });
  }

  assert.equal(ready.apply().status, "COMPLETE");
});

test("Spec publication approval can be refreshed after its producer binding becomes invalid", (t) => {
  const ready = publicationSetup(t);
  const snapshot = ready.store.get({ caseId: ready.caseId, target: TARGET });
  const invalid = structuredClone(ready.approval);
  invalid.source.producerDigest = `sha256:${"0".repeat(64)}`;
  snapshot.approvals = { pending: [invalid], consumed: [] };
  let refreshed = null;
  const store = {
    get: () => structuredClone(snapshot),
    addApproval: ({ approval }) => { refreshed = approval; },
  };
  let output = "";
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => { output += chunk; return true; };
  try {
    assert.equal(runSpecPublicationCli([
      "approve",
      "--plan", ready.planPath,
      "--expected-fingerprint", ready.plan.planFingerprint,
      "--case-id", ready.caseId,
      "--json",
    ], { storeFactory: () => store, clock: () => NOW, correlationId: "C-refreshed-spec-approval" }), 0);
  } finally {
    process.stdout.write = originalWrite;
  }
  assert.equal(JSON.parse(output).status, "COMPLETE");
  assert.equal(refreshed.subject.digest, ready.plan.planFingerprint);
});

test("Spec publication apply ignores an invalid superseded approval for the same exact plan", (t) => {
  const ready = publicationSetup(t);
  const invalid = structuredClone(ready.approval);
  invalid.id = "F-human-spec-publication-superseded";
  invalid.source.producerDigest = `sha256:${"0".repeat(64)}`;
  const store = new Proxy(ready.store, {
    get(target, property) {
      if (property === "get") {
        return (options) => {
          const snapshot = target.get(options);
          snapshot.approvals.pending.unshift(invalid);
          return snapshot;
        };
      }
      const value = target[property];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  assert.equal(ready.applyWithStore(store).status, "COMPLETE");
  assert.equal(ready.store.get({ caseId: ready.caseId, target: TARGET }).approvals.consumed[0].id, ready.approval.id);
});

test("Delivery Spec publication excludes Legacy Admission qualification and runtime review", (t) => {
  const ready = publicationSetup(t);
  ready.apply();
  assert.deepEqual(ready.tracker.calls.map(({ operation }) => operation), ["find", "create", "read", "read"]);
  const toSpec = read("skills/to-spec/SKILL.md");
  const publication = toSpec.slice(toSpec.indexOf("### 5. Verify and publish the draft"), toSpec.indexOf("### 6. Complete"));
  assert.match(publication, /planning-artifact publication boundary/);
  assert.match(publication, /Do not invoke Legacy Herdr Admission, Harness readiness, capability qualification, compatibility matrix, a Reviewer, or Controller checks/);
  assert.doesNotMatch(publication, /doctor --require admission|admit readiness|ticket-readiness-reviewer/);

  const setup = read("skills/setup-delivery-repository/SKILL.md");
  assert.match(setup, /Planning publication completion/);
  assert.match(setup, /Optional Legacy Herdr completion/);
  assert.match(setup, /Only when the operator explicitly selects Legacy Herdr/);
});

test("Delivery Spec publication writes needs-triage and never writes ready-for-agent", (t) => {
  const ready = publicationSetup(t);
  ready.apply();
  const create = ready.tracker.calls.find(({ operation }) => operation === "create");
  assert.deepEqual(create.labels, ["needs-triage"]);
  assert.equal(create.labels.includes("ready-for-agent"), false);
  assert.equal(create.labels.includes("ready-for-human"), false);
  const toSpec = read("skills/to-spec/SKILL.md");
  const publication = toSpec.slice(toSpec.indexOf("### 5. Verify and publish the draft"), toSpec.indexOf("### 6. Complete"));
  assert.match(publication, /The exact write set is one parent Issue with labels \[`needs-triage`\]/);
  assert.match(publication, /Do not add `ready-for-agent` or `ready-for-human`/);
});

test("Spec self-check rejects a missing required section", (t) => {
  const ready = publicationSetup(t);
  const broken = ready.draft.replace("## Release signal mapping", "## Missing mapping");
  assert.throws(() => buildSpecPublicationPlan({
    context: ready.context,
    draftBytes: Buffer.from(broken),
    artifacts: { contextPath: ready.contextPath, contextDigest: ready.plan.artifacts.context.digest, draftPath: ready.draftPath, planPath: ready.planPath },
  }), /SPEC_STRUCTURE_CHECK_FAILED/);
  for (const marker of [EXECUTABLE_DELIVERY_SPEC_MARKER, ROADMAP_GRAPH_MARKER]) {
    assert.throws(() => buildSpecPublicationPlan({
      context: ready.context,
      draftBytes: Buffer.from(`${ready.draft}\n${marker}`),
      artifacts: { contextPath: ready.contextPath, contextDigest: ready.plan.artifacts.context.digest, draftPath: ready.draftPath, planPath: ready.planPath },
    }), /SPEC_PARENT_KIND_MARKER_CONFLICT/);
  }
});

test("Spec preflight rereads exact Git authorities and live tracker label", (t) => {
  const repository = fs.mkdtempSync(path.join(os.tmpdir(), "ptp-spec-preflight-repo-"));
  t.after(() => fs.rmSync(repository, { recursive: true, force: true }));
  const files = {
    "docs/product/releases/r003.md": "# R003/r1\n",
    "AGENTS.md": "# Policy\n",
    "docs/adr/0003-boundary.md": "# ADR\n\n- Status: ACCEPTED\n",
    "docs/adr/0004-localized.md": "# ADR\n\n状态：已接受\n",
    "docs/agents/issue-tracker.md": "# Issue tracker: GitHub\n",
    "docs/agents/triage-labels.md": "needs-triage\n",
  };
  for (const [relative, bytes] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repository, relative)), { recursive: true });
    fs.writeFileSync(path.join(repository, relative), bytes);
  }
  const run = (args) => spawnSync("git", args, { cwd: repository, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "test", GIT_COMMITTER_EMAIL: "test@example.invalid" } });
  assert.equal(run(["init", "-q"]).status, 0);
  assert.equal(run(["add", "."]).status, 0);
  assert.equal(run(["commit", "-qm", "base"]).status, 0);
  assert.equal(run(["remote", "add", "origin", "https://github.com/Notyet1307/example.git"]).status, 0);
  const baseSha = run(["rev-parse", "HEAD"]).stdout.trim();
  const context = publicationContext("PC-existing-spec");
  Object.assign(context.source, { baseRef: "HEAD", baseSha, blobDigest: hash(files["docs/product/releases/r003.md"]) });
  Object.assign(context.policy, { digest: hash(files["AGENTS.md"]) });
  Object.assign(context.adrs[0], { digest: hash(files["docs/adr/0003-boundary.md"]) });
  context.adrs.push({
    identity: `ADR-0004@${baseSha}`,
    path: "docs/adr/0004-localized.md",
    digest: hash(files["docs/adr/0004-localized.md"]),
    accepted: true,
  });
  Object.assign(context.tracker.issueTracker, { digest: hash(files["docs/agents/issue-tracker.md"]) });
  Object.assign(context.tracker.triageLabels, { digest: hash(files["docs/agents/triage-labels.md"]) });
  let labelReads = 0;
  const adapter = { hasLabel(name) { labelReads += 1; return name === "needs-triage"; } };
  assert.deepEqual(verifySpecPublicationContext({ context, repositoryPath: repository, adapter }), context);
  assert.equal(labelReads, 1);
  const drifted = structuredClone(context);
  drifted.source.blobDigest = `sha256:${"0".repeat(64)}`;
  assert.throws(() => verifySpecPublicationContext({ context: drifted, repositoryPath: repository, adapter }), /SPEC_SOURCE_BLOB_DRIFT/);
});

test("prepare-codex-release keeps one fresh graph review and the semantic handoff checks", () => {
  const prepare = read("skills/prepare-codex-release/SKILL.md");
  assert.equal((prepare.match(/ticket-readiness-reviewer/g) ?? []).length, 1);
  assert.match(prepare, /one fresh, read-only `ticket-readiness-reviewer` graph review/);
  for (const required of ["one `release-plan.json`", "controllerContractVersion: 1", "--approve-plan", "approval is consumed once"]) {
    assert.match(prepare, new RegExp(required));
  }
});

test("explicit Legacy Herdr Admission still fails closed on an empty compatibility matrix", () => {
  const harness = { readiness: { projection: { configDigest: `sha256:${"c".repeat(64)}` } } };
  const { receipt } = qualifiedCapability(REPO, BASE, harness, "2026-08-28T00:00:00.000Z");
  assert.throws(() => requireAdmissionCapabilities(receipt, {
    repo: REPO,
    baseSha: BASE,
    now: NOW,
    matrix: { schema: "pi-ticket-planning:compatibility-matrix:v2", defaultStatus: "UNTESTED", entries: [] },
  }), /CAPABILITY_TUPLE_UNTESTED/);
  assert.match(read("skills/admit-ticket/SKILL.md"), /use this skill only when the operator explicitly selects per-ticket Herdr labels/);
});

test("Spec publication rejects draft drift before any tracker call and preserves approval", (t) => {
  const ready = publicationSetup(t);
  assert.throws(() => applySpecPublication({
    plan: ready.plan,
    current: { context: ready.context, draftBytes: Buffer.from(`${ready.draft}drift`) },
    preflight: ({ context }) => context,
    adapter: ready.tracker,
    store: ready.store,
    caseId: ready.caseId,
    approvalId: ready.approval.id,
    expectedFingerprint: ready.plan.planFingerprint,
    clock: () => NOW,
  }), /SPEC_PUBLICATION_DRIFT/);
  assert.deepEqual(ready.tracker.calls, []);
  assert.equal(ready.store.get({ caseId: ready.caseId, target: TARGET }).approvals.pending.some(({ id }) => id === ready.approval.id), true);
});

test("Spec publication rejects a Case release binding mismatch before tracker access", (t) => {
  const ready = publicationSetup(t, undefined, { baseSha: "c".repeat(40) });
  assert.throws(() => ready.apply(), /SPEC_PUBLICATION_CASE_SOURCE_MISMATCH/);
  assert.deepEqual(ready.tracker.calls, []);
  assert.equal(ready.store.get({ caseId: ready.caseId, target: TARGET }).approvals.pending.some(({ id }) => id === ready.approval.id), true);
});

test("Spec publication revalidates approval immediately before create", (t) => {
  const ready = publicationSetup(t);
  const times = [NOW, "2026-08-28T03:00:00.000Z"];
  assert.throws(() => applySpecPublication({
    plan: ready.plan,
    preflight: ({ context }) => context,
    adapter: ready.tracker,
    store: ready.store,
    caseId: ready.caseId,
    approvalId: ready.approval.id,
    expectedFingerprint: ready.plan.planFingerprint,
    clock: () => times.shift() ?? times.at(-1),
  }), /INVALID_SPEC_PUBLICATION_APPROVAL/);
  assert.equal(ready.tracker.calls.some(({ operation }) => operation === "create"), false);
  assert.equal(ready.store.get({ caseId: ready.caseId, target: TARGET }).approvals.pending.some(({ id }) => id === ready.approval.id), true);
});

test("resume preserves one existing Planning Case, draft bytes, decisions, facts, and approval state", (t) => {
  const ready = publicationSetup(t, { loseCreateResponse: true });
  const { store, caseId, stateDir } = ready;
  const draft = path.join(stateDir, "r003-delivery-spec-draft.md");
  fs.writeFileSync(draft, ready.draft, { mode: 0o600 });
  store.record({
    caseId,
    target: TARGET,
    type: "DECISION_RECORDED",
    data: { decision: { id: "R003-existing-decision", subject: SUBJECT, decision: "KEEP_EXISTING", rationaleRef: "existing-case", observedAt: NOW } },
  });
  const before = store.get({ caseId, target: TARGET });

  assert.equal(store.resume({ caseId, target: TARGET }).mutationScopes.planningPublication.allowed, true);
  assert.throws(() => ready.apply(), /CREATE_RESPONSE_LOST/);
  const interrupted = store.get({ caseId, target: TARGET });
  assert.equal(interrupted.approvals.pending.some(({ id }) => id === ready.approval.id), true);
  assert.equal(interrupted.approvals.consumed.some(({ id }) => id === ready.approval.id), false);
  const reopened = ready.reopenStore();
  assert.equal(ready.applyWithStore(reopened).status, "COMPLETE");

  const after = reopened.get({ caseId, target: TARGET });
  assert.deepEqual(after.facts.slice(0, before.facts.length), before.facts);
  assert.deepEqual(after.decisions, before.decisions);
  assert.equal(after.approvals.pending.some(({ id }) => id === ready.approval.id), false);
  assert.equal(after.approvals.consumed.filter(({ id }) => id === ready.approval.id).length, 1);
  assert.equal(after.bindings.spec.contentDigest, hash(ready.plan.issue.body));
  assert.deepEqual(store.list({ target: TARGET }).map(({ caseId: id }) => id), [caseId]);
  assert.equal(fs.readFileSync(draft, "utf8"), ready.draft);
  assert.equal(ready.tracker.calls.filter(({ operation }) => operation === "create").length, 1);
  assert.match(read("skills/to-spec/SKILL.md"), /Reuse the exact existing draft bytes; do not regenerate the Spec or create another Planning Case/);
});
