import { validateAdmissionState } from "../scripts/check-admission-state.mjs";
import { parseDeliveryGraph, validateDeliveryGraph } from "../scripts/check-delivery-graph.mjs";
import { requireExactAdmissionReviewBinding } from "../admission/review-transport.mjs";
import { validateReviewerDispatchBinding } from "../extensions/reviewer-one-shot-gate.mjs";
import { validateArtifact } from "../protocol/kernel.mjs";
import { validateReview } from "../admission/domain.mjs";
import { HANDOFF_PLAN_SCHEMA, RELEASE_PLAN_SCHEMA, canonical, fingerprint, handoffProjection, hashText, releasePlanDigest } from "./domain.mjs";
import { parseChildTicket, parseControlledLines, parseParentDeliverySpec } from "./markdown.mjs";
import { reviewCandidateMatchesTicketContract, validateTicketContract } from "../scripts/check-ticket-contract.mjs";
import { oracleValidationCoverageProblems } from "../scripts/check-release-closure.mjs";
import { executionFreshnessProjection, isGitAncestor } from "./freshness.mjs";

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA = /^[a-f0-9]{40}$/;

function safeId(input, parent, graph) {
  if (/^\S{1,120}$/u.test(graph.releaseId ?? "") && !/[\u0000\r\n]/u.test(graph.releaseId)) return graph.releaseId;
  const candidate = String(input.release?.id ?? input.releaseId ?? "");
  return input.release?.accepted === true && /^[A-Za-z0-9._-]+$/.test(candidate)
    ? candidate
    : `release-${parent.id}-${fingerprint(graph).slice(7, 19)}`;
}

