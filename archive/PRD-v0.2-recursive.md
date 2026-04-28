# Agent Boss — 递归型多 Agent 编排器 (PRD v0.2)

> 版本：v0.2  
> 日期：2026-04-28  
> 作者：刘幼峰 + 大雄  
> 核心理念：**递归管理** — Agent Boss 本身也是 Agent，可以被更高层 Boss 管理

---

## 一、愿景

**不是一个工具，而是一个组织。**

Agent Boss 是一套递归的多 Agent 编排协议。每个 Agent Boss 实例既可以管理下属 Agent，也可以被更高层的 Agent Boss 管理。

这意味着：
- **个人级**：你管理 4 个 Agent（Codex / Claude / OpenClaw / Hermes）
- **团队级**：一个「组长 Agent Boss」管理 5 个「个人 Agent Boss」
- **公司级**：一个「CEO Agent Boss」管理 10 个「组长 Agent Boss」

每个层级的 Boss 只做一件事：**接收任务 → 拆解 → 委派 → 收集结果 → 评判 → 上报。**

---

## 二、递归架构

```
                    ┌─────────────────┐
                    │  CEO Agent Boss │  ← 管理多个部门
                    │  (公司级)       │
                    └────────┬────────┘
                             │
           ┌─────────────────┼─────────────────┐
           │                 │                 │
    ┌──────▼──────┐   ┌──────▼──────┐   ┌──────▼──────┐
    │ 部门 Boss A │   │ 部门 Boss B │   │ 部门 Boss C │
    │ (前端组)    │   │ (后端组)    │   │ (算法组)    │
    └──────┬──────┘   └──────┬──────┘   └──────┬──────┘
           │                 │                 │
    ┌──────▼──────┐   ┌──────▼──────┐   ┌──────▼──────┐
    │ 个人 Boss 1 │   │ 个人 Boss 2 │   │ 个人 Boss 3 │
    │ (开发A)     │   │ (开发B)     │   │ (开发C)     │
    └──────┬──────┘   └──────┬──────┘   └──────┬──────┘
           │                 │                 │
    ┌──────▼──────┐   ┌──────▼──────┐   ┌──────▼──────┐
    │ Claude/Code │   │ Claude/Code │   │ Claude/Code │
    │  /OpenClaw  │   │  /OpenClaw  │   │  /OpenClaw  │
    └─────────────┘   └─────────────┘   └─────────────┘
```

### 2.1 递归协议

每个 Agent Boss 节点暴露统一接口：

```typescript
interface AgentBoss {
  // 向上层汇报
  report(taskId: string, result: Result): void;
  
  // 接收下层/同层请求
  delegate(task: Task): Promise<Result>;
  
  // 查询状态
  status(): { agents: AgentStatus[], queue: Task[] };
  
  // 评判结果
  judge(taskId: string, agentId: string, score: Score): void;
}
```

### 2.2 任务流转

```
用户给 CEO Boss 发任务：
"下个月上线推荐系统"
       ↓
CEO Boss 拆解：
  1. 前端界面 → 委派给 部门 Boss A
  2. 后端 API  → 委派给 部门 Boss B
  3. 推荐算法 → 委派给 部门 Boss C
       ↓
部门 Boss A 再拆解：
  1. UI 设计 → 委派给 个人 Boss 1
  2. 组件开发 → 委派给 个人 Boss 2
       ↓
个人 Boss 1 调用 Claude/Code 写代码
       ↓
结果逐层上报：
  个人 Boss → 部门 Boss → CEO Boss → 用户
       ↓
CEO Boss 汇总各子系统，给出整体评估
```

---

## 三、与传统 Agent 框架的区别

| 维度 | AutoGen / CrewAI | Agent Boss |
|------|-----------------|------------|
| **层级** | 扁平（所有 agent 同级） | **递归（可嵌套任意深度）** |
| **管理** | 一个编排器管理所有 | **每个节点都是编排器** |
| **扩展** | 加 agent 改配置 | **加一层 Boss 即可** |
| **组织映射** | 无 | **直接对应公司/团队结构** |
| **递归** | ❌ | ✅ **核心设计** |

---

## 四、核心功能（保留原 PRD + 新增递归）

### 4.1 P0 — MVP（个人级）

| # | 功能 | 说明 |
|---|------|------|
| 1 | Agent 自动发现 | 检测本机 Claude/Code/OpenClaw/Hermes |
| 2 | 单发/多发 Query | ask / ask all |
| 3 | 结果收集 + 对比 | compare / diff |
| 4 | 评判打分 | judge → leaderboard |
| 5 | 群组讨论 | group |

### 4.2 P1 — 递归层（组织级）⭐ 新增

