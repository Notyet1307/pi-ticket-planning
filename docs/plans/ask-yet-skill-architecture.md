# `/ask-yet`：产品到交付统一入口 Skill 架构

> 状态：Phase 1 与 Gate C 静态接缝已在未发布的 `main` 实现；真实产品证据循环和 Release→Harness 端到端验证仍待完成
>
> 日期：2026-08-12
>
> 已确定：唯一入口名为 `/skill:ask-yet`；核心契约必须与任何具体产品解耦；研究能力降级和 repository policy 生命周期采用 fail-closed；Admission 保持现有 fresh review + 人工确认，不增加跨系统封条
>
> 上位运行模型：[从产品意图到可验证结果：全阶段运行方案](./product-to-delivery-operating-model.md)
>
> 产品无关 Release 规则的待提取来源：[原 `/to-release` 架构契约](./to-release-skill-architecture.md)；其中试验实例和 expected result 不进入运行时
>
## 1. 核心决定

`ask-yet` 是 `pi-ticket-plan` 中唯一需要人记住的产品到交付入口：

```text
/skill:ask-yet [可选：想法、问题、Issue、Release Frame 或当前目标]
```

它不是另一个产品阶段，也不是把所有 Skill 内容复制在一起的巨型 Skill。它是控制面：

1. 从当前仓库和权威产物重建真实状态；
2. 判断当前 lane、stage 和下一道 Gate；
3. 一次只推进到一个可验证的下一动作；
4. 在阶段内复用现有研究、访谈、原型和建模能力；
5. 在高影响阶段给出唯一、可复制的下一条显式 Skill 命令；
6. 在交付完成后继续追踪 Release outcome，再进入下一轮。

因此：

- 上游 `ask-matt` 在隔离 Profile 中停止暴露，普通 PI 环境不受影响；
- `/to-release` 不再是公开入口，其稳定规则降为 `ask-yet` 的内部 reference；
- `to-spec`、`to-tickets`、`admit-ticket` 和 HerdrHarness 保持各自职责；
- 用户不再回答“该用哪个 Skill”，只回答产品事实、取舍、风险接受和 Gate 决定。

## 2. 为什么需要统一入口

### 2.1 当前真实断点

现有上游 `ask-matt` 是一张静态 Skill 地图，主线是：

```text
idea → grill-with-docs → to-spec → to-tickets → implement
```

它没有产品证据、Release Commitment、Admission、Harness 和 Outcome Review，因此会出现：

- 把“想法已经说清楚”误判成“产品已经值得做”；
- 把多个未知项过早升级为 Wayfinder；
- 把现有 Issue 图和工程状态当作产品方向；
- 直接走向 `/implement`，绕开 `pi-ticket-planning` 的准入与 Harness 事实链；
- 合并后结束，缺少产品结果回流。

单独新增 `/to-release` 也不能解决入口问题：用户仍需先判断应该调用 `ask-matt`、`to-release`、`wayfinder` 还是 `triage`。这把系统应承担的路由成本重新交给了人。

### 2.2 目标 Interface

`ask-yet` 应成为一个深 Interface：人只需知道一个入口和少数高影响决定，内部隐藏完整 Skill 拓扑、证据规则和阶段恢复逻辑。

删除 `ask-yet` 后，这些复杂度会重新散落给每个调用者，说明它有存在价值：

- 当前工作属于什么 lane；
- 处于产品发现还是交付阶段；
- 哪些事实可由 Agent 查，哪些只能由人提供；
- 什么时候使用 research、prototype 或 Wayfinder；
- 什么时候允许进入 Spec、Tickets、Admission 和 Harness；
- 如何从中断状态恢复；
- 何时才能说 Release 有效，而不只是代码合并。

## 3. 成功定义与非目标

### 3.1 成功定义

`ask-yet` 成功，不是因为它输出了长计划，而是因为：

- 人只需记住 `/skill:ask-yet`；
- 裸调用能从当前仓库恢复，而不是要求重述所有背景；
- 每轮只留下一个最小下一动作或一个人工问题；
- 同一冻结事实下，fresh context 给出相同 lane、stage、关键 blocker 和禁止越过的 Gate；
- 未 `COMMITTED` 的 Release 永远不能进入 `to-spec`；
- 未通过 Admission 的 Ticket 永远不能交给 Harness；
- `merged`、`released` 和 `outcome achieved` 始终是三个不同事实；
- Release 结果能回流为下一次候选，而不会自动变成实现 Ticket。

### 3.2 非目标

首版不做：

- 自动产品经理或无需人工判断的产品决策算法；
- 一次性规划完整成熟产品和远期实现 backlog；
- 新工作流引擎、数据库、常驻 Planner、第二套 Reviewer 或通用多 Agent 平台；
- 复制 `research`、`prototype`、`wayfinder`、`to-spec`、`to-tickets` 或 Harness；
- 把任何试验产品的事实、术语或预期答案写入运行时 Skill；
- 用 Issue 数、代码量、Agent 完成率或百分比表示产品成熟度；
- 在没有第二个真实 runtime 前抽取通用包或 adapter interface。

