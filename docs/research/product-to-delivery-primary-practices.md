# 从产品发现到 AI 交付：一手工程实践证据综述

> 检索日期：2026-08-12
>
> 范围：`0→1 产品发现 / 既有产品功能演进 → Release framing → Spec → 小型纵向 Ticket → AI Agent 实现与独立审查 → CI/CD → 发布后证据与下一轮决策`
>
> 本文是证据、适用性、局限与冲突的综述，不是最终实施方案。

## 1. 结论摘要

1. **没有一套方法单独覆盖全链路。** Continuous Discovery / Opportunity Solution Tree（OST）回答“哪个用户问题值得解决”；User Story Mapping 回答“用户如何完成目标、最小闭环是什么”；Shape Up 回答“这次愿意投入多少、边界和坑是什么”；Spec、BDD、INVEST、小 PR 实践回答“如何形成可实现、可验证的交付单位”；DORA、CI/CD、SSDF、SLSA 回答“如何持续、安全地集成和发布”。它们大部分是互补层，而不是彼此替代品。
2. **探索与交付应并行反馈，但不能混成同一种 Ticket。** Dual Track 的原始论述明确反对“发现阶段完成后再把需求交给开发”的串行交接；发现是快速降低价值、可用性、可行性风险，交付是稳定地产出可运行软件。对于一人加 AI，适用的是同一个人交替戴产品与交付两顶帽子，不是复制两个团队或两套永久 backlog。
3. **0→1 与既有产品演进不能使用同一种确定性。** 0→1 早期更适合以学习、原型和关键假设证据为结果；核心行为和架构尚未稳定时，不应假装已经拥有一条长期实现路线。既有产品可以从真实基线、行为漏斗、用户问题和回归约束出发，形成更具体的 Release slice。
4. **当前 `pi-ticket-planning` 已经较强地覆盖“已决定内容 → Delivery Spec → Ticket → 独立准入”，但不负责决定产品应做什么。** 它不能用更细的 Ticket 弥补上游缺失的目标、用户行为、机会证据和 Release 结果指标。
5. **“小型纵向 Ticket”有充分方向性证据，但没有行业通用数字阈值。** 一手资料支持一个自包含、可观察、可独立审查的主要结果；不支持“最多 8 条 AC”“最多 3 个交付面”是普遍规律。这些数字只能作为本地治理启发式，并用返工、审查耗时和拆票失败数据校准。
6. **AI Agent 的自动检查、独立 Reviewer、人类接受和产品结果是四层不同事实。** fresh-context Reviewer 能降低作者自我确认偏差，但仍可能与 Worker 共享模型盲点；GitHub 的 AI Review 也不会构成 required approval。METR 的维护者研究进一步显示，自动 grader 通过与真实可合并之间存在显著差距。
7. **DORA 指标衡量软件交付表现，不衡量产品是否成功。** 产品结果需要单独的用户行为、任务成功、质量反馈或业务指标；两类指标不能相互代理。
8. **安全实践应按风险叠加，而不是把 SSDF/SLSA 变成每张 Ticket 的大清单。** SSDF 是可裁剪的安全开发结果集合；SLSA 主要建立源码和构建产物的供应链完整性。它们都不能证明功能正确、产品有价值或依赖本身无漏洞。

## 2. 证据口径

本文只采用以下一手来源：

- 原作者或官方方法论：Teresa Torres、Jeff Patton、Shape Up、Agile Manifesto、INVEST 原作者、Cucumber 官方 BDD 文档；
- 官方工程与平台文档：DORA、Google Engineering Practices、GitHub、OpenAI、Anthropic；
- 标准与规范：NIST SSDF、SLSA；
- 原始研究：Google HEART 论文、METR 维护者审查研究、SWE-bench 项目资料；
- 当前仓库契约与源代码文档。

这些来源的证据强度不同：标准说明“应满足的控制结果”；平台文档说明“该工具当前怎样工作”；原作者方法论是经验框架，不是普适因果证明；单项研究能说明其样本中的现象，不能外推为所有产品和模型的精确成功率。因此下文分别记录“支持什么”和“不能证明什么”。

## 3. 当前本地链路的事实基线

截至检索日，本地 `pi-ticket-planning` 位于提交 `d634088065ced25a0f04b488019a949f1efddb74`：

