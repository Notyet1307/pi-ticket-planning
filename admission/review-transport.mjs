import fs from "node:fs";
import path from "node:path";

import { hashText, parseDeliveryGraph } from "../scripts/check-delivery-graph.mjs";
import { ADMISSION_READINESS_SCHEMA, stableHarnessReadiness } from "../scripts/readiness-receipt.mjs";
import { validateCapabilityReceipt } from "../capabilities/doctor.mjs";

export const ADMISSION_REVIEW_INPUT_SCHEMA = "pi-ticket-planning:admission-review-input:v1";
export const ADMISSION_REVIEW_BINDING_SCHEMA = "pi-ticket-planning:admission-review-binding:v1";
const INPUT_NAME = /^admission-review-input\.([a-f0-9]{64})\.json$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const SHA = /^[a-f0-9]{40,64}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const MAX_INPUT_BYTES = 16 * 1024 * 1024;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function same(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join("\n") !== [...keys].sort().join("\n")) {
    throw new Error(`${label} fields are invalid`);
  }
}

function safeText(value, label, { multiline = false, max = 1_048_576 } = {}) {
  if (typeof value !== "string" || value.length === 0 || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
    || (!multiline && /[\r\n]/u.test(value))) throw new Error(`${label} is invalid`);
  return value;
}

function projectSource(source) {
  const projected = {
    identity: safeText(source?.identity, "Review source identity"),
    revision: safeText(source?.revision, "Review source revision"),
    baseSha: safeText(source?.baseSha, "Review source base"),
    ...(source?.specContentHash === undefined ? {} : { specContentHash: source.specContentHash }),
  };
  if (!SHA.test(projected.baseSha) || (projected.specContentHash !== undefined && !DIGEST.test(projected.specContentHash))) {
    throw new Error("Review source binding is invalid");
  }
  return projected;
}

function projectPolicy(policy) {
  if (policy?.accepted !== true || !DIGEST.test(policy.digest ?? "")) throw new Error("Review policy binding is invalid");
  return { accepted: true, identity: safeText(policy.identity, "Review policy identity"), digest: policy.digest };
}

function projectComments(comments) {
  if (comments === undefined) return [];
  if (!Array.isArray(comments) || comments.length > 10_000) throw new Error("Review comments are invalid");
  return comments.map((comment) => {
    if (typeof comment === "string") return { body: safeText(comment, "Review comment", { multiline: true }) };
    const projected = { body: safeText(comment?.body, "Review comment", { multiline: true }) };
    for (const key of ["author", "createdAt", "updatedAt"]) {
      if (comment?.[key] !== undefined) projected[key] = safeText(comment[key], `Review comment ${key}`);
    }
    return projected;
  });
}

function projectIssue(issue, { body = true } = {}) {
  const projected = {
    id: safeText(String(issue?.id ?? ""), "Review Issue id"),
    title: safeText(issue?.title, "Review Issue title"),
    ...(body ? { body: safeText(issue?.body, "Review Issue body", { multiline: true }) } : {}),
    state: safeText(issue?.state, "Review Issue state"),
    labels: [...(issue?.labels ?? [])].map((label) => safeText(label, "Review Issue label")),
    blockedBy: [...(issue?.blockedBy ?? [])].map((id) => safeText(String(id), "Review blocker")),
    comments: projectComments(issue?.comments),
    updatedAt: safeText(issue?.updatedAt ?? "UNKNOWN", "Review Issue updatedAt"),
  };
  return projected;
}

function projectContextChecks(contextChecks) {
  if (!Array.isArray(contextChecks) || contextChecks.length > 10_000) throw new Error("Review Context checks are invalid");
  return contextChecks.map((entry) => ({
    candidateId: safeText(String(entry?.candidateId ?? ""), "Review Context candidate"),
    result: structuredClone(entry?.result),
  }));
}

function trustMetadata() {
  return {
    reviewTarget: { source: "tracker", level: "authenticated", mayInfluenceContent: true, mayGrantAuthority: false },
    policy: { source: "repository", level: "authoritative", mayInfluenceContent: true, mayGrantAuthority: false },
    reviewer: { source: "provider", level: "untrusted", mayInfluenceContent: true, mayGrantAuthority: false },
  };
}

function validateStableHarnessProjection(value) {
  exactKeys(value, ["identity", "digest", "projection"], "Review Harness projection");
  const checked = stableHarnessReadiness({
    identity: value.identity,
    digest: value.digest,
    readiness: {
      schema: ADMISSION_READINESS_SCHEMA,
      observedAt: "1970-01-01T00:00:00.000Z",
      receiptDigest: `sha256:${"0".repeat(64)}`,
      projection: value.projection,
    },
  });
  if (!same(checked, value)) throw new Error("Review Harness projection is invalid");
  return checked;
}

function subjectProjection(input) {
  const { subject: _subject, ...rest } = input;
  return rest;
}

