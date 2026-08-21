# PI Ticket Planning

[English](README.md) | 简体中文

PI Ticket Planning 把一句模糊产品想法、既有项目的新能力需求或一个 Issue，逐步整理成决定完整且执行 lane 明确的 Ticket：`AGENT` 工作可由 AI 独立执行和验证，不可委托的工作仍保留为 `HUMAN`。它适合希望系统主动核对仓库事实、保留证据和决定、准备交付任务，同时不把人的关键决定偷渡给 Agent 的产品和工程负责人。

输入可以只是一句自然语言或一个 Issue 引用；持久输出是经过准入的独立 Ticket，或与已接受产品目标、技术决定和验证方式相连的 Ticket 图。不能一开始就让 Agent 开发，因为未关闭的产品、架构、依赖和风险取舍会被悄悄埋进实现。

> 系统会推荐，并自动完成可逆的规划工作；真实客户事实、Commitment、风险取舍、Ticket 图批准和 Admission 激活仍由人负责。没有经过相应 Gate 和批准，它不会创建实现任务，也不会写 GitHub ready label。

## 你可以从三种起点开始

| 你的起点 | 第一条输入 | 系统先做什么 |
| --- | --- | --- |
| [只有一个模糊想法](docs/getting-started/greenfield.zh-CN.md) | “我想做一个帮助小团队减少交付遗漏的产品，但还没想清楚。” | 形成不同候选方向，推荐一个，然后只问一个真实事件问题。 |
| [给既有项目增加能力](docs/getting-started/brownfield-feature.zh-CN.md) | “我想增加批量导入，但不知道是批量创建、迁移还是同步。” | 读取最小相关仓库事实，再形成候选，不把代码事实冒充客户 Evidence。 |
| [已有 Issue 或 Bug](docs/getting-started/existing-issue.zh-CN.md) | `/skill:ask-yet owner/repo#39` | 读取可访问的 Issue 和相关代码事实，判断一个 Ticket 是否足够，还是需要继续塑形。 |

你不需要选择流程模式；系统会根据事实推断最短且安全的路径。

