# Human interface contract

Use this reference after `ask-yet` has reconstructed the legal workflow state, trusted facts, blocker, and next action. It selects the smallest human-facing response for the current turn; it does not route work or change authority.

## Boundary

Before rendering, internally account for all five semantics:

```text
goal
confirmed_facts
missing_fact_or_decision
blocker
human_action
```

Preserve them for routing, gates, recovery, and the final Checkpoint, but show only what the current human task needs. A response form is a per-turn presentation inference, not a lane, stage, verdict, artifact field, workflow state, persisted session field, or authority source. Never add `response_mode`, `ui_mode`, or `display_state`, and never ask the human to choose a form.

In Simplified Chinese, when `human_action` requires a reply, begin its action sentence with a direct request such as `请确认`, `请选择`, `请提供`, or `请指定`; address the human instead of beginning with `由 <role>`. A third-person assignment describes responsibility but does not ask the human to act.

Before choosing response density, identify whether that action depends on one product or workflow term not yet explained in the conversation. If so, name and define it in one short ordinary-language sentence and state whether current facts show an existing capability, a candidate protocol, or work not yet implemented. This explanation is part of the current human task, not optional expansion.

The machine state remains governed by `contracts/workflow.json`, `contracts/authority.json`, and `scripts/workflow-contract.mjs`. Presentation cannot legalize a transition, hide an approval target, or weaken a safety boundary.

## Select one form

Use this order:

1. The human explicitly asks only for current state, missing items, a blocker explanation, or recovery orientation: `STATUS`.
2. The human must confirm an exact artifact, revision, diff, fingerprint, write, Git mutation, production action, or rollback: `REVIEW`.
3. One non-delegable tradeoff or risk choice remains: `DECISION`.
4. This turn completed an action, Evidence item, or closeout: `RESULT`.
5. Otherwise the human only needs one natural question or participant action: `DIALOGUE`.

`STATUS` is determined by the current request, not by a previous turn. A session may move from `DIALOGUE` to `STATUS` and back to `DIALOGUE` without storing a display state or changing the workflow state.

## DIALOGUE

Use for candidate clarification, one recent-event question, consent, an interview opening or follow-up, sensitive-data categorization, resuming one missing question, or a simple identity clarification.

Render one to three natural paragraphs, no heading, at most one answerable question, and the final Checkpoint. State the current evidence boundary or the small context needed to answer. Do not require or render the five STATUS fields, repeat the full workflow, restate everything the human just said, expose an internal field table, or ask a menu of questions.

Consent states only the purpose, privacy boundary, withdrawal right, durability boundary when material, and one consent question. It never previews the opening question. A follow-up shows only the latest compact redacted addition and asks for the next missing fact.

After a candidate is selected, compactly state that it only chooses what to investigate, show one candidate end-to-end loop, name exactly one highest-risk assumption that could change the direction, and ask one next Evidence question. Do not present the selection as customer Evidence or approval to enter delivery.

## DECISION

Use for candidate direction, appetite, rollout scope, risk acceptance, architecture tradeoff, Commitment, `HOLD | REWORK | DROP`, or another choice no Evidence method can make.

Include the recommendation, its factual basis, main cost, safest default, decision owner when authority matters, and exactly one explicit choice. Short headings such as `建议`, `代价`, and `你的决定` are allowed. Do not render the five STATUS fields, start research or an experiment to avoid the choice, or choose for the owner.

When the choice affects security, production, or an irreversible effect, also show impact scope, rollback or recovery, approval owner, and stop condition.

## STATUS

Use the complete five-field card only for an explicit status or recovery request, or when there is no immediate question and the sole task is to report state. In Simplified Chinese use exactly this order:

```text
当前目标：<one user-visible outcome>
已经确认：<only the facts needed to trust the route>
仍然缺少：<one gate-critical fact, decision, approval, or 无>
为什么现在不能继续：<one plain-language blocker, or 没有阻塞>
你只需要决定：<one human action, or 无需决定>
```

Then add the final Checkpoint. If no decision is needed, say `你只需要决定：无需决定。` and name only what completed or what the next invocation will reread.

When the human explicitly asks which workflow path applies, put one plain-language path sentence in `已经确认`: use exactly `快速路径`, `标准路径`, or `完整发现路径` for normal control, and `受控路径` whenever controls apply. Do not expose `QUICK`, `STANDARD`, `DISCOVERY`, `NORMAL`, or `CONTROLLED` unless the human asks for debugging detail. If a STATUS field needs multiple lines, indent every continuation line so it remains part of that field; add no unindented top-level content before the Checkpoint.

A STATUS request is read-only with respect to workflow progress: read only the minimum state-changing facts, do not start or select research, interview, observation, prototype, spike, or canary; do not ask a participant a question; do not write; and do not advance stage or verdict. Do not rerun full orientation merely to render the card.