export function createAdmissionReviewInput({
  repo,
  source,
  policy,
  parent,
  children,
  candidate,
  contextChecks,
  harness,
  capabilityReceipt,
  reviewedAt,
}) {
  if (!REPO.test(repo ?? "")) throw new Error("Review repo is invalid");
  if (!Number.isFinite(Date.parse(reviewedAt))) throw new Error("Review timestamp is invalid");
  const projectedSource = projectSource(source);
  const reviewTarget = candidate
    ? { kind: "STANDALONE", candidate: projectIssue(candidate) }
    : {
        kind: "DELIVERY_GRAPH",
        parent: projectIssue(parent),
        children: (children ?? []).map((child) => projectIssue(child)),
        graph: parseDeliveryGraph(parent?.body ?? ""),
      };
  const input = {
    schema: ADMISSION_REVIEW_INPUT_SCHEMA,
    reviewedAt,
    source: projectedSource,
    policy: projectPolicy(policy),
    contextChecks: projectContextChecks(contextChecks),
    reviewTarget,
    harness: harness === null || harness === undefined ? null : stableHarnessReadiness(harness),
    capability: capabilityReceipt ?? null,
    trust: trustMetadata(),
  };
  const targetId = candidate ? String(candidate.id) : String(parent.id);
  const subject = {
    target: `github:${repo}`,
    kind: "admission-review",
    id: targetId,
    revision: projectedSource.revision,
    digest: hashText(JSON.stringify(canonical(subjectProjection(input)))),
  };
  const value = { ...input, subject };
  validateAdmissionReviewInput(value);
  return value;
}

export function validateAdmissionReviewInput(input) {
  exactKeys(input, ["schema", "subject", "reviewedAt", "source", "policy", "contextChecks", "reviewTarget", "harness", "capability", "trust"], "Admission review input");
  if (input.schema !== ADMISSION_REVIEW_INPUT_SCHEMA || !Number.isFinite(Date.parse(input.reviewedAt))) throw new Error("Admission review input identity is invalid");
  exactKeys(input.subject, ["target", "kind", "id", "revision", "digest"], "Admission review subject");
  if (!input.subject.target.startsWith("github:") || input.subject.kind !== "admission-review" || !DIGEST.test(input.subject.digest ?? "")) {
    throw new Error("Admission review subject is invalid");
  }
  const projectedSource = projectSource(input.source);
  if (!same(projectedSource, input.source) || input.subject.revision !== input.source.revision) throw new Error("Admission review source fields are invalid");
  if (!same(projectPolicy(input.policy), input.policy)) throw new Error("Admission review policy fields are invalid");
  if (!same(projectContextChecks(input.contextChecks), input.contextChecks)) throw new Error("Admission review Context check fields are invalid");
  exactKeys(input.reviewTarget, input.reviewTarget?.kind === "STANDALONE" ? ["kind", "candidate"] : ["kind", "parent", "children", "graph"], "Admission review target");
  if (input.reviewTarget.kind === "STANDALONE") {
    if (!same(projectIssue(input.reviewTarget.candidate), input.reviewTarget.candidate)) throw new Error("Admission review candidate fields are invalid");
  } else if (input.reviewTarget.kind === "DELIVERY_GRAPH") {
    if (!same(projectIssue(input.reviewTarget.parent), input.reviewTarget.parent)) throw new Error("Admission review parent fields are invalid");
    if (!Array.isArray(input.reviewTarget.children)) throw new Error("Admission review children are invalid");
    input.reviewTarget.children.forEach((child) => {
      if (!same(projectIssue(child), child)) throw new Error("Admission review child fields are invalid");
    });
  } else throw new Error("Admission review target kind is invalid");
  if (input.harness !== null) validateStableHarnessProjection(input.harness);
  if (input.capability !== null && !validateCapabilityReceipt(input.capability, { now: input.reviewedAt }).ok) {
    throw new Error("Admission review capability receipt is invalid");
  }
  if (!same(input.trust, trustMetadata())) throw new Error("Admission review trust metadata is invalid");
  if (input.subject.digest !== hashText(JSON.stringify(canonical(subjectProjection(input))))) throw new Error("Admission review subject digest is invalid");
  const bytes = Buffer.byteLength(JSON.stringify(input), "utf8");
  if (bytes > MAX_INPUT_BYTES) throw new Error("Admission review input exceeds its byte budget");
  return { ok: true, problems: [] };
}

export function bindAdmissionReviewInput(input) {
  validateAdmissionReviewInput(input);
  const content = `${JSON.stringify(canonical(input), null, 2)}\n`;
  const binding = {
    schema: ADMISSION_REVIEW_BINDING_SCHEMA,
    subject: structuredClone(input.subject),
    inputDigest: hashText(content),
    byteCount: Buffer.byteLength(content, "utf8"),
    createdAt: input.reviewedAt,
  };
  return { binding, content };
}

