# Agent Boss — 技术方案 (TECH-SPEC)

> 版本：v1.0
> 日期：2026-04-29
> 状态：活跃
> 作者：大雄（kimi-2.5）
> 基于：PRD v0.3

---

## 一、总体架构

```
┌─────────────────────────────────────────────┐
│                CLI Layer                     │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐      │
│  │  ask    │ │ compare │ │ judge   │      │
│  │  agents │ │ history │ │ group   │      │
│  └────┬────┘ └────┬────┘ └────┬────┘      │
└───────┼───────────┼───────────┼───────────┘
        │           │           │
┌───────▼───────────▼───────────▼───────────┐
│           Core Orchestrator                  │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐     │
│  │ Router  │ │ Result  │ │ Judge   │     │
│  │ Engine  │ │Collector│ │ Panel   │     │
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
│  │  Store  │ │ Profile │               │
│  │ (SQLite)│ │ (SQLite)│               │
│  └─────────┘ └─────────┘               │
└─────────────────────────────────────────┘
```

### 模块职责

| 模块 | 职责 | 对应 PRD 需求 |
|------|------|--------------|
| CLI Layer | 解析命令，展示结果 | 需求 1（统一入口） |
| Router Engine | 决定 query 发给谁 | 需求 1（自动推荐） |
| Result Collector | 收集/展示多 agent 输出 | 需求 2（A/B 对比） |
| Judge Panel | 存储/分析评判记录 | 需求 3（评判积累） |
| Agent Registry | 管理 agent 生命周期 | 需求 1（自动发现） |
| Task Store | 持久化任务历史 | — |
| Agent Profile | 积累 agent 能力画像 | 拓展 3.2（Agent 画像） |

---

## 二、核心数据模型

### 2.1 Agent（黑箱能力单元）

```typescript
interface Agent {
  id: string;           // "claude-code" | "codex" | "openclaw" | "hermes"
  name: string;
  type: "cli" | "websocket" | "gateway";
  
  // 核心操作
  send(query: string, context?: Context): Promise<Result>;
  status(): AgentStatus;  // ready | busy | offline
  
  // 元数据（运行时收集）
  capabilities: string[];
  avgScore: number;
  totalTasks: number;
}
```

**设计原则：Agent 是黑箱。** 不暴露内部实现，只关心输入和输出。能力画像由外部评判系统积累，不是 self-declared。

### 2.2 Task（原子工作单元）

```typescript
interface Task {
  id: string;
  query: string;
  mode: "single" | "multi" | "group";
  agents: string[];
  context?: Context;
  
  results: Map<string, Result>;
  judge?: JudgeRecord;
  
  createdAt: Date;
  completedAt?: Date;
  tags: string[];
}
```

### 2.3 JudgeRecord（评判记录）

```typescript
interface JudgeRecord {
  taskId: string;
  ratings: Map<string, {
    score: "A+" | "A" | "B" | "C" | "D";
    comment?: string;
  }>;
  winner?: string;
  tags: string[];
  createdAt: Date;
}
```

---

## 三、Router Engine — 智能路由

### 3.1 路由策略矩阵

```typescript
type RoutingStrategy = 
  | "auto"      // 基于历史评分自动推荐
  | "explicit"  // 用户明确指定
  | "broadcast" // 发给所有
  | "compete";  // 2-3 个 agent 竞争上岗

interface RoutingDecision {
  strategy: RoutingStrategy;
  agents: string[];
  reasoning?: string;
  estimatedTime?: number;
}
```

### 3.2 自动推荐算法

```typescript
function autoRoute(query: string, profiles: AgentProfile[]): RoutingDecision {
  // Step 1: 提取场景标签（关键词匹配，非 LLM）
  const tags = extractTags(query);
  
  // Step 2: 查询各 agent 在该场景下的表现
  const candidates = profiles.map(p => ({
    agentId: p.agent_id,
    sceneScore: p.scene_scores[tags[0]]?.avg || 0,
    globalScore: p.avg_score,
    confidence: p.scene_scores[tags[0]]?.count || 0,
  }));
  
  // Step 3: 综合排序（场景 70% + 全局 30%）
  const ranked = candidates
    .map(c => ({ ...c, composite: c.sceneScore * 0.7 + c.globalScore * 0.3 }))
    .sort((a, b) => b.composite - a.composite);
  
  const top = ranked[0];
  const hasEnoughData = top.confidence >= 3;
  
  return {
    strategy: hasEnoughData ? "auto" : "compete",
    agents: hasEnoughData ? [top.agentId] : [top.agentId, ranked[1].agentId],
    reasoning: hasEnoughData
      ? `${top.agentId} 在 "${tags[0]}" 场景下评分 ${top.sceneScore.toFixed(1)}`
      : `"${tags[0]}" 场景数据不足，启动竞争模式`,
  };
}
```