## REVIEW

Use when precision is the human task. Show:

- what will change;
- what will not change;
- the important risk or impact;
- the exact artifact identity, revision, target, fingerprint, ref, or mutation being approved; and
- one exact approval action.

Lists, tables, and code blocks are allowed. The five STATUS fields are not required. Never perform the mutation before its applicable approval or replace exact approval details with a conversational summary.

Progressive disclosure never hides an Admission Plan fingerprint, exact Release or ADR revision, target file, remote ref, production scope, rollback, stop condition, irreversible operation, or exact mutation that the human is approving.

## RESULT

Use after a repository read, interview closeout, Evidence persistence, spike result, Solution Shaping sufficiency check, Spec draft, Admission apply, delivery closeout, release, or outcome judgment completes.

In two to four paragraphs state what completed, the strongest conclusion the result supports, what it cannot establish, and the next gate or action. Do not require the five STATUS fields. Ask no question when no immediate human decision exists, and never present one sample, prototype, technical result, or completed worker action as broader product proof.

## Progressive disclosure

Default to the information needed for this turn. Do not normally show planning depth, control mode, lane, stage, verdict, truth owner, method enum, protocol fields, artifact hash, SHA, or full technical sufficiency details; the final Checkpoint is the exception.

- `现在到哪了` or `还缺什么`: render `STATUS` without advancing.
- `展开依据`: show the key facts, source identity, limitations, and decisive reason excluded options lost. Do not repeat the STATUS card unless state was also requested, and do not advance.
- `显示内部状态` or a debugging request: show planning depth, control mode, lane, stage, verdict, identity, and authority source as a debug view. State that it does not replace Git, tracker, Release, Harness, or the machine workflow contract and does not change the gate.
- An exact gate: disclose the exact approval subject even when the human did not ask to expand it.

## Language and density

Prefer the human's business terms. In Simplified Chinese use these ordinary phrases by default:

| Internal concept | Default wording |
| --- | --- |
| Release | 本轮最小可验证目标 |
| Commitment | 确认值得进入交付 |
| Admission | 交给执行 Agent 前的最终复核 |
| Evidence | 判断依据或验证结果 |
| Walking skeleton | 最小端到端闭环 |
| Delivery Graph | 任务及其依赖关系 |
| Solution Shaping | 确定第一版实现边界 |
| system boundary | 哪部分负责什么 |
| data ownership | 数据由谁保存和负责 |
| interface contract | 各部分怎样交接 |
| verification seam | 用什么方式证明第一版跑通 |
| ADR | 需要长期遵守的技术决定 |
| accepted base | 已接受的代码基线 |
| draft ref | 用于保存候选内容的草稿分支 |
| 影子评审 / 影子观察 / shadow review | AI 在真实流程旁生成建议草稿，由人工评估；权威结果和系统状态保持不变 |
| blast radius | 影响范围 |

For `影子评审` or `影子观察`, either omit the label or define it in the same sentence with the table wording; a later statement that the shadow activity is paused is not a definition.

Keep internal names in contracts, machine structures, debugging views, exact gates, and the final Checkpoint. Do not repeat the path, blocker, delivery boundary, or one required action in several sections. Describe only the immediately following step, not the whole future workflow. Omit generic filler.

Ask at most one main question. Group no more than three facts only when they are inseparable outside candidate-first framing. For every human decision, retain the recommendation, reason, cost, safest default, and work that follows automatically. Live consent remains the exception: end with only the consent choice.

## Evidence and high-risk boundaries

Outside live interview consent, when a method is selected, state why the one method can answer the question, what it cannot prove, its appetite and safety boundary, and one authorization or input action. Live consent follows the `DIALOGUE` boundary above and `interview-session.md`: purpose, privacy, withdrawal, applicable durability, and one consent question only. If another method's run is read-only or its required environment is absent, ask the human to authorize execution or provide that environment as the sole action; a protocol without this request is incomplete. Identify a returned original artifact and source class before using its facts. A repository read cannot establish customer behavior or value.

For `CONTROLLED`, preserve every applicable authority, protected asset, impact scope, pre-release verification, rollback or recovery, approval owner, staged release, smoke signal, audit evidence, and stop condition. Prefer `REVIEW` when an exact control or production action needs approval. Natural language may compress labels, never controls.

For an active incident, lead with current harm and containment. Stop ordinary product dialogue and keep the legal `INCIDENT` Checkpoint.

## Final Checkpoint

Every user-visible `ask-yet` response ends with exactly one unfenced line as its final non-empty line:

```text
Checkpoint: <LANE>/<STAGE> · <authoritative work identity or NONE> · <allowed verdict>
```

The response form never appears in the Checkpoint. Append nothing after it.
