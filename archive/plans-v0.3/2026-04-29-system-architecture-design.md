# Agent Boss — 系统架构设计 v1.0

> 版本：v1.0
> 日期：2026-04-29
> 状态：草案（待评审）
> 作者：大雄（kimi-2.5）
> 基于：PRD v0.3

---

## 一、设计目标

**一句话：让 4 个 Agent（Claude/Code/OpenClaw/Hermes）能被统一管理、对比评判、自由协作。**

非目标（现阶段不做）：
- ❌ 递归管理层（P2，预留扩展点）
- ❌ Web UI（P3）
- ❌ 飞书集成（P3）
- ❌ 自动化规则引擎（P3）

---

## 二、核心抽象

### 2.1 Agent = 黑箱能力单元

```typescript
interface Agent {
  id: string;           // "claude-code" | "codex" | "openclaw" | "hermes"
  name: string;         // 展示名
  type: "cli" | "websocket" | "gateway";
  
  // 核心操作
  send(query: string, context?: Context): Promise<Result>;
  status(): AgentStatus;  // ready | busy | offline
  
  // 元数据（运行时收集）
  capabilities: string[];   // 擅长领域标签
  avgScore: number;        // 历史平均分
  totalTasks: number;      // 累计任务数
}
```

**关键设计：Agent 是黑箱。**
- 不暴露内部实现（Claude 怎么跑的不关心）
- 只关心输入（query）和输出（result）
- 能力画像由外部评判系统积累，不是 self-declared

### 2.2 Task = 原子工作单元

```typescript
interface Task {
  id: string;
  query: string;
  mode: "single" | "multi" | "group";  // 单发 / 多发 / 群组
  agents: string[];                     // 指定哪些 agent
  context?: Context;                   // 文件/代码片段等
  
  // 结果
  results: Map<string, Result>;         // agentId → result
  judge?: JudgeRecord;                 // 用户评判
  
  // 元数据
  createdAt: Date;
  completedAt?: Date;
  tags: string[];                      // 自动/手动标签
}
```

### 2.3 JudgeRecord = 评判记录

```typescript
interface JudgeRecord {
  taskId: string;
  ratings: Map<string, {              // agentId → 评分
    score: "A+" | "A" | "B" | "C" | "D";
    comment?: string;
  }>;
  winner?: string;                    // 最优 agent（可选）
  tags: string[];                      // 场景标签（自动提取）
  createdAt: Date;
}
```

---

## 三、系统架构

### 3.1 总体结构

```
┌─────────────────────────────────────────────┐
│                CLI Layer                     │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐    │
│  │  ask    │ │ compare │ │ judge   │    │
│  │  agents │ │ history │ │ group   │    │
│  └────┬────┘ └────┬────┘ └────┬────┘    │
└───────┼───────────┼───────────┼───────────┘
        │           │           │
┌───────▼───────────▼───────────▼───────────┐
│           Core Orchestrator                │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐     │
│  │ Router  │ │ Result  │ │ Judge   │     │
│  │ Engine  │ │ Collector│ │ Panel   │     │
│  └────┬────┘ └────┬────┘ └────┬────┘     │
│       │           │           │          │
│  ┌────┴───────────┴───────────┴────┐   │
│  │         Agent Registry            │   │
│  │  ┌────┐ ┌────┐ ┌────┐ ┌────┐   │   │
│  │  │ C  │ │ X  │ │ O  │ │ H  │   │   │
│  │  │ l  │ │ e  │ │ p  │ │ e  │   │   │
│  │  │ a  │ │ d  │ │ e  │ │ r  │   │   │
│  │  │ u  │ │ e  │ │ n │ │ m  │   │   │
│  │  │ d  │ │ x  │ │ C  │ │ e  │   │   │
│  │  │ e  │ │    │ │ l  │ │ s  │   │   │
│  │  └────┘ └────┘ └────┘ └────┘   │   │
│  └─────────────────────────────────┘   │
│                                         │
│  ┌─────────┐ ┌─────────┐               │
│  │  Task   │ │  Agent  │               │
│  │  Store  │ │  Profile│               │
│  │ (SQLite)│ │  (SQLite)│               │
│  └─────────┘ └─────────┘               │
└─────────────────────────────────────────┘
```

