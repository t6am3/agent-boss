# Agent Boss — 递归层扩展设计 v1.3

> 版本：v1.3
> 日期：2026-04-29
> 状态：草案（远期规划）
> 作者：大雄（kimi-2.5）
> 基于：架构 v1.0 + 核心模块 v1.1

---

## 一、核心思想

**Agent Boss 节点是同构的。**

Personal Boss 和 CEO Boss 是同一个程序，只是配置不同：
- **Personal Boss**：管理 Worker Agent（Claude/Code/OpenClaw/Hermes）
- **Department Boss**：管理 Personal Boss
- **CEO Boss**：管理 Department Boss

每个节点只做四件事：
1. **接收** — 从上级接收任务
2. **拆解** — 拆解为子任务
3. **委派** — 委派给下级
4. **上报** — 收集结果，合并上报

---

## 二、从个人级到组织级的演进

### 2.1 演进路线

```
Phase 1: Personal Boss（已设计完成）
  └─ 管理 Worker Agents
     ├─ ask → 单发
     ├─ ask all → 广播
     ├─ compare → 对比
     ├─ judge → 评判
     └─ group → 群组讨论

Phase 2: Department Boss（扩展）
  └─ 管理 Personal Bosses
     ├─ delegate → 委派任务给下属 Boss
     ├─ tree → 查看组织架构
     ├─ report → 收集下属结果
     └─ inter-boss → 跨部门协作

Phase 3: CEO Boss（扩展）
  └─ 管理 Department Bosses
     ├─ delegate → 项目级委派
     ├─ dashboard → 全局视图
     └─ strategy → 基于数据的资源调配
```

### 2.2 同构接口

```typescript
interface BossNode {
  // 身份
  nodeId: string;
  nodeType: "personal" | "department" | "organization";
  
  // 向上接口（接收 + 上报）
  receiveTask(task: Task): Promise<void>;
  reportResult(result: Result): void;
  
  // 向下接口（拆解 + 委派）
  delegate(task: Task, target: string): Promise<Result>;
  getSubordinates(): BossNode[];
  
  // 状态
  status(): BossStatus;
}
```

**Personal Boss 实现了 BossNode，但它没有 subordinates（Worker Agent 不算 subordinate，算工具）。**

### 2.3 通信协议

```
┌──────────────┐      delegate(task)       ┌──────────────┐
│  Parent Boss │  ──────────────────────▶  │  Child Boss  │
│              │                            │              │
│              │  ◀───────────────────────  │              │
│              │      report(result)        │              │
└──────────────┘                            └──────────────┘

传输层：JSON-RPC 2.0 over WebSocket
消息格式：见 v1.0 架构中的 ABCP 协议
```

---

## 三、Department Boss 设计

### 3.1 职责

Department Boss = Personal Boss + 下属管理。

```typescript
class DepartmentBoss extends PersonalBoss {
  // 新增：下属 Boss 列表
  private children: Map<string, BossClient>;
  
  // 新增：任务拆解策略
  private taskBreaker: TaskBreaker;
  
  // 覆盖：接收任务后自动拆解
  async receiveTask(task: Task): Promise<void> {
    if (this.canHandle(task)) {
      // 自己能做，直接做
      return super.receiveTask(task);
    }
    
    // 拆解为子任务
    const subTasks = this.taskBreaker.break(task);
    
    // 委派给下属
    const results = await Promise.all(
      subTasks.map(sub => this.delegateToChild(sub))
    );
    
    // 合并结果
    const merged = this.mergeResults(results);
    
    // 上报给上级
    this.reportToParent({
      taskId: task.id,
      status: "completed",
      result: merged,
    });
  }
}
```

### 3.2 任务拆解策略

**规则引擎（先做这个）：**

```yaml
# ~/.agent-boss/rules.yaml
task_breakdown:
  - name: "前端项目"
    condition: "task.tags contains 'frontend'"
    sub_tasks:
      - "ui-design: UI 设计"
      - "component-dev: 组件开发"
      - "api-integration: API 对接"
      - "e2e-test: 端到端测试"
    
  - name: "后端 API"
    condition: "task.tags contains 'backend'"
    sub_tasks:
      - "api-design: 接口设计"
      - "db-schema: 数据库设计"
      - "impl: 实现"
      - "unit-test: 单元测试"
```

**LLM 自动拆解（未来）：**

```typescript
class LLMTaskBreaker implements TaskBreaker {
  async break(task: Task): Promise<SubTask[]> {
    const prompt = `
请将以下任务拆解为 3-5 个子任务，每个子任务应有明确的交付物和验收标准。

任务：${task.description}

输出格式（JSON）：
[
  { "name": "子任务名", "description": "描述", "deliverable": "交付物" }
]
`;
    
    const response = await llm.chat(prompt);
    return JSON.parse(response);
  }
}
```

### 3.3 结果合并策略

| 场景 | 合并方式 |
|------|---------|
| 代码项目 | git merge / 文件系统合并 |
| 文档 | 章节拼接 |
| 数据 | 表合并 |
| 方案 | 取最佳（基于评判） |

