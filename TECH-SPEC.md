# Agent Boss — 递归型多 Agent 编排器技术方案

> 版本：v0.2
> 日期：2026-04-28
> 核心理念：**递归管理** — Agent Boss 本身也是 Agent，可以被更高层 Boss 管理

---

## 一、架构总览

### 1.1 递归三层模型

```
Layer 3: CEO Boss (组织级)
    └── 管理 N 个 Department Boss
        
Layer 2: Department Boss (部门级)
    └── 管理 N 个 Personal Boss
        
Layer 1: Personal Boss (个人级)
    └── 管理 N 个 Worker Agent (Claude/Code/OpenClaw/Hermes)
```

**每个 Boss 节点完全同构。** 即：Personal Boss 和 CEO Boss 是同一个二进制，只是配置不同。

### 1.2 节点内部结构

```
┌─────────────────────────────────────┐
│           Agent Boss Node           │
│  ┌─────────────┐ ┌─────────────┐  │
│  │ Upstream    │ │ Downstream  │  │
│  │ (上报结果)   │ │ (委派任务)   │  │
│  │ WebSocket   │ │ WebSocket   │  │
│  │ Client      │ │ Server      │  │
│  └──────┬──────┘ └──────┬──────┘  │
│         │               │         │
│  ┌──────┴───────────────┴──────┐  │
│  │      Core Orchestrator      │  │
│  │  ┌─────────┐ ┌──────────┐  │  │
│  │  │ Task    │ │ Judge    │  │  │
│  │  │ Queue   │ │ Panel    │  │  │
│  │  └────┬────┘ └────┬─────┘  │  │
│  │       │           │         │  │
│  │  ┌────┴───────────┴─────┐  │  │
│  │  │   Worker Agents      │  │  │
│  │  │  ┌────┐┌────┐┌────┐  │  │  │
│  │  │  │ C  ││ X  ││ O  │  │  │  │
│  │  │  │ l  ││ e  ││ p  │  │  │  │
│  │  │  │ a  ││ d  ││ e  │  │  │  │
│  │  │  │ u  ││ e  ││ n │  │  │  │
│  │  │  │ d  ││ x  ││ C  │  │  │  │
│  │  │  │ e  ││   ││ l  │  │  │  │
│  │  │  └────┘└────┘└────┘  │  │  │
│  │  └──────────────────────┘  │  │
│  └─────────────────────────────┘  │
└─────────────────────────────────────┘
```

---

## 二、核心协议：ABCP (Agent Boss Communication Protocol)

### 2.1 协议栈

```
┌──────────────────────────────┐
│      Application Layer       │  ← JSON-RPC 2.0
│  boss.delegate / boss.report │
├──────────────────────────────┤
│       Session Layer          │  ← Task ID + 层级追踪
│  task-2026-001 → t-001-a    │
├──────────────────────────────┤
│      Transport Layer         │  ← WebSocket (默认)
│  ws://host:port/abcp         │
├──────────────────────────────┤
│       Discovery Layer        │  ← mDNS / 配置文件
│  _agent-boss._tcp.local      │
└──────────────────────────────┘
```

### 2.2 消息类型

```typescript
// 委派任务 (上级 → 下级)
interface DelegateMessage {
  jsonrpc: "2.0";
  method: "boss.delegate";
  params: {
    taskId: string;           // 全局唯一
    parentTaskId?: string;    // 父任务（递归关键）
    type: TaskType;
    description: string;
    context: Context;
    priority: "low" | "medium" | "high" | "critical";
    deadline?: ISOString;
    requiredAgents?: string[]; // 指定用哪些 agent
  };
}

// 上报结果 (下级 → 上级)
interface ReportMessage {
  jsonrpc: "2.0";
  method: "boss.report";
  params: {
    taskId: string;
    agentId: string;
    status: "completed" | "failed" | "partial";
    result: Result;
    subTasks?: SubTask[];     // 如果拆分了子任务
    metrics: {
      timeSpent: number;      // 秒
      tokensUsed: number;
      cost?: number;          // 美元
    };
  };
}

// 状态查询 (任意方向)
interface StatusMessage {
  jsonrpc: "2.0";
  method: "boss.status";
  result: {
    nodeId: string;
    nodeType: "personal" | "department" | "organization";
    agents: AgentStatus[];
    queue: QueuedTask[];
    childNodes?: string[];    // 下属 Boss 列表
  };
}

// 评判通知 (上级 → 下级，或同级)
interface JudgeMessage {
  jsonrpc: "2.0";
  method: "boss.judge";
  params: {
    taskId: string;
    agentId: string;
    score: "A+" | "A" | "B" | "C" | "D";
    comment: string;
    judgeBy: string;          // 谁评判的
  };
}
```

---

## 三、递归任务流转

### 3.1 任务拆解算法

```typescript
function handleTask(task: Task, boss: AgentBoss): Promise<Result> {
  // 1. 判断是否需要拆解
  if (shouldBreakDown(task)) {
    // 拆解为子任务
    const subTasks = breakDown(task);
    
    // 2. 委派给下属
    const promises = subTasks.map(sub => {
      if (hasChildBosses(boss)) {
        // 有下属 Boss，递归委派
        return delegateToChildBoss(sub);
      } else {
        // 没有下属 Boss，自己执行
        return executeWithWorkers(sub);
      }
    });
    
    // 3. 等待所有子任务
    const results = await Promise.all(promises);
    
    // 4. 合并结果
    return mergeResults(results);
  } else {
    // 直接执行
    return executeWithWorkers(task);
  }
}
```