### 3.2 模块职责

| 模块 | 职责 | 对应 PRD 需求 |
|------|------|--------------|
| **CLI Layer** | 解析命令，展示结果 | 需求 1（统一入口） |
| **Router Engine** | 决定 query 发给谁 | 需求 1（自动推荐） |
| **Result Collector** | 收集/展示多 agent 输出 | 需求 2（A/B 对比） |
| **Judge Panel** | 存储/分析评判记录 | 需求 3（评判积累） |
| **Agent Registry** | 管理 agent 生命周期 | 需求 1（自动发现） |
| **Task Store** | 持久化任务历史 | — |
| **Agent Profile** | 积累 agent 能力画像 | 拓展 3.2（Agent 画像） |

---

## 四、数据流

### 4.1 单发流程

```
用户: ask "优化 SQL"
       ↓
CLI → Router
       ↓
Router 查询 Agent Profile
       ↓
"sql-optimization" 场景下 Claude 评分 A+
       ↓
自动推荐 Claude（用户可覆盖）
       ↓
Claude Adapter 发送 query
       ↓
收集结果 → 展示给用户
       ↓
存入 Task Store
```

### 4.2 多发对比流程

```
用户: ask claude,codex "写 LRU 缓存"
       ↓
CLI → Router
       ↓
并行发送给 Claude + Codex
       ↓
Result Collector 流式接收
       ↓
两者都完成后 → 并排展示
       ↓
用户: judge 1 A  /  judge 2 B+
       ↓
Judge Panel 记录 → 更新 Agent Profile
       ↓
下次同类问题自动推荐 Claude
```

### 4.3 群组讨论流程

```
用户: group claude+codex "讨论架构"
       ↓
CLI → Group Chat Manager
       ↓
创建虚拟 Room
       ↓
Round 1: 发送给 Claude "讨论架构"
       ↓
Claude 回复 → 存入 Room History
       ↓
Round 2: 发送给 Codex "Claude 说...你怎么看？"
       ↓
Codex 回复 → 存入 Room History
       ↓
... 多轮循环 ...
       ↓
用户: group stop
       ↓
导出完整讨论记录 → Task Store
```

---

## 五、Agent 适配层设计

### 5.1 统一接口

```typescript
interface AgentAdapter {
  readonly id: string;
  readonly type: "cli" | "websocket";
  
  // 启动/停止
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  
  // 查询状态
  getStatus(): AgentStatus;
  
  // 发送 query，返回流式输出
  send(query: string, options?: SendOptions): AsyncIterable<Chunk>;
  
  // 取消当前任务
  abort(): void;
}

type AgentStatus = "ready" | "busy" | "offline" | "error";

type Chunk = {
  type: "text" | "thinking" | "code" | "error";
  content: string;
  timestamp: number;
};
```

### 5.2 各 Agent 接入方式

| Agent | 类型 | 接入方式 | 难点 |
|-------|------|---------|------|
| **Claude Code** | CLI | `claude --output` 或 `claude exec` | TUI 模式需绕过 |
| **Codex** | CLI | `codex exec "query"` | 输出相对干净 |
| **OpenClaw** | WebSocket | 直连 Gateway `ws://127.0.0.1:18789` | 异步回调需封装 |
| **Hermes** | ? | 需调研确认 | 未知 |

### 5.3 Adapter 实现原则

1. **进程隔离**：每个 CLI agent 独立子进程，避免相互污染
2. **超时机制**：默认 120s 超时，可配置
3. **流式回显**：chunk 到达即展示，不等完整结果
4. **优雅降级**：agent 离线时标记状态，不影响其他 agent

---

## 六、存储设计（SQLite）

### 6.1 表结构