export function reviewBindingForAdmission(input) {
  const reviewInput = createAdmissionReviewInput({
    repo: input.repo,
    source: input.source,
    policy: input.policy,
    parent: input.parent,
    children: input.children,
    candidate: input.candidate,
    contextChecks: input.contextChecks,
    harness: input.harness ?? null,
    capabilityReceipt: input.capabilityReceipt ?? null,
    reviewedAt: input.review?.reviewedAt,
  });
  return bindAdmissionReviewInput(reviewInput).binding;
}

export function requireExactAdmissionReviewBinding(input) {
  const expected = reviewBindingForAdmission(input);
  validateAdmissionReviewBinding(input.reviewBinding);
  validateAdmissionReviewBinding(input.review?.inputBinding);
  if (!same(input.reviewBinding, expected) || !same(input.review.inputBinding, expected)) {
    throw new Error("Admission review is not bound to the exact review input");
  }
  return expected;
}

export function validateAdmissionReviewBinding(binding, input) {
  exactKeys(binding, ["schema", "subject", "inputDigest", "byteCount", "createdAt"], "Admission review binding");
  exactKeys(binding.subject, ["target", "kind", "id", "revision", "digest"], "Admission review binding subject");
  if (binding.schema !== ADMISSION_REVIEW_BINDING_SCHEMA || !DIGEST.test(binding.inputDigest ?? "")
    || !Number.isInteger(binding.byteCount) || binding.byteCount < 2 || binding.byteCount > MAX_INPUT_BYTES
    || !Number.isFinite(Date.parse(binding.createdAt)) || !binding.subject.target?.startsWith("github:")
    || binding.subject.kind !== "admission-review" || !safeText(binding.subject.id, "Admission review binding id")
    || !safeText(binding.subject.revision, "Admission review binding revision") || !DIGEST.test(binding.subject.digest ?? "")) {
    throw new Error("Admission review binding is invalid");
  }
  if (input) {
    const expected = bindAdmissionReviewInput(input).binding;
    if (!same(binding, expected)) throw new Error("Admission review binding does not match exact input");
  }
  return { ok: true, problems: [] };
}

function privateDirectory(directory, root = directory) {
  const requested = path.resolve(directory);
  const rootPath = fs.realpathSync(path.resolve(root));
  const metadata = fs.lstatSync(requested);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o700) {
    throw new Error("Admission review directory must have mode 0700 and must not be a symlink");
  }
  const resolved = fs.realpathSync(requested);
  const relative = path.relative(rootPath, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Admission review directory escapes its private root");
  return resolved;
}

function readHeldFile(file) {
  const initial = fs.lstatSync(file);
  if (!initial.isFile() || initial.isSymbolicLink() || initial.nlink !== 1 || (initial.mode & 0o777) !== 0o600) {
    throw new Error("Admission review input must be one regular file with mode 0600");
  }
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== initial.dev || opened.ino !== initial.ino) {
      throw new Error("Admission review input changed while opened");
    }
    const content = fs.readFileSync(descriptor, "utf8");
    const current = fs.lstatSync(file);
    if (!current.isFile() || current.isSymbolicLink() || current.nlink !== 1 || current.dev !== opened.dev || current.ino !== opened.ino) {
      throw new Error("Admission review input path changed while opened");
    }
    return content;
  } finally {
    fs.closeSync(descriptor);
  }
}

export function materializeAdmissionReviewInput(input, directory, { root = directory } = {}) {
  const prepared = bindAdmissionReviewInput(input);
  const resolvedDirectory = privateDirectory(directory, root);
  const file = path.join(resolvedDirectory, `admission-review-input.${prepared.binding.inputDigest.slice("sha256:".length)}.json`);
  const entries = fs.readdirSync(resolvedDirectory);
  if (entries.length === 0) {
    fs.writeFileSync(file, prepared.content, { mode: 0o600, flag: "wx" });
    fs.chmodSync(file, 0o600);
  } else if (entries.length !== 1 || entries[0] !== path.basename(file)) {
    throw new Error("Admission review directory may contain only the exact review input");
  }
  const captured = captureAdmissionReviewInput(resolvedDirectory, { root });
  return { binding: captured.binding, path: captured.path };
}

export function captureAdmissionReviewInput(directory, { root = directory } = {}) {
  const resolvedDirectory = privateDirectory(directory, root);
  const entries = fs.readdirSync(resolvedDirectory);
  if (entries.length !== 1 || !INPUT_NAME.test(entries[0])) {
    throw new Error("Admission review directory may contain only the exact review input");
  }
  const pathName = path.join(resolvedDirectory, entries[0]);
  const content = readHeldFile(pathName);
  const filenameDigest = entries[0].match(INPUT_NAME)[1];
  if (hashText(content) !== `sha256:${filenameDigest}`) throw new Error("Admission review input digest does not match its exact path");
  let input;
  try {
    input = JSON.parse(content);
  } catch {
    throw new Error("Admission review input is not valid JSON");
  }
  const prepared = bindAdmissionReviewInput(input);
  if (prepared.content !== content) throw new Error("Admission review input is not canonical");
  return { binding: prepared.binding, path: fs.realpathSync(pathName), content };
}