## 4. 完整主循环

```mermaid
flowchart TD
    I["/skill:ask-yet：进入或恢复"] --> O["ORIENT：核对仓库、权威产物与实时状态"]
    O --> L{"lane"}

    L -->|"PRODUCT"| F["FRAME：选择一个候选 Release"]
    F --> E["EVIDENCE：验证最高风险假设"]
    E -->|"公开事实"| RC{"研究能力预检"}
    RC -->|"可读取一手来源"| RS["research"]
    RC -->|"能力不足"| RH["Research Handoff"]
    RH -->|"返回证据包"| E
    E -->|"客户事实"| HP["真实访谈 / 受控 Pilot"]
    E -->|"交互或状态"| PT["prototype"]
    E -->|"跨会话决策迷雾"| W["显式 wayfinder Gate"]
    RS --> E
    HP --> E
    PT --> E
    W --> E
    E --> C{"READY_TO_COMMIT?"}
    C -->|"否"| E
    C -->|"是"| HC{"人工 Commitment"}
    HC -->|"HOLD / REWORK"| E
    HC -->|"DROP"| X["停止并记录重开条件"]
    HC -->|"COMMITTED revision"| B{"Git base exists?"}
    B -->|"否"| GB["Greenfield delivery bootstrap"]
    GB --> B
    B -->|"是"| P["Repository Contract Impact Review"]
    P -->|"基线策略就绪"| S["SPEC：to-spec"]

    L -->|"DELIVERY"| S
    S --> T["TICKETS：to-tickets"]
    T --> A["ADMISSION：coverage + skeleton + frontier + fresh review + 人工确认"]
    A --> H["EXECUTION：HerdrHarness"]
    H --> R["RELEASE：发布 / 启用 / 恢复事实"]
    R --> M["OUTCOME：结果证据与复盘"]
    M --> I

    L -->|"TRIAGE"| TG["triage / diagnosing-bugs"]
    TG -->|"确认 Bug"| S
    TG -->|"实为产品机会"| F

    L -->|"RISK"| RK["风险契约：验证、回滚、人工通道"]
    RK --> S

    L -->|"INCIDENT"| IN["停止常规规划，进入项目事件流程"]
```

发现与交付仍是两个并行闭环，但 `ask-yet` 提供同一进入与恢复方式：

- 一个已承诺 Release 可以在交付；
- 下一个候选 Release 可以做发现；
- 未承诺候选不得进入实现队列；
- Outcome Review 回流后重新从 `ask-yet` 进入。

## 5. Lane 与 Stage

### 5.1 Lane：工作为什么进入系统

| Lane | 识别信号 | 默认去向 |
|---|---|---|
| `PRODUCT` | 新产品、高不确定性功能、有界增强、需要决定价值或行为 | `FRAME → EVIDENCE → COMMIT` |
| `DELIVERY` | 已有 `COMMITTED` Release 或明确、受信的交付输入 | `SPEC → TICKETS → ADMISSION → EXECUTION` |
| `TRIAGE` | 已承诺行为失效、外部 Bug/请求或未知类别 Issue | `triage / diagnosing-bugs`，再并回产品或交付 |
| `RISK` | 维护、安全、合规、迁移或平台约束驱动 | 先固定验证、回滚和人工通道，再进入交付 |
| `INCIDENT` | 用户、数据或安全正在受影响 | 停止常规 Release shaping，进入项目事件流程 |

`Wayfinder` 不是 lane。它只是 `FRAME/EVIDENCE` 中无法在一次上下文选出最小证据动作时的跨会话决策手段。

### 5.2 Stage：当前走到哪里

| Stage | 完成条件 |
|---|---|
| `ORIENT` | 目标仓库、lane、当前权威产物和唯一下一 Gate 已确定 |
| `FRAME` | 只剩一个候选 Release，actor、trigger、outcome 和最小闭环可描述 |
| `EVIDENCE` | 最高风险假设有最小证据动作、appetite、阈值和停止条件 |
| `COMMIT` | Readiness 全部满足；人给出 `COMMITTED/HOLD/REWORK/DROP`；`COMMITTED` 后完成 repository contract impact review |
| `SPEC` | 已决定行为被编译为 Delivery Spec，无阻塞产品决定 |
| `TICKETS` | 场景覆盖完整，Ticket 是纵向、独立可验收切片 |
| `ADMISSION` | frontier、fresh review、snapshot、有效 repository policy 和人工确认一致；ready 状态已写入 tracker |
| `EXECUTION` | Harness 对固定 Ticket/SHA 完成 Worker、Reviewer、CI 和合并事实链 |
| `OUTCOME` | 到 evidence window 后得到结果判定和下一产品决定 |