```typescript
function mergeResults(results: Result[]): Result {
  const types = results.map(r => r.type);
  
  if (types.every(t => t === "code")) {
    return mergeCode(results);
  }
  
  if (types.every(t => t === "document")) {
    return mergeDocument(results);
  }
  
  // 默认：返回结构化汇总
  return {
    type: "summary",
    content: results.map(r => `[${r.agentId}]\n${r.content}`).join("\n\n---\n\n"),
  };
}
```

---

## 四、组织架构配置

### 4.1 配置格式

```yaml
# ~/.agent-boss/org.yaml
node:
  id: "frontend-dept"
  type: "department"
  name: "前端组"
  endpoint: "ws://localhost:3001"

parent:
  id: "tech-cto"
  endpoint: "ws://localhost:3000"
  heartbeat_interval: 30

children:
  - id: "dev-alice"
    name: "Alice"
    endpoint: "ws://localhost:3002"
    role: "senior"
    
  - id: "dev-bob"
    name: "Bob"
    endpoint: "ws://localhost:3003"
    role: "junior"

workers:
  # Personal Boss 层：直接管理 Worker Agent
  claude-code:
    type: cli
    command: claude
    
  codex:
    type: cli
    command: codex
```

### 4.2 树形视图

```bash
> tree

CEO-Boss (tech-cto)
├── 前端组 (frontend-dept)
│   ├── Alice (dev-alice)
│   │   └── agents: claude, codex
│   └── Bob (dev-bob)
│       └── agents: claude, codex
│
├── 后端组 (backend-dept)
│   ├── Charlie (dev-charlie)
│   │   └── agents: claude, openclaw
│   └── David (dev-david)
│       └── agents: codex, openclaw
│
└── 算法组 (algo-dept)
    └── Eve (dev-eve)
        └── agents: claude, codex, hermes
```

---

## 五、跨部门协作

### 5.1 场景

前端组需要和后端组协商 API 接口。

### 5.2 实现

```
用户: inter-boss "frontend-dept" "backend-dept" "设计用户 API"

Frontend Dept Boss:
  "我们需要：
   - GET /users/:id (带头像URL)
   - POST /users (创建)
   - PATCH /users/:id (更新)"

Backend Dept Boss:
  "可以，但：
   - 头像URL走CDN，不要直接存
   - 创建用户要验证手机号
   - 更新操作需要审计日志"

Frontend Dept Boss:
  "审计日志会影响响应时间吗？"

Backend Dept Boss:
   "异步写入，不影响。"

✅ 达成协议
   - 生成 API 文档
   - 双方确认
   - 上报给用户
```

### 5.3 技术实现

```typescript
async function interBossDiscussion(
  deptA: DepartmentBoss,
  deptB: DepartmentBoss,
  topic: string
): Promise<DiscussionResult> {
  const room = new InterBossRoom(deptA, deptB);
  
  // 并行发送给两个部门
  const [viewA, viewB] = await Promise.all([
    deptA.discuss(topic),
    deptB.discuss(topic),
  ]);
  
  // 多轮协商
  for (let round = 1; round <= 5; round++) {
    const responseA = await deptA.respondTo(viewB, round);
    const responseB = await deptB.respondTo(viewA, round);
    
    room.addMessage(deptA.id, responseA);
    room.addMessage(deptB.id, responseB);
    
    if (isAgreement(responseA, responseB)) break;
  }
  
  return room.summarize();
}
```

---

## 六、与当前架构的关系

### 6.1 当前架构（v1.0）已预留的扩展点

```typescript
// Task 已有 parentTaskId（未使用）
interface Task {
  id: string;
  parentTaskId?: string;  // ← 递归预留
  // ...
}

// Agent 可扩展 children（未使用）
interface Agent {
  id: string;
  children?: Agent[];  // ← 递归预留
  // ...
}
```

### 6.2 需要新增的部分

| 模块 | 当前状态 | 递归层新增 |
|------|---------|-----------|
| Router Engine | 本地函数调用 | JSON-RPC over WebSocket |
| Task Store | SQLite 本地 | 分布式/同步机制 |
| Agent Profile | 本地积累 | 跨节点共享 |
| CLI | 单机命令 | 远程节点管理命令 |

### 6.3 渐进式实现

```
Step 1: 单机多 agent（已完成设计）
        │
Step 2: 单机多 boss（一个进程里跑多个 Boss 实例）
        │
Step 3: 局域网多 boss（WebSocket 直连）
        │
Step 4: 广域网多 boss（加认证 + 心跳）
        │
Step 5: 云服务多 boss（负载均衡 + 持久化）
```

---

## 七、风险

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 网络分区 | 中 | 高 | 心跳检测 + 自动重连 |
| 任务死锁 | 低 | 高 | 超时机制 + 任务 ID 防环 |
| 结果合并冲突 | 中 | 中 | 定义明确的 merge 策略 |
| 权限越界 | 低 | 高 | 层级权限校验 |

---

## 八、下一步

1. **先跑通个人级 MVP**（v1.0 + v1.1 + v1.2）
2. **再叠递归层**：从单机多 boss 开始
3. **通信协议**：先实现本地进程间通信，再扩展到 WebSocket

---

*本设计由 大雄（kimi-2.5）基于架构 v1.0 + 核心模块 v1.1 推导，日期 2026-04-29。*
*递归层为远期规划，当前优先级：P2。*
