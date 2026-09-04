import { validateAdmissionState } from "../scripts/check-admission-state.mjs";
import { parseDeliveryGraph, validateDeliveryGraph } from "../scripts/check-delivery-graph.mjs";
import { requireExactAdmissionReviewBinding } from "../admission/review-transport.mjs";
import { validateReviewerDispatchBinding } from "../extensions/reviewer-one-shot-gate.mjs";
import { validateReview } from "../admission/domain.mjs";
import { fingerprint, hashText } from "./domain.mjs";
import { parseChildTicket, parseControlledLines, parseParentDeliverySpec } from "./markdown.mjs";
import { reviewCandidateMatchesTicketContract, validateTicketContract } from "../scripts/check-ticket-contract.mjs";
import { isGitAncestor } from "./freshness.mjs";
import { CONTROLLER_CONTRACT_VERSION, validateReleasePlan } from "./release-contract.mjs";
import { releaseRisk } from "../scripts/risk-classes.mjs";

const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA = /^[a-f0-9]{40}$/;

function safeId(input, parent, graph) {
  if (/^\S{1,120}$/u.test(graph.releaseId ?? "") && !/[\u0000\r\n]/u.test(graph.releaseId)) return normalizeId(graph.releaseId);
  const candidate = String(input.release?.id ?? input.releaseId ?? "");
  return input.release?.accepted === true && /^[A-Za-z0-9._-]+$/.test(candidate)
    ? normalizeId(candidate)
    : `release-${parent.id}-${fingerprint(graph).slice(7, 19)}`;
}

function normalizeId(value) {
  const normalized = String(value).trim().toLowerCase().replace(/[^a-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
  if (!normalized) throw new Error("INVALID_RELEASE_ID");
  return normalized.slice(0, 80);
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

export function compileExecutionPlan(input) {
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
      "UNKNOWN_RISK_CLASS",
      "SCOPE_BUDGET_TOO_LARGE",
      "INVALID_EXPECTED_PATH_PATTERN",
      "MISSING_REPLAN_TRIGGERS",
      "PROTECTED_PATH_IN_EXPECTED_WRITE_SET",
      "TICKET_REQUIRES_SPLIT",
      "INTEGRATION_ONLY_CONTRACT_VIOLATION",
      "INVALID_RELEASE_RESULT",
    ].includes(code));
    throw new Error(stable?.code ?? "CODEX_RELEASE_NOT_EXECUTABLE");
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
  try { requireExactAdmissionReviewBinding(input); validateReviewerDispatchBinding(input.reviewDispatchBinding); } catch { throw new Error("INVALID_REVIEW_BINDING"); }
  const candidates = new Map((input.review?.candidates ?? []).map((candidate) => [String(candidate.id), candidate]));
  if (candidates.size !== graph.children.length) throw new Error("REVIEW_CANDIDATE_SET_MISMATCH");
  const reviewSource = (({ identity, revision, baseSha, specContentHash }) => ({ identity, revision, baseSha, ...(specContentHash === undefined ? {} : { specContentHash }) }))(input.source ?? {});
  if (!validateReview(input.review) || fingerprint(input.review.source) !== fingerprint(reviewSource) || Object.values(input.review.axes ?? {}).some((value) => value !== "PASS")) throw new Error("REVIEW_NOT_READY");
  const spec = parseParentDeliverySpec(input.parent.body);
  const live = new Map(input.children.map((child) => [String(child.id), child]));
  const issues = graph.children.map((child, index) => {
    const current = live.get(String(child.id));
    const review = candidates.get(String(child.id));
    if (!current || current.state !== "open" || current.title !== child.title || hashText(current.body) !== child.bodyHash) throw new Error(`CHILD_DRIFT:${child.id}`);
    if (review?.verdict !== "READY" || review.executionLane !== child.executionLane
      || current.executionLane !== undefined && current.executionLane !== child.executionLane) throw new Error("CODEX_RELEASE_NOT_EXECUTABLE");
    const contract = validateTicketContract({ repositoryPath: input.repositoryPath, baseSha: graph.executionBaseSha, child: current, graphChild: child, graphChildren: graph.children });
    if (!contract.ok) throw new Error(contract.problems[0]?.code ?? "CODEX_RELEASE_NOT_EXECUTABLE");
    if (!reviewCandidateMatchesTicketContract(review, contract.projection, contract.problems)) throw new Error("REVIEW_TICKET_CONTRACT_MISMATCH");
    if ((current.blockedBy ?? []).some((id) => !graph.children.some((item) => String(item.id) === String(id)))) throw new Error("CODEX_RELEASE_NOT_EXECUTABLE");
    const parsed = parseChildTicket(current.body);
    const risk = releaseRisk(parsed.executionConstraints.riskClasses);
    if (!risk) throw new Error("UNKNOWN_RISK_CLASS");
    return {
      number: Number(child.id),
      order: index + 1,
      dependsOn: child.blockedBy.map(Number),
      objective: parsed.objective,
      acceptanceCriteria: parsed.acceptanceCriteria,
      expectedPaths: parsed.executionConstraints.expectedPaths,
      scopeBudget: parsed.executionConstraints.scopeBudget,
      risk,
      oracleCommands: risk === "high" ? [parsed.oracleBinding.execution.command] : [],
    };
  });
  if (issues.length === 0) throw new Error("CODEX_RELEASE_NO_AGENT_TRANCHE");
  const releasePlan = {
    controllerContractVersion: CONTROLLER_CONTRACT_VERSION,
    id: safeId(input, input.parent, graph),
    title: input.parent.title,
    objective: spec.objective,
    repo: input.repo,
    baseRef: input.source.baseRef,
    baseSha: graph.executionBaseSha,
    parentIssue: Number(input.parent.id),
    issues,
    releaseAcceptanceCriteria: [...new Set([...spec.scenarios.map((scenario) => `${scenario.id}: ${scenario.observable}`), `Walking skeleton: ${spec.walkingSkeleton}`])],
    reviewFocus: reviewFocusForSpec(spec),
  };
  if (releasePlan.releaseAcceptanceCriteria.length > 50 || releasePlan.releaseAcceptanceCriteria.some((value) => value.length > 2000)) throw new Error("RELEASE_PLAN_TOO_LARGE");
  const problems = validateReleasePlan(releasePlan);
  if (problems.length > 0) throw new Error(problems[0].code);
  return releasePlan;
}