### 3.3 场景标签提取（规则引擎）

```typescript
const SCENE_PATTERNS = {
  "sql-optimization": [/sql/i, /query/i, /database/i, /optimize/i],
  "algorithm-design": [/algorithm/i, /data structure/i, /leetcode/i],
  "code-review": [/review/i, /refactor/i, /bug/i, /fix/i],
  "architecture": [/architecture/i, /design pattern/i, /microservice/i],
  "frontend-dev": [/react/i, /vue/i, /css/i, /ui/i, /component/i],
  "devops": [/docker/i, /kubernetes/i, /deploy/i, /ci\/cd/i],
  "api-design": [/api/i, /rest/i, /graphql/i, /endpoint/i],
  "testing": [/test/i, /unit test/i, /mock/i, /coverage/i],
};
```

---

## 四、Judge Panel — 评判系统

### 4.1 评分体系

| 等级 | 含义 | 积分 |
|------|------|------|
| A+ | 超出预期，最佳实践 | 5 |
| A | 正确且完整 | 4 |
| B+ | 正确但有瑕疵 | 3.5 |
| B | 基本完成 | 3 |
| C | 有缺陷，需修正 | 2 |
| D | 错误或不可用 | 1 |

### 4.2 ELO 评分算法

```typescript
function updateElo(winner: AgentProfile, loser: AgentProfile, kFactor: number = 32): void {
  const expectedWin = 1 / (1 + 10 ** ((loser.elo - winner.elo) / 400));
  winner.elo += kFactor * (1 - expectedWin);
  loser.elo += kFactor * (0 - expectedWin);
}
```

### 4.3 自动标签提取

从用户评论中提取能力标签：

```typescript
const CAPABILITY_PATTERNS = {
  "边界处理": [/边界/i, /edge case/i, /corner case/i, /空值/i],
  "并发安全": [/并发/i, /线程安全/i, /race condition/i, /lock/i],
  "性能优化": [/性能/i, /optimize/i, /fast/i, /缓存/i, /cache/i],
  "代码简洁": [/简洁/i, /clean/i, /短/i],
  "架构设计": [/架构/i, /设计模式/i, /可扩展/i, /解耦/i],
  "测试覆盖": [/测试/i, /test/i, /覆盖/i, /coverage/i],
  "文档完善": [/文档/i, /注释/i, /doc/i, /README/i],
  "错误处理": [/错误/i, /异常/i, /error/i, /try catch/i],
};
```

---

## 五、Result Collector — 结果展示

### 5.1 展示模式

| 模式 | 适用场景 |
|------|---------|
| **流式** | 单发，实时滚动 |
| **并排** | 多发（2个），左右分栏 |
| **列表** | 多发（3+），折叠列表 |
| **diff** | 多发对比，高亮差异 |
| **对话** | 群组讨论，聊天记录式 |

### 5.2 群组讨论实现

```typescript
async function roundRobinDiscussion(room: GroupChat, topic: string, maxRounds: number = 3): Promise<Message[]> {
  const messages: Message[] = [{ agent: "user", content: topic }];
  
  for (let round = 1; round <= maxRounds; round++) {
    for (const agentId of room.agent_ids) {
      const context = buildContext(messages);
      const prompt = `讨论主题：${topic}\n\n历史发言：\n${context}\n\n轮到你发言（第 ${round} 轮）。`;
      
      const response = await agents[agentId].send(prompt);
      messages.push({ agent: agentId, content: response, round });
    }
    
    if (isConsensus(getLastRounds(messages, 2))) break;
  }
  
  return messages;
}
```

