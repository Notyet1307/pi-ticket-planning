# Brownfield：给既有项目增加能力

[English](brownfield-feature.md) | 简体中文 · [返回 README](../../README.zh-CN.md)

## 1. 适用起点

仓库和产品已经存在，但新能力可能对应多种产品结果时，使用这条路径。系统先读取当前边界，再询问无法从仓库发现的内容；仓库事实和客户 Evidence 始终是两件事。

一个范围窄、决定完整的修正可能直接形成独立 Ticket。行为已知但涉及多个交付面时，可能需要简化 Release、Delivery Spec 和 Ticket 图。用户、流程或价值仍不确定时，先形成 Candidate Frame 和 Evidence。路径深度由系统推断，不要求你选择。

## 2. 你第一句话怎么说

从仓库根目录启动，直接描述尚未关闭的歧义：

```text
/skill:ask-yet 我想给现有系统增加批量导入，但还没想清楚是批量创建、历史迁移还是持续同步。
```

```text
/skill:ask-yet 我想给告警详情增加 AI 分析，但不知道真实用户任务是什么。
```

```text
/skill:ask-yet 我想新增审批状态，但不确定页面、接口和数据边界应该怎样调整。
```

不必把需求翻译成内部 stage；只说明想改变什么、还有什么不清楚。

## 3. 系统首先读取什么

系统会读取最小相关集合：

- README 和 repository policy；
- 相关入口和相近行为；
- 测试与配置；
- 领域术语和 accepted ADR；
- 相近 Issue；
- 当前接口、状态和数据所有权。

能发现的技术事实不会反问用户。仓库中的角色或 UI persona 不能证明真实客户任务。代码可以确认已有单条创建和字段校验；它不能证明管理员需要批量创建，也不能证明重复录入是重要问题。

## 4. 系统可能怎样回复

对于批量导入，交互可能是：

> **系统：** 仓库确认已有单条创建和必填字段校验，但没有批量任务的客户 Evidence。这个需求可能是 A）批量创建新记录，B）一次性迁移旧记录，或 C）持续同步记录。我推荐 A，因为它是对 accepted path 最窄的扩展，暂不承担迁移清理和长期集成。哪个更接近？
>
> **用户：** A，批量创建。
>
> **系统：** 我会把现有校验路径保留为技术事实，把真实批量任务当作待验证假设。最近一次事件中，谁录入了多条记录、什么触发了它、返工出现在哪里？

这只是交互示例，不是 golden response。仓库事实不同时，系统可以推荐另一个候选。

## 5. 你需要作出的决定

你负责选择产品解释，提供真实工作流事实，并决定优先级、appetite、风险接受和 Commitment。系统根据 Evidence 选择最短路径：

- 可信且决定完整的单一行为，已有一个结果和验证，可形成单 Ticket；
- 行为已确定但需要多张 Ticket，形成有界 Release 和 Spec；
- actor、流程、结果或价值仍不确定，停留在 Candidate Frame 和 Evidence；
- 安全、隐私、凭据、迁移或生产风险会叠加控制，但不会强迫无关的客户发现。

对于“AI 分析”，边界必须保持清楚：

```text
AI 是 solution hypothesis。
AI 不是 target outcome。
AI 不是 primary signal。
```

系统先找：谁在作判断、什么触发、当前缺什么信息、哪种错误最重要。通常应先明确真实用户闭环。只有一个固定技术约束可能让整个候选无法在 appetite 内成立时，才能先做有界 Technical Spike；其他情况下，应等模型能力成为能改变决定的技术 unknown。

## 6. 会产生哪些持久产物

read-only 定向不会创建文件。选中但未经证明的方向可以成为 Candidate Frame；正式 Evidence 可增加经批准的脱敏结果；Commitment 绑定并记录 exact `COMMITTED` Release revision，其 exact blob 仍必须进入 accepted remote delivery base；新的承重技术选择随后进入 accepted ADR。Delivery Spec 和 Candidate Ticket 图必须追溯到这些 accepted sources。