```sql
-- 任务表
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  mode TEXT NOT NULL,  -- single/multi/group
  agent_ids TEXT NOT NULL,  -- JSON array
  context TEXT,  -- JSON
  results TEXT,  -- JSON Map<agentId, result>
  judge TEXT,    -- JSON
  tags TEXT,     -- JSON array
  created_at INTEGER,
  completed_at INTEGER
);

-- 评判记录表
CREATE TABLE judges (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks(id),
  ratings TEXT NOT NULL,  -- JSON Map<agentId, {score, comment}>
  winner TEXT,
  tags TEXT,  -- JSON array（自动提取）
  created_at INTEGER
);

-- Agent 画像表
CREATE TABLE agent_profiles (
  agent_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  total_tasks INTEGER DEFAULT 0,
  avg_score REAL,
  capabilities TEXT,  -- JSON array（标签）
  scene_scores TEXT,  -- JSON Map<scene, {avg, count}>
  updated_at INTEGER
);

-- 群组讨论记录表
CREATE TABLE group_chats (
  id TEXT PRIMARY KEY,
  name TEXT,
  agent_ids TEXT NOT NULL,  -- JSON array
  messages TEXT NOT NULL,   -- JSON array [{agent, content, timestamp}]
  created_at INTEGER,
  ended_at INTEGER
);
```

### 6.2 查询模式

```sql
-- 查询某场景下 agent 排行
SELECT agent_id, scene_scores->>'$.sql-optimization.avg' as score
FROM agent_profiles
ORDER BY score DESC;

-- 查询最近 30 天的评判分布
SELECT 
  json_extract(ratings, '$[0].score') as score,
  COUNT(*) as count
FROM judges
WHERE created_at > datetime('now', '-30 days')
GROUP BY score;
```

---

## 七、扩展点（预留递归层）

### 7.1 递归扩展接口

```typescript
// 未来实现递归时，Agent 接口扩展为：
interface RecursiveAgent extends Agent {
  // 向上汇报
  report(taskId: string, result: Result): void;
  
  // 接收委派
  delegate(task: Task): Promise<Result>;
  
  // 下级管理
  children?: RecursiveAgent[];
  parent?: RecursiveAgent;
}
```

### 7.2 当前预留

- `Task` 已含 `parentTaskId` 字段（未使用）
- `Agent` 可扩展 `children` 字段（未使用）
- 通信层可扩展为 JSON-RPC over WebSocket（当前用本地函数调用）

---

## 八、与旧 TECH-SPEC 的区别

| 维度 | 旧 v0.2（废弃） | 新 v1.0（本版） |
|------|----------------|----------------|
| **出发点** | 从协议层开始设计（JSON-RPC/WebSocket） | 从用户需求推导（PRD v0.3） |
| **Agent 定义** | 暴露内部协议细节 | 黑箱，只关心输入输出 |
| **递归** | 核心设计，一开始就实现 | 预留扩展点，P2 再做 |
| **存储** | 未明确 | SQLite，表结构已定义 |
| **CLI** | 列出命令 | 定义数据流和交互模式 |

---

## 九、风险与假设

| 风险 | 影响 | 缓解方案 |
|------|------|---------|
| Claude Code TUI 无法绕过 | 高 | 调研 `claude --output` 或 `claude exec` |
| Hermes 接口未知 | 高 | 先实现 3 个 agent，Hermes 调研后补 |
| 并发任务资源冲突 | 中 | 进程隔离 + 文件锁 |
| SQLite 性能瓶颈（>10万条记录） | 低 | 未来可迁移到 PostgreSQL |

---

## 十、下一步

1. 用户确认本版架构方向
2. 细化 Router Engine 算法（基于历史评分的推荐逻辑）
3. 实现第一个 Agent Adapter（Codex CLI）
4. 搭建 SQLite 表结构 + 数据访问层

---

*本设计由 大雄（kimi-2.5）基于 PRD v0.3 推导，日期 2026-04-29。*