---

## 六、Agent Adapter 层

### 6.1 统一接口

```typescript
interface AgentAdapter {
  readonly id: string;
  readonly name: string;
  readonly type: "cli" | "websocket";
  
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getStatus(): AgentStatus;
  send(query: string, options?: SendOptions): AsyncIterable<Chunk>;
  abort(): void;
}
```

### 6.2 各 Agent 接入方式

| Agent | 类型 | 接入方式 | 难点 |
|-------|------|---------|------|
| **Codex** | CLI | `codex exec "query"` | 无，输出干净 |
| **Claude Code** | CLI | `claude` PTY + ANSI 过滤 | TUI 模式需绕过 |
| **OpenClaw** | WebSocket | Gateway `ws://127.0.0.1:18789` | 异步回调需封装 |
| **Hermes** | ? | 需调研确认 | 未知 |

### 6.3 进程管理原则

1. **进程隔离**：每个 CLI agent 独立子进程
2. **超时机制**：默认 120s
3. **流式回显**：chunk 到达即展示
4. **优雅降级**：agent 离线时标记状态，不影响其他 agent

---

## 七、存储设计（SQLite）

### 7.1 表结构

```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  mode TEXT NOT NULL,
  agent_ids TEXT NOT NULL,
  context TEXT,
  results TEXT,
  judge TEXT,
  tags TEXT,
  created_at INTEGER,
  completed_at INTEGER
);

CREATE TABLE judges (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks(id),
  ratings TEXT NOT NULL,
  winner TEXT,
  tags TEXT,
  created_at INTEGER
);

CREATE TABLE agent_profiles (
  agent_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  total_tasks INTEGER DEFAULT 0,
  avg_score REAL,
  capabilities TEXT,
  scene_scores TEXT,
  elo INTEGER DEFAULT 1500,
  updated_at INTEGER
);

CREATE TABLE group_chats (
  id TEXT PRIMARY KEY,
  name TEXT,
  agent_ids TEXT NOT NULL,
  messages TEXT NOT NULL,
  created_at INTEGER,
  ended_at INTEGER
);
```

---

## 八、递归层扩展（预留）

### 8.1 当前预留的扩展点

- `Task` 已含 `parentTaskId` 字段（未使用）
- `Agent` 可扩展 `children` 字段（未使用）
- 通信层可扩展为 JSON-RPC over WebSocket（当前用本地函数调用）

### 8.2 递归节点接口（未来实现）

```typescript
interface RecursiveAgent extends Agent {
  report(taskId: string, result: Result): void;
  delegate(task: Task): Promise<Result>;
  children?: RecursiveAgent[];
  parent?: RecursiveAgent;
}
```

---

## 九、实现顺序

| 阶段 | 内容 | 预计时间 |
|------|------|---------|
| **Phase 1** | Codex Adapter + CLI 骨架 | 1-2 天 |
| **Phase 2** | SQLite 存储 + Task Store | 1 天 |
| **Phase 3** | Router Engine + 场景标签 | 1-2 天 |
| **Phase 4** | Claude Code Adapter（PTY） | 2-3 天 |
| **Phase 5** | Judge Panel + ELO 评分 | 1-2 天 |
| **Phase 6** | Result Collector（并排/diff） | 1-2 天 |
| **Phase 7** | Group Chat | 1-2 天 |
| **Phase 8** | OpenClaw Adapter | 1 天 |
| **Phase 9** | 递归层 | 1-2 周 |

---

## 十、风险与假设

| 风险 | 影响 | 缓解方案 |
|------|------|---------|
| Claude Code TUI 无法程序化交互 | 高 | PTY 模拟 + ANSI 过滤 |
| Hermes 接口不开放 | 高 | 先做 3 个 agent，Hermes 调研后补 |
| 并发任务资源冲突 | 中 | 进程隔离 + 文件锁 |
| SQLite 性能瓶颈（>10万条） | 低 | 未来可迁移到 PostgreSQL |

---

*本技术方案由 大雄（kimi-2.5）基于 PRD v0.3 推导，整合架构 v1.0 + 核心模块 v1.1 + 适配层 v1.2 + 递归层 v1.3，日期 2026-04-29。*
