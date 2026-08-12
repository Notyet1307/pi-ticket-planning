# R001：暴露面资产差异确认闭环

> 类型：Phase 1 高不确定性产品 Pilot
>
> 状态：`NEEDS_RESEARCH`
>
> 日期：2026-08-12
>
> 当前结论：问题类别成立，具体客户机会、独立产品价值和 AI 增量尚未成立；不得进入 `to-spec`、`to-tickets` 或 `ready-for-agent`。

## 1. Pilot 要回答的唯一问题

> 对一个真实客户，外部暴露面结果与内部掌握资产之间，是否存在现有云图/内部流程没有解决、会反复发生，并值得使用一个独立治理产品持续处理的决策闭环？

本 Pilot 不回答“能否开发出来”。现有系统已经提供充分的技术可行性证据。它要回答的是客户是否需要、为什么不直接使用云图或内部资产系统、结果由谁采取什么行动，以及是否会重复使用。

## 2. 当前事实

### 已验证事实

- 行业问题真实存在：[Microsoft Defender EASM](https://learn.microsoft.com/en-us/azure/external-attack-surface-management/what-is-discovery) 把未知资产发现、候选归属和持续资产清单作为正式工作流；[Axonius](https://docs.axonius.com/docs/device-discovery-chart) 展示各数据来源观测量及关联后的唯一资产，说明跨源覆盖差异属于成熟产品类别。
- [云图官方定位](https://www.chaitin.cn/cloudatlas)已经包含外部资产发现、CMDB/资产管理系统集成、资产归属关联、生命周期管理、风险分派和联动处置。因此“把两个清单比一下”本身不是足够差异化的独立产品。
- Exposure-Agent 已完成 Project 权限/审计、CustomerUpload、CloudAtlas 只读 SourceInstance、GovernanceRun、不可变 SourceSnapshot、IP Observation/Resource、两类 Finding 生命周期和最小 Assets/Findings UI。
- 2026-08-09 的真实 CloudAtlas 隔离 canary 通过：CloudAtlas 13,182 条、CustomerUpload 1 条，形成 13,183 个 Resource 和 13,183 个 OPEN Finding，六步均一次成功。
- 该 canary 证明真实连接、确定性计算、规模和追溯链可运行；它没有证明客户会理解、相信、处置或再次使用结果。`13,182 : 1` 的输入也不是一个有代表性的客户资产对齐样本。
- 当前远端 `main` 为 `03f640d00ab29ec1710fe9681eaf1dbf835cf1bb`；本地 checkout 为 `26f0130396da668bbad6d94516980f51e310677e`，落后 35 个提交。
- Stage 5 报告父 Spec #90 有 22 个原生子 Issue：13 个已关闭，#105 正被 Harness 领取，#98/#106–#112 仍开放。
- Stage 5 已增加确定性 Evidence、Report、HTML/CSV、API 和 UI 等约 10,079 行 diff。其 PI prototype 虽通过 7/7 机械安全用例，却在三份盲评中只胜 1/3，两个非平凡场景均输给确定性模板；当前 PI 已被正确排除在正式路径之外。
- 仓库和 Issue 中尚未找到客户访谈、实际用户任务观察、重复使用、付费意愿或现有替代流程失败的证据。
- 最终客户系统仍未通过 OctoBus SourceInstance 接入；CustomerUpload 只是过渡输入。因此当前不是生产交付状态。

### 尚未验证的核心假设

1. 客户当前确实需要人工把云图结果与内部台账反复比对。
2. 云图自身的 CMDB/API、归属、标签和处置能力不能充分满足这一流程。
3. 痛点不是一次性数据清洗或售前服务，而是需要持续产品化的治理周期。
4. 安全运营或资产治理负责人能根据两类差异做出明确行动。
5. 客户能提供时间范围和资产范围可比的两侧数据，而不是每次都依赖高成本人工定制。
6. 跨 Run 生命周期、Evidence、审计和私有化交付是客户真正重视的差异，而不是我们自认为重要。
7. 客户需要 AI 解释；且 AI 能在决策质量、理解时间或行动形成上稳定胜过确定性模板。

## 3. 产品判断

| 维度 | 当前判断 | 证据 |
|---|---|---|
| 问题类别 | `SUPPORTED` | 官方 EASM/CAASM 与安全指南均承认未知资产、资产清单和持续核验问题 |
| 具体客户痛点 | `UNVERIFIED` | 没有近期真实故事、任务观察或现有流程证据 |
| 技术可行性 | `SUPPORTED_FOR_IP` | Stage 4 真实 CloudAtlas canary 与确定性事实链通过 |
| 可用性 | `UNVERIFIED` | 未观察目标客户独立完成一次差异判断 |
| 商业/独立产品价值 | `HIGH_RISK` | 云图本身已覆盖大量相邻能力；差异化尚未由客户证明 |
| AI 增量 | `CURRENTLY_REJECTED` | 现有盲评中非平凡场景不如确定性模板 |
| 生产就绪 | `NO` | 客户系统正式接入、真实客户 Pilot、备份/保留/交付要求尚未验证 |

整体阶段定义：

> **工程上是可供受控试用的 IP-only technical alpha；产品上仍处于 problem/solution fit 验证；AI 上处于负向 prototype 结论。**

它不是“完全没做成”，也不是“已经进入产品扩张期”。工程进度已经领先产品证据，需要先让产品证据追上来。

## 4. 收窄后的产品命题

不再定位为“AI 暴露面扫描平台”，也不与云图争夺发现和扫描能力。

候选定位：

> 云图告诉客户攻击者看到了什么；客户内部系统记录组织认为自己拥有什么；Exposure-Agent 把两者之间的差异变成可解释、可确认、可归责、可复测关闭的治理事实。

首个目标角色暂定为：

> 对外网资产清单完整性负责、需要协调业务部门确认和整改的安全运营负责人或资产治理负责人。

“客户”“领导”“企业评估者”都过宽。Pilot 必须找到一个实际执行上述工作的角色；若只有售前人员或领导觉得概念好，不算目标用户证据。

## 5. 最小用户闭环

```text
一次真实核验触发
→ 选定同一部门/业务范围和同一观测窗口
→ 导入内部掌握资产
→ 读取该范围的 CloudAtlas 外部观测
→ 确定性产生匹配、未报备、未观测结果
→ 目标用户抽样核对来源证据
→ 对差异记录业务处置方向、责任对象和待确认原因
→ 形成一份可带走的行动清单
→ 在约定窗口后复测，确认至少一个差异被处理或得到解释
```

现有系统尚未实现完整的人工 disposition/owner 状态，不应立即开发。第一次 Pilot 用受控表格或访谈记录承接这些决定，用来观察真实状态模型；只有重复出现的状态才进入下一 Release。

## 6. Release Frame 草案

```yaml
release_id: R001
status: NEEDS_RESEARCH
actor_and_trigger: >-
  待确认：安全运营负责人或资产治理负责人，在月度检查、重保、审计、
  新业务上线或发现未知暴露资产后，需要核对外部暴露面与内部台账。
observed_problem:
  facts: []
  evidence_refs: []
target_outcome: >-
  目标用户能针对一个有界资产范围，可信地判断哪些差异需要补台账、
  补扫描范围、排除归属或继续调查，并形成可追踪的下一行动。
solution_hypothesis: >-
  将真实 CloudAtlas 观测、内部台账、确定性匹配、来源追溯和跨轮生命周期
  放在一个私有化治理闭环中，能比现有人工表格或云图原生流程更快形成行动。
smallest_closed_loop: >-
  同范围两侧输入 → 确定性差异 → 人工核对与处置方向 → 行动清单 → 一次复测。
included_scenarios:
  - 同一有界范围的 IP 精确匹配
  - 外部已观测、内部未报备
  - 内部已报备、当前外部未观测
  - 来源追溯和误解纠正
  - 人工记录下一行动并完成一次复测
non_goals:
  - 新扫描引擎
  - AI 自动匹配、统计、归属或关闭 Finding
  - CloudAtlas SourceFinding 风险归一
  - Endpoint/Domain/URL/Application 扩展
  - 自动整改或客户系统写回
  - 正式 PI Agent 接入
  - 新的报告/规模/审计平台建设
success:
  baseline: 待访谈记录现有流程耗时、参与者、工具和返工
  primary_signal: 目标用户使用结果做出至少一个真实、可追踪的资产治理决定
  guardrail: 不把未观测解释为不存在；不泄漏原始数据；不产生未经批准的外部写操作
  evidence_window: 首次受控任务观察 + 7至14天后复测/回访
  minimum_evidence:
    - 至少一位实际执行该工作的目标用户完成受控任务
    - 能说清现有替代流程及其失败点
    - 能从样本差异形成明确的下一行动和责任对象
    - 至少一个行动在复测或回访中得到处理、解释或明确拒绝
    - 用户明确表达是否愿意在下一周期再次使用
appetite: 两周内完成访谈、一次受控任务观察和一次回访；默认不新增产品代码
blocking_unknowns:
  - 实际目标角色和触发事件
  - 当前人工/云图原生流程
  - 客户为何不能直接使用云图的 CMDB、归属和处置能力
  - 两侧数据能否按同一范围与时间窗口比较
  - 结果之后的真实 disposition、owner 和升级状态
  - 客户接受的部署、数据和模型边界
false_positive_completion: >-
  系统成功处理 10k 数据、生成报告或 AI 输出看起来更像人话，
  但没有客户据此完成真实判断、行动和复测。
```

## 7. Evidence 计划

### 7.1 三次故事型访谈

优先找实际做资产清点/安全运营的人，不先演示产品。每次围绕最近一次真实事件询问：

1. 最近一次发现未知外网资产是什么时候？什么触发了检查？
2. 当时从哪些系统拿数据，谁把它们放到一起？
3. 你们如何判断资产归属、误报、漏报和责任部门？
4. 哪一步最耗时、最容易争议或最常返工？
5. 结果最后进入哪里：表格、报告、工单、群聊还是内部资产系统？
6. 谁必须认可结果，谁真正执行下一动作？
7. 下一次复查时如何知道旧问题已处理，而不是暂时没有观测到？
8. 云图现有标签、CMDB/API、归属和处置流程为什么没有解决它？

如果三次访谈都没有发生过真实对账，只是认为概念“听起来有用”，判为 `DROP` 或售前服务，不进入产品开发。

### 7.2 一次有代表性的受控任务观察

- 选择一个部门、业务系统或明确 IP 范围；不要全公司起步。
- 两侧数据使用可解释的同一时间窗口。
- 内部资产数量应足以包含匹配、未报备和未观测三种情况；不要重复 `13,182 : 1` 的技术 canary。
- 从真实差异中稳定抽取 20–30 条供用户逐条核对；完整结果仍保持有界和脱敏。
- 记录用户完成时间、需要解释的位置、误解、无法决定的原因、下一行动和责任对象。
- 开发者只能观察和回答产品事实，不能代替用户完成判断。

### 7.3 AI 只做 shadow eval

第一轮不把 AI 放入客户关键路径。若有合规的有界脱敏 Evidence，可在会后生成 AI 摘要，与确定性模板进行盲评：

- 是否更快找到要处理的问题；
- 是否减少误解；
- 是否形成更准确、可执行的行动；
- 是否引入无来源推断。

只有在目标用户任务上稳定胜过模板，AI 才能成为未来 Release 候选。语言更流畅不算产品价值。

## 8. Circuit breaker

当前 #105 已由 Harness 领取，不建议在未知状态下强行打断。建议它到达安全、可验证边界后：

- 暂停 #98/#106–#112 的继续领取；
- 不创建新的 Stage 5、SourceFinding、处置或 AI Ticket；
- 不改变已合并事实，也不回滚可复用的确定性报告基础；
- 先完成本 Pilot，再决定剩余报告 hardening 是否仍是最高价值工作。

本文只提出暂停建议，没有修改 Harness、Issue 标签或 GitHub 状态。任何实际暂停操作需单独确认，并先读取实时 ledger/Controller 状态。

## 9. Pilot Gate

### `READY_TO_COMMIT`

仅当以下事实同时成立：

- 至少一个实际目标用户确认这是近期反复发生的工作；
- 现有云图/内部系统/人工表格存在明确且重要的失败点；
- 用户能用本产品结果做出真实行动，而不是只觉得页面不错；
- 结果语义和来源可信，误报处理不会依赖开发者逐条解释；
- 用户愿意在下一周期再次使用；
- 下一次要开发的唯一主结果可由观察证据明确指出。

### `PIVOT`

- 客户有需求，但核心价值是云图实施、CMDB 集成或人工运营服务；
- 客户只需要一次性报告，不需要持续治理产品；
- 差异确认成立，但产品应是云图上的轻量工作流/插件，而非独立平台。

### `DROP`

- 云图原生能力或当前内部流程已经足够；
- 客户无法提供可比数据，且没有改变条件的意愿；
- 没有实际角色负责处理结果；
- 用户不愿复用，或差异不会触发任何行动；
- 价值只能依靠 AI 包装，而确定性结果本身没有决策用途。

## 10. 下一次需要的人类输入

开始访谈前只需确认三件事：

1. 第一位可接触客户的实际角色；
2. 他最近一次做内外部资产核验的真实经历；
3. 可用于受控 Pilot 的内部资产来源、CloudAtlas 范围和大致规模。

## 11. `ask-yet` 前向测试观察

### Gate A / Session `ask-yet-gate-a-1`

测试时间：2026-08-12；PI session：`019ff4dc-f9f5-7197-838b-6d7551536cde`。

已通过：

- 裸调用正确识别仓库、干净的 exact `main`、有效根策略和产品入口；
- 没有扫描完整 Issue 图、启动子代理、写文件或越过产品 Gate；
- 无活动 Release 时停在 `PRODUCT / ORIENT`，只请求一个具体目标；
- 获得目标后只读取相关架构片段和已接受 ADR，区分了架构/工程事实与客户价值证据；
- 候选 Frame 保持 IP-only、有界范围、人工确认和复测闭环，并在选择前停住，没有创建 Release 文件。

累计缺口，已进入批量修补，待 fresh-session 前向验证：

1. `AY-001`：Stage verdict 没有固定枚举。两轮分别产生了 `NEEDS_TARGET` 和 `CANDIDATE_FRAME_AWAITING_SELECTION`；语义合理，但 fresh session 可能漂移。连续测试完成后，在 reference 中定义各 Stage 的最小 verdict 集并加入静态检查。
2. `AY-002`：候选把仓库 RBAC 术语 `Operator` 直接提升为目标客户角色，虽然客户角色尚无证据。后续必须把 actor/trigger 显式标为 `ASSUMPTION`，直到真实近期故事确认，避免把领域实现角色当成产品事实。
3. `AY-003`（已复现）：回答一方面说“不应先验证 Agent 能否解释”，另一方面把 `AI 解释` 放入 smallest closed loop。用户表示希望提升 AI 价值后，Router 正确提出了调查卡、核验建议、确认草稿和复测解释等受限位置，也保留了不匹配、不改 Finding、不执行动作的权限边界；但随后把 Release 的核心假设改成“AI 调查卡是否优于确定性展示”，并提出 AI-first artifact 名称。这跳过了风险更高且尚未验证的客户角色、现有对账流程、行动价值和持续复测需求。首个 Release 应先验证真实对账、判断、行动和复测；AI 只能作为可替换 shadow/对照假设，不能成为该 Release 成立的前提。
4. `AY-004`：`FRAME` 没有显式按风险排序并守住最高风险假设。用户对 solution 的偏好被直接提升为核心 Release 假设，说明 Router 需要固定规则：新增 solution preference 可以更新 `solution_hypothesis`，但不能覆盖尚未关闭的更高风险 `VALUE`/actor/workflow unknown；若要改变当前 riskiest assumption，必须说明证据依据。
5. `AY-005`：获批的 `CANDIDATE r1` 已写入并复读后，Router 的下一步已经是固定首个 Evidence protocol，但 checkpoint 仍返回 `stage: FRAME` / `CANDIDATE_FRAME_RECORDED`。Release artifact 的 `product_stage: FRAME` 合理，Router 当前工作阶段则应进入 `EVIDENCE`；两者混用会让 fresh resume 重复路由到 FRAME。后续应固定转换规则：FRAME artifact 写入并复读成功后，artifact 保持 `product_stage: FRAME`，checkpoint 切到 `stage: EVIDENCE`，并继续禁止 `COMMIT`，直到 Evidence Gate 完成。
6. `AY-006`：P0 protocol 固定了 participant/sample、120 分钟 active time、4 小时总人力、14 天 evidence window，以及完整 pass/fail/stop thresholds，属于 reference 所定义的 material appetite/evidence-window change，却直接改写 `CANDIDATE r1`，没有创建 `r2`。后续必须在实质变更前提出新 revision，并让 checkpoint、artifact metadata 和后续授权共同锁定该 revision。
7. `AY-007`：人类只说“授权设计 Evidence protocol”，并明确不授权执行、敏感数据写入或 COMMIT；Router 将“设计”直接解释为可修改现有 Release 文件，没有先明确请求对目标路径和 revision 的 mutation approval。这违反 Skill 自身“文件 mutation 必须由明确授权覆盖”的规则。后续应默认先在对话中展示候选 protocol；只有人类明确批准目标文件与 revision 后才落盘。
8. `AY-008`：每次响应强制输出九字段 YAML checkpoint，`established`、`blocker`、`next_action` 与正文重复，长句在终端严重换行。恢复锚点仍有价值，但只需保留 `lane/stage + release/revision + verdict + next + need + blocked`。改为四行、无 fenced YAML、每行不超过 120 字符的 resume footer。

纠偏结果：同一 session 在收到完整恢复指令后正确把 actor 改回 `UNKNOWN`，把核心闭环改为“真实内外部资产 → 确定性差异 → 有据判断 → 具体行动 → 复测 → 再次使用决定”，并把 AI 降为不计入主要通过条件的 shadow/对照；新 artifact 名称为 `rel-001-evidence-based-asset-difference-closure.md`。FRAME Gate 因此通过，可以批准首次写入。`AY-003/004` 仍保留，因为正确结果依赖人工纠偏，fresh session 默认行为尚未修复。

当前决定：继续本 session，不修 Skill；已验收纠偏后的 `CANDIDATE r1` 首次写入，下一步只进入 Evidence protocol 设计。立即停止并提前修补的条件是：把未证实客户事实写成 `FACT`、先开发 AI、进入 `to-spec`，或把工程完成当作产品验证。

运行观察（不归因于 Skill）：纠偏内容被分成多条连续输入，后续输入两次中止了正在生成的 assistant turn；随后 provider 连续返回空 `error` turn，终端停留在 `Working...`，session JSONL 不再增长。首次写入后，在设计 founder dogfood Evidence protocol 时同一模式再次出现：只读检查成功，随后响应以 `terminated` 结束，自动重试又返回 `fetch failed`，没有发生新写入。恢复时应保留当前 session，停止挂起请求，并用一条短消息要求基于最近的人类决定继续；不能把这类运行时中断误判为 Frame 或 Evidence Gate 失败。

首次写入验收：PI 只创建了获批的 `docs/product/releases/rel-001-evidence-based-asset-difference-closure.md`，状态为 `CANDIDATE r1`；随后复读文件并检查 Git 状态。未修改 Issue、标签或其他系统。artifact 正确区分 `DECISION`、`FACT`、`UNKNOWN`，actor 保持 `UNKNOWN`，AI 保持不计入主要通过条件的 shadow/对照，COMMIT 与 Delivery 继续封锁。除 `AY-005` 的 Router stage 标记外，本次写入符合授权和 Gate 预期。

P0 protocol 内容验收：协议正确进入 `EVIDENCE`，把参与者限定为 founder dogfood 而非独立客户替身，固定一个案例、最多五个候选、基线/复测、证据字段、隐私边界、appetite、`P0_PASS | P0_REWORK | P0_INCONCLUSIVE | STOP_SAFETY`，并保持外部客户价值/采用为 `UNKNOWN`、AI 为冻结主流程后的 shadow、`COMMIT` 禁止。内容可作为候选 r2；当前不能接受其 `r1` revision 身份和未单独批准的落盘方式。

批量修补授权：2026-08-12，在完成 ORIENT、FRAME、首次 artifact 写入和 P0 Evidence protocol 设计的真实前向路径后，用户同意调整 Skill。修补覆盖 `AY-001` 至 `AY-008`：固定 verdict、actor 证据边界、风险优先、AI shadow、router/artifact stage 分离、material revision、mutation approval 和紧凑 resume footer。缺口在静态验证通过后仍只标记为 `PATCHED_PENDING_FORWARD_TEST`，必须用 fresh PI session 复验后才能关闭。
