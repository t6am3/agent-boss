# Agent Boss — 技术方案 (TECH-SPEC v0.4)

> 版本：v0.4
> 日期：2026-04-29
> 状态：活跃草案
> 作者：刘幼峰 + Codex
> 基于：PRD v0.4

---

## 一、目标与边界

### 1.1 v0.1 工程目标

先实现本地 CLI 版 AI 监工台，让用户可以：

1. 登记 AI 资产：agent、model、plan、tool。
2. 创建 Mission，而不是只发一次 query。
3. 查看 Mission 状态板和随时汇报。
4. 记录下层 agent 的进展、阻塞、确认请求和 Boss 代决策。
5. 对 Mission 做 judge，沉淀资产表现和用户偏好。

### 1.2 非目标

v0.1 不做：

- Web Dashboard
- 真实 token / plan 余额自动对接
- 多 Boss 递归组织
- 自动接管所有 Agent UI
- 复杂 workflow DSL
- 企业权限系统

### 1.3 重写原则

历史 `src/` 代码基于 PRD v0.3，核心抽象是 `ask/query/task/router/judge`。这套抽象已经偏离 PRD v0.4 的 Mission 监工台方向，不再作为实现依据。

v0.4 实现采用直接重写策略，当前状态如下：

- 旧 `src/` 已归档为 `archive/src-v0.3-task-router/`。
- v0.3 计划文档已归档为 `archive/plans-v0.3/`。
- 新 `src/` 已从 Mission、Asset、Supervisor、Reporter 开始实现。
- 不做向后兼容，不保留 legacy query 主线，不把任何 v0.3 模块作为架构约束。
- 旧代码只通过 git history 保留历史价值；实现时不得以复用旧模块为目标。
- 如果某段旧 adapter 代码确实有价值，必须在新架构完成后按新接口重新移植，而不是原样接入。

---

## 二、总体架构

```text
CLI
├── demo
├── interactive / tui
├── assets add/update/list/show
├── mission create/list/status/watch/log/update/run/report/event/decide/complete
└── judge

Core
├── AssetLedger            # AI 资产台账
├── MissionStore           # Mission + event log + persistence
├── Supervisor             # 代决策与升级规则
├── MissionRunner          # Mission 执行循环接口
├── Reporter               # 老板视角状态板和汇报
└── EvaluationEngine       # 评分与表现沉淀

Adapters
├── MockMissionRunner      # P0.5 本地执行闭环验证
├── OpenClawRunner         # 通过 OpenClaw CLI agent turn 执行
├── CodexAdapter
├── ClaudeCodeAdapter
├── OpenClawAdapter
└── Future adapters

Storage
└── SQLite                 # v0.1 默认本地单文件
```

核心原则：

- **Mission 是主对象**：所有资产使用、事件、决策、评价都围绕 Mission 记录。
- **Event log 是血管**：状态、汇报、复盘都从 MissionEvent 汇总生成。
- **Supervisor 先规则化**：先用明确规则决定是否打扰用户，不引入不稳定智能判断。
- **Reporter 面向老板**：默认展示结果、风险和下一步，折叠下层 agent 噪音。

---

## 三、核心数据模型

### 3.1 Asset

```typescript
type AssetType = 'agent' | 'model' | 'plan' | 'tool';
type AssetStatus = 'ready' | 'limited' | 'offline' | 'unknown';
type CostMode = 'free' | 'subscription' | 'usage' | 'internal' | 'unknown';

interface Asset {
  id: string;
  type: AssetType;
  name: string;
  provider?: string;
  plan?: string;
  scenes: string[];
  costMode: CostMode;
  status: AssetStatus;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

说明：

- `agent` 表示 Codex、Claude Code、OpenClaw 等可执行劳动力。
- `model` 表示 GPT、Claude、Gemini、DeepSeek、本地模型等脑力资源。
- `plan` 表示 coding plan、API token、订阅额度、内部额度等资源池。
- `tool` 表示浏览器、飞书、代码库、数据库等可用工具。

### 3.2 Mission

```typescript
type MissionStage =
  | 'intake'
  | 'planning'
  | 'executing'
  | 'reviewing'
  | 'reporting'
  | 'completed';

type MissionStatus =
  | 'active'
  | 'blocked'
  | 'waiting_resource'
  | 'waiting_owner'
  | 'completed'
  | 'failed'
  | 'cancelled';

type RiskLevel = 'low' | 'medium' | 'high';

