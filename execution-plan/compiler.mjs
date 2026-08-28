import { validateAdmissionState } from "../scripts/check-admission-state.mjs";
import { parseDeliveryGraph } from "../scripts/check-delivery-graph.mjs";
import { requireExactAdmissionReviewBinding } from "../admission/review-transport.mjs";
import { validateReviewerDispatchBinding } from "../extensions/reviewer-one-shot-gate.mjs";
import { validateArtifact } from "../protocol/kernel.mjs";
import { validateReview } from "../admission/domain.mjs";
import { HANDOFF_PLAN_SCHEMA, RELEASE_PLAN_SCHEMA, canonical, fingerprint, handoffProjection, hashText, releasePlanDigest } from "./domain.mjs";
import { parseChildTicket, parseControlledLines, parseParentDeliverySpec } from "./markdown.mjs";

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA = /^[a-f0-9]{40}$/;

function safeId(input, parent, graph) {
  const candidate = String(input.release?.id ?? input.releaseId ?? "");
  return input.release?.accepted === true && /^[A-Za-z0-9._-]+$/.test(candidate)
    ? candidate
    : `release-${parent.id}-${fingerprint(graph).slice(7, 19)}`;
}

function focus(spec) {
  const lines = spec.scenarios.map((scenario) => `${scenario.id} failure path: ${scenario.failure}`);
  lines.push(`Walking skeleton handoff: ${spec.walkingSkeleton}`);
  for (const [prefix, text] of [
    ["Constraint", spec.constraints],
    ["Release signal", spec.releaseSignals],
    ["Decision", spec.decisions],
  ]) {
    for (const line of parseControlledLines(text)) lines.push(`${prefix}: ${line}`);
  }
  const result = [...new Set(lines)];
  if (result.length > 20 || result.some((line) => Buffer.byteLength(line, "utf8") > 2000)) throw new Error("REVIEW_FOCUS_TOO_LARGE");
  return result;
}

function runtimeProvenance(controller, config, releasePlan, planDigest) {
  const identity = controller?.controllerIdentity ?? controller?.provenance?.controller;
  if (!identity) throw new Error("CONTROLLER_PROVENANCE_REQUIRED");
  const body = { version: 1, controller: identity, executionMode: config.executionMode, configDigest: controller.configDigest, releasePlan: { version: 2, digest: planDigest } };
  const expected = { ...body, digest: releasePlanDigest(body) };
  if (controller.provenance && JSON.stringify(canonical(controller.provenance)) !== JSON.stringify(canonical(expected))) throw new Error("CONTROLLER_PROVENANCE_MISMATCH");
  return expected;
}