| # | 功能 | 说明 |
|---|------|------|
| 6 | **Boss 注册** | `register-boss` 一个 Boss 可以注册为另一个 Boss 的下属 |
| 7 | **任务委派** | `delegate` Boss 收到任务后自动拆解并委派给下属 |
| 8 | **结果上报** | `report` 下属完成自动上报给上级 Boss |
| 9 | **层级视图** | `tree` 命令查看完整组织架构 |
| 10 | **跨 Boss 协作** | 两个部门的 Boss 可以直接对话协商 |

### 4.3 P2 — 公司级

| # | 功能 | 说明 |
|---|------|------|
| 11 | 自动化规则引擎 | YAML 配置工作流 |
| 12 | 权限体系 | 不同层级 Boss 有不同操作权限 |
| 13 | 审计日志 | 所有委派/评判/上报全程记录 |
| 14 | 成本分摊 | 各层级 API 调用成本统计 |

---

## 五、递归 CLI 设计

```bash
# === 个人级（原有）===
ask claude "fix this"
ask all "review PR"
compare 1,2
judge 1 A+
group claude+codex "discuss"

# === 组织级（新增）===
# 查看完整组织架构
tree
└── CEO-Boss (你)
    ├── 前端-Boss (Alice)
    │   ├── dev1: claude+code
    │   └── dev2: claude+code
    ├── 后端-Boss (Bob)
    │   ├── dev3: codex+openclaw
    │   └── dev4: hermes
    └── 算法-Boss (Carol)
        └── dev5: claude+code

# 注册一个下属 Boss
register-boss --name "前端-Boss" --endpoint ws://192.168.1.10:3000

# 给下属 Boss 委派任务
delegate "前端-Boss" "完成登录页面重构"
       ↓
前端-Boss 收到后自动拆解：
  - 委派给 dev1: "写 UI 组件"
  - 委派给 dev2: "对接 API"
  - 等两个都完成后，合并上报给你

# 查看某个 Boss 的状态
status "前端-Boss"
[前端-Boss] 2 agents ready, 1 task running
  - dev1: 🟢 ready
  - dev2: 🟡 busy (task: "对接 API")

# 跨 Boss 协作（让两个部门讨论）
inter-boss "前端-Boss+后端-Boss" "API 接口设计"
[前端-Boss] 我们需要 REST + WebSocket 双通道...
[后端-Boss] 建议先上 GraphQL，后续再...
[前端-Boss] 但 GraphQL 学习成本...
```

---

## 六、协议层设计

### 6.1 Agent Boss 通信协议 (ABCP)

基于 JSON-RPC over WebSocket，每个 Boss 既是 Server 也是 Client。

```json
{
  "jsonrpc": "2.0",
  "method": "boss.delegate",
  "params": {
    "taskId": "t-2026-001",
    "task": {
      "type": "code_review",
      "description": "review auth module",
      "context": { "file": "src/auth.ts" },
      "deadline": "2026-04-29T18:00:00Z"
    },
    "priority": "high"
  },
  "id": 1
}
```

### 6.2 上报格式

```json
{
  "jsonrpc": "2.0",
  "method": "boss.report",
  "params": {
    "taskId": "t-2026-001",
    "agentId": "claude-1",
    "result": {
      "status": "completed",
      "output": "...",
      "timeSpent": 120,
      "tokensUsed": 5000
    },
    "subTasks": [
      { "taskId": "t-2026-001-a", "status": "completed" },
      { "taskId": "t-2026-001-b", "status": "completed" }
    ]
  }
}
```

---

## 七、里程碑（更新）

### Milestone 1：个人 Agent Boss（1 周）
- 原有 MVP 全部完成

### Milestone 2：递归协议（1 周）⭐
- Boss 注册/发现
- 委派/上报机制
- 层级视图 tree 命令

### Milestone 3：多 Boss 协作（1 周）⭐
- 跨 Boss 任务流转
- 结果合并与冲突解决
- 审计日志

### Milestone 4：企业级（未来）
- Web Dashboard（组织架构图）
- 权限 RBAC
- 成本分摊报表

---

## 八、递归的意义

> "Agent Boss 不是另一个 agent 框架。它是**组织的数字化镜像**。
>
> 当一个团队有 10 个人，每人用 3 个 Agent，传统方式是 30 个独立 Agent。
> Agent Boss 的方式是：1 个 CEO Boss → 3 个部门 Boss → 10 个人 Boss → 30 个 Agent。
>
> 每一层都有评判、都有记忆、都能学习。整个组织在进化。"

---

## 九、下一步

1. 确认递归设计是否符合你的管理思路
2. 我先写个人级 MVP（原有功能）
3. 再叠加递归层（注册/委派/上报）

递归层需要我先写吗？还是先把个人级跑起来？
