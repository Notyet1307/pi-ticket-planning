# PI Ticket Planning

[English](README.md) | 简体中文

这是一个只通过专用 PI Profile 启用的 package。它以 `/skill:ask-yet` 作为产品到结果的统一入口，再把已承诺 Release 编译成实现票、执行独立 admission，并且只激活能够被严格前沿 Harness 安全领取的任务图。

它固定 Matt Pocock 稳定技能集，屏蔽上游 Router 和仓库初始化 Skill，改用本 package 的 `ask-yet` 与 `setup-delivery-repository`，并由本 package 控制 spec、拆票、triage 和 Admission 流程。上游更新必须手动处理。

## 从 GitHub 安装

环境要求：

- Node.js 22.16 或更高版本；
- `pi`、`git` 和 `gh` 已加入 `PATH`；
- PI 已具有可用的登录和模型配置；
- 操作真实 GitHub Issues 前已完成 GitHub 登录。

克隆指定 Release tag，然后运行安装器：

```sh
git clone --branch v0.3.1 --depth 1 \
  https://github.com/Notyet1307/pi-ticket-planning.git
cd pi-ticket-planning
./install.sh
```

安装器会：

1. 在 `$HOME/.pi/ticket-planning` 创建专用 Profile；
2. 使用当前 checkout 的真实路径生成 package settings；
3. 将 Matt 上游和 `pi-subagents` 固定到记录的版本；
4. 将 `$HOME/.local/bin/pi-ticket-plan` 安装为指向当前 checkout 的符号链接；
5. 如果默认 Profile 已有 `auth.json` 和 `models.json`，则通过符号链接共享；
6. 同步 packages，并验证隔离后的命令目录和 reviewer 合同。

安装器会保留不属于受管 package、skill 和 scout 路由字段的既有 Profile 偏好。替换发生变化的受管文件前，会在原文件旁保留备份。凭证、sessions、trust 决策、缓存和运行时状态都不应进入此仓库。

可以指定自定义安装位置：

```sh
PI_TICKET_PLAN_PROFILE_DIR=/absolute/profile \
PI_TICKET_PLAN_BIN_DIR=/absolute/bin \
./install.sh
```

请确保所选 bin 目录已加入 `PATH`。使用非默认 Profile 目录时，后续启动 `pi-ticket-plan` 的 shell 也必须导出相同的 `PI_TICKET_PLAN_PROFILE_DIR`。

## 诊断安装和项目就绪度

在准备规划的目标项目中运行只读 doctor：

```sh
cd /absolute/path/to/project
pi-ticket-plan doctor
```

它会检查 Node.js、PI、专用 Profile 和 Reviewer、固定的上游 Skill commit、GitHub 登录、package 相对 release/main 的版本，以及当前 GitHub 目标仓库的默认分支、交付策略、标签、Issue API 和合并规则。输出开头会分别显示 `Planning`、`Admission` 和 `Release` 就绪度，因此缺少一个 GitHub 标签不会被误解为“产品塑形也不可用”。默认只有 Planning 被阻断时才以状态码 1 退出；激活前使用 `pi-ticket-plan doctor --require admission`，严格全量预检使用 `--require all`。每个可以安全修复的 `FAIL` 都会给出 `FIX`。仓库还没有 Issue 时，只读 Sub-issue 和 Dependency 探针显示 `SKIP`，不会误报为“不支持”。在本 package checkout 中运行时只检查安装和版本，并跳过目标仓库检查。

## Profile 边界

启动器会在 PI 启动前选择 Profile：

```sh
export PI_CODING_AGENT_DIR="${PI_TICKET_PLAN_PROFILE_DIR:-$HOME/.pi/ticket-planning}"
exec pi "$@"
```

普通 `pi` 不会发生变化，也不会加载此 package。已经运行的普通 PI 会话不能原地切换 Profile；需要先退出，再启动 `pi-ticket-plan`。

在 PI 中确认当前 Profile：

```text
!!printf '%s\n' "$PI_CODING_AGENT_DIR"
```

默认结果为 `$HOME/.pi/ticket-planning`。

## 在项目中启动

PI 会按工作目录划分 session，因此必须从项目根目录启动：

```sh
cd /absolute/path/to/project
pi-ticket-plan --name "project-planning"
```

人通常只需调用 `/skill:ask-yet`。`setup-delivery-repository`、triage、spec、ticket 和 Admission 都是由模型自动调用的 helper；各自的 `/skill:<name>` 只保留给恢复和调试。

## 工作流

所有产品、功能、Issue 和续接场景都从同一个入口开始：

```text
/skill:ask-yet [可选：想法、Issue、Release 文档或当前目标]
```

`ask-yet` 会从仓库和权威产物恢复当前状态，并在人的持续授权范围内自动推进可逆的规划工作。只有遇到产品选择、仓库策略变更、Ticket 图批准、Admission 激活、禁止操作或重大漂移时才停下。已有 Git 的目标中，只有 exact Release blob 已进入被接受的远端基线时才算权威；工作树文件或未发布的本地 commit 不能进入 `to-spec`。空目录或尚无 commit 的仓库会继续停留在产品塑形；只有人明确提交 exact Release revision 后，`setup-delivery-repository` 才能建立最小 Git/Tracker 交付基线，并且不会选择应用技术栈或创建实现脚手架。

