# Agent Boss — 产品需求文档 (PRD v0.4)

> 版本：v0.4
> 日期：2026-04-29
> 状态：活跃草案
> 作者：刘幼峰 + Codex
> 核心变化：从多 Agent 编排器转向 AI 监工台

---

## 一、核心动机

### 1.1 真实痛点

我已经拥有一堆 AI 劳动力和模型资产：

- 多个智能体：Codex、Claude Code、OpenClaw、Hermes 等
- 多个模型或模型入口：不同 provider、不同上下文能力、不同价格和速度
- 多个 coding plan / token / 订阅额度
- 多个 UI 和运行环境：终端、网页、IDE、内部平台、飞书等

但这些资产没有被集中管理，也没有形成可复用的经验：

1. **资产分散**：我买了很多 token、plan、模型和工具，但不知道什么时候该用谁、还剩多少、花得值不值。
2. **派发成本高**：每次有一个 query，我还要决定发给谁、打开哪个 UI、复制上下文、等待结果。
3. **结果不沉淀**：每次任务完成后，没有统一记录谁做得好、为什么好、成本多少、下次该不该继续用。
4. **下层 Agent 喜欢打断我**：很多任务卡住，不是因为没法做，而是 agent 把琐碎确认丢回给我。
5. **协作不像管理**：现有多 agent 系统往往是固定流程，不像人类管理者会追问进度、驳回低质量输出、调整分工、持续改进。

### 1.2 一句话定义

**Agent Boss 是管理 AI 劳动力和模型资产的任务监工台。**

用户像老板一样提出目标；Agent Boss 像管理者一样负责过程：组织资源、派发任务、追问进度、拦截琐事、验收结果、汇报风险，并把每次经验沉淀下来。

### 1.3 产品立场

Agent Boss 不是一个更热闹的多 Agent 聊天室，也不是简单的 `ask all`。

它要解决的问题是：

> 我提出目标以后，谁来替我管理这些 AI 劳动力，把任务持续推到完成？

### 1.4 默认交互原则

一般情况下，Owner 不关心工具、流程和子 agent 的细节。

Owner 默认只做两件事：

1. 给目标。
2. 看进度。

Boss 默认只向 Owner 汇报：

- 当前做到哪了
- 有没有阻塞
- 有没有风险
- 下一步是什么
- 是否需要 Owner 介入

子 agent 的日志、runner、模型、命令、stdout/stderr、过程争论都默认折叠。Owner 明确要求“审计”时才展开。

---

## 二、产品定义

### 2.1 老板只提目标，Boss 管过程

用户不应该被迫思考：

- 这个任务该给 Claude 还是 Codex？
- 该用哪个模型、哪个 plan、哪个 UI？
- 下层 agent 问“要不要加测试”时怎么回复？
- 卡住半小时以后要不要催？
- 两个结果哪个更值得沉淀？

这些应该由 Agent Boss 处理。用户只在资源、权限、破坏性操作或战略目标变化时介入。

### 2.2 核心对象从 Query 升级为 Mission

`ask` 是一次提问；`Mission` 是一个需要被管理到结束的目标。

一个 Mission 至少包含：

| 字段 | 含义 |
|------|------|
| 目标 | 用户真正要完成的事情 |
| 当前阶段 | 理解、计划、执行、验证、汇报、复盘 |
| 执行资源 | 使用了哪些 agent、模型、plan、工具 |
| 状态 | 进行中、阻塞、待资源、待验收、完成、失败 |
| 风险 | 质量风险、进度风险、资源风险、权限风险 |
| 下一步 | Boss 准备如何继续推进 |
| 结果 | 最终交付物、过程评价、可沉淀经验 |

`ask/query` 保留为轻量快捷入口，但不再是产品核心。

### 2.3 管理循环

Agent Boss 的基本循环不是固定流水线，而是动态管理：

```text
理解目标 -> 组织资源 -> 派发任务 -> 追问进度 -> 挑错验收 -> 汇报结果 -> 复盘沉淀
```

Boss 可以根据任务状态调整策略：

- 下层 agent 跑偏：驳回并要求重做
- 下层 agent 卡住：追问原因、补充上下文、改派其他 agent
- 输出质量不足：要求 reviewer 或 tester 补充验证
- 资源不足：向用户升级
- 成本过高：换更便宜的模型或降级策略

---

## 三、核心概念

### 3.1 Owner

Owner 是用户，是老板。

Owner 负责：

- 提目标
- 设定偏好和边界
- 提供必要资源和权限
- 在关键节点验收