export function reviewFocusForSpec(spec) {
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
  try { graph = input.deliveryGraph && typeof input.deliveryGraph === "object" ? structuredClone(input.deliveryGraph) : parseDeliveryGraph(input.parent.body); } catch { throw new Error("INVALID_DELIVERY_GRAPH_SOURCE"); }
  if (graph?.schema === "pi-ticket-planning:roadmap-graph:v1" || graph?.kind === "ROADMAP") throw new Error("ROADMAP_NOT_EXECUTABLE");
  if (graph?.schema !== "pi-ticket-planning:delivery-release-graph:v3") throw new Error("NEEDS_MIGRATION");
  if (graph.children?.some((child) => child.executionLane !== "AGENT" || (child.externalBlockers ?? []).length > 0)) throw new Error("CODEX_RELEASE_NOT_EXECUTABLE");
  const graphCheck = validateDeliveryGraph(graph, { isAncestor: (from, to) => isGitAncestor(input.repositoryPath, from, to) });
  if (!graphCheck.ok) {
    const stable = graphCheck.problems.find(({ code }) => [
      "MISSING_ORACLE_BINDING",
      "TOO_MANY_RISK_CLASSES",
      "SCOPE_BUDGET_TOO_LARGE",
      "MISSING_REPLAN_TRIGGERS",
      "PROTECTED_PATH_IN_EXPECTED_WRITE_SET",
      "TICKET_REQUIRES_SPLIT",
      "INTEGRATION_ONLY_CONTRACT_VIOLATION",
    ].includes(code) || code === "PREDECESSOR_COMPLETION_EXPORT_REQUIRED" || code.startsWith("CONTROLLER_COMPLETION_"));
    throw new Error(stable?.code ?? "CODEX_RELEASE_NOT_EXECUTABLE");
  }
  if (graph.releaseOrdinal > 1 && (graph.predecessorReceipt.controllerCompletion.repo !== input.repo
    || graph.predecessorReceipt.controllerCompletion.baseRef !== input.source?.baseRef)) {
    throw new Error("CONTROLLER_COMPLETION_TARGET_MISMATCH");
  }
  if (!["GRAPH_REVIEWED", "HANDOFF_APPROVED", "HANDOFF_READY"].includes(graph.readinessState)) throw new Error("RELEASE_NOT_GRAPH_REVIEWED");
  const maxChildren = graph.childPolicy?.maxChildren ?? 4;
  if (graph.children.length > maxChildren) throw new Error("CHILD_COUNT_POLICY_EXCEEDED");
  const initialChildren = new Map((input.children ?? []).map((child) => [String(child.id), child]));
  for (const graphChild of graph.children ?? []) {
    const live = initialChildren.get(String(graphChild.id));
    if (!live || live.title !== graphChild.title || typeof live.body !== "string" || hashText(live.body) !== graphChild.bodyHash) throw new Error(`CHILD_DRIFT:${graphChild.id}`);
    if (live.state !== "open") throw new Error(`ISSUE_NOT_OPEN:${graphChild.id}`);
  }
  if (!SHA.test(graph.executionBaseSha ?? "") || typeof input.source?.baseRef !== "string" || !input.source.baseRef) throw new Error("INVALID_DELIVERY_GRAPH_SOURCE");
  if ((input.children ?? []).some((child) => !/^[1-9][0-9]*$/.test(String(child?.id ?? ""))
    || (child.blockedBy ?? []).some((id) => !(input.children ?? []).some((other) => String(other.id) === String(id))))) throw new Error("CODEX_RELEASE_NOT_EXECUTABLE");
  const admission = validateAdmissionState({ repo: input.repo, repositoryPath: input.repositoryPath, source: input.source, parent: input.parent, parentBody: input.parent.body, specAcceptance: input.specAcceptance, deliveryGraph: graph, roadmapGraph: input.roadmapGraph, roadmapParent: input.roadmapParent, children: input.children, contextChecks: input.contextChecks });
  if (!admission.ok) {
    const verifier = admission.problems.find(({ code }) => [
      "ORACLE_VERIFIER_MANIFEST_MISSING",
      "ORACLE_VERIFIER_BINDING_DRIFT",
      "GLOBAL_ORACLE_VERIFIER_PATH_IN_WRITE_SET",
    ].includes(code));
    throw new Error(verifier?.code ?? `ADMISSION_STATE_NOT_READY:${admission.problems[0]?.code ?? "UNKNOWN"}`);
  }
  if (!input.policy || input.policy.accepted !== true || typeof input.policy.identity !== "string" || !input.policy.identity || !/^sha256:[a-f0-9]{64}$/.test(input.policy.digest ?? "")) throw new Error("POLICY_NOT_ACCEPTED");
  let reviewBinding;
  try { reviewBinding = requireExactAdmissionReviewBinding(input); validateReviewerDispatchBinding(input.reviewDispatchBinding); } catch { throw new Error("INVALID_REVIEW_BINDING"); }
  const candidates = new Map((input.review?.candidates ?? []).map((candidate) => [String(candidate.id), candidate]));
  if (candidates.size !== graph.children.length) throw new Error("REVIEW_CANDIDATE_SET_MISMATCH");
  const reviewSource = (({ identity, revision, baseSha, specContentHash }) => ({ identity, revision, baseSha, ...(specContentHash === undefined ? {} : { specContentHash }) }))(input.source ?? {});
  if (!validateReview(input.review) || fingerprint(input.review.source) !== fingerprint(reviewSource) || Object.values(input.review.axes ?? {}).some((value) => value !== "PASS")) throw new Error("REVIEW_NOT_READY");
  const spec = parseParentDeliverySpec(input.parent.body);
  const live = new Map(input.children.map((child) => [String(child.id), child]));
  const reviewedChildren = graph.children.map((child) => {
    const current = live.get(String(child.id));
    const review = candidates.get(String(child.id));
    if (!current || current.state !== "open" || current.title !== child.title || hashText(current.body) !== child.bodyHash) throw new Error(`CHILD_DRIFT:${child.id}`);
    if (review?.verdict !== "READY" || review.executionLane !== child.executionLane
      || current.executionLane !== undefined && current.executionLane !== child.executionLane) throw new Error("CODEX_RELEASE_NOT_EXECUTABLE");
    const contract = validateTicketContract({
      repositoryPath: input.repositoryPath,
      baseSha: graph.executionBaseSha,
      child: current,
      graphChild: child,
      graphChildren: graph.children,
    });
    if (!contract.ok) throw new Error(contract.problems[0]?.code ?? "CODEX_RELEASE_NOT_EXECUTABLE");
    if (!reviewCandidateMatchesTicketContract(review, contract.projection, contract.problems)) throw new Error("REVIEW_TICKET_CONTRACT_MISMATCH");
    if ((current.blockedBy ?? []).some((id) => !graph.children.some((item) => String(item.id) === String(id)))) throw new Error("CODEX_RELEASE_NOT_EXECUTABLE");
    return { issue: String(child.id), title: current.title, bodyHash: child.bodyHash, executionLane: child.executionLane, blockedBy: child.blockedBy.map(String), body: current.body };
  });
  if (reviewedChildren.length === 0) throw new Error("CODEX_RELEASE_NO_AGENT_TRANCHE");
  const children = reviewedChildren.map((child, index) => {
    const parsed = parseChildTicket(child.body);
    const constraints = parsed.executionConstraints;
    return { ...child, release: { number: Number(child.issue), order: index + 1, dependsOn: child.blockedBy.map(Number), objective: parsed.objective, acceptanceCriteria: parsed.acceptanceCriteria, suggestedValidation: [], allowNoop: false, expectedTitle: child.title, expectedBodyHash: child.bodyHash, oracleBindings: [parsed.oracleBinding], riskClasses: constraints.riskClasses, scopeBudget: constraints.scopeBudget, expectedPaths: constraints.expectedPaths, protectedPaths: constraints.protectedPaths, replanTriggers: constraints.replanTriggers, integrationOnly: constraints.integrationOnly, waiverDigests: constraints.waivers.map(({ digest }) => digest) } };
  });
  const config = controller?.config ?? input.controller;
  const reviewEnabled = config?.review?.enabled ?? config?.reviewEnabled;
  if (!config || config.executionMode !== "release-plan-v2-direct" || config.repo !== input.repo || config.baseRef !== input.source.baseRef || !Number.isInteger(config.policy?.maxIssues) || config.policy.maxIssues < children.length || reviewEnabled !== true) throw new Error("CONTROLLER_CONFIG_MISMATCH");
  const oracleCoverage = oracleValidationCoverageProblems({ controllerConfig: config, children: input.children });
  if (oracleCoverage.length > 0) throw new Error(oracleCoverage[0].code);
  const dependencyHandoffDigests = graph.decisionManifest.dependencyHandoffs.map(({ sha256 }) => sha256);
  const releasePlan = { version: 2, source: { planner: "pi-ticket-planning", repo: input.repo, baseRef: input.source.baseRef, baseSha: graph.executionBaseSha, parentBinding: { number: Number(input.parent.id), expectedTitle: input.parent.title, expectedBodyHash: hashText(input.parent.body) }, specContentHash: graph.source.specContentHash, deliveryGraphDigest: fingerprint(graph), decisionManifestDigest: graph.decisionManifestDigest, predecessorReceiptDigest: graph.predecessorReceipt?.digest ?? null, dependencyHandoffDigests }, id: safeId(input, input.parent, graph), title: input.parent.title, objective: spec.objective, parentIssue: Number(input.parent.id), issues: children.map(({ release }) => release), releaseAcceptanceCriteria: [...new Set([...spec.scenarios.map((scenario) => `${scenario.id}: ${scenario.observable}`), `Walking skeleton: ${spec.walkingSkeleton}`])], reviewFocus: reviewFocusForSpec(spec) };
  if (releasePlan.releaseAcceptanceCriteria.length > 50 || releasePlan.releaseAcceptanceCriteria.some((value) => value.length > 2000)) throw new Error("RELEASE_PLAN_TOO_LARGE");
  const controllerPlanDigest = controller?.planDigest ?? releasePlanDigest(releasePlan);
  const provenance = runtimeProvenance(controller, config, releasePlan, controllerPlanDigest);
  const plan = { schema: HANDOFF_PLAN_SCHEMA, kind: "CODEX_RELEASE", repo: input.repo, target: String(input.parent.id), source: { identity: graph.source.identity, revision: graph.source.revision, baseRef: input.source.baseRef, baseSha: graph.executionBaseSha, specContentHash: graph.source.specContentHash, deliveryGraphDigest: fingerprint(graph), parentBodyHash: hashText(input.parent.body), decisionManifestDigest: graph.decisionManifestDigest, predecessorReceiptDigest: graph.predecessorReceipt?.digest ?? null, dependencyHandoffDigests }, children: children.map(({ issue, title, bodyHash, executionLane, blockedBy }) => ({ issue, title, bodyHash, executionLane, blockedBy })), freshness: executionFreshnessProjection(input), reviewedFingerprint: fingerprint({ source: reviewSource, review: input.review, reviewBinding, reviewDispatchBinding: input.reviewDispatchBinding }), policy: { identity: input.policy.identity, digest: input.policy.digest }, controller: { identity: "herdr-codex-controller", releasePlanVersion: 2, configDigest: controller?.configDigest ?? "", provenance, repo: config.repo, baseRef: config.baseRef, maxIssues: config.policy.maxIssues, reviewEnabled }, releasePlan, controllerPlanDigest, recovery: { strategy: "rebuild-on-source-drift", conflict: "Rebuild and re-approve on any fresh source, receipt, decision, dependency handoff, Oracle, review, policy, Controller config, provenance, or Plan drift." } };
  const complete = { ...plan, planFingerprint: fingerprint(handoffProjection(plan)) };
  if (!validateArtifact(releasePlan, { identity: RELEASE_PLAN_SCHEMA }).ok || !validateArtifact(complete).ok) throw new Error("INVALID_EXECUTION_HANDOFF_ARTIFACT");
  return complete;
}

export { RELEASE_PLAN_SCHEMA };