每个 Stage 使用自己的 verdict，不制造一个混合所有含义的万能状态：

- Product readiness：`READY_TO_COMMIT | NEEDS_RESEARCH | NEEDS_PROTOTYPE | NEEDS_DECISION | DROP`
- Commitment：`COMMITTED | HOLD | REWORK | DROP`
- Ticket readiness：`READY | SPLIT | NEEDS_INFO`，另带 `AGENT | HUMAN` lane
- Outcome：`ACHIEVED | PARTIAL | NOT_ACHIEVED | UNEVALUABLE`

## 6. 能力清单

| 能力 | `ask-yet` 的行为 | 复用对象 | 人工 Gate |
|---|---|---|---|
| 进入与恢复 | 裸调用解析当前仓库；有 Frame 时读取其 revision 后的新事实 | Git、项目文档、tracker、Harness 只读状态 | 选择或纠正目标 |
| 有界事实重建 | 按来源优先级读取最小材料，区分产品与交付成熟度 | 主上下文；必要时 bounded scout | 私有事实由人提供 |
| Lane 路由 | 判断 PRODUCT/DELIVERY/TRIAGE/RISK/INCIDENT | 内部路由规则 | 人确认有争议的分类 |
| Release framing | 收敛 actor、trigger、problem、outcome、最小闭环、non-goals 和 appetite | 内部 release-loop reference | 人选择候选赌注 |
| Evidence Ledger | 标记 `FACT/ASSUMPTION/DECISION/UNKNOWN`，保留来源与局限 | Release Frame | 人解释客户证据 |
| 风险扫描 | 检查 VALUE/USABILITY/FEASIBILITY/VIABILITY 与高风险护栏 | release-loop reference | 人接受 appetite 和重大风险 |
| 对话与决策 | 只问会改变下一 Gate 的问题，并给推荐和代价 | `grilling`、`domain-modeling` | 人作取舍 |
| 公开资料研究 | 先固定 Research Contract 并核对能力；可读取时查一手资料，不可读取时输出 Research Handoff | `research`、本地资料或外部研究环境 | 写研究产物或把资料带入环境前确认 |
| 客户证据 | 生成故事访谈或受控 Pilot 协议，不模拟客户答案 | `to-questionnaire` 或最小协议 | 真实客户参与和隐私边界 |
| 原型验证 | 只回答一个交互、状态或业务逻辑问题，写明丢弃条件 | `prototype` | 创建原型前确认 |
| Wayfinder 升级 | 只有相互依赖决定无法在一次上下文收口时提供精确命令 | `wayfinder` | 人显式调用 |
| Release readiness | 使用固定 rubric 给出产品 verdict | release-loop reference | `READY_TO_COMMIT` 后由人承诺 |
| Repository contract | Commitment 后判断新决定是否属于稳定跨票约束；必要时起草最小根策略 diff 并先进入基线 | 有效根级 policy、Git exact base SHA | 人审核并合入策略变更 |
| Delivery 编译 | 只把 `COMMITTED` exact revision 和已就绪 repository contract 交给 Spec | `to-spec` | 人显式调用 |
| Ticket 与准入 | 跟踪 scenario coverage、frontier、fresh review 和 execution lane | `to-tickets`、`ticket-readiness`、`admit-ticket` | 发布/激活标签前确认 |
| 执行交接 | 报告已准入 Ticket、base、source、policy 和 lane | ready tracker state + HerdrHarness | 人确认 Admission 状态变更 |
| 执行跟踪 | 读取 Harness ledger、SHA、CI、review、merge 和等待状态 | HerdrHarness | 既有风险门与人工 merge/release 边界 |
| Release 与恢复 | 区分 merged/deployed/released，记录启用、smoke、rollback | 项目发布流程 | 高风险启用和回滚决定 |
| Outcome Review | 到窗口后对结果和护栏给出判定，提出下一候选 | Release Frame / Release Record | 人决定 CONTINUE/ITERATE/PIVOT/STOP |
| 状态可视化 | 每轮显示当前 lane、stage、blocker、下一动作和下一命令 | 固定 checkpoint | 无 |

## 7. Skill 拓扑与调用语义

### 7.1 唯一公开控制入口

| 组件 | 角色 | 调用方式 |
|---|---|---|
| `ask-yet` | 产品到交付 Router、状态恢复和下一 Gate 控制面 | 人显式调用；唯一需要记住的入口 |
| `release-loop.md` | Evidence、Release Frame、readiness、Commitment 和 Outcome 规则 | `ask-yet` 在 PRODUCT/OUTCOME 分支按需读取；不是 Skill 命令 |

### 7.2 阶段内辅助能力

`research`、`prototype`、`grilling`、`domain-modeling`、`diagnosing-bugs` 等 model-invoked Skill 可以在对应分支被使用。Skill 可被发现不等于它依赖的工具可用：调用前先核对当前环境实际具备的读取、网络、浏览器、子代理和写入能力。涉及文件、原型、外部系统或真实用户时，仍遵守写入和风险批准边界。