Owner 不负责：

- 替下层 agent 做琐碎产品/工程判断
- 反复复制上下文
- 追问每个 agent 的进度
- 手动整理每次任务经验

### 3.2 Boss

Boss 是 Agent Boss 的管理层。

Boss 负责：

- 维护 AI 资产台账
- 判断任务该用哪些资源
- 派发和监督下层 agent
- 拦截琐碎确认
- 定期或按需汇报
- 更新结果评估和组织记忆

Boss 对 Owner 不应该表现成一堆工具按钮。Boss 自己需要的基础能力很少：

- 独立 workspace
- 文件系统读写
- bash / shell 执行
- 必要时观察浏览器
- 必要时调用本机 worker agent

这些是 Boss 的手脚，不是 Owner 的日常操作面板。产品设计不能把内部工具复杂度转嫁给 Owner。

### 3.3 Worker Agent

Worker Agent 是被管理的 AI 劳动力，例如 Codex、Claude Code、OpenClaw、Hermes。

Worker Agent 不是按钮，而是可被评估的员工：

- 有擅长场景
- 有使用成本
- 有历史表现
- 有可用状态
- 有失败模式

### 3.4 Model / Plan

Model / Plan 是 Agent 可用的脑力和额度资源。

同一个 Agent 可能支持多个模型或 plan；同一个模型也可能通过不同入口使用。Agent Boss 需要记录：

- 模型名称和 provider
- 上下文能力、速度、质量倾向
- token 或 coding plan 额度
- 费用、限制、可用窗口
- 适合什么任务，不适合什么任务

### 3.5 Asset Ledger

Asset Ledger 是 AI 资产台账。

P0 阶段采用手动登记，不直接对接真实账单。至少记录：

| 资产 | 示例 |
|------|------|
| Agent | codex、claude-code、openclaw、hermes |
| Model | gpt-5、claude、gemini、deepseek、本地模型 |
| Plan | coding plan、API token、内部额度 |
| 成本偏好 | 便宜优先、质量优先、速度优先、稳妥优先 |
| 适用场景 | 写代码、review、查资料、自动化、飞书、内部系统 |
| 历史表现 | 任务数、成功率、质量评分、常见失败原因 |

### 3.6 Supervisor Policy

Supervisor Policy 定义 Boss 什么时候可以自主推进，什么时候必须问 Owner。

默认原则：

- **默认代决策**：Boss 处理下层 agent 的琐碎确认，不把噪音推给 Owner。
- **默认追进度**：Boss 对卡住、低质量、跑偏的任务保持焦虑，并主动推进。
- **默认只汇报结果和风险**：执行细节可展开，但不默认打扰 Owner。

必须升级给 Owner 的情况：

1. **钱**：新增付费、购买额度、明显超预算、消耗高价值 plan。
2. **权限**：登录账号、授权访问、需要用户提供密钥或私有系统权限。
3. **破坏性操作**：删除、覆盖、外发消息、合并代码、发布上线等不可轻易回滚的动作。

### 3.7 Report

Report 是老板视角的汇报，不是 agent 聊天记录。

一次汇报应该回答：

- 目标是什么
- 已完成多少
- 当前卡在哪里
- 风险是什么
- 用了哪些 agent/model/plan
- 下一步怎么推进
- 需要 Owner 做什么，如果没有就明确说“不需要你介入”

---

## 四、核心需求

### 需求 1：AI 资产集中管理

**用户故事**：我买了很多模型 token、coding plan 和 agent 服务，希望有一个地方统一登记、查看和规划使用。

**验收标准**：

- `assets list` 能看到已登记的 agent、model、plan、用途、状态。
- `assets add` 能手动登记一个 agent/model/plan。
- 每次 Mission 记录实际使用了哪些资产。
- 后续可以按成本、质量、速度、任务类型做分析。

### 需求 2：Mission 创建与任务监工

**用户故事**：我只输入目标，比如“帮我重构登录模块”，Boss 应该创建 Mission，判断怎么推进，而不是马上问我一堆实现细节。

**验收标准**：

- `mission create "帮我重构登录模块"` 创建可追踪任务。
- Boss 生成初始计划、阶段、风险和下一步。
- Boss 自主选择合适 agent/model/plan 的候选组合。
- Mission 有明确状态：进行中、阻塞、待资源、待验收、完成、失败。

### 需求 3：终端状态板

**用户故事**：我想像老板看项目进度一样，看当前每个 Mission 到哪了、有没有风险、要不要我介入。

**验收标准**：