`ask-yet` 会分别推断规划深度和风险控制，不要求人选择：

| 档位 | 适用情况 | 最短正式路径 |
|---|---|---|
| `QUICK` | 一个可信来源可以形成一张决策完整的独立 Ticket | Source → 单 Ticket → 全新上下文 Readiness → Admission |
| `STANDARD` | 用户与目标行为已有事实，但仍需 Spec 或多张 Ticket | Release-lite → Spec → Tickets → Admission |
| `DISCOVERY` | 新产品、新角色、新核心流程、价值或行为仍不确定 | Frame → Evidence → Commit → Spec → Tickets |
| `CONTROLLED` | 任一规划深度同时涉及安全、隐私、合规、破坏性迁移、高风险生产切换、启用/回滚机制、不可逆副作用或较大影响范围 | 对应最短规划路径 + 适用控制、审批、Admission 和发布门禁 |

规划深度取决于决策不确定性和交付形态；`CONTROLLED` 是风险覆盖层，普通可逆部署本身不会触发它。一行生产凭据配置修改可以是 `QUICK + CONTROLLED`：不做客户发现，也不强制创建多票 Spec，但仍保留权限、验证、恢复、审批、smoke、审计和发布门禁。用户只会看到“受控路径”，内部两个维度保持隐藏。流程说明只在五字段人类状态卡中出现一次，内部 lane、stage 和 verdict 只保留在最后一行机器 footer：

```text
当前目标：修正现有 status 文案。
已经确认：这是一个边界清楚的局部修改，将使用快速路径。
仍然缺少：一张持久化独立 Ticket 和全新上下文 readiness 复核。
为什么现在不能继续：Admission 尚未确认激活。
你只需要决定：确认激活；随后系统会自动把 Ticket 交给 Harness。

Checkpoint: TRIAGE/ADMISSION · GH-42@review-1 · ACTIVATION_AWAITING_CONFIRMATION
```

完整 `DISCOVERY` 路径：

```text
ask-yet
  -> Frame：一个用户、触发、目标结果和最小闭环
  -> Evidence：一个最高风险假设和有界证据动作
  -> 人工 Commitment
  -> 没有 Git 基线时执行 greenfield delivery bootstrap
  -> repository contract 影响检查
  -> to-spec：创建带稳定 Scenario ID 和显式交接状态的 needs-triage Delivery Spec
  -> to-tickets：生成场景覆盖矩阵、walking skeleton、子票和 blocker graph
  -> 在 Delivery Parent 中持久化 coverage snapshot
  -> 严格前沿顺序检查
  -> 全新上下文 ticket-readiness reviewer
  -> 生成确定性 Admission Plan 和 fingerprint
  -> 人工确认这个 exact fingerprint
  -> 幂等执行 admit apply
  -> 子票进入 ready-for-agent / ready-for-human
  -> 最后激活 Delivery Parent
  -> Harness 领取
  -> Harness 负责执行和审查
  -> 所有预期子票终态后由规划侧收尾
  -> 真实启用目标受众，并记录 Release Record、smoke 和 rollback 证据
  -> 到 evidence window 后复核 Outcome
```

`ask-yet` 不是常驻监控进程。需要恢复时再次调用即可：Admission 以 tracker 为准，执行以 Harness ledger 为准，接受的源码以 Git/PR 为准，发布以 Release Record 和真实启用为准，Outcome 以证据窗口后的信号为准。只有 Harness 可以常驻。`HANDOFF_READY`、`IN_PROGRESS`、`DELIVERED`、merged、released 和 outcome achieved 始终是不同状态。

Wayfinder Map 只包含决策、研究、原型和人工输入，不进入实现队列。`READY | SPLIT | NEEDS_INFO` 判断票是否可以执行；`AGENT | HUMAN` 决定执行 lane。

已有 Issue 和直接激活请求也先交给统一入口：

```text
/skill:ask-yet owner/repo#39
```

`ask-yet` 会在真实阶段需要时自行加载 triage 或 Admission。任何生成或 triage 路径都不能直接添加 ready 标签。Admission 会复核场景覆盖、每个状态/产物交接、walking skeleton、严格前沿和全新上下文 readiness，再请求人工确认。持久 stage、verdict、转换条件和事实权威来自 `contracts/workflow.json` 与 `contracts/authority.json`；自然语言只能提议状态，不能让非法转换生效。source、matrix、候选 Ticket 或任务图发生修改后，必须重新 Admission 才能交给 Harness。

## 严格前沿安全

Delivery Parent 的 `## Ticket coverage` 只保存一份规范化 Delivery Graph v2 JSON 快照，并用 SHA-256 绑定 accepted Spec 内容和每张子票的 exact body。用下面的命令检查其来源身份、Scenario 交接、覆盖、walking skeleton 和内部顺序：