[五分钟开始](#五分钟开始) · [系统与人的分工](#系统会做什么你仍需决定什么) · [高级机制](#高级机制) · [开发和发布验证](#开发和发布验证)

## 五分钟开始

### 安装

环境要求：

- Node.js 22.16 或更高版本；
- `pi`、`git` 和 `gh` 已加入 `PATH`；
- PI 已具有可用的登录和模型配置；
- 操作真实 GitHub Issues 前已完成 GitHub 登录。

本 README 跟踪 `main` 上的当前开发行为。请只选择一个安装通道；需要可重现的最新稳定版时使用 `v0.4.0`。

#### 当前开发版（`main`）

```sh
git clone --branch main --depth 1 \
  https://github.com/Notyet1307/pi-ticket-planning.git
cd pi-ticket-planning
./install.sh
```

#### 最新稳定版（`v0.4.0`）

```sh
git clone --branch v0.4.0 --depth 1 \
  https://github.com/Notyet1307/pi-ticket-planning.git
cd pi-ticket-planning
./install.sh
```

### 检查

从准备规划的目标项目运行只读 doctor：

```sh
cd /absolute/path/to/project
pi-ticket-plan doctor
```

摘要分别检查 `Planning`、`Admission` 和 `Release` 就绪度。产品塑形可用，不代表 GitHub Admission 已经就绪；例如缺少 ready label 不会阻止前期产品对话。默认只有 Planning 被阻断时才以非零状态退出；激活前使用 `pi-ticket-plan doctor --require admission`，严格全量预检使用 `pi-ticket-plan doctor --require all`。检查结果使用 `PASS`、`FAIL`、`FIX` 或 `SKIP`。

### 启动

PI 会按工作目录划分 session，因此从项目根目录启动：

```sh
cd /absolute/path/to/project
pi-ticket-plan --name "project-planning"
```

然后把目标、Issue 或当前问题交给唯一的常规人工入口：

```text
/skill:ask-yet <你的自然语言目标、Issue 或当前问题>
```

空目录也是合法的 Greenfield 起点：

```sh
mkdir my-product
cd my-product
pi-ticket-plan --name "my-product-planning"
```

```text
/skill:ask-yet 我想做一个帮助小团队减少交付遗漏的产品，但还没想清楚。
```

此时系统不会初始化 Git、选择技术栈或创建应用代码。它会先收敛本轮最小产品结果，并为最可能推翻它的假设选择有效验证方式。

## 系统会做什么，你仍需决定什么

| 系统承担 | 人必须提供或决定 |
| --- | --- |
| 读取当前 Gate 所需、可访问的最小仓库、Issue、Git、Tracker 和 accepted ADR 事实。 | 权威来源里不存在的真实客户事件和事实。 |
| 区分事实、假设、决定和未知，形成候选并推荐一个。 | 产品方向、优先级、appetite，以及是否接受推荐。 |
| 选择一个有界的 Evidence 方法，形成 Candidate Frame。 | 同意、访问权限、隐私边界，以及只能由真实参与者或环境给出的结果。 |
| Commitment 后检查必要技术决定，编译 Delivery Spec。 | Commitment、承重架构取舍、数据所有权、共享接口和风险接受。 |
| 生成场景覆盖、walking skeleton、候选 Ticket 和依赖图。 | 批准 exact Ticket 图。 |
| 执行 fresh-context readiness review，准备 exact Admission Plan。 | 确认 exact Admission fingerprint 并激活。 |
| 从已持久化权威状态恢复到第一道未关闭 Gate。 | 生产启用、回滚决定和最终 Outcome 判断。 |

系统会推荐，但不会把不可委托的人类取舍伪装成自动化结论。

## 一次完整流程实际上是什么

```text
一句想法或一个 Issue
→ 找到最小可验证目标
→ 验证最可能推翻它的未知
→ 人确认值得进入交付
→ 关闭必要技术决定
→ 编译为可验证场景和 Ticket
→ 独立复核
→ 人确认交给执行 Harness
→ 执行、发布并观察真实结果
```

可信事实已经关闭某道 Gate 时，系统会缩短路径。决定完整的局部修正可以形成单 Ticket；产品方向仍不确定的想法不可以。

| 人类语言 | 内部术语 |
| --- | --- |
| 本轮最小可验证目标 | **Release** |
| 确认值得进入交付 | **Commitment** |
| 关闭承重技术决定 | **Solution Shaping / ADR** |
| 描述可验证行为 | **Delivery Spec** |
| 定义任务及依赖 | **Delivery Graph** |
| 交给 Agent 前的最终复核 | **Admission** |
| 记录真实启用和健康状态 | **Release Record** |
| 判断发布后的实际结果 | **Outcome** |

这些术语描述 Gate 和持久产物；用户开始前不需要先学会它们。

## 它不会做什么

- 伪造客户 Evidence，或因为代码存在就认为产品有价值；
- 因为用户说“用 AI”，就在用户流程尚未明确时启动模型 Spike；
- 在 Commitment 前选择完整技术栈或创建应用脚手架；
- 一次规划完整长期 backlog，或让第一张 Ticket 同时创建整个系统；
- 让未通过 Admission 的 Ticket 进入 Harness；
- 没有相应范围和批准就写 GitHub；
- 把 merged、released 和 Outcome achieved 当成同一事实；
- 把 `ask-yet` 当作 daemon 常驻，或持续轮询 Harness。

## 什么时候会产生文件或 GitHub 变更

对话、持久产物和激活是三件事：

1. 用户尚未选择候选时，不创建产品文件。
2. read-only 请求不会写入任何内容。
3. Candidate 文件或获批 draft ref 可以在 Frame 和 Evidence 期间保存进展，但不是 accepted delivery source。
4. 正式 Evidence 只保存经批准的脱敏结果；原始回答留在仓库外。
5. exact accepted Release 和必要的 accepted ADR 必须进入已接受的代码基线，Delivery Spec 才能成为权威产物。
6. Candidate Ticket 先处于 `needs-triage`。
7. Admission 激活前会展示 exact 文件或 Issue、revision、ref、fingerprint 和不变项；一般的“继续”不等于批准这次 exact mutation。
8. 只有确认后的 Admission 才写入 `ready-for-agent` 或 `ready-for-human`。

当前行为由 [`contracts/`](contracts/)、[`scripts/`](scripts/) 以及对应的 [`skills/`](skills/) 或 reference 负责；[`fixtures/`](fixtures/) 和 `test/` 只是回归证据，不是合同。README 和指南只负责解释。

## 如何暂停、恢复和查看状态

回到同一目录并继续使用专用 Profile：

```sh
pi-ticket-plan -c
pi-ticket-plan -r
```

在 PI 中，`/session` 查看当前 session，`/new` 新建，`/resume` 选择历史 session，`/quit` 退出。

- “继续”会从当前活动问题继续。
- 明确问“现在到哪了、还缺什么”会显示完整状态卡，但不推进。
- 访谈暂停后恢复会回到首个缺口。
- 新 session 无法从模型记忆或助手摘要恢复未持久化的参与者回答；优先恢复原 session。
- 经批准、已脱敏的正式 Evidence 可以从权威仓库产物恢复。另一条合法路径是 owner 提供脱敏 return block 并明确确认其事实准确；它可以恢复对话，但只有满足既有 formal contract 时才能关闭正式 Evidence Gate。

## 高级机制

### 专用 PI Profile 与固定 Release

安装器在 `$HOME/.pi/ticket-planning` 创建专用 Profile，使用 checkout 的真实路径生成 settings，固定所记录的 Matt Pocock Skill commit 和 `pi-subagents`，并把 `$HOME/.local/bin/pi-ticket-plan` 安装为指向当前 checkout 的符号链接。默认 Profile 已有 `auth.json` 和 `models.json` 时会通过符号链接共享。替换受管文件前会备份；凭证、sessions、trust 决策、缓存和运行时状态不进入本仓库。

启动器在 PI 启动前选择 Profile：

```sh
export PI_CODING_AGENT_DIR="${PI_TICKET_PLAN_PROFILE_DIR:-$HOME/.pi/ticket-planning}"
exec pi "$@"
```

普通 `pi` 不会变化。已经运行的普通 PI 会话不能原地切换 Profile。在 PI 中可这样确认：

```text
!!printf '%s\n' "$PI_CODING_AGENT_DIR"
```

可以指定自定义安装位置：

```sh
PI_TICKET_PLAN_PROFILE_DIR=/absolute/profile \
PI_TICKET_PLAN_BIN_DIR=/absolute/bin \
./install.sh
```

后续启动器必须使用同一个 `PI_TICKET_PLAN_PROFILE_DIR`。人通常只调用 `ask-yet`；`setup-delivery-repository`、triage、spec、ticket、readiness 和 Admission Skills 都是模型调用的 helper。直接调用 helper 只用于高级恢复或调试。

### 自动流程深度与权威事实

内部会由 `ask-yet` 推断 `QUICK`、`STANDARD` 或 `DISCOVERY` 规划深度；安全、隐私、凭据、破坏性迁移、生产切换、不可逆影响或广泛爆炸半径存在时，再叠加 `CONTROLLED` 风险 Gate。这些是内部实现细节，不是要求用户作出的选择。

不同事实有不同权威来源：产品 Evidence 和决定来自 accepted product artifact；source identity 和 accepted baseline 来自 Git；Ticket 状态来自 Tracker；执行状态来自 Harness ledger；真实启用来自 Release Record；观察窗口后的结果来自 Outcome Evidence。对话和摘要只是线索，不是权威事实。

已有 Git 的目标中，一条经人批准的远端 draft ref 可以在 Candidate Frame 和 Evidence revision 间保存 exact candidate blob，但不能进入 Delivery Spec。Commitment 后，exact Release blob 必须进入 accepted remote base。Greenfield 只有在 exact Commitment 和所需授权后才允许建立仓库；它只创建最小交付容器，不选择应用技术栈，也不创建实现脚手架。

### Solution Shaping、Spec 与 Ticket 图

exact committed Release 进入 accepted base 后，Solution Shaping 只关闭第一版实现边界所需的决定。已有 accepted ADR 和接口应直接复用；只有公共接口、数据所有权、跨 Ticket Schema、安全边界或主要验证 seam 等承重决定仍未关闭时，才需要新 ADR。有界 Technical Spike 只能确定技术事实，不能决定产品价值，也不能自动接受 ADR。

Delivery Spec 用稳定 Scenario ID 和明确交接描述行为。拆票会覆盖这些场景、识别 walking skeleton、记录依赖，并先生成 `needs-triage` Candidate Issues。Wayfinder map 保存决定、研究、原型和人工输入，不进入实现队列。

### Strict frontier 与 Admission

不同 Tracker 的能力边界并不相同：

| Tracker | 支持边界 |
| --- | --- |
| GitHub | 规划、图与就绪复核、事务化 Admission `plan`/`apply`、ready label 激活，以及已配置的 HerdrHarness 交接。 |
| GitLab | 仅规划和规划级/就绪复核；没有 package-backed 事务化 `admit apply`，也不能激活 HerdrHarness。 |
| Local Markdown | 仅规划和复核；没有事务化 ready 激活，也不能激活 HerdrHarness。 |

Delivery Parent 在 `## Ticket coverage` 下保存一份规范化 Delivery Graph v2 snapshot，用 SHA-256 绑定 accepted Spec 和 exact child body。检查 snapshot：

```sh
npm run check:delivery-graph -- --input /path/to/parent-or-snapshot
```

更强的 Admission-state 检查会把它与 Parent Spec、当前 child body、原生顺序和 blocker graph 比对：

```sh
npm run check:admission-state -- --input /path/to/admission-bundle.json
```

GitHub 图通过启动器准备和应用 exact Admission transaction：

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

独立 Ticket 使用 `--issue 42` 替换 `--parent 90`。`plan` 完全只读；`apply` 只接受已确认快照，保留无关标签，记录幂等 Admission comment，并在激活 Parent 前重读全部子票。`COMPLETE` 表示成功，`PARTIAL` 用同一 Plan 恢复，`CONFLICT` 必须重新 review。ready label 加 Admission record 才是 Harness handoff；Admission 不会独立探测已部署 Harness。

Harness claim、执行、review、merge、真实启用、健康和 Outcome 是不同事实。`ask-yet` 只在被调用时运行，并从权威来源恢复下一道 Gate；只有 Harness 可以常驻。

## 开发和发布验证

只验证仓库内容时，不需要预先安装 PI Profile：

```sh
npm run check:docs
npm run verify:ci
```

安装后再验证真实 Profile：

```sh
npm run verify
```

Profile 烟测的预期结果是 `profile isolation: ok (27 skills)`。

运行一个 fresh-process live case：

```sh
npm run eval:pi -- --case <id>
```

单轮 case 验证冻结起点。多轮 case 复用同一个真实 PI session；多轮失败必须从第一轮整案重跑，不能从失败轮续跑。版本控制中的 [`pi-eval-suites.json`](fixtures/pi-eval-suites.json) 决定当前动态 case 数和三层 suite：

- **Release** 是只读且阻断发布的门禁，只包含成本有界、稳定且承重的代表 case，不允许 Observer 注入或模型写入；
- **Nightly** 重复运行更长或波动更大的只读 case，可以使用显式 Observer 输入；它报告失败，但不替普通 package 发布作决定；
- **Isolated Writable** 只包含有明确 allowlist 的 writeback canary，只能显式运行在 runner 的一次性 workspace 和本地 bare origin 中，Release 与 Nightly 都不会间接执行它。

不进入这三层可执行 suite 的 case 会显式列在 `quarantine`，只能用 `--case` 手工诊断，直到覆盖价值和稳定性足以晋级。

三层 suite 都使用真实模型；`npm run verify:ci` 是不产生模型费用的确定性检查。

发布 package 前，可以在干净且已认证的 checkout 中运行：

```sh
npm run verify:release -- --report /tmp/pi-ticket-plan-release-eval.json
```

`verify:release` 要求干净 checkout，并运行 Manifest 定义的 Release suite。报告包含 suite 名、动态 case 数、名义 model turn 数和 case-set hash。结果分为 `PASS`、`SEMANTIC_FAIL` 和 `INFRA_FAIL`；允许的重试恢复后标记为 `FLAKY`。需要观察方差但不形成发布决定时运行：

```sh
npm run eval:pi:nightly -- --report /tmp/pi-ticket-plan-live-eval.json
```

只有确实要验证隔离写入时，才显式运行 allowlisted writable canary：

```sh
npm run eval:pi -- --suite isolated-writable --report /tmp/pi-ticket-plan-writable-eval.json
```

更新时保持原安装通道。

当前开发版：

```sh
git checkout main
git pull --ff-only
./install.sh
```

最新稳定版：

```sh
git fetch --tags
git checkout v0.4.0
./install.sh
```

不要直接跟随 Matt 上游。固定来源、package overrides、被屏蔽 Skills 或 release manifest 的变化必须经过有意审查和本仓库的发布验证。

## 安全和来源

PI packages 和 Skills 能以当前用户权限触发命令。安装前应审查 Release，并固定 tag 或 commit。必须保留 `LICENSE` 和 `NOTICE`；兼容 override 来源于 [`upstream-lock.json`](upstream-lock.json) 所记录提交上的 `mattpocock/skills`。