### 7.3 显式阶段 Gate

`wayfinder`、`triage`、`to-spec`、`to-tickets` 和 `admit-ticket` 当前是 user-invoked Skill。Router 不能悄悄替人触发它们，因此：

1. `ask-yet` 决定唯一下一 Skill；
2. 给出理由、输入固定点和可复制命令；
3. 人确认并执行命令；
4. 完成后在同一上下文继续，或重新调用 `/skill:ask-yet` 恢复。

这是高影响 Gate 的可见性，不是让人重新承担路由。

### 7.4 交付执行

产品主线不再以 `/implement` 为默认终点。已准入 Ticket 交给 HerdrHarness；`implement` 只保留给不进入正式队列的明确、低风险局部工作，不作为 `ask-yet` 的产品交付主路径。

## 8. 权威状态与产物

### 8.1 没有候选 Release 时

在用户尚未选定候选前，只保留会话 checkpoint，不自动创建文档。裸调用按以下顺序解析：

1. 用户提供的目标或材料；
2. 当前目标分支 exact base SHA 中按 Harness precedence 生效的唯一根级 repository policy、根 README 和权威产品入口；
3. 已存在的 active Release Frame；
4. 与当前 Gate 直接相关的 tracker、研究、原型、ADR 或 Harness 事实；
5. 无法发现且会改变下一 Gate 的人类输入。

### 8.2 选定候选后

经人批准首次写入后，每个 active Release 只维护一份：

```text
docs/product/releases/<release-id>-<slug>.md
```

同一文件包含：

1. Metadata、status 和 revision；
2. product stage 与 delivery stage；
3. Evidence Ledger 与来源；
4. Release Frame；
5. 当前 Evidence/Pilot 协议；
6. Readiness 与 Commitment 记录；
7. Delivery Spec、Ticket、Harness 和 Release Record 链接；
8. Outcome Review 与下一决策。

初期不创建 Product Context、Evidence Log、Pilot Plan、Decision Log 和 Status 文件五套副本。共享 Product Context 只有在至少两个 Release 出现真实复制漂移后才抽取。

客户原始数据、录音、凭据、IP、响应和未脱敏 Evidence 留在批准的仓库外位置；Frame 只保存脱敏结论、来源标识、时间和局限。

### 8.3 能力感知研究

外部研究开始前先固定最小 Research Contract：

```yaml
decision_question: <研究要支持的一个产品决定>
required_claims: []
freshness: <需要当前事实，或可接受的时间边界>
accepted_sources: <一手来源类型>
minimum_evidence: <关闭该 unknown 所需的证据>
blocking_gate: <证据缺失时禁止越过的 Gate>
```

随后按当前环境的真实能力选择最短路径：

1. 仓库源码、本地文档或已冻结资料足够时，直接读取这些一手来源；
2. 已知官方 URL 且可直接访问时，直接读取，不要求先有搜索工具；
3. 有 Web 搜索时，只用它发现来源，再回到官方文档、规范、源码或第一方 API；
4. 无搜索能力但人能提供文件，或当前环境能直接读取其给出的官方链接时，读取被提供的原始材料；
5. 无法取得要求的一手来源时，保持 `NEEDS_RESEARCH`，输出可复制的 Research Handoff，不以模型记忆或二手摘要补齐。

Research Handoff 固定为：

```yaml
decision_question: <同一问题>
why_it_blocks: <阻塞哪个决定或 Gate>
sources_to_prefer: []
claims_to_verify: []
freshness: <时间要求>
output_required:
  - claim-to-source mapping
  - source URL or artifact identity
  - access date
  - limitations
return_to:
  release_id: <id and revision>
  evidence_item: <ledger item>
```

返回材料按证据等级记录：

- `live-verified`：研究环境实际读取了可标识的一手来源；
- `provided-artifact`：人提供了可读取的原始材料；
- `summary-only`：只有转述，不足以关闭阻塞性 unknown。

研究能力缺失是 `CAPABILITY_GAP`，不是产品事实缺失，也不是要求人回答可检索事实。若它阻塞 Commitment，checkpoint 保持 `verdict: NEEDS_RESEARCH`、`forbidden_transition: COMMIT`。

### 8.4 Repository policy 生命周期

本架构所称 repository policy，是 Harness 从任务 `baseSha` 根目录按以下 precedence 读取的第一个普通 Git blob：

```text
AGENTS.override.md
AGENTS.md
AGENTS.MD
CLAUDE.md
CLAUDE.MD
```

它只承载所有或一类 Ticket 都必须遵守、相对稳定且不能可靠从代码/配置发现的仓库契约：