```sh
npm run check:delivery-graph -- --input /path/to/parent-or-snapshot
```

更强的 Admission-state 检查接收一次重新读取的 bundle，并比对快照、Parent Spec、当前子票正文、原生子票顺序和 blocker graph：

```sh
npm run check:admission-state -- --input /path/to/admission-bundle.json
```

对于每一条内部 `blocker -> dependent` 边，blocker 还必须位于 Delivery Parent 原生子票列表中更靠前的位置。Admission 会在 review 前和 activation 前分别运行快照检查和只读 GitHub 顺序检查。

从 checkout 手动运行：

```sh
npm run check:frontier -- \
  --repo owner/repo \
  --parent 90
```

出现 `FAIL` 或 GitHub 读取错误时，任务图继续保持 `needs-triage`。

GitHub Delivery Map 通过启动器生成并执行 exact Admission Plan：

```sh
pi-ticket-plan admit plan \
  --repo owner/repo --parent 90 \
  --review /tmp/review.json --context /tmp/context.json \
  --out /tmp/admission-plan.json

pi-ticket-plan admit apply \
  --plan /tmp/admission-plan.json \
  --expected-fingerprint sha256:<已确认的-plan-hash> \
  --context /tmp/fresh-context.json
```

QUICK 独立 Ticket 使用同一个事务，只把 `--parent` 换成 `--issue`：

```sh
pi-ticket-plan admit plan \
  --repo owner/repo --issue 42 \
  --review /tmp/review.json --context /tmp/context.json \
  --out /tmp/admission-plan.json
```

`plan` 完全只读。`apply` 只接受获批快照，把 Plan fingerprint 写入幂等 Admission comment，通过逐项标签操作保留无关标签，并在响应不确定时重新读取、向前补齐。时间戳只用于触发重读；真正阻断的是 title、open state、body、blockers、source、policy、受控标签，以及适用的 graph/Harness 事实。Delivery Parent 只有在最终重新读取所有子票后才会激活。只有 `COMPLETE` 表示成功；`PARTIAL` 可用同一 Plan 恢复，`CONFLICT` 必须重新 review；检测到 Harness claim 后绝不会自动撤销 ready 标签。

## 继续会话

回到相同项目目录，并继续使用同一个启动器：

```sh
pi-ticket-plan -c
pi-ticket-plan -r
```

在 PI 中，`/session` 查看当前 session，`/new` 新建，`/resume` 选择历史 session，`/quit` 退出。

## 验证和升级

只验证仓库内容时，不需要预先安装 PI Profile：

```sh
npm run verify:ci
```

其中冻结输出和 live case 定义由统一的确定性检查器验证：

```sh
npm run check:behavior-fixtures
```

安装完成后，再验证真实 Profile：

```sh
npm run verify
```

Profile 烟测的预期结果是 `profile isolation: ok (27 skills)`。

发布 package 前，从干净 checkout 运行静态检查、Profile 烟测和全部真实模型场景：

```sh
npm run verify:release -- --report /tmp/pi-ticket-plan-release-eval.json
```

Release Gate 会在产生模型费用前拒绝脏 checkout。固定的 14-case 清单会从当前 checkout 加载 `ask-yet`、`to-spec`、`to-tickets`、`ticket-readiness` 和 `admit-ticket`，每次都使用独立的 `--no-session` 进程和只读工具，由模型外的确定性程序校验机器 Checkpoint，并核对临时工作区没有变化。报告区分 `PASS`、`SEMANTIC_FAIL` 和 `INFRA_FAIL`，记录每个 case 与整体成功率。失败 case 自动重跑一次；每个 case 至少成功一次才放行，重跑恢复的 case 会标记为 `FLAKY`。

单个失败可用 `npm run eval:pi -- --case <id>` 重跑。需要观察稳定性时可重复运行并保存报告：

```sh
npm run eval:pi:nightly -- --report /tmp/pi-ticket-plan-live-eval.json
```

这个需要认证的三次重复评测只记录成功率，不直接形成发布结论，因此仍不进入普通 PR CI。当前仓库没有专用 Actions runner 或评测 secret，所以定时调度明确留给有认证边界的外部 runner；仓库工作流不会借用维护者个人 OAuth。无 Skill 基线和较弱模型矩阵在形成稳定评分合同前也只作为观察项。

升级必须显式选择 Release：

```sh
git fetch --tags
git checkout v0.3.1
./install.sh
```

不要直接跟随 Matt 上游。发布 package 新版本时，必须有意更新固定提交，重新核对三个同名 override、改名后的 `setup-delivery-repository` 适配以及两个被屏蔽的上游 Skill，更新 `upstream-lock.json`，并通过完整验证。

## 安全和来源

PI packages 和 skills 能够以当前用户权限触发命令。安装前应审查 Release，并固定到 tag 或 commit。必须保留 `LICENSE` 和 `NOTICE`；兼容 override 来源于 `upstream-lock.json` 所记录提交上的 `mattpocock/skills`。
