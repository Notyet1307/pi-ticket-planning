# Existing Issue：分诊、塑形或准入

[English](existing-issue.md) | 简体中文 · [返回 README](../../README.zh-CN.md)

## 1. 适用起点

Bug、Enhancement、外部 PR、已有 Candidate Ticket，或“把 Issue 改成 `ready-for-agent`”的请求，都使用这条路径。Issue 是输入，不是工作已经决定完整的证据。

系统会判断它是 accepted behavior 失效、新产品行为、重复或曾被拒绝的请求、已经实现的变化，还是交付候选。直接激活请求只改变期望终点，不改变 review Gate。

## 2. 你第一句话怎么说

可以直接引用仓库 Issue：

```text
/skill:ask-yet owner/repo#39
```

也可以说明想得到什么判断：

```text
/skill:ask-yet 帮我判断 Issue #39 是否已经适合交给 Agent。
```

```text
/skill:ask-yet 这个 Bug 已经能复现，帮我整理成可执行 Ticket。
```

```text
/skill:ask-yet 把这个 Issue 直接改成 ready-for-agent。
```

最后一种说法仍要经过 source 检查、fresh review、exact Admission Plan 和人工确认。

## 3. 系统首先读取什么

对于指定目标，系统读取可访问的完整 Issue body、评论、标签、关联决定，以及当前 Gate 所需的相关仓库事实，并检查：

- Bug 的当前行为能否最小复现；
- 该行为是否已经实现；
- 相近重复请求和 accepted rejection；
- accepted 产品与架构决定；
- 相关代码、测试、接口和 policy；
- 报告是否只有一个独立结果和一个主要验证。

外部 PR 也必须与 accepted behavior 和 source decision 对照；代码已经存在，不能让未获批准的行为自动变得有效。

## 4. 系统可能怎样回复

常见结果有三种。

**单 Ticket：** 当前行为、目标行为、验证、架构和风险都已经决定。

```text
triage
→ needs-triage 下的持久独立候选
→ fresh readiness review
→ exact Admission Plan
→ 人工确认
→ ready label
```

**需要继续塑形：** Issue 包含新的用户结果、多个行为，或开放的产品/架构决定。系统会返回 Candidate Frame、Release 或 Delivery Spec 边界，而不是把歧义交给 Worker。

**需要补信息：** 回复会列出已确认事实、唯一关键缺口、谁负责回答，以及补充后怎样继续。

## 5. 你需要作出的决定

对于 Bug，你确认 accepted behavior 尚未覆盖的产品解释，并决定风险或 rollout 取舍。对于 Enhancement 或外部 PR，你决定是否需要提议的用户行为；代码存在不是批准。Issue 含多个行为时，拆票前由你批准产品边界。

候选通过 review 后，你仍要确认 exact Admission Plan fingerprint。`READY` 是 review verdict，不是 mutation authority。一般的“继续”和“直接改成 ready”都不能批准尚未生成的未来快照。

## 6. 会产生哪些持久产物

read-only triage 不创建内容。获得发布批准后，独立候选或 child Ticket 以 `needs-triage` 开始，并记录 starting state、一个结果、primary verification、invariants、accepted decision sources、blockers、execution lane 和 out of scope。

Issue 需要产品塑形时，Candidate Frame、Release、accepted ADR、Delivery Spec 和 Ticket graph 保持为分离且可追溯的产物。全部检查通过后，Admission 才把已确认 Plan fingerprint 写入幂等 comment，并写受控 ready label。

## 7. 什么时候才开始拆 Ticket

单个 Bug 修复或文案修正只有一个结果、一个验证，且没有开放产品/架构决定时，应保持一张 Ticket。只有 Issue 包含可独立交付的结果、明确交接或需要分别验证的依赖时才拆分。

拆分时，系统先编译稳定 Spec scenarios，再证明每个场景都有直接覆盖，并找出最早 walking skeleton。exact child order、blockers、bodies 和 write set 会一起交给人批准。局部图或循环图不会被发布为 ready。

## 8. 什么时候交给 Harness

Admission 不能绕过。它检查 exact source 和 policy、当前 Issue body、受控标签、blocker、适用的 graph、fresh readiness verdict，以及 `AGENT` 工作真实执行的 exact-base Harness readiness projection。Issue、graph、项目配置、validation source 或 delivery gate 变化后，必须重新 review 或生成 Plan。

只有 `admit apply` 可以写 ready label。最终 ready label 加 Admission comment 才是已配置 Harness 的 handoff。下面含义彼此不同：

- `needs-triage`：候选，不可领取；
- reviewer `READY`：review 通过，仍需人工确认；
- `ready-for-agent`：Harness 可以领取；
- Harness completed：执行生命周期结束，不代表一定被接受或发布；
- merged：代码进入某个分支，不代表已经启用；
- released：行为已经启用并记录，不代表产生预期效果；
- Outcome achieved：发布后 Evidence 达到 accepted result rule。

## 9. 常见误区

- 把 Issue title 当作完整行为合同；
- 因为报告写着“Bug”就跳过复现；
- 把外部 PR 当作产品批准；
- 假设已有 Candidate Ticket 已经通过 fresh review；
- reviewer 说 `READY` 后直接加 `ready-for-agent`；
- 为了避免依赖图，把多个行为塞进一张 Ticket；
- 把 merge、release 和 Outcome 混为一谈。

## 10. 暂停与恢复

从同一仓库使用 `pi-ticket-plan -c` 或 `pi-ticket-plan -r`。恢复时，只要指定 Issue、source、policy、review revision 或受控标签能改变当前 Gate，系统就会重读；不会让旧摘要覆盖当前 Tracker 或 Git 状态。

Admission Plan 为 `PARTIAL` 时，只能在重读后用相同 Plan 和 fingerprint 恢复。结果为 `CONFLICT` 时，必须重新生成 bundle、review 和 Plan，不能强行应用旧激活。

## 11. 从输入到下一道 Gate 的完整示例

```text
输入：“状态命令应输出 `Ready` 而不是 `Ready.`；accepted behavior 和测试 seam 已在仓库中。”
系统：核对可信行为来源、当前输出、单文件范围、主要字符串断言，以及不存在开放产品/架构选择。
结果：形成 needs-triage 下的持久独立候选；不需要 Release artifact 或多 Ticket Spec。
Fresh review：检查 starting state、exact outcome、verification、invariants、risk 和 policy。
人工 Gate：确认 exact Admission Plan fingerprint。
下一道 Gate：Admission 写入 ready-for-agent；之后 Harness 才能领取 Ticket。
```

如果同一个 Issue 实际引入新用户工作流或多个未决行为，下一道 Gate 是产品或技术塑形，而不是 Admission。

维护者可在[开发和发布验证](../../README.zh-CN.md#开发和发布验证)查看三层真实模型评测套件。