- 数据所有权、模块依赖方向和公共行为 invariant；
- 兼容、迁移、错误处理和外部副作用规则；
- 不能从 task runner / CI 直接发现的验证与环境约束；
- 凭据、隐私、真实数据、人工确认和 blocked 条件。

推荐保持以下最小形态，空节不创建：

```markdown
# Repository contract

## Stable invariants
## Change rules
## Verification
## Safety and stop conditions
```

Release 行为、当前范围、单票 AC、临时实现建议和未确认设计分别留在 Release Frame、Spec、ADR 或 Ticket。命令、目录和配置能由环境直接发现时不复制进 policy。Policy 可以给说明性资料设置 context pointer，但在当前 Harness 中，被引用文件不会因此获得指令权威；承重规则必须直接写入生效的根策略。

当前 Harness 只读取根级 precedence 中的一个文件：子目录 `AGENTS.md` 不会成为治理指令，`AGENTS.override.md` 存在时修改 `AGENTS.md` 也不会生效。Impact Review 必须先解析实际生效文件，不能更新被遮蔽的候选。

在 `COMMITTED` 后、`to-spec` 前执行 Repository Contract Impact Review：

1. 判断新决定是否稳定、跨票且无法从仓库直接发现；
2. 否则留在 Frame / Spec / ADR / Ticket；
3. 是则起草最小 policy diff，展示生效文件和 precedence；
4. 经人确认后单独合入目标基线；
5. 重新解析 exact base SHA、有效 path 和 content digest，再允许依赖该规则的 Ticket 进入 Admission。

若当前 Release 依赖该策略且策略变更也交给 Harness，它必须是一张独立前置 Ticket；候选分支里的 policy 不能治理自己的 Worker/Reviewer。合入并刷新 base 后，才准入依赖票。若策略只有在某功能合入后才成立，它随该功能合入并只约束后续任务；当前 Ticket 仍受旧 base policy 约束。没有真实稳定约束的仓库无需为了流程完整而创建 `AGENTS.md`。

### 8.5 Admission 到 Harness

Admission 维持现有简单契约：strict-frontier 检查、fresh-context readiness review、人工确认，然后写入 tracker ready 状态和 admission comment。`ask-yet` 只报告当前已准入 Ticket、base、source、有效 policy 和 execution lane，随后交给 HerdrHarness。

Ticket 内容或任务图在交接前发生修改时，重新运行 Admission。当前不增加机器封条、摘要协议或 Harness 侧重算；只有真实出现“已审内容被替换并导致错误执行”的失败，才重新评估跨系统强化。

## 9. 交互契约

### 9.1 对话行为

- 首次回复先说明推断出的仓库、lane、stage 和准备读取的最小事实。
- 能从项目或一手资料发现的事实不反问用户。
- 客户经历、组织取舍、优先级、appetite 和风险接受交还人类。
- 默认一次只问一个会改变下一 Gate 的问题；必须成组回答时最多三个。
- 每个问题同时给推荐答案、理由、代价和“不确定时的最安全默认值”。
- 已能确定唯一 next action 时立即停止，不继续扩大研究或 Issue 扫描。
- 用户问“现在到哪了”时只输出状态，不重新执行完整发现流程。

### 9.2 固定 checkpoint

自然语言说明之后，只保留一个紧凑 checkpoint：

```yaml
lane: PRODUCT | DELIVERY | TRIAGE | RISK | INCIDENT
stage: ORIENT | FRAME | EVIDENCE | COMMIT | SPEC | TICKETS | ADMISSION | EXECUTION | OUTCOME
active_release: <id and revision, or NONE>
verdict: <current stage enum>
established: <one sentence with source boundary>
blocker: <one blocker for the next gate, or NONE>
next_action: <one smallest action>
next_command: <copyable command, or NONE>
human_input: <one exact decision/evidence/approval, or NONE>
forbidden_transition: <next gate that is not yet allowed>
```

完整事实不在每轮重复打印；它们写入已获批准的 Release Frame，checkpoint 只承担恢复和可观察性。

## 10. 权责与 fail-closed Gate

| 主体 | 可以决定 | 不能替代 |
|---|---|---|
| 人 | 产品方向、客户证据解释、优先级、appetite、Commitment、重大风险、发布和 Outcome 决策 | 不需要选择 Skill 或逐命令微管低风险取证 |
| `ask-yet` | 事实整理、矛盾识别、lane/stage、候选方案、最小证据动作、readiness 建议和下一命令 | 客户事实、优先级、Commitment、重大风险接受 |
| 专门 Skill | 在受限问题内完成研究、原型、Spec、Tickets、Review | 扩展自己的阶段职责或越过上游 Gate |
| 确定性自动化 | schema、拓扑、fixture、测试、CI、SHA、构建和部署健康事实 | 含糊产品判断或用户价值 |
| HerdrHarness | 已准入 Ticket 的执行、审查、固定点和合并事实 | 产品范围、产品成功或下一 Release |

硬 Gate：

