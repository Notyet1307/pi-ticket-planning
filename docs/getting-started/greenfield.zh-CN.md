# Greenfield：从模糊想法开始

[English](greenfield.md) | 简体中文 · [返回 README](../../README.zh-CN.md)

## 1. 适用起点

Greenfield 可能同时表示三件不同的事：

- **产品从 0：** 用户和最小有用结果仍不确定；
- **仓库从 0：** 工作目录可以是空目录，也可以尚未使用 Git；
- **技术实现从 0：** 还没有应用边界、技术栈或代码。

一句产品意图足以开始塑形，空目录不是 blocker。产品 Frame 阶段不会初始化 Git、选择技术栈或创建应用代码。人 Commitment 一个 exact Release 后，仓库设置才可能建立最小交付容器。应用脚手架属于获得精确授权的 execution handoff，不属于产品塑形。

## 2. 你第一句话怎么说

在空目录或已有项目目录启动 PI，然后使用下面任一表达：

```text
/skill:ask-yet 我想做一个帮助独立设计师减少交付遗漏的产品，但还没想清楚。
```

```text
/skill:ask-yet 我想做一个内部工具，让安全运营人员更快判断告警，但不知道第一版应该做什么。
```

```text
/skill:ask-yet 我有一个自动处理任务的想法，但不知道用户到底在哪一步需要它。
```

不要先选择流程模式或技术栈，用普通语言描述意图即可。

## 3. 系统首先读取什么

系统先读取这句话，以及能够改变下一个问题的最小一手上下文。在空目录中，Git、policy、README、代码和 Tracker support 都被记录为“当前不存在的事实”，而不是 blocker。目录中已有文件时，只读取相关事实；文件存在本身不会变成客户 Evidence。

系统会把已确认表达、候选解释和未知分开，不会为了找实现理由而扫描仓库。

## 4. 系统可能怎样回复

典型的首次交互很短：

> **用户：** 我想帮助小团队减少交付遗漏，但还没想清楚产品。
>
> **系统：** 这可能是 A）交付前完整性检查，B）团队交接防漏，或 C）更早的过程预警。我推荐先看 A，因为它是最窄且可逆的闭环，暂时不做协作和预测。A、B、C，还是你想修正一个方向？
>
> **用户：** 选 A，先做交付前检查。
>
> **系统：** 我会把 A 当作候选调查方向，不当作客户 Evidence 或交付批准。最近一次相似交付中，漏了什么，随后出现了什么可观察后果？

这段示例只说明 `DECISION` 再到 `DIALOGUE` 的交互形态，不是固定输出模板。真实措辞可以不同，并始终以机器 Checkpoint 收尾。

## 5. 你需要作出的决定

你负责选择或修正候选方向，并提供仓库里不可能存在的近期真实事件。Candidate selection 只决定调查什么，不是客户事实、Commitment 或实现授权。

探索性访谈可发现 actor、trigger、顺序流程、失败、后果和完成信号；验证性 Evidence 用回答前已经冻结的判断规则检验一个假设。Commitment 前，系统会用普通语言确认：

- actor、近期 trigger、当前流程、现有替代和重要失败有 Evidence；
- 最小用户闭环能从触发走到结果；
- 成功信号、guardrail、观察窗口和最低 Evidence 可观察；
- 最高风险已经验证，或被限制在接受的 appetite 内；
- non-goals 和主要风险边界清楚。

只有运行时的六项 readiness 全部通过，人才能选择 `COMMITTED`、`HOLD`、`REWORK` 或 `DROP`。系统可以推荐，但不能替人选择。

## 6. 会产生哪些持久产物

候选尚未选定时，对话不会创建产品文件。之后 Candidate Frame 可以保存选定方向、最小闭环、排除项、最高风险假设和下一道决定，同时仍保持 candidate 身份。经批准的正式 Evidence 只能增加脱敏结果；原始访谈回答和身份信息留在 Git 外。

Commitment 绑定 exact Release revision。这个 exact blob 必须进入 accepted remote delivery base，才能编译交付内容；draft ref 或本地工作树不够。

## 7. 什么时候才开始拆 Ticket

不会从模糊想法直接拆 Ticket。Commitment 后才按下面顺序推进：

```text
accepted Release
→ 缺少交付基线且获得授权时 setup-delivery-repository
→ Solution Shaping / accepted ADR
→ Repository Contract Impact Review
→ Delivery Spec
→ Candidate Tickets 和依赖图
```

仓库设置只创建交付容器。Solution Shaping 关闭第一版承重决定，不创建实现代码。Delivery Spec 定义可验证场景；拆票覆盖这些场景，并识别从 trigger 到 result 的最小 walking skeleton。

## 8. 什么时候进入执行

Candidate Tickets 从始至终保持 `needs-triage`。一个 fresh-context reviewer 会检查所有 Ticket，以及场景覆盖、交接、walking skeleton、依赖顺序、source revision 和 policy。推荐路径随后编译一个 Controller Release Plan v2，等待人确认 exact Handoff fingerprint。

确认后的 apply 会原子物化三个私有 Controller 输入文件，记录 `EXECUTION/HANDOFF_READY`，并只打印、不运行 Controller `start --expected-config-digest <approved-digest>` 命令。它不写 ready label。只有 operator 显式选择时才使用 Legacy Herdr 按 Ticket 标签路径。

## 9. 常见误区

- 第一项产品结果尚未明确就选择完整技术栈；
- 一开始设计完整平台或长期 backlog；
- 因为用户说“AI”就先做模型 benchmark；
- 把内部 canary 或技术可行性结果当作客户价值 Evidence；
- 让第一张 Ticket 同时创建整个系统；
- accepted ADR 之前让 Worker 自行选择承重架构。

最小有用默认值是：一个产品闭环、一个最高风险假设、一个下一步 Evidence action。

## 10. 暂停与恢复

从同一目录使用 `pi-ticket-plan -c` 或 `pi-ticket-plan -r`。PI 内用 `/session` 查看当前 session，用 `/resume` 选择历史 session。

暂停的访谈会回到第一个缺失问题。新 session 不能从模型记忆或摘要重建未持久化的参与者回答，因此应恢复原 session。owner 也可以提供脱敏 return block 并明确确认事实准确；它能恢复对话，但只有满足 formal contract 的 approved result 才能关闭正式 Evidence。

## 11. 从输入到下一道 Gate 的完整示例

```text
输入：“帮助小团队减少交付遗漏。”
系统：形成交付前检查 / 交接防漏 / 过程预警候选，并推荐最窄的一个。
人：选择交付前检查。
系统：形成 Candidate Frame，只问一个近期真实遗漏及其后果。
Evidence：探索可能修正流程；之后的验证只检验一个冻结的最高风险假设。
人工 Gate：readiness 全部通过后，owner 决定是否 Commitment exact Release。
下一道 Gate：Commitment 后建立获批交付基线，并在 Delivery Spec 前关闭最小技术边界。
```

这个示例不表示候选已经有价值，也不表示 Frame 阶段创建了仓库或应用，更不表示任务已经进入 Harness。

维护者可在[开发和发布验证](../../README.zh-CN.md#开发和发布验证)查看三层真实模型评测套件。