- [`to-spec`](../../skills/to-spec/SKILL.md) 把已作出的决定整理成 Delivery Spec，包含问题、交付结果、行为场景、约束、验证、范围外事项和未决项；它明确不继续产品访谈，也不凭空补决定。
- [`to-tickets`](../../skills/to-tickets/SKILL.md) 从已决定的 Spec 生成纵向 Ticket、依赖图和主要验证入口，并在发布前要求人工确认。
- [`ticket-readiness`](../../skills/ticket-readiness/SKILL.md) 用 `READY / SPLIT / NEEDS_INFO` 检查全新上下文是否足够、阻塞关系是否真实，以及 Ticket 属于人类还是 Agent lane。
- [`admit-ticket`](../../skills/admit-ticket/SKILL.md) 对固定快照执行 fresh-context 复核，再经人工确认和漂移检查添加就绪标签。

本机用于集成的 `HerdrHarness-lite` checkout 位于提交 `058f1974070cf56d85ab2cf6b4766dc2156b5636`；只读实时核对显示 `origin/main` 已推进到 `08d5543c5c2fee4fccbb03e9623328cdfcc2e137`。远端当前[中文 README](https://github.com/Notyet1307/HerdrHarness-lite/blob/08d5543c5c2fee4fccbb03e9623328cdfcc2e137/README.zh-CN.md)仍把它定义为失败关闭的 Issue 交付控制器，并描述持久账本、分离的 Worker/Reviewer、固定 Git HEAD、固定验证命令、GitHub required checks 和真实 merge 观测。本文没有把过期的本地 tracking ref 当成远端当前事实。

由这些契约能作出的有界判断是：当前系统已经覆盖较严谨的**交付编译与执行事实链**；其上游输入仍假定“交付结果和关键行为已经决定”。它没有直接承载用户研究、机会选择、行为地图、Release 成功指标或发布后学习。这是职责边界，不是实现缺陷。

## 4. 阶段一：从方向到可证伪的产品结果

### 4.1 Continuous Discovery 与 Opportunity Solution Tree

[Teresa Torres 对 Product Discovery 的定义](https://www.producttalk.org/glossary-discovery-product-discovery/)把发现描述为决定做什么，交付则是构建、发布和维护。她的[OST 原始说明](https://www.producttalk.org/opportunity-solution-trees/)把结构固定为：期望结果 → 用户机会（需求、痛点、愿望）→ 候选方案 → 假设测试。其前提包括明确目标客户和价值主张、一个清晰结果，以及从故事型访谈中生成机会；不是把利益相关者的功能请求直接挂到树上。

这一方法支持：

- 先定义可观察结果，再讨论功能；
- 把用户问题与解决方案分层，避免“想到功能就排期”；
- 同一机会探索多个方案，并优先测试风险最大的假设；
- 新证据出现后回到树上更新选择，而不是维护一份永久正确的路线图。

其[关于发现投入的说明](https://www.producttalk.org/time-in-product-discovery/)同时反对把发现和交付做成串行大阶段：只做到足以降低当前不可接受风险即可；如果代码是最快的学习手段，代码也可以是实验。它也反对无限研究和数月不发布。

局限：

- OST 需要真实用户故事或其他可靠证据；只有创始人脑内假设时，树的外观不会提高证据质量。
- “每周访谈、每周测试”是 Continuous Discovery 的理想节奏，不是所有低流量、内部工具或单人产品都能满足的硬准入条件。
- OST 不是系统设计、技术依赖图或实现 Ticket 图。

### 4.2 Outcome、Output 与 MVP

[Torres 对 outcome 与 output 的区分](https://www.producttalk.org/shifting-from-outputs-to-outcomes/)是：output 是构建出来的东西，outcome 是对用户行为或业务产生的影响。早期缺少测量能力时可以使用方向性 outcome；进入陌生问题空间时也可以先使用 learning outcome，但不能把“发布了功能”当作成功。

[Eric Ries 对 MVP 的原始定义](https://www.startuplessonslearned.com/2009/08/minimum-viable-product-guide.html)强调以最少努力获得最多经验证学习。它支持将 0→1 的第一单位定义为“能验证关键假设的最小实验”，而不是“成熟产品功能清单的最小子集”。

局限：MVP 只规定学习目的，不自动提供质量、安全、可维护性或发布标准。实验代码若进入生产，仍需满足相应交付和风险门槛。

### 4.3 0→1 与既有产品的不同证据条件

[Shape Up 关于新产品与既有产品的章节](https://basecamp.com/shapeup/2.3-chapter-09)明确区分两种模式：核心架构和产品形态尚未稳定时是 R&D，目标是 spike 和学习，不承诺每个周期都发布；已有产品和稳定基础后，才更适合按 shaping、betting、shipping 运行。既有功能也可以先内部使用，再决定是否公开。

由此支持的边界是：

| 场景 | 可合理要求的上游证据 | 不应伪造的确定性 |
| --- | --- | --- |
| 0→1、问题空间陌生 | 目标用户/情境、最危险假设、学习问题、原型或最小实验、停止/转向信号 | 完整长期架构、数月实现 Ticket、必然发布承诺 |
| 既有产品新增功能 | 当前行为基线、用户旅程缺口、真实问题证据、兼容/回归边界、发布后指标 | 仅凭单个功能请求推断普遍需求 |

## 5. 阶段二：从机会到下一次 Release 闭环

### 5.1 User Story Mapping

[Jeff Patton 的原始说明](https://jpattonassociates.com/the-new-backlog/)反对只有优先级的扁平 backlog。Story Map 横向铺开用户为达成目标所经历的主干活动，纵向补充细节和优先级；通过沿用户旅程“走图”发现遗漏，再用横向 release slice 形成可端到端运行的 walking skeleton。[Story Mapping Quick Reference](https://www.jpattonassociates.com/wp-content/uploads/2015/03/story_mapping.pdf)把可行 Release 描述为：目标用户完成目标所需的最小任务集合，也可切出实验、MVP 或 walking skeleton。

适用性：

- 它补上 OST 不表达的“用户行为顺序和完整闭环”；
- Release slice 能约束只详细规划下一次能被使用或验证的闭环，而不是把整个 Roadmap 预拆成实现票；
- 既能用于 0→1 walking skeleton，也能在既有产品中定位旅程断点。

局限：Patton 明确把地图视为促进共同理解和持续对话的工具。它不是精确流程图、系统状态机、API 契约或可直接交给 Agent 的 Spec；单独保存一张图不能替代行为场景和验收条件。

### 5.2 Shape Up 的问题、Appetite 和边界

[Shape Up 的 Pitch 契约](https://basecamp.com/shapeup/1.5-chapter-06)包括问题、appetite、方案、rabbit holes 和 no-gos。[设定边界章节](https://basecamp.com/shapeup/1.2-chapter-03)强调固定时间、可变范围；超过 appetite 时应寻找仍有意义的更小版本，而不是先估算一个完整方案再被动延期。

这与 Release framing 互补：

- Story Map 说明闭环中包含哪些用户步骤；
- Shape Up 说明这次为何值得做、最多投入多少、已知风险和明确不做什么；
- Delivery Spec 再把已选择 slice 的行为、约束和验证编译为交付契约。

局限与直接冲突：

- [Shape Up 明确主张把项目而非预拆任务交给团队](https://basecamp.com/shapeup/3.1-chapter-10)，认为在实现前拆尽任务会撕碎上下文，真实 scopes 应在构建中发现。这与 `pi-ticket-planning + HerdrHarness-lite` 要求预先形成小型、独立、fresh-context 可执行 Ticket 存在直接冲突。
- 可兼容的是**上游 shaping 原则**，不是原样复制其“不要预拆任务”的执行制度。AI Worker 没有稳定共享上下文，Harness 又以 Ticket 作为授权和验收边界，因此不能把一个 Shape Up project 直接当单张 Agent Ticket。
- Shape Up 原书以六周周期和有经验的产品团队为背景；其[小团队附录](https://basecamp.com/shapeup/4.1-appendix-02)明确说 2–3 人可省略六周周期、cooldown、正式 pitch 和 betting table，只保留 appetite、shape、build 的核心。这说明完整制度不适合机械移植到一人加 AI。

### 5.3 Dual Track 不是双阶段瀑布

[Jeff Patton 对 Dual Track 的原始论述](https://jpattonassociates.com/dual-track-development/)把 discovery 视为低成本学习和验证，把 development/delivery 视为可预测、高质量地交付；两者由同一团队持续参与，许多发现想法会被丢弃，发布后仍继续测量。[Marty Cagan 的后续澄清](https://www.svpg.com/dual-track-agile/)更偏好“continuous discovery and continuous delivery”这一名称，以避免被误解成两个阶段或两个孤岛。

对单人加 AI 场景，合理解释是两条**工作状态和证据标准**：未知项停留在 discovery/decision lane，已决定的 Release slice 才进入 delivery lane。它不要求同时运行两支团队，也不支持研究人员写完需求后一次性交给开发 Agent。

### 5.4 Agile 与 Lean 提供原则，不提供 Ticket 编译器

[Agile Manifesto 的原始原则](https://agilemanifesto.org/principles)强调尽早并持续交付有价值的软件、欢迎变化、以可工作的软件作为主要进展、技术卓越、简洁和定期调整。[Lean Enterprise Institute 对 Lean 的原始定义](https://www.lean.org/explore-lean/what-is-lean/)从客户问题和所需价值出发，通过识别 value stream、建立 flow、按需求 pull 和持续改进减少浪费。

两者支持下一次可验证 Release、小批量、限制 WIP 和证据反馈；但都不直接规定 Issue 模板、AC 数量、AI Reviewer 或 GitHub 状态机。用“敏捷/精益”作为取消明确结果、测试、权限边界或运行证据的理由，与其原始原则相反。

## 6. 阶段三：从 Release 行为到小型纵向 Ticket

### 6.1 行为 Spec 与实例化验收

[Cucumber 官方 BDD 说明](https://cucumber.io/docs/bdd/)把循环表述为：讨论一个小变化 → 用具体例子澄清行为 → 把例子文档化并尽可能自动化 → 实现；若讨论暴露关键未知，则回到发现而不是继续编码。[Better Gherkin](https://cucumber.io/docs/bdd/better-gherkin/)强调声明可观察行为，而不是描述按钮点击、函数调用和内部实现步骤。[Gherkin Reference](https://cucumber.io/docs/gherkin/reference/)将 `Given / When / Then` 分别用于初始情境、事件和可观察结果。

适用性：Delivery Spec 和 Ticket 可以使用这种“情境—事件—结果”的行为实例，特别是正常路径、边界和失败路径。它支持可测试性，但不要求项目引入 Cucumber 依赖；若现有测试栈已能表达这些场景，增加工具本身没有证据收益。

### 6.2 INVEST、小批量与可独立审查

[Bill Wake 的 INVEST 原文](https://xp123.com/invest-in-good-stories-and-smart-tasks/)把良好 story 作为 `Independent, Negotiable, Valuable, Estimable, Small, Testable` 的启发式，并强调 story 是 card、conversation、confirmation，不是完整需求文档。[Google 的 small change 实践](https://google.github.io/eng-practices/review/developer/small-cls.html)要求一个 self-contained change、相关测试和足够上下文，合入后代码库仍可工作；小 change 更容易正确审查和回滚，但官方不规定通用行数。

[GitHub Copilot coding agent 最佳实践](https://docs.github.com/en/copilot/tutorials/cloud-agent/get-the-best-results)要求 Issue 具有清晰问题、完整 acceptance criteria 和相关文件/位置指引，并建议把大工作拆成能由独立 PR 交付、容易审查的 sub-issues。GitHub 同时把复杂、广泛、上下文密集、深业务逻辑、高风险或模糊任务列为不适合直接委派给 coding agent 的起点。

这些来源共同支持的最小属性是：

- 一个主要、可观察的行为结果；
- 明确起始状态或问题，Bug 有可复现路径；
- in-scope / out-of-scope、不可破坏约束和真实 blocker；
- 行为型 AC，覆盖至少一个失败或回归风险；
- 实现前已知的主要验证入口、环境和预期信号；
- 有可靠的代码查找线索，但不强制预先穷举全部文件；
- 能形成一张易审、可单独合入且合入后系统仍工作的 PR。

没有这些来源支持固定的 LOC、文件数、AC 数或“交付面”上限。因此本仓库 `3–6 AC、8 条硬上限、超过 3 个独立交付面必须拆分` 应被标注为**本地 guardrail**。它可用于强制停下来复核，但不能宣称为行业标准。

### 6.3 真正的纵向切片

Story Mapping 的 walking skeleton、Google 的 self-contained change 和 DORA 的 small batch 都支持“每次交付可工作的端到端结果”。这意味着纵向 Ticket 不等于“前端票、后端票、测试票”横向排队；只有在各票自身产生可观察结果，或确有技术 prerequisite 时，依赖边才真实存在。

与 INVEST 的冲突也要保留：`Independent` 是降低协调成本的方向，不应为了让图好看而隐藏数据库迁移、基础设施、协议版本或合并顺序的真实依赖。

## 7. 阶段四：AI Agent 实现、审查与人类 Gate

### 7.1 可机器读取的验证信号

[Anthropic 的 Claude Code Best Practices](https://code.claude.com/docs/en/best-practices)要求给 Agent 测试、构建、截图或输出 fixture，并让其展示验证证据；只有任务不确定、多文件或代码陌生时才需要更完整的 Explore → Plan → Implement，小而清楚的修改不必强制生成长计划。[OpenAI Codex Prompting](https://learn.chatgpt.com/docs/prompting)对 Bug 工作流同样要求复现、约束、重跑复现、执行最小相关测试并报告命令和结果。

这支持在 Ticket 被执行前定义 Primary verification，但验证应规定结果和信号，而不是把 Worker 的每一步实现方式写死。Agent 自述完成、进程退出或提交存在都不是验收证据。

### 7.2 fresh-context Reviewer 的价值和边界

Anthropic 同一份最佳实践明确推荐 Writer/Reviewer 分离：由另一 session 或 fresh-context subagent 根据固定 diff 和要求审查，因为作者上下文会让模型偏向刚写出的实现。它同时警告，“找问题”式 prompt 往往总能产生 finding，盲目追逐会造成过度工程；阻塞 finding 应限制为需求违背、正确性、回归、安全/数据损失或未经授权的范围扩张，而非风格偏好和未来假设。

[Google Code Review](https://google.github.io/eng-practices/review/)将审查定义为作者之外的人检查设计、功能、复杂度、测试、命名和文档；其[审查标准](https://google.github.io/eng-practices/review/reviewer/standard.html)是变更确定改善整体代码健康即可，不要求完美。

适用性与局限：

- fresh context 降低同一作者自证偏差，适合当前 Herdr 的固定 Spec、base SHA、head SHA、exact diff 和验证证据输入；
- 同一模型的 Writer 和 Reviewer 仍可能共享盲点；高风险代码不能只靠第二次模型调用；
- 如果 Worker 可在同一分支修改 reviewer instructions，审查标准本身可能被污染。GitHub [Copilot Code Review 文档](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/copilot-code-review)说明 Reviewer 会读取 PR head branch 中的 instructions/skills，因此受信审查策略应来自固定 base 或 Harness，规则变更需要独立高风险审查。

### 7.3 自动检查、AI Review、人类接受和产品结果不可合并

[GitHub 对 Copilot 输出的官方要求](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/review-copilot-output)是彻底人工检查 PR；当 required approvals 开启时，任务分配者不能成为唯一有效审批者，含 Actions workflow 的变更还应先检查再授权运行，因为 workflow 可能访问 secrets。GitHub 的 [AI Code Review](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/copilot-code-review)只产生 `Comment`，不会 `Approve` 或 `Request changes`，不计入 required approval，也不会自行阻塞合并。

[METR 2026 维护者审查研究](https://metr.org/notes/2026-03-10-many-swe-bench-passing-prs-would-not-be-merged-into-main/)让 4 位活跃维护者审查 3 个 SWE-bench 仓库中的 296 个 AI PR：约一半自动 grader 通过的 PR 仍不会被维护者合并；自动 grader 通过率平均比维护者 merge decision 高 24.2 个百分点。拒绝原因包括核心行为错误、破坏其他代码和不符合仓库质量标准。

该研究的局限是只覆盖 3 个仓库、4 位维护者和一个实验 Harness；Agent 没有根据反馈迭代，评审时也没有完整真实 CI，模型最晚至 Claude Sonnet 4.5。因此它证明的是**自动验收与维护者接受存在结构性缺口**，不能声称所有当前模型恰好有 50% 假通过率。

由证据可区分四层事实：

```text
指定的确定性检查通过
  → 独立 diff/spec 审查通过
    → 维护者或风险所有者接受并合入/发布
      → 发布后的用户与业务结果成立
```

前一层是后一层的输入，不是其替代品。

### 7.4 Eval 与 Harness 自身的测量

[OpenAI Evaluation Best Practices](https://developers.openai.com/api/docs/guides/evaluation-best-practices)区分通用 benchmark 与业务自己的 task-specific eval，要求测试反映真实使用分布、从生产/历史数据持续加入案例，并以人工反馈校准自动 grader。[Anthropic 的 Agent Evals 原始工程文章](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)建议从 20–50 个真实失败、人工检查和用户问题开始；同时覆盖应发生和不应发生的行为，在干净隔离环境中运行，优先确定性 grader，并阅读 transcript 排除含糊任务或 grader 错误。

它还区分多次尝试至少成功一次的 `pass@k` 与连续可靠成功的 `pass^k`。因此 Harness 仅记录“最终成功”会被重试抬高；有证据价值的不同维度包括首次验证率、最终验证率、重试次数、review 循环、自动通过后的人类拒绝、回滚/重开/回归、lead time 和成本。它们仍是交付系统指标，不能替代 Release outcome。

[SWE-bench 原始项目](https://www.swebench.com/original.html)能比较固定仓库快照和测试环境中 Agent 生成补丁的能力；其[多语言分析](https://www.swebench.com/multilingual.html)也承认抽取机制偏向定义清楚、单测明确的小修改。它不能证明 Agent 会选择正确产品方向、PR 会被维护者接受或产品会持续成功。

## 8. 阶段五：CI、集成、部署与发布

### 8.1 DORA 当前五项指标

[DORA 当前官方指南](https://dora.dev/guides/dora-metrics/)使用五项软件交付指标：

- 吞吐：change lead time、deployment frequency、failed deployment recovery time；
- 不稳定性：change fail rate、deployment rework rate。

DORA 明确要求把它们用于观察同一应用随时间的趋势，不应用单项指标设目标、跨不同系统竞赛或把速度与稳定性割裂。它们描述交付过程，不描述留存、任务成功、用户满意或商业收益。

### 8.2 CI、Trunk-Based Development 与短分支

[DORA Continuous Integration](https://dora.dev/capabilities/continuous-integration/)要求频繁把小批量工作集成到 trunk/main、每次提交自动构建和测试、快速修复红灯，并保持构建反馈足够快。[DORA Trunk-Based Development](https://dora.dev/capabilities/trunk-based-development/)强调少量活跃分支、至少每日合并、避免长寿命分支和代码冻结。

[DORA Working in Small Batches](https://dora.dev/capabilities/working-in-small-batches/)把批次描述为独立、有价值、可测试，典型可在数小时到两天内完成，并指出超过一周通常过大；[WIP Limits](https://dora.dev/capabilities/wip-limits/)支持在完成当前工作前限制启动更多工作。这是方向性 flow 证据，不是对所有代码库都成立的 Ticket 工时 SLA；“小”也不能退化为没有用户或系统可观察结果的水平任务。

这与 Herdr 的“每 Ticket 分支”并非天然冲突：如果分支足够短、小，始终从新鲜 base 开始，并在固定 SHA 上完成 required checks 后快速合入，它仍实现了小批量频繁集成。若准入、Worker、Reviewer、CI 或人工确认形成多日队列，分支持续漂移，则与 trunk-based 原则发生实质冲突。

[GitHub Protected Branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)可要求 status checks、reviews、dismiss stale approvals、latest push approval 和禁止绕过；[required check 排障文档](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)说明检查应绑定最新提交状态。这与 Herdr 的 exact-head、no-drift 合并事实相符。

同一 GitHub 文档也暴露一个需要保留的失败模式：`skipped` 和 `neutral` 结论可能被视为成功，路径过滤还可能令整个 workflow 永久 Pending。因而 required check 的名字存在不等于真正 fail-closed；聚合 gate 必须显式检查依赖 job 的实际结果。

### 8.3 Continuous Delivery 不等于无条件自动发布

[DORA Continuous Delivery](https://dora.dev/capabilities/continuous-delivery/)定义的是软件始终可部署，能按需以低风险发布，依靠 CI、自动化测试、版本化配置、部署自动化和监控。它不要求每次 main 提交都立即公开给所有用户。

[Martin Fowler 的 Feature Toggles 原始文章](https://martinfowler.com/articles/feature-toggles.html)说明 release toggle 可分离部署和用户暴露，从而兼容 trunk 和渐进发布；同时每个 toggle 都增加条件复杂度、测试组合和潜在攻击面，短期 release toggle 应尽快退役。Feature flag 因此是需要分离“合入/部署/暴露”时的工具，不是每张 Ticket 的默认要求。

[GitHub Environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)提供 deployment reviewers、禁止自审、分支策略和 gate 后才可访问的 environment secrets，可承载生产发布的人类/风险边界。它是平台控制，不会自行判断产品 outcome。

## 9. 阶段六：安全开发与供应链证据

### 9.1 NIST SSDF

[NIST SSDF 项目页](https://csrc.nist.gov/projects/ssdf)与 [SP 800-218](https://csrc.nist.gov/pubs/sp/800/218/final)把实践分为 Prepare the Organization、Protect the Software、Produce Well-Secured Software、Respond to Vulnerabilities。SSDF 明确是结果和风险导向的共同语言，组织应按风险、成本、可行性和适用性裁剪，而不是把全文作为逐票 checklist。

截至检索日，SSDF 1.1 是最终版；[SP 800-218 Rev.1（SSDF 1.2）](https://csrc.nist.gov/pubs/sp/800/218/r1/ipd)仍是 Initial Public Draft。当前实现若声明规范基线，应写 1.1，不能把 1.2 草案表述为已发布 final。

对一人加 AI 的直接适用面包括：受信仓库/指令和最小权限、依赖与构建来源记录、安全需求/威胁驱动测试、漏洞响应和修复追踪。身份认证、权限、凭据、PII、迁移、生产基础设施或 workflow 权限变更应比普通 UI 文案具有更强的人类 gate 和验证。

局限：SSDF 不给具体产品优先级、不定义 Ticket 粒度，也不证明某次实现没有漏洞。

### 9.2 SLSA

[SLSA v1.2](https://slsa.dev/spec/v1.2/)用渐进的 source/build tracks 说明供应链完整性。[Build Track](https://slsa.dev/spec/v1.2/build-track-basics)从存在 provenance，到由受管构建服务签名，再到隔离、加固构建；[Source Track](https://slsa.dev/spec/v1.2/source-requirements)覆盖版本控制、历史/来源和更高等级的变更控制。

适用性：如果 Release 产出二进制、容器或包，可用签名 provenance 证明“这个产物由哪个 workflow、源码和 commit 构建”。GitHub [Artifact Attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations)能生成并验证这类签名声明。

局限与冲突：

- GitHub 明确说明 attestation 不是“产物安全”的保证，只是来源和构建声明；必须验证才有价值。
- [SLSA About](https://slsa.dev/spec/v1.2/about)明确不覆盖代码质量、恶意生产者或传递依赖自身是否可信。
- 更高等级成本更高。[SLSA Source Requirements](https://slsa.dev/spec/v1.2/source-requirements)对最高 source 等级所说的 trusted person 明确指 human；单人加 AI 不能仅因为有 AI Reviewer 就宣称达到可信双人审查要求。是否追求具体等级应由威胁模型和发布物决定。
- 当前 SLSA 规范是 1.2，而 GitHub attestation 页面仍以 SLSA v1.0 Build L2/L3 描述其平台能力。不能把供应商对 v1.0 的声明自动改写成“满足 SLSA v1.2 的同名等级”。
- 只有源码、无发布产物的早期实验，不应为追逐等级而建设完整 provenance 基础设施。

## 10. 阶段七：发布后证据与下一轮决策

[Google HEART 原始论文](https://research.google/pubs/measuring-the-user-experience-on-a-large-scale-user-centered-metrics-for-web-applications/)提供 Happiness、Engagement、Adoption、Retention、Task success 五类用户体验指标，并以 Goals–Signals–Metrics 把产品目标映射为可观测信号。它支持选择与本次 Release 目标直接相关的少数维度，而不是默认建立庞大仪表盘。

[GOV.UK 的服务成功测量指南](https://www.gov.uk/service-manual/measuring-success/measuring-the-success-of-your-service)要求结合性能数据与可用性研究，不能只依赖 analytics；用户旅程可观察任务完成率、完成时间并进行周期性基准比较。[Service Standard 第 10 项](https://www.gov.uk/service-manual/service-standard/point-10-define-success-publish-performance-data)要求事前定义成功，并用数据持续改进服务。

适用性：

- Release framing 时记录 baseline、期望信号、观测窗口和复盘日期；
- 发布后同时看交付健康、用户任务结果、定性反馈和意外副作用；
- 证据回流到 outcome/OST/story map，决定继续、修正、回滚、停止或探索下一机会。

局限：HEART 源于大规模 Web 产品，低流量 CLI、内部工具或早期 0→1 可能无法获得统计显著的留存/参与度。此时任务观察、访谈、人工使用记录、支持问题和明确的 learning outcome 往往比虚假的精确百分比更有信息量。指标还会被代理优化和口径漂移影响，不能脱离原始用户证据使用。

## 11. 互补、冲突与不适配矩阵

| 方法或控制 | 与当前链路的关系 | 适合吸收的证据原则 | 不应直接照搬的部分 |
| --- | --- | --- | --- |
| Continuous Discovery / OST | 补 `to-spec` 上游 | outcome、机会、多个方案、风险假设、持续证据 | 把机会树当 backlog 或 Ticket 依赖图；无用户证据也机械画树 |
| User Story Mapping | 补产品行为图和 Release slice | 用户主干、走图查缺、最小端到端闭环 | 把地图直接当精确 Spec；一次性细化整个 Roadmap |
| Shape Up | 补 Release problem/appetite/boundary | problem、appetite、rabbit holes、no-gos、可变范围 | 六周制度、正式 betting table；“项目不拆票”直接交给 fresh-context Agent |
| Dual Track | 连接持续发现与持续交付 | 未知项与已决定项使用不同证据标准并持续反馈 | 两个孤岛、阶段性交接、复制两支团队 |
| Agile / Lean / MVP | 提供反馈和学习原则 | 早交付价值、欢迎变化、简洁、validated learning | 把“敏捷”当作无 Spec、无边界；把 MVP 当低质量半成品 |
| BDD / Gherkin | 加强 Spec/Ticket 可观察性 | 情境—事件—结果、具体例子、失败路径 | 为格式而增加 Cucumber；把 UI/函数步骤写成行为 AC |
| INVEST / small PR | 加强实现票与审查 | 自包含、一个主要结果、可测试、易审、可回滚 | 虚构独立性；把本地数字阈值称作行业标准 |
| Fresh-context Reviewer | 已由 Herdr 强覆盖 | 固定 Spec/SHA/diff，独立 correctness/requirements 审查 | 把第二个模型当人类批准；要求“必须找出问题”导致过度工程 |
| DORA CI/CD / trunk | 加强集成与发布反馈 | 小批量、快速绿灯、短分支、按需低风险部署 | 用 DORA 排名 Agent/个人；把每次部署等同于全部用户发布 |
| Feature flags | 条件性补充分离部署与暴露 | 渐进放量、内部验证、快速关闭 | 每个功能都加 flag；不设退役责任 |
| SSDF | 风险覆盖层 | 组织准备、保护、生产安全软件、漏洞响应 | 每张低风险 Ticket 挂完整安全清单 |
| SLSA / attestations | 发布产物的供应链证据层 | source/build provenance、可验证产物来源 | 用 provenance 声称功能正确或安全；无威胁依据追最高等级 |
| HEART / 服务指标 | 补发布后产品结果层 | goal–signal–metric、任务成功、定量加定性 | 低流量产品伪造精确数据；用交付指标代替用户结果 |

## 12. 主要失败模式及证据边界

1. **过早编译整个产品。** 上游假设改变会使远期 Ticket 大面积失效。Story Mapping、Continuous Discovery 和 Shape Up 都支持只把当前有证据的下一 Release 细化；Roadmap 可以保留方向性结果，但不等于 ready-for-agent 队列。
2. **把研究票和实现票混用。** “决定目标用户/状态模型/方案”没有确定代码结果；若硬交给 coding agent，Agent 会用实现替代产品取舍。Discovery/decision 产物与 delivery Ticket 应使用不同完成定义。
3. **Ticket 很细但没有纵向价值。** 前端、后端、测试横向分票会产生长依赖链和不可用中间态；只有真实技术 prerequisite 或每票都能产生可观察结果时才成立。
4. **用测试通过宣称完成。** 自动测试只覆盖已表达断言；METR 的研究和 GitHub 的人类审查要求都表明它不等于可合并，更不等于产品结果。
5. **Reviewer 规则受实现分支影响。** Agent 可修改自身审查 instructions 时会破坏信任边界；规则必须来自可信固定点，规则变更本身需要升级审查。
6. **把人类 Gate 变成逐命令点击。** [Anthropic 的 Agent Containment 文章](https://www.anthropic.com/engineering/how-we-contain-claude)报告高比例权限提示会被批准，并主张以 sandbox、文件系统和网络边界限制 blast radius。人类注意力更适合放在产品范围、高风险权限、生产、合并、发布和风险豁免等语义边界。
7. **用速度指标驱动局部优化。** 只压 lead time 可能增加返工和变更失败；只压失败率可能停止发布。DORA 要求吞吐和稳定性成对观察，产品 outcome 另行衡量。
8. **安全框架堆叠造成仪式负担。** SSDF 和 SLSA 都允许风险分层；无产物、无生产数据、低风险原型与处理认证、PII、迁移、供应链发布的 Ticket 不应拥有相同控制强度。

## 13. 尚无一手证据支持或仍需本地验证的问题

- 没有一手资料证明某个固定 AC 数量、文件数、LOC 或 token 数是 Agent Ticket 的最佳上限；需用本地执行数据校准。
- 没有证据证明使用同一模型但 fresh context 的 Reviewer 足以达到独立人类审查的可靠性；错误相关性需用历史 PR 和故障案例测量。
- Continuous Discovery 的推荐节奏来自方法论实践，不保证对低流量个人产品可行；需要按用户接触渠道决定证据节奏。
- DORA、HEART、METR、SWE-bench 衡量对象不同，不能合成一个“产品完成率”总分。
- Feature flag、GitHub Environments、SLSA attestation 的成本是否合理，取决于实际部署面、用户暴露方式和威胁模型；目前不能仅凭通用实践决定。
- AI Agent 文档主要来自工具供应商的生产经验，不能当作独立因果研究或成功率承诺。
- 当前链路是否真正缩短周期并降低返工，需要建立自己的基线：首次通过率、重试/review 循环、自动通过后的人类拒绝、回滚/重开/回归，以及每个 Release 的用户 outcome。