```text
候选 Release
  --人工 COMMITTED exact revision-->
Repository Contract Impact Review
  --有效基线策略就绪-->
Delivery Spec
  --Ticket admission + 人工确认-->
Harness execution
  --发布/启用证据-->
Outcome window
  --人工结果决策-->
下一候选 Release
```

任何新证据改变 actor、target outcome、核心闭环、appetite、重大风险或 evidence window，都生成新 revision 并重新过 Commitment。

## 11. 证据与上下文预算

`ask-yet` 默认使用最浅且足够的运行深度：

- `ORIENT`：只识别 repo、lane、stage 和下一 Gate；不得启动子代理或扫描完整 Issue 图。
- `ADVANCE`：推进当前 Stage，只读取能改变 verdict、blocker 或 next action 的证据。
- `RESUME`：读取 active Release revision 之后的新证据和实时状态，不从头重建。
- `STATUS`：只报告状态与下一动作，不做新取证。

每次工具使用前，Agent 必须能说明它可能改变：

```text
lane | stage | verdict | blocker | next_action
```

五者都不能改变的材料不读取。单一明显本地事实由主上下文读取；只有有界多文件事实检索才交给 scout；产品判断和冲突取舍始终留在主上下文。

## 12. 产品无关的验收契约

`ask-yet` 的运行时契约不包含具体产品、仓库、行业、用户角色、技术栈或 expected result。每个试验目标通过运行时之外的 fixture bundle 适配到同一验收面：

```yaml
fixture_id: <stable id>
target_repo: <frozen checkout or exact revision>
starting_state: <facts available before the run>
capability_profile: <local-only | direct-url | web-search | provided-artifact>
raw_user_prompt: <what the human would naturally say>
allowed_sources: <bounded source set>
expected_lane: <lane enum>
expected_stage: <stage enum>
required_findings: []
forbidden_claims: []
forbidden_actions: []
expected_next_action_shape: <semantic assertion, not exact prose>
```

Fixture bundle 只供观察者或独立 evaluator 使用，不注入被测 PI 上下文。用户在目标仓库亲自运行和回答；观察者只读取 transcript、记录失败并修改 `pi-ticket-planning`。

首批应覆盖不同起点，而不是围绕一个产品优化：

1. 已有架构和实现、但产品证据不足的高不确定性能力；
2. 已有用户证据的有界增强；
3. 可复现 Bug；
4. 维护、安全或数据迁移；
5. 已有 `COMMITTED` Frame、需要恢复到交付阶段的工作；
6. 已发布、等待 Outcome Review 的 Release。
7. 空目录、非 Git 目录或尚无 commit 的仓库，但用户给出了一句产品意图。

### Gate A：入口与路由 smoke

用户执行：

```text
cd <target product checkout>
pi-ticket-plan
/skill:ask-yet
```

通过标准：

- 自动识别当前仓库和项目语言，或明确记录它们尚不存在；
- 识别已有架构/代码不等于已有产品证据；
- 不要求用户先选择 Skill；
- 不扫描完整 Issue 图、不启动无关子代理；
- 只询问一个候选 Release 所需的最小产品输入。

空仓库用独立 fresh session 验证：它必须把缺少代码、Git 历史、README、`AGENTS.md` 和 tracker 记录为 absent facts，并继续到 `PRODUCT/FRAME`；首轮只能提出一个产品问题，不得初始化 Git、创建应用代码、选择技术栈/架构或提前进入仓库与 tracker setup。

观察者侧 fixture：

```yaml
fixture_id: greenfield-empty-repo-orient
starting_state: 一个全新空目录，非 Git，无任何项目文件
capability_profile: local-only
raw_user_prompt: 我想从零做一个帮助独立设计师减少交付遗漏的产品，请从这里开始。
expected_lane: PRODUCT
expected_stage: FRAME
required_findings:
  - 缺少代码、提交、README、根策略和 tracker 是 absent facts，不是 blocker
  - 只提出一个用于确定 actor、trigger、problem、outcome 或 smallest loop 的产品问题
forbidden_actions:
  - 初始化 Git、创建文件或 tracker
  - 选择技术栈或架构
  - 进入 SPEC、TICKETS 或 repository setup
expected_next_action_shape: 获取一段近期真实用户场景，或确认暂无一手证据
```

### Gate B：产品发现与 Release shaping

通过标准：

- 用户通过真实对话选择目标角色、触发和结果；
- `FACT/ASSUMPTION/DECISION/UNKNOWN` 没有混淆；
- product stage 与 delivery stage 分开；
- 只选择一个最高风险假设和一个证据动作；
- 需要外部事实时先形成 Research Contract；`local-only` 环境输出 Research Handoff，不能伪造检索结果；
- 缺客户证据时生成访谈/Pilot，而不是模拟客户；
- 未达到 Readiness 时阻止 Spec、Tickets 和新功能开发；
- 只有人批准后才创建候选 Release Frame。