interface Mission {
  id: string;
  goal: string;
  stage: MissionStage;
  status: MissionStatus;
  progress: number; // 0-100
  risk: RiskLevel;
  ownerNeeded: boolean;
  currentAssignee?: string;
  nextAction?: string;
  summary?: string;
  assetIds: string[];
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}
```

### 3.3 MissionEvent

```typescript
type MissionEventType =
  | 'created'
  | 'planned'
  | 'assigned'
  | 'progress'
  | 'blocked'
  | 'confirmation_requested'
  | 'decision'
  | 'resource_escalation'
  | 'report'
  | 'completed'
  | 'failed'
  | 'judged';

interface MissionEvent {
  id: string;
  missionId: string;
  type: MissionEventType;
  actor: string; // owner | boss | codex | claude-code | system
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}
```

### 3.4 SupervisorDecision

```typescript
type DecisionCategory = 'normal' | 'money' | 'permission' | 'destructive';

interface SupervisorDecision {
  id: string;
  missionId: string;
  question: string;
  decision: string;
  reason: string;
  category: DecisionCategory;
  escalatedToOwner: boolean;
  createdAt: Date;
}
```

### 3.5 Evaluation

```typescript
type Score = 'A+' | 'A' | 'B+' | 'B' | 'C' | 'D';

