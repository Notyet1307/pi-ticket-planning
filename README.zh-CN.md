# PI Ticket Planning

[English](README.md) | 简体中文

这是一个只通过专用 PI Profile 启用的 package。它以 `/skill:ask-yet` 作为产品到结果的统一入口，再把已承诺 Release 编译成实现票、执行独立 admission，并且只激活能够被严格前沿 Harness 安全领取的任务图。

它固定 Matt Pocock 稳定技能集，由本 package 用 `ask-yet` 替换上游 Router，并覆盖 spec、拆票、triage 和 admission 流程。上游更新必须手动处理。

## 从 GitHub 安装

环境要求：

- Node.js 22.16 或更高版本；
- `pi`、`git` 和 `gh` 已加入 `PATH`；
- PI 已具有可用的登录和模型配置；
- 操作真实 GitHub Issues 前已完成 GitHub 登录。

克隆指定 Release tag，然后运行安装器：

```sh
git clone --branch v0.2.0 --depth 1 \
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

PI 的显式 skill 命令格式是 `/skill:<name>`。Skill 文档中的 `/to-spec` 等写法表示工作流跳转；人在输入框中应使用 `/skill:to-spec`。

## 工作流

所有产品、功能、Issue 和续接场景都从同一个入口开始：

```text
/skill:ask-yet [可选：想法、Issue、Release 文档或当前目标]
```

`ask-yet` 会从仓库和权威产物恢复当前状态，一次只给出一个产品问题、证据动作或可复制的下一条命令。空目录或尚无 commit 的仓库会继续停留在产品塑形；只有人明确提交 exact Release revision 后，`/skill:setup-matt-pocock-skills` 才能建立最小 Git/Tracker 交付基线，并且不会选择应用技术栈或创建实现脚手架。

完整路径：

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
  -> 人工确认
  -> 子票进入 ready-for-agent / ready-for-human
  -> 最后激活 Delivery Parent
  -> Harness 领取
```

Wayfinder Map 只包含决策、研究、原型和人工输入，不进入实现队列。`READY | SPLIT | NEEDS_INFO` 判断票是否可以执行；`AGENT | HUMAN` 决定执行 lane。

已有 Issue 和直接激活请求也先交给统一入口：

```text
/skill:ask-yet owner/repo#39
```

它会根据真实阶段返回 `/skill:triage` 或 `/skill:admit-ticket` 的精确命令。任何生成或 triage 路径都不能直接添加 ready 标签。Admission 会复核场景覆盖、每个状态/产物交接、walking skeleton、严格前沿和全新上下文 readiness，再请求人工确认；source、matrix、候选 Ticket 或任务图发生修改后，必须重新 Admission 才能交给 Harness。

## 严格前沿安全

Delivery Parent 的 `## Ticket coverage` 只保存一份规范化 Delivery Graph JSON 快照。用下面的命令检查其来源身份、Scenario 交接、覆盖、walking skeleton 和内部顺序：

```sh
npm run check:delivery-graph -- --input /path/to/parent-or-snapshot
```

对于每一条内部 `blocker -> dependent` 边，blocker 还必须位于 Delivery Parent 原生子票列表中更靠前的位置。Admission 会在 review 前和 activation 前分别运行快照检查和只读 GitHub 顺序检查。

从 checkout 手动运行：

```sh
npm run check:frontier -- \
  --repo owner/repo \
  --parent 90
```

出现 `FAIL` 或 GitHub 读取错误时，任务图继续保持 `needs-triage`。

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

安装完成后，再验证真实 Profile：

```sh
npm run verify
```

Profile 烟测的预期结果是 `profile isolation: ok (27 skills)`。

升级必须显式选择 Release：

```sh
git fetch --tags
git checkout v0.2.0
./install.sh
```

不要直接跟随 Matt 上游。发布 package 新版本时，必须有意更新固定提交、重新核对四个 override 和被隐藏的上游 Router、更新 `upstream-lock.json`，并通过完整验证。

## 安全和来源

PI packages 和 skills 能够以当前用户权限触发命令。安装前应审查 Release，并固定到 tag 或 commit。必须保留 `LICENSE` 和 `NOTICE`；兼容 override 来源于 `upstream-lock.json` 所记录提交上的 `mattpocock/skills`。