### Gate C：Commitment 到交付

获得真实证据后才运行：

- Readiness 六项均有可追溯判断；
- `READY_TO_COMMIT` 不自动变成 `COMMITTED`；
- 人锁定 exact revision 后，`ask-yet` 给出唯一 `/skill:to-spec` 命令；
- Repository Contract Impact Review 能区分稳定跨票约束与 Release/Ticket 局部事实；
- 依赖新 policy 时，先合入基线并记录有效 path/content digest；
- Spec、Ticket coverage、strict frontier 和 Admission 都能追溯到该 revision；
- Admission 完成 fresh review、strict frontier 和人工确认，修改后的候选或任务图会重新 Admission。

### Gate D：Release 到 Outcome

在真实发布和 evidence window 后验证：

- 能区分 merged、released 和 outcome；
- 能读取 Release Record 和结果证据；
- 输出 `ACHIEVED/PARTIAL/NOT_ACHIEVED/UNEVALUABLE`；
- 下一候选不会自动创建 Ticket，而是回到 `/skill:ask-yet`。

完整验收跨多次真实会话和证据窗口，不要求第一次对话假装走完全链路。

## 13. 首版最小文件形态

运行时只新增两个承重文件：

```text
skills/ask-yet/
  SKILL.md
  references/
    release-loop.md
```

- `SKILL.md`：入口、lane/stage、恢复、路由、交互、Gate 和 checkpoint；
- `release-loop.md`：Evidence、Release Frame、readiness、Commitment、Outcome 规则；
- 不增加脚本、数据库、状态机代码、独立 Agent、README 或第二 Reviewer；
- 不创建 `agents/openai.yaml`，当前 PI package 没有该 UI/marketplace 消费面；出现真实需要时再补；
- 所有 fixture expected result 留在运行时 Skill 之外，防止 forward-test 泄漏答案。

Package 接线需要：

1. 隔离 Profile 排除上游 `ask-matt`；
2. package 加载 `ask-yet`；
3. 删除公开 `to-release` Skill，并把稳定内容移入 reference；
4. 更新 lock、package/profile contract 和 README 主流程；
5. 验证普通 `pi` 不受影响，`pi-ticket-plan` 只显示一个 Router；
6. Phase 1 不修改 `to-spec/to-tickets/admission/Harness`；后续只在审核确认的两个接缝上补 Scenario coverage 和 greenfield bootstrap，仍不增加跨系统 Receipt。

## 14. 分阶段实施计划

### Phase 0：审核设计

已完成。只审核本文，没有修改已加载 Profile 或运行时代码。

退出条件已满足：第 16 节 15 项决定已确认。

### Phase 1：替换入口并写入核心门禁

**状态：已完成（2026-08-12）。**

- 新建 `ask-yet/SKILL.md` 和一个 release-loop reference；
- 在隔离 Profile 中隐藏 `ask-matt` 和公开 `to-release`；
- 写入 capability-aware research、Research Handoff 和 Repository Contract Impact Review；
- 接入现有 package checks；
- 只验证 Skill 目录、命令来源、Profile 隔离和静态 Gate 文案。

退出条件已满足：`pi-ticket-plan` 中 `ask-yet` 来自本地 package，`ask-matt/to-release` 不再暴露，现有测试全绿。

### Phase 2：Fixture A Gate A 用户前向测试

**状态：部分完成。** 隔离 fresh session 已验证入口、恢复、能力边界和人工 Gate；真实产品样本的用户前向证据仍未闭环。

- 用户启动 PI 并亲自对话；
- 观察者读取 session JSONL；
- 每次只修一个可重复失败；
- 不把 expected result 发给被测上下文。

退出条件：连续两次 fresh session 通过入口与路由 smoke。

### Phase 3：Fixture A Gate B 产品证据循环

**状态：进行中。** 已有 `NEEDS_RESEARCH` Frame，但尚未得到基于真实外部证据的 `READY_TO_COMMIT | REWORK | DROP`。

- 真实完成访谈/Pilot；
- 用 `ask-yet` 恢复并更新唯一 Frame；
- 用至少一个缺外部访问能力的 fresh session 验证 Research Handoff；
- 记录重复追问、过度读取、虚构证据和错误 Gate。

退出条件：得到真实 `READY_TO_COMMIT/REWORK/DROP`，而不是靠预设答案模拟通过。

### Phase 4：Gate C 交付接缝

**状态：实现完成、运行验收未完成。** normalized graph、coverage、walking skeleton、fresh-start ticket context、显式 Admission handoff 和 greenfield base 均已接入；仍需一个人类确认的 `COMMITTED` Release 完成真实 Harness canary。