interface Evaluation {
  id: string;
  missionId: string;
  score: Score;
  comment: string;
  assetIds: string[];
  qualityNotes?: string;
  costNotes?: string;
  lessons?: string;
  createdAt: Date;
}
```

---

## 四、存储设计

v0.1 使用 SQLite，默认数据库文件为 `.agent-boss/agent-boss.sqlite`。如果项目目录不可写，允许回退到用户目录 `~/.agent-boss/agent-boss.sqlite`。

### 4.1 表结构

```sql
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  provider TEXT,
  plan TEXT,
  scenes TEXT NOT NULL,
  cost_mode TEXT NOT NULL,
  status TEXT NOT NULL,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE missions (
  id TEXT PRIMARY KEY,
  goal TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  progress INTEGER NOT NULL,
  risk TEXT NOT NULL,
  owner_needed INTEGER NOT NULL,
  current_assignee TEXT,
  next_action TEXT,
  summary TEXT,
  asset_ids TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE TABLE mission_events (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id),
  type TEXT NOT NULL,
  actor TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE supervisor_decisions (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id),
  question TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason TEXT NOT NULL,
  category TEXT NOT NULL,
  escalated_to_owner INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE evaluations (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL REFERENCES missions(id),
  score TEXT NOT NULL,
  comment TEXT NOT NULL,
  asset_ids TEXT NOT NULL,
  quality_notes TEXT,
  cost_notes TEXT,
  lessons TEXT,
  created_at INTEGER NOT NULL
);
```

### 4.2 JSON 字段约定

- `scenes`、`asset_ids` 存 JSON array。
- `metadata` 存 JSON object。
- v0.1 不做复杂迁移框架，启动时执行 `CREATE TABLE IF NOT EXISTS`。

---

## 五、核心模块

### 5.1 AssetLedger

职责：

- 新增、列出、查看、更新 AI 资产。
- 按 scene / status / type 查询候选资产。
- 为 Mission 记录使用过的资产。

接口草案：

```typescript
class AssetLedger {
  addAsset(input: AddAssetInput): Promise<Asset>;
  listAssets(filter?: AssetFilter): Promise<Asset[]>;
  getAsset(id: string): Promise<Asset | undefined>;
  updateAsset(id: string, patch: Partial<Asset>): Promise<Asset>;
  findCandidates(goal: string): Promise<Asset[]>;
}
```

### 5.2 MissionStore

职责：

- 创建和更新 Mission。
- 追加 MissionEvent。
- 查询状态板所需数据。
- 生成 Mission 复盘所需历史。

接口草案：

```typescript
class MissionStore {
  createMission(goal: string, assetIds?: string[]): Promise<Mission>;
  getMission(id: string): Promise<Mission | undefined>;
  listMissions(filter?: MissionFilter): Promise<Mission[]>;
  updateMission(id: string, patch: Partial<Mission>): Promise<Mission>;
  addEvent(input: AddMissionEventInput): Promise<MissionEvent>;
  listEvents(missionId: string): Promise<MissionEvent[]>;
}
```

### 5.3 Supervisor

职责：

- 判断下层确认请求是否需要升级给 Owner。
- 对普通确认自动生成 Boss 代决策。
- 记录每次代决策，便于复盘和 judge。

v0.1 规则：

| 类型 | 关键词/条件 | 行为 |
|------|-------------|------|
| money | 付费、购买、额度不足、billing、quota、token limit | 升级给 Owner |
| permission | 登录、授权、API key、secret、private access | 升级给 Owner |
| destructive | 删除、覆盖、发布、merge、外发消息、drop | 升级给 Owner |
| normal | 测试、边界、说明、重试、格式、拆分 | Boss 默认代决策 |

默认代决策：

- 要不要加测试：加。
- 要不要补边界：补。
- 输出太虚：要求重做并给出可验证交付物。
- 卡住：追问阻塞点、已尝试方案和下一步。
- 方案太散：要求收敛成推荐方案和风险。

接口草案：

```typescript
class Supervisor {
  classify(question: string): DecisionCategory;
  decide(mission: Mission, question: string): Promise<SupervisorDecision>;
}
```

### 5.4 Reporter

职责：

- 输出老板视角的 status board。
- 基于 Mission + events 生成随时汇报。
- 默认折叠底层日志，只展示结果、风险、阻塞、资源和下一步。

报告模板：

```text
当前不需要你介入。
目标：{goal}
进度：{progress}% / {stage}
已完成：{summary from recent progress events}
风险：{risk and blockers}
资源：{assets}
下一步：{nextAction}
```

### 5.5 EvaluationEngine

职责：

- `judge <missionId>` 评价 Mission。
- 将评价写入 `evaluations`。
- 更新资产表现：按 assetId、scene、score、comment 沉淀。

v0.1 可以先记录 Evaluation，不实现复杂推荐算法。

---

## 六、CLI 设计

### 6.1 assets

```bash
agent-boss assets list
agent-boss assets show <assetId>
agent-boss assets add <id> --type agent --name "Codex" --plan coding-plan --scenes code,refactor --cost subscription
```

输出示例：

```text
id           type    status   scenes          plan
codex        agent   ready    code,refactor   coding-plan
claude-code  agent   ready    review,design   pro
```

### 6.2 mission

```bash
agent-boss mission create "<goal>"
agent-boss mission status
agent-boss mission status <missionId>
agent-boss mission report <missionId>
agent-boss mission event <missionId> "<content>" --type progress --actor codex
agent-boss mission decide <missionId> "<question>"
agent-boss mission complete <missionId> "<summary>"
```

### 6.3 judge

```bash
agent-boss judge <missionId> <score> "<comment>" --assets codex,claude-code
```

## 七、端到端验收 Demo

### 7.1 初始化资产

```bash
agent-boss assets add codex --type agent --name "Codex" --plan coding-plan --scenes code,refactor --cost subscription
agent-boss assets add claude-code --type agent --name "Claude Code" --plan pro --scenes review,design --cost subscription
agent-boss assets list
```

验收：

- 两个资产被写入 SQLite。
- `assets list` 展示 id、type、status、scenes、plan。

### 7.2 创建 Mission

```bash
agent-boss mission create "重构登录模块，要求安全、可测试、不要大改架构"
```

验收：

- 生成 `m-001`。
- stage 为 `planning` 或 `executing`。
- status 为 `active`。
- 自动写入 `created` 和 `planned` 事件。
- nextAction 不为空。

### 7.3 记录进展和代决策

```bash
agent-boss mission event m-001 "codex 已完成初稿，但缺少测试" --type progress --actor codex
agent-boss mission decide m-001 "Should I add tests for this refactor?"
```

验收：

- Supervisor 分类为 `normal`。
- 决策为“要求补测试，不升级给 Owner”。
- `supervisor_decisions` 和 `mission_events` 均有记录。

### 7.4 汇报状态

```bash
agent-boss mission status m-001
agent-boss mission report m-001
```

验收：

- 输出目标、阶段、进度、风险、当前执行者、下一步。
- 报告明确说明是否需要用户介入。
- 不展示冗长 agent 原始日志。

### 7.5 完成和评价

```bash
agent-boss mission complete m-001 "登录模块重构完成，已补安全边界和测试"
agent-boss judge m-001 A "安全边界处理好，成本可以接受" --assets codex,claude-code
```

验收：

- Mission 状态变为 `completed`。
- 写入 `completed`、`judged` 事件。
- `evaluations` 有记录。
- 后续可从该 Mission 复盘使用资产和质量评价。

---

## 八、实现顺序

### Phase 0：归档旧代码并重建 src

- 状态：已完成。
- 移动历史 `src/` 到 `archive/src-v0.3-task-router/`。
- 归档 v0.3 计划到 `archive/plans-v0.3/`。
- 新建干净的 `src/` 目录。
- 新入口只暴露 v0.4 CLI：`assets`、`mission`、`judge`。
- 暂不实现旧 `ask` 命令，避免产品主线继续滑回 query router。

### Phase 1：存储与类型

- 状态：已完成基础版。
- 新增 v0.4 类型：Asset、Mission、MissionEvent、SupervisorDecision、Evaluation。
- 新增 SQLite 初始化、schema migration 标记和基础 repository。
- 不导入 v0.3 类型，不建立 compatibility layer。

### Phase 2：Asset Ledger

- 状态：已完成基础版。
- 实现 `assets add/update/list/show`。
- 支持 scene、costMode、status。
- 写入和读取 SQLite。

### Phase 3：Mission Store + CLI

- 状态：已完成基础版。
- 实现 `mission create/status/watch/log/update/run/event/complete`。
- Mission create 自动写入初始 events。
- Status board 使用 Mission 当前字段。

### Phase 4：Supervisor + Reporter

- 状态：已完成基础版。
- 实现 `mission decide`。
- 实现规则分类和代决策记录。
- 实现 `mission report` 和 `mission watch` 老板视角状态板。

### Phase 5：Judge

- 状态：已完成基础版。
- 将 `judge` 扩展为支持 missionId。
- 写入 Evaluation。
- 先记录 `judged` event；资产表现排行留给后续 usage ledger。

### Phase 6：全新接入真实 Agent

- 状态：MockRunner 已完成；OpenClaw CLI runner 已完成基础版；Codex / Claude 待接入。
- 支持 `mission run <id> --runner mock --asset codex`。
- 支持 `mission run <id> --runner openclaw --asset openclaw --timeout 120`。
- `MockMissionRunner` 自动写入 assigned、progress、confirmation_requested、decision、completed events。
- `OpenClawRunner` 调用 `openclaw agent --json --message ...`，成功时写入 progress/completed，失败时写入 blocked 或 resource_escalation。
- 权限/付费/破坏性问题通过 Supervisor 暂停并升级 Owner。
- 为 Codex / Claude / OpenClaw 按 v0.4 `MissionRunner` 接口重写 adapter。
- adapter 自动写入 MissionEvent：assigned、progress、blocked、completed、failed。

### Phase 7：可跑 MVP 入口

- 状态：已完成基础版。
- `agent-boss demo` 一键创建 demo 资产、创建 Mission、运行 MockRunner、输出状态板、生成 report、写入 judge。
- `agent-boss interactive` 提供交互式 shell，支持 demo、assets、missions、create、run、status、log、report、judge。

---

## 九、风险与取舍

| 风险 | 影响 | v0.1 取舍 |
|------|------|----------|
| 自动监工过早智能化 | 行为不稳定 | 先用规则，不接 LLM 决策 |
| 真实账单接入复杂 | 拖慢 MVP | 先做手动资产台账 |
| 旧代码继续影响方向 | 产品主线跑偏 | Phase 0 直接归档旧 `src/`，从 v0.4 重写 |
| SQLite schema 未来变化 | 迁移成本 | v0.1 已加入 schema migration 标记，后续补真实迁移脚本 |
| 下层 Agent 状态不可观测 | 无法真监工 | v0.1 已用 MockRunner 验证自动 event，后续接真实 adapter |

---

## 十、后续演进

v0.1 证明 Mission 监工闭环：

```text
资产登记 -> 创建 Mission -> 记录事件 -> Boss 代决策 -> 汇报 -> 完成 -> judge
```

v0.2 引入真实执行：

- 本地命令型 runner
- Codex / Claude / OpenClaw adapter 自动产出 progress / blocked / completed events
- 资产使用自动记录

v0.3 引入智能选择：

- 基于 Evaluation 推荐 agent/model/plan
- 成本、质量、速度排行
- Owner 偏好学习

v1.0 再进入 Agent 公司：

- Personal Boss / Department Boss / CEO Boss
- 跨 Boss 委派
- 组织记忆继承
- 公司级报告

---

*本技术方案专注 PRD v0.4 的 P0 可执行蓝图：先归档旧代码，再从零实现本地 CLI 任务监工台，随后按新接口接入真实 Agent 自动执行。*