### 3.2 流转示例

```
用户 → CEO Boss:
"开发一个电商推荐系统"
       ↓
CEO Boss 拆解：
  ├── "前端界面" → delegate 给 前端-Boss
  ├── "后端 API" → delegate 给 后端-Boss
  └── "推荐算法" → delegate 给 算法-Boss
       ↓
前端-Boss 收到后拆解：
  ├── "商品列表页" → delegate 给 dev1-Personal-Boss
  └── "购物车页"   → delegate 给 dev2-Personal-Boss
       ↓
dev1-Personal-Boss 收到后执行：
  ├── Claude Code: "写 React 组件"
  └── Codex:       "写样式文件"
       ↓
结果逐层上报：
  dev1 → 前端-Boss → CEO Boss → 用户
```

---

## 四、技术栈（更新）

| 层级 | 选型 | 理由 |
|------|------|------|
| **Runtime** | Node.js + TypeScript | 异步/事件驱动，WebSocket 原生支持 |
| **协议** | JSON-RPC 2.0 over WebSocket | 标准、双向、可跨语言 |
| **发现** | mDNS + 配置文件 | 本地网络自动发现 + 云端手动配置 |
| **存储** | SQLite (local) | 零配置，任务历史 + 评判记录 |
| **CLI** | `ink` (React for CLI) | 递归 tree 视图需要组件化 |
| **配置** | YAML | 层级配置可读性高 |

---

## 五、配置文件（递归配置）

```yaml
# ~/.agent-boss/config.yaml

# === 节点身份 ===
node:
  id: "frontend-boss-01"
  type: "department"        # personal / department / organization
  name: "前端组 Boss"
  endpoint: "ws://0.0.0.0:3001"

# === 上级节点 ===
upstream:
  enabled: true
  parentEndpoint: "ws://192.168.1.100:3000"  # CEO Boss
  heartbeatInterval: 30                     # 秒

# === 下级节点 ===
downstream:
  enabled: true
  childBosses:
    - id: "dev1-boss"
      name: "开发1"
      endpoint: "ws://192.168.1.101:3002"
    - id: "dev2-boss"
      name: "开发2"
      endpoint: "ws://192.168.1.102:3002"

# === Worker Agents (个人级) ===
agents:
  claude-code:
    type: cli
    command: claude
    
  codex:
    type: cli
    command: codex
    
  openclaw:
    type: websocket
    url: ws://127.0.0.1:18789

# === 任务拆解规则 ===
rules:
  - name: "代码任务默认拆解"
    condition: "task.type == 'coding' AND task.complexity > 5"
    action: "break_down"
    subTasks:
      - "{task.name}-design: 设计文档"
      - "{task.name}-impl: 实现"
      - "{task.name}-test: 测试"
```

---

## 六、关键难点

| 难点 | 方案 |
|------|------|
| **任务拆解智能** | 先用规则引擎（YAML），未来接入 LLM 自动拆解 |
| **循环依赖** | 任务 ID 全局唯一，带层级前缀，防环检测 |
| **结果合并** | 定义标准 merge 策略（代码用 git merge，文档用 concat） |
| **权限越界** | 上级只能 delegate 给直属下级，不能跨级 |
| **故障隔离** | 某个 Boss 挂了，任务自动重试或上报失败 |

---

## 七、实现顺序

### Phase 1：个人级 Boss（1 周）
- Agent 发现 + CLI 交互
- 单发/多发/对比/评判

### Phase 2：递归协议（1 周）⭐
- WebSocket Server/Client
- JSON-RPC 协议实现
- delegate / report 消息流

### Phase 3：多节点组网（1 周）⭐
- Boss 注册/发现
- 任务自动拆解
- 结果合并上报

### Phase 4：企业级（未来）
- Web Dashboard（组织架构图）
- RBAC 权限
- 审计日志

---

## 八、递归的意义（技术视角）

传统 Multi-Agent 框架 = **星型拓扑**（一个中心管所有）

```
    ┌── Agent 1
    ├── Agent 2
User ─┼── Agent 3
    ├── Agent 4
    └── Agent 5
```

Agent Boss = **树型拓扑**（递归分层，无中心瓶颈）

```
        CEO Boss
       /    |    \
  Dept A  Dept B  Dept C
   / \      |      / \
  P1 P2    P3    P4  P5
```

**优势：**
1. **无限扩展**：加人？加一层 Boss 就行，不用改架构
2. **局部自治**：前端组内部怎么玩，CEO 不需要管
3. **故障隔离**：某个 Personal Boss 挂了，只影响那个人的 Agent
4. **异构兼容**：不同部门可以用不同技术栈，只要协议兼容

---

## 九、下一步

1. 确认递归设计是否过头？还是先把个人级跑起来？
2. 如果要递归，先写 ABCP 协议层还是先做个人级 MVP？