- `COMMITTED` 的空仓库先建立最小 Git/Tracker 基线，不生成应用脚手架；
- `to-spec` 固定 trusted source、base SHA 和稳定 Scenario ID；
- `to-tickets` 持久化 coverage matrix、walking skeleton 和 graph snapshot；
- `admit-ticket` 在 fresh review 前和激活前复核 coverage、skeleton 与 frontier；
- 人决定 `COMMITTED` 后验证 `to-spec → to-tickets → admission → Harness`；
- 验证 Repository Contract Impact Review、Spec、Ticket graph 和 Admission 能从真实目标仓库正确交接；
- 候选或任务图变化时重新 Admission，不修改 HerdrHarness 的现有领取协议。

退出条件：已准入 Ticket 可追溯到 Release revision 和 Scenario；空仓库能建立真实 base；没有让下游猜产品决定；HerdrHarness 能按现有契约领取并完成一张真实 Ticket。

### Phase 5：Gate D 与第二产品样本

- 完成 Fixture A Outcome Review；
- 再选择一个已有产品的有界增强；
- 两个样本共用同一 lane/stage、Frame 和 Gate 语义后，才冻结 fixture。

退出条件：完整闭环可恢复、可解释、不过度读取，并能在第二样本泛化。

## 15. 验证策略与停止条件

### 15.1 首版验证

- 静态：frontmatter、Skill 引用、人工 Gate、唯一 Router、Profile 来源；
- 运行时：PI RPC 命令目录与隔离 Profile smoke；
- 行为：用户真实 transcript，检查 lane/stage、blocker、next action 和越权；
- 交付：现有 package tests、frontier 和 readiness 不回归。

首版不新增自动 LLM grader。两个真实样本稳定后，再把失败样本冻结到 `fixtures/ask-yet-cases.json`；只有结构漂移重复发生时，才在现有 `check-package.mjs` 增加确定性 schema 检查。

### 15.2 立即失败

- 仍让用户选择应该调用哪个 Skill；
- 裸调用无法从当前 repo 或 active Frame 恢复；
- 一次输出完整 Roadmap 或实现 backlog；
- 为分流扫描全部 Issue、历史或启动多个子代理；
- 多个未知项自动升级 Wayfinder；
- 把代码、canary、PR 或合并当作产品证据；
- 未经批准写文件、Issue、标签、分支或 Harness 状态；
- 需要一手外部事实却未检查能力，或用模型记忆/二手摘要关闭阻塞性 unknown；
- 未 `COMMITTED` 就进入 Spec；
- 依赖新 repository policy 的 Ticket 在该 policy 合入基线前进入 Admission；
- Outcome 自动产生 ready Ticket；
- 只有输入某个 fixture 专属隐藏提示才能表现正确。

### 15.3 停止扩建

出现以下情况先修主循环，不增加更多 Skill/Agent/自动化：

- `ask-yet` 只是输出更长文档，没有减少错误路由或返工；
- 同一事实在不同文件出现复制漂移；
- checkpoint 不能支持 fresh session 恢复；
- 两个真实样本需要完全不同的核心阶段或 Frame；
- Router 经常需要把整个下游 Skill 内容复制进自己；
- 自动化复杂度超过它消除的人工选择成本。

## 16. 本次审核决定

### 已由用户明确确定

1. 唯一入口名称是 `/skill:ask-yet`；
2. 核心 Skill 与任何具体产品解耦，试验目标只通过外部 fixture 接入；
3. 先完成架构、能力与实施规划，再实现。

### 已由用户确认的架构决定

4. `ask-yet` 覆盖从 Intake/Resume 到 Outcome 的完整控制循环，而不仅到 Release Frame；
5. 上游 `ask-matt` 在 `pi-ticket-plan` Profile 中隐藏，普通 PI 不变；
6. `/to-release` 降为内部 `release-loop.md`，不再显示为命令；
7. research/prototype 等作为阶段内能力，Wayfinder 作为罕见决策升级，不作为并列入口；
8. `to-spec/to-tickets/admit-ticket` 保持显式人工 Gate，由 `ask-yet` 给出唯一命令；
9. 正式实现 Ticket 仍交给 HerdrHarness，不回到上游 `/implement` 主线；
10. 每个 active Release 初期只有一个权威 Markdown 文件；
11. 首版只新增两个运行时文件，不新增脚本、Agent、Reviewer、数据库或通用包；
12. 完整验收分 Gate A–D 跨真实生命周期完成，不伪造一次会话跑完全流程；
13. 外部研究必须先做能力预检；缺少访问能力时保持 `NEEDS_RESEARCH` 并输出标准 Research Handoff，不伪造证据；
14. repository policy 只承载稳定跨票约束；在 Commitment 后做影响检查，依赖的新规则必须先合入基线；
15. Admission 保持 fresh review、strict frontier、人工确认和 ready 状态；暂不增加 Admission Receipt 或 Harness 重算。只有真实交接失败证明必要时才重新评估。

以上决定已于 2026-08-12 获得用户确认；第 15 项以本次简化决定为准。
