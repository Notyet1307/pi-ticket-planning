import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { createPlanningCaseStore } from "../planning-case/store.mjs";
import { safeError } from "../admission/domain.mjs";
import {
  applySpecPublication,
  buildSpecPublicationPlan,
  createGitHubSpecPublicationAdapter,
  createSpecPublicationApproval,
  digestBytes,
  recordSpecPublicationArtifacts,
  validateSpecPublicationPlan,
  verifyRecordedSpecPublicationArtifacts,
  verifySpecPublicationContext,
} from "./publication.mjs";

function parse(argv) {
  const [command, ...rest] = argv;
  const options = new Map();
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token?.startsWith("--") || options.has(token.slice(2))) throw new Error("INVALID_OPTIONS");
    const name = token.slice(2);
    if (name === "json") { options.set(name, true); continue; }
    const value = rest[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error("INVALID_OPTIONS");
    options.set(name, value);
    index += 1;
  }
  return { command, options };
}

function requireOptions(options, allowed, required) {
  for (const name of options.keys()) if (!allowed.includes(name)) throw new Error(`UNKNOWN_OPTION:${name}`);
  for (const name of required) if (!options.has(name)) throw new Error(`MISSING_OPTION:${name}`);
}

function json(file) {
  const value = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_JSON_INPUT");
  return value;
}

function draft(file) {
  const target = path.resolve(file);
  const metadata = fs.lstatSync(target);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("UNSAFE_SPEC_DRAFT");
  return fs.readFileSync(target);
}

function write(file, value) {
  const target = path.resolve(file);
  const output = `${JSON.stringify(value, null, 2)}\n`;
  if (fs.existsSync(target)) {
    if (fs.readFileSync(target, "utf8") !== output) throw new Error("SPEC_PUBLICATION_PLAN_OUTPUT_CONFLICT");
    return target;
  }
  fs.writeFileSync(target, output, { encoding: "utf8", mode: 0o600, flag: "wx" });
  fs.chmodSync(target, 0o600);
  return target;
}

export function runSpecPublicationCli(argv = process.argv.slice(2), { adapterFactory = createGitHubSpecPublicationAdapter, storeFactory = createPlanningCaseStore, clock = () => new Date().toISOString(), correlationId = `C-${randomUUID()}` } = {}) {
  try {
    const { command, options } = parse(argv);
    if (command === "build") {
      requireOptions(options, ["context", "draft", "repo-path", "out", "json"], ["context", "draft", "repo-path", "out"]);
      const context = json(options.get("context"));
      const adapter = adapterFactory({ repo: context.repo });
      const verified = verifySpecPublicationContext({ context, repositoryPath: options.get("repo-path"), adapter });
      const contextPath = path.resolve(options.get("context"));
      const draftPath = path.resolve(options.get("draft"));
      const planPath = path.resolve(options.get("out"));
      const plan = buildSpecPublicationPlan({ context: verified, draftBytes: draft(draftPath), artifacts: { contextPath, contextDigest: digestBytes(fs.readFileSync(contextPath)), draftPath, planPath } });
      write(planPath, plan);
      recordSpecPublicationArtifacts({ plan, store: storeFactory(), clock });
      process.stdout.write(`${JSON.stringify({ status: "COMPLETE", planFingerprint: plan.planFingerprint, issue: plan.issue, writeSet: plan.writeSet }, null, 2)}\n`);
      return 0;
    }
    if (command === "approve") {
      requireOptions(options, ["plan", "expected-fingerprint", "case-id", "json"], ["plan", "expected-fingerprint", "case-id"]);
      const plan = json(options.get("plan"));
      if (!validateSpecPublicationPlan(plan).ok) throw new Error("INVALID_SPEC_PUBLICATION_PLAN");
      if (options.get("expected-fingerprint") !== plan.planFingerprint) throw new Error("EXPECTED_FINGERPRINT_MISMATCH");
      if (options.get("case-id") !== plan.caseId) throw new Error("SPEC_PUBLICATION_CASE_MISMATCH");
      const store = storeFactory();
      const target = `github:${plan.repo}`;
      const snapshot = store.get({ caseId: plan.caseId, target });
      verifyRecordedSpecPublicationArtifacts({ plan, store });
      if ([...snapshot.approvals.pending, ...snapshot.approvals.consumed].some((item) => item.fact === "human.specPublication" && item.subject?.digest === plan.planFingerprint)) throw new Error("SPEC_PUBLICATION_APPROVAL_ALREADY_EXISTS");
      const approval = createSpecPublicationApproval({ plan, correlationId, observedAt: clock() });
      store.addApproval({ caseId: plan.caseId, target, approval });
      process.stdout.write(`${JSON.stringify({ status: "COMPLETE", approval }, null, 2)}\n`);
      return 0;
    }
    if (command === "apply") {
      requireOptions(options, ["plan", "repo-path", "expected-fingerprint", "case-id", "approval-id", "json"], ["plan", "repo-path", "expected-fingerprint", "case-id", "approval-id"]);
      const plan = json(options.get("plan"));
      if (!validateSpecPublicationPlan(plan).ok) throw new Error("INVALID_SPEC_PUBLICATION_PLAN");
      const adapter = adapterFactory({ repo: plan.repo });
      const result = applySpecPublication({
        plan,
        preflight: ({ context }) => verifySpecPublicationContext({ context, repositoryPath: options.get("repo-path"), adapter }),
        adapter,
        store: storeFactory(),
        caseId: options.get("case-id"),
        approvalId: options.get("approval-id"),
        expectedFingerprint: options.get("expected-fingerprint"),
        clock,
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return 0;
    }
    throw new Error("INVALID_COMMAND");
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: "BLOCKED", problems: [{ code: /^[A-Z][A-Z0-9_:.-]+$/.test(error?.message ?? "") ? error.message : "SPEC_PUBLICATION_FAILED", detail: safeError(error?.message) }] }, null, 2)}\n`);
    return 1;
  }
}