Candidate Tickets 保持 `needs-triage`。仓库事实、客户 Evidence、产品决定、ADR、Spec、Tickets、Admission 和执行状态各自保留独立事实所有者。

## 7. 什么时候才开始拆 Ticket

只有产品行为和必要技术边界关闭后才开始拆票。新公开接口、数据所有权、跨 Ticket Schema、安全边界、恢复规则或主要验证 seam 尚未决定时，需要 Solution Shaping。

accepted code、ADR、接口、ownership 和测试已经覆盖 committed behavior 时，直接复用并跳过新塑形。性能或集成事实未知时，先做一个有界 Spike，而不是猜测架构。Solution Shaping 不创建应用代码，也不创建 Ticket。

Delivery Spec 随后定义稳定场景；拆票必须先证明场景覆盖和 walking skeleton，再把 exact 拆分与依赖图交给人批准。

## 8. 什么时候进入执行

创建或 review Issue 不会启动执行。推荐路径会重读不可变的 accepted Parent 与 receipt、effective policy、exact Ticket body、当前一个 `delivery-release-graph:v3`、blocker、coverage、walking skeleton 和依赖顺序。fresh reviewer 返回 `READY`、`SPLIT` 或 `NEEDS_INFO`；只有无 external blocker、规模有界且全 AGENT 的 v3 Release 才会编译成一个 exact Controller Release Plan v2。Roadmap、HUMAN work、未来 candidate 与 v2 artifact 都不进入 Controller input。

一次人工批准绑定 Handoff fingerprint。Apply 只写三个私有输入文件并打印、不运行绑定 approved config digest、Controller revision 与 provenance digest 的 Controller `start` 命令；Ticket 保持 `needs-triage`。Legacy Herdr ready-label 激活是显式兼容选择。Controller 完成、merge、Release Record 和 Outcome 是后续不同事实。

## 9. 常见误区

- 让用户重复代码或测试中已经能找到的事实；
- 把 UI 里的管理员角色当作管理员需要该能力的证据；
- 把现有技术能力当作产品价值证据；
- 未区分创建、迁移和同步，就把“批量导入”做成单一设计；
- 未确定告警判断任务和重要错误，就开始模型 benchmark；
- accepted interface 已经关闭决定，仍新建 ADR；
- 让不同 Ticket 分别选择不兼容的 Schema 或 ownership。

## 10. 暂停与恢复

在同一仓库使用 `pi-ticket-plan -c` 或 `pi-ticket-plan -r`。只问状态时，系统显示已确认事实和唯一开放决定，不推进。活动访谈会回到第一个缺口；应优先恢复原 session。owner-confirmed 脱敏 return block 可以恢复对话，但只有满足既有 formal contract 时才能关闭正式 Evidence。

暂停期间 Git、Issue、ADR 或 policy 发生变化时，系统只重读能改变下一道 Gate 的事实。

## 11. 从输入到下一道 Gate 的完整示例

```text
输入：“增加批量导入，但创建、迁移和同步仍混在一起。”
仓库事实：已有单条创建和校验；没有客户事件证明存在批量问题。
系统：形成三个候选，推荐有界批量创建，并说明暂缓的代价。
人：选择批量创建。
系统：形成最小 create-many 闭环，把真实重复录入任务列为最高风险假设。
Evidence：一个有界方法检验该任务；代码存在不计作客户 Evidence。
人工 Gate：readiness 通过后，owner Commitment exact Release。
下一道 Gate：能复用 accepted interface 就直接复用；否则接受最小 ADR，再编译 Delivery Spec。
```

产品行为和承重技术决定未被接受前，不会把该能力拆成 Ticket。

维护者可在[开发和发布验证](../../README.zh-CN.md#开发和发布验证)查看三层真实模型评测套件。