export function compileExecutionPlan(input, { controller = null } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input) || !REPO.test(input.repo ?? "")) throw new Error("INVALID_EXECUTION_PLAN_INPUT");
  if (input.kind !== "DELIVERY_GRAPH" || !/^[1-9][0-9]*$/.test(String(input.parent?.id ?? "")) || input.parent.state !== "open" || typeof input.parent.body !== "string") throw new Error("PARENT_NOT_OPEN");
  let graph;
  try { graph = parseDeliveryGraph(input.parent.body); } catch { throw new Error("INVALID_DELIVERY_GRAPH_SOURCE"); }
  if (graph.children?.some((child) => child.executionLane === "HUMAN" || (child.externalBlockers ?? []).length > 0)) throw new Error("CODEX_RELEASE_NOT_EXECUTABLE");
  const initialChildren = new Map((input.children ?? []).map((child) => [String(child.id), child]));
  for (const graphChild of graph.children ?? []) {
    const live = initialChildren.get(String(graphChild.id));
    if (!live || live.title !== graphChild.title || typeof live.body !== "string" || hashText(live.body) !== graphChild.bodyHash) throw new Error(`CHILD_DRIFT:${graphChild.id}`);
    if (live.state !== "open") throw new Error(`ISSUE_NOT_OPEN:${graphChild.id}`);
  }
  if (!SHA.test(graph.source?.baseSha ?? "") || typeof input.source?.baseRef !== "string" || !input.source.baseRef) throw new Error("INVALID_DELIVERY_GRAPH_SOURCE");
  if ((input.children ?? []).some((child) => !/^[1-9][0-9]*$/.test(String(child?.id ?? ""))
    || child.executionLane === "HUMAN" || (child.blockedBy ?? []).some((id) => !(input.children ?? []).some((other) => String(other.id) === String(id))))) throw new Error("CODEX_RELEASE_NOT_EXECUTABLE");
  const admission = validateAdmissionState({ repositoryPath: input.repositoryPath, source: input.source, parentBody: input.parent.body, children: input.children, contextChecks: input.contextChecks });
  if (!admission.ok) throw new Error(`ADMISSION_STATE_NOT_READY:${admission.problems[0]?.code ?? "UNKNOWN"}`);
  if (!input.policy || input.policy.accepted !== true || typeof input.policy.identity !== "string" || !input.policy.identity || !/^sha256:[a-f0-9]{64}$/.test(input.policy.digest ?? "")) throw new Error("POLICY_NOT_ACCEPTED");
  let reviewBinding;
  try { reviewBinding = requireExactAdmissionReviewBinding(input); validateReviewerDispatchBinding(input.reviewDispatchBinding); } catch { throw new Error("INVALID_REVIEW_BINDING"); }
  const candidates = new Map((input.review?.candidates ?? []).map((candidate) => [String(candidate.id), candidate]));
  if (candidates.size !== graph.children.length) throw new Error("REVIEW_CANDIDATE_SET_MISMATCH");
  const reviewSource = (({ identity, revision, baseSha, specContentHash }) => ({ identity, revision, baseSha, ...(specContentHash === undefined ? {} : { specContentHash }) }))(input.source ?? {});
  if (!validateReview(input.review) || fingerprint(input.review.source) !== fingerprint(reviewSource) || Object.values(input.review.axes ?? {}).some((value) => value !== "PASS")) throw new Error("REVIEW_NOT_READY");
  const spec = parseParentDeliverySpec(input.parent.body);
  const live = new Map(input.children.map((child) => [String(child.id), child]));
  const children = graph.children.map((child, index) => {
    const current = live.get(String(child.id));
    const review = candidates.get(String(child.id));
    if (!current || current.state !== "open" || current.title !== child.title || hashText(current.body) !== child.bodyHash) throw new Error(`CHILD_DRIFT:${child.id}`);
    if (review?.verdict !== "READY" || review.executionLane !== "AGENT" || child.executionLane !== "AGENT") throw new Error("CODEX_RELEASE_NOT_EXECUTABLE");
    if ((current.blockedBy ?? []).some((id) => !graph.children.some((item) => String(item.id) === String(id)))) throw new Error("CODEX_RELEASE_NOT_EXECUTABLE");
    const parsed = parseChildTicket(current.body);
    return { issue: String(child.id), title: current.title, bodyHash: child.bodyHash, executionLane: "AGENT", blockedBy: child.blockedBy.map(String), release: { number: Number(child.id), order: index + 1, dependsOn: child.blockedBy.map(Number), objective: parsed.objective, acceptanceCriteria: parsed.acceptanceCriteria, suggestedValidation: [], allowNoop: false, expectedTitle: current.title, expectedBodyHash: child.bodyHash } };
  });
  const config = controller?.config ?? input.controller;
  const reviewEnabled = config?.review?.enabled ?? config?.reviewEnabled;
  if (!config || config.executionMode !== "release-plan-v2-direct" || config.repo !== input.repo || config.baseRef !== input.source.baseRef || !Number.isInteger(config.policy?.maxIssues) || config.policy.maxIssues < children.length || reviewEnabled !== true) throw new Error("CONTROLLER_CONFIG_MISMATCH");
  const releasePlan = { version: 2, source: { planner: "pi-ticket-planning", repo: input.repo, baseRef: input.source.baseRef, baseSha: graph.source.baseSha, parentBinding: { number: Number(input.parent.id), expectedTitle: input.parent.title, expectedBodyHash: hashText(input.parent.body) }, specContentHash: graph.source.specContentHash, deliveryGraphDigest: fingerprint(graph) }, id: safeId(input, input.parent, graph), title: input.parent.title, objective: spec.objective, parentIssue: Number(input.parent.id), issues: children.map(({ release }) => release), releaseAcceptanceCriteria: [...new Set([...spec.scenarios.map((scenario) => `${scenario.id}: ${scenario.observable}`), `Walking skeleton: ${spec.walkingSkeleton}`])], reviewFocus: focus(spec) };
  if (releasePlan.releaseAcceptanceCriteria.length > 50 || releasePlan.releaseAcceptanceCriteria.some((value) => value.length > 2000)) throw new Error("RELEASE_PLAN_TOO_LARGE");
  const controllerPlanDigest = controller?.planDigest ?? releasePlanDigest(releasePlan);
  const provenance = runtimeProvenance(controller, config, releasePlan, controllerPlanDigest);
  const plan = { schema: HANDOFF_PLAN_SCHEMA, kind: "CODEX_RELEASE", repo: input.repo, target: String(input.parent.id), source: { identity: graph.source.identity, revision: graph.source.revision, baseRef: input.source.baseRef, baseSha: graph.source.baseSha, specContentHash: graph.source.specContentHash, deliveryGraphDigest: fingerprint(graph), parentBodyHash: hashText(input.parent.body) }, children: children.map(({ issue, title, bodyHash, executionLane, blockedBy }) => ({ issue, title, bodyHash, executionLane, blockedBy })), reviewedFingerprint: fingerprint({ source: reviewSource, review: input.review, reviewBinding, reviewDispatchBinding: input.reviewDispatchBinding }), policy: { identity: input.policy.identity, digest: input.policy.digest }, controller: { identity: "herdr-codex-controller", releasePlanVersion: 2, configDigest: controller?.configDigest ?? "", provenance, repo: config.repo, baseRef: config.baseRef, maxIssues: config.policy.maxIssues, reviewEnabled }, releasePlan, controllerPlanDigest, recovery: { strategy: "rebuild-on-source-drift", conflict: "Rebuild and re-approve on source, graph, policy, review, Controller config, provenance, or Plan drift." } };
  const complete = { ...plan, planFingerprint: fingerprint(handoffProjection(plan)) };
  if (!validateArtifact(releasePlan, { identity: RELEASE_PLAN_SCHEMA }).ok || !validateArtifact(complete).ok) throw new Error("INVALID_EXECUTION_HANDOFF_ARTIFACT");
  return complete;
}

export { RELEASE_PLAN_SCHEMA };