- `mission status` 展示所有 Mission 的目标、阶段、完成度、风险、资源消耗、下一步。
- `mission status <id>` 展示单个 Mission 的详细状态。
- 默认展示结果和风险，下层 agent 日志默认折叠。
- 用户随时问“现在做到哪了？”，Boss 能给出简明汇报。

### 需求 4：琐碎确认拦截

**用户故事**：下层 agent 经常问“要不要加测试”“要不要处理这个边界”“选 A 还是 B”。这些问题不应该打断我，Boss 应该根据默认偏好和任务目标自己决定。

**验收标准**：

- 下层 agent 请求确认时，Boss 先判断是否属于钱、权限、破坏性操作。
- 如果不是，Boss 自主回复并继续推进。
- Boss 记录自己做过的关键代决策，便于事后复盘。
- 用户可以在 Mission 结束后评价这些代决策是否符合偏好。

### 需求 5：进度追问与质量验收

**用户故事**：很多任务卡在一半，是因为 agent 停下来等我，或者给了半成品。Boss 应该像管理者一样持续追问和验收。

**验收标准**：

- Boss 能识别 agent 长时间无进展、输出不完整、偏离目标、缺少验证。
- Boss 可以追问 agent 当前阻塞和下一步。
- Boss 可以要求补充测试、补充说明、重做、找另一个 agent review。
- Boss 在汇报中标注质量判断和剩余风险。

### 需求 6：结果评估与沉淀

**用户故事**：任务完成后，我希望知道这次谁做得好、用了多少资源、下次类似任务应该怎么派。

**验收标准**：

- `judge <missionId>` 能评价结果质量、代决策、成本是否值得。
- 系统更新 agent/model/plan 在场景下的表现。
- Mission 结束后生成复盘：做法、结果、成本、质量、经验、下次建议。
- 历史记录可用于后续智能选择。

---

## 五、P0 MVP

P0 的目标不是做一个完整 Agent 公司，而是先让个人老板视角成立。

| # | 功能 | 说明 |
|---|------|------|
| 1 | Boss Direct Line | 交互式终端，Owner 用自然语言给目标、问进度、要汇报 |
| 2 | Mission 创建 | 用户输入目标，Boss 创建可追踪任务 |
| 3 | Mission Progress | 默认只展示目标、进度、阻塞、风险、下一步 |
| 4 | Supervisor Policy | 默认代决策，只在钱/权限/破坏性操作上升级 |
| 5 | 基础执行能力 | Boss 有自己的 workspace、文件系统、bash，必要时看浏览器 |
| 6 | 审计与沉淀 | 细节默认折叠，Owner 要审计时展开事件流和资产使用 |

P0 明确不做：

- Web Dashboard
- 真实账单自动对接
- 多 Boss 递归组织
- 复杂工作流 DSL
- 面向 Owner 的复杂工具面板
- 完整企业权限系统

---

## 六、P1 / P2 路线

### P1：更聪明的个人 Boss

- 智能选择 agent/model/plan
- 按成本、质量、速度做排行
- 学习 Owner 偏好：稳妥优先、速度优先、低成本优先、少打扰优先
- 定期生成 AI 资产使用报告
- 对长期低质量或高成本 agent 发出调整建议

### P2：Agent 公司雏形

- Personal Boss 管理个人 AI 资产和任务
- Department Boss 管理多个 Personal Boss
- CEO Boss 管理多个 Department Boss
- 支持跨 Boss 委派、上报、合并结果和组织记忆
- 形成真正的 agent 公司：目标自上而下，结果逐层上报

---

## 七、CLI 设计（老板视角）

主入口不是命令面板，而是 Boss 单线终端：

```bash
> agent-boss boss

owner> 帮我重构登录模块
Boss: 我已接单：m-001
目标：重构登录模块
当前进度：0% / planning
下一步：我会组织执行资源并开始推进。

owner> 现在进展如何
Boss:
目标：重构登录模块
状态：推进中，进度 35%
风险：medium，不需要你介入
最近进展：实现草案完成，正在补测试。
阻塞：无
下一步：继续验证认证边界。

owner> 审计 m-001
Boss: 展开底层事件流、子 agent 输出摘要、命令、资源使用和代决策。
```

底层命令保留给调试、脚本和审计，不是 Owner 的默认使用方式：

```bash
# === 资产台账 ===
> assets list
agent        model/plan        status   scenes              note
codex        coding-plan       ready    code, refactor      fast implementation
claude-code  pro-plan          ready    review, design      strong reasoning
openclaw     local gateway     ready    automation, feishu  tool execution

> assets add agent codex --plan coding-plan --scenes code,refactor --cost monthly

# === 创建 Mission ===
> mission create "帮我重构登录模块，要求安全、可测试、不要大改架构"
Mission m-001 created
Boss plan:
- Goal: 重构登录模块
- Strategy: implementation + review + verification
- Candidate resources: codex, claude-code
- Owner intervention: not needed

# === 状态板 ===
> mission status
id      stage       progress   risk       current       next
m-001   executing   45%        medium     codex         review auth edge cases
m-002   waiting     10%        resource   openclaw      need login permission

> mission status m-001
Goal: 重构登录模块，要求安全、可测试、不要大改架构
Stage: executing
Progress: 45%
Current: codex implementing service refactor
Risk: medium - auth edge cases not verified
Resources: codex/coding-plan, claude-code/pro-plan
Next: ask claude-code to review security and tests
Owner needed: no

# === 随时汇报 ===
> mission report m-001
当前不需要你介入。
已完成：登录流程梳理、主要重构草案。
正在做：实现代码并补测试。
风险：权限边界和异常路径需要 review。
下一步：让 claude-code 做安全 review，再让 codex 修复。

# === 评估沉淀 ===
> judge m-001 A "安全边界处理好，测试补得完整，成本可以接受"
Profile updated:
- codex: refactor implementation +1
- claude-code: security review +1
- preference: quality over brevity for auth-related tasks
```

`ask` 可以继续存在，但定位为快捷命令：

```bash
> ask "解释这段报错"
```

复杂目标应进入 Mission。

---

## 八、验收场景

### 场景 1：用户只提目标

用户输入：

```bash
mission create "帮我重构登录模块"
```

期望：

- Boss 创建 Mission。
- Boss 选择 agent/model/plan 候选。
- Boss 不先问“要不要加测试”“用什么风格”“先改哪一层”。
- Boss 给出计划和当前下一步。

### 场景 2：下层 agent 提琐碎确认

下层 agent 问：

```text
Should I add tests for this refactor?
```

期望：

- Boss 判断这不是钱、权限、破坏性操作。
- Boss 根据默认质量标准要求加测试。
- 用户不被打扰。
- Mission 复盘中记录这次代决策。

### 场景 3：资源问题升级

下层 agent 需要登录、购买额度、访问私有系统或删除文件。

期望：

- Boss 暂停相关动作。
- Boss 向用户汇报为什么需要介入、可选方案、风险。
- 在用户授权前不继续执行高风险动作。

### 场景 4：用户随时问进度

用户问：

```bash
mission report m-001
```

期望：

- Boss 汇报目标、完成度、阻塞、风险、资源消耗和下一步。
- 如果不需要用户介入，明确说不需要。
- 不默认展示下层 agent 的长对话。

### 场景 5：任务结束复盘

Mission 完成后：

- Boss 给出最终结果和质量判断。
- Boss 列出使用的 agent/model/plan。
- Boss 记录耗时、成本、风险处理和代决策。
- 用户 judge 后，系统更新后续推荐依据。

---

## 九、成功指标

| 指标 | 目标 |
|------|------|
| UI 切换次数 | 从多个 agent UI 手动切换下降到主要使用 Agent Boss |
| 无效确认次数 | 琐碎确认由 Boss 拦截，用户只处理资源/权限/破坏性问题 |
| Mission 完成率 | 任务不再因 agent 等待用户琐事确认而卡住 |
| 汇报可用性 | 用户随时询问进度时，Boss 能给出老板视角摘要 |
| 资产沉淀 | 每次 Mission 记录 agent/model/plan 使用和质量评价 |
| 推荐准确性 | 历史数据积累后，Boss 能更准确选择资源 |

---

## 十、长期愿景

Agent Boss 最终可以拓展成真正的 Agent 公司。

短期：

- 管理个人 AI 资产
- 管理个人 Mission
- 形成任务、资产、质量、成本的闭环

中期：

- 多个 Boss 之间委派任务
- 每个 Boss 有自己的资产台账和偏好
- 任务逐层上报，结果逐层验收

长期：

- CEO Boss 提目标
- Department Boss 拆解并组织资源
- Personal Boss 管理具体 agent 和模型
- 组织记忆沉淀为公司级 AI 劳动力管理系统

核心不变：

> Owner 提目标，Boss 管过程，Worker Agent 做执行，系统沉淀判断力。

---

*本 PRD 专注产品定义和 MVP 边界，不涉及具体技术实现。技术方案需基于 v0.4 重新对齐。*
