# Agent Boss — 核心模块设计 v1.1

> 版本：v1.1
> 日期：2026-04-29
> 状态：草案（待评审）
> 作者：大雄（kimi-2.5）
> 基于：架构 v1.0 + PRD v0.3

---

## 一、Router Engine — 智能路由引擎

### 1.1 问题定义

用户输入 `ask "优化 SQL"`，系统决定：
1. 发给谁？（单 agent 推荐）
2. 发几个？（是否 A/B 对比）
3. 怎么展示？（流式 or 等全部完成）

### 1.2 路由策略矩阵

```typescript
type RoutingStrategy = 
  | "auto"      // 基于历史评分自动推荐
  | "explicit"  // 用户明确指定（ask claude）
  | "broadcast" // 发给所有（ask all）
  | "compete"   // 2-3 个 agent 竞争上岗
  | "pipeline"; // 流水线：A → B → C

interface RoutingDecision {
  strategy: RoutingStrategy;
  agents: string[];           // 选中的 agent
  reasoning?: string;         // 为什么选这些（展示给用户）
  estimatedTime?: number;     // 预计耗时（秒）
}
```

### 1.3 自动推荐算法

```typescript
function autoRoute(query: string, profiles: AgentProfile[]): RoutingDecision {
  // Step 1: 提取场景标签
  const tags = extractTags(query);  // ["sql", "optimization"]
  
  // Step 2: 查询各 agent 在该场景下的表现
  const candidates = profiles.map(p => ({
    agentId: p.agent_id,
    sceneScore: p.scene_scores[tags[0]]?.avg || 0,
    globalScore: p.avg_score,
    confidence: p.scene_scores[tags[0]]?.count || 0,  // 历史样本数
  }));
  
  // Step 3: 综合排序
  // 场景匹配度权重 70%，全局能力权重 30%
  // 样本数 < 3 时降低置信度，提示用户
  const ranked = candidates
    .map(c => ({
      ...c,
      composite: c.sceneScore * 0.7 + c.globalScore * 0.3,
    }))
    .sort((a, b) => b.composite - a.composite);
  
  const top = ranked[0];
  const hasEnoughData = top.confidence >= 3;
  
  return {
    strategy: hasEnoughData ? "auto" : "compete",
    agents: hasEnoughData ? [top.agentId] : [top.agentId, ranked[1].agentId],
    reasoning: hasEnoughData 
      ? `${top.agentId} 在 "${tags[0]}" 场景下评分 ${top.sceneScore.toFixed(1)}（${top.confidence} 次记录）`
      : `"${tags[0]}" 场景数据不足（仅 ${top.confidence} 次），启动竞争模式对比`,
  };
}
```

### 1.4 场景标签提取

不依赖 LLM，用规则 + 关键词匹配：

```typescript
const SCENE_PATTERNS = {
  "sql-optimization": [/sql/i, /query/i, /database/i, /optimize/i],
  "algorithm-design": [/algorithm/i, /data structure/i, /leetcode/i, /complexity/i],
  "code-review": [/review/i, /refactor/i, /bug/i, /fix/i],
  "architecture": [/architecture/i, /design pattern/i, /microservice/i],
  "frontend-dev": [/react/i, /vue/i, /css/i, /ui/i, /component/i],
  "devops": [/docker/i, /kubernetes/i, /deploy/i, /ci\/cd/i],
  "api-design": [/api/i, /rest/i, /graphql/i, /endpoint/i],
  "testing": [/test/i, /unit test/i, /mock/i, /coverage/i],
};

function extractTags(query: string): string[] {
  const tags: string[] = [];
  for (const [scene, patterns] of Object.entries(SCENE_PATTERNS)) {
    if (patterns.some(p => p.test(query))) {
      tags.push(scene);
    }
  }
  return tags.length > 0 ? tags : ["general"];
}
```

**扩展性**：未来可接入 LLM 做更精细的场景识别，但规则引擎够 MVP 用。

### 1.5 竞争模式（Compete）

当场景数据不足时，自动启动 2 个 agent 竞争：

```
用户: ask "设计一个分布式锁"
系统分析："distributed-system" 场景无历史记录
路由决策：compete（启动 Claude + Codex）
输出：
  [Claude] 设计 A...
  [Codex]  设计 B...

用户评判后 → 记录到 Judge Panel
下次同类问题就有数据了
```

---

## 二、Judge Panel — 评判系统

### 2.1 核心设计原则

**评判不是为了打分，是为了积累知识。**

每次评判应该回答三个问题：
1. **谁更好？** — 相对排名
2. **好在哪？** — 能力标签（系统提取）
3. **在什么场景下？** — 场景绑定

### 2.2 评分体系

| 等级 | 含义 | 积分 |
|------|------|------|
| A+ | 超出预期，最佳实践 | 5 |
| A  | 正确且完整 | 4 |
| B+ | 正确但有瑕疵 | 3.5 |
| B  | 基本完成 | 3 |
| C  | 有缺陷，需修正 | 2 |
| D  | 错误或不可用 | 1 |

**ELO 变体算法：**

```typescript
function updateElo(
  winner: AgentProfile,
  loser: AgentProfile,
  kFactor: number = 32
): void {
  const expectedWin = 1 / (1 + 10 ** ((loser.elo - winner.elo) / 400));
  const expectedLose = 1 / (1 + 10 ** ((winner.elo - loser.elo) / 400));
  
  winner.elo += kFactor * (1 - expectedWin);
  loser.elo += kFactor * (0 - expectedLose);
}
```

### 2.3 自动标签提取

用户评判时输入评论，系统自动提取能力标签：

```typescript
const CAPABILITY_PATTERNS = {
  "边界处理": [/边界/i, /edge case/i, /corner case/i, /空值/i],
  "并发安全": [/并发/i, /线程安全/i, /race condition/i, /lock/i],
  "性能优化": [/性能/i, /optimize/i, /fast/i, /缓存/i, /cache/i],
  "代码简洁": [/简洁/i, /clean/i, /简洁/i, /短/i],
  "架构设计": [/架构/i, /设计模式/i, /可扩展/i, /解耦/i],
  "测试覆盖": [/测试/i, /test/i, /覆盖/i, /coverage/i],
  "文档完善": [/文档/i, /注释/i, /doc/i, /README/i],
  "错误处理": [/错误/i, /异常/i, /error/i, /try catch/i],
};

function extractCapabilities(comment: string): string[] {
  const caps: string[] = [];
  for (const [cap, patterns] of Object.entries(CAPABILITY_PATTERNS)) {
    if (patterns.some(p => p.test(comment))) {
      caps.push(cap);
    }
  }
  return caps;
}
```

### 2.4 Agent Profile 更新逻辑

```typescript
function updateAgentProfile(
  profile: AgentProfile,
  judge: JudgeRecord,
  tags: string[]
): void {
  // 1. 更新全局平均分
  profile.total_tasks += 1;
  const scoreValue = SCORE_MAP[judge.ratings[profile.agent_id].score];
  profile.avg_score = weightedAvg(profile.avg_score, scoreValue, profile.total_tasks);
  
  // 2. 更新场景分数
  for (const tag of tags) {
    const scene = profile.scene_scores[tag] || { avg: 0, count: 0 };
    scene.count += 1;
    scene.avg = weightedAvg(scene.avg, scoreValue, scene.count);
    profile.scene_scores[tag] = scene;
  }
  
  // 3. 更新能力标签
  const caps = extractCapabilities(judge.ratings[profile.agent_id].comment);
  for (const cap of caps) {
    if (!profile.capabilities.includes(cap)) {
      profile.capabilities.push(cap);
    }
  }
  
  // 4. 如果有 winner/loser，更新 ELO
  if (judge.winner) {
    // ... ELO update
  }
}
```

### 2.5 用户可见的 Profile

```bash
> profile claude

┌─ Claude Code ─────────────────────────┐
│ 总分: A- (4.2/5.0)                    │
│ 任务数: 47                            │
│ ELO: 1823                             │
├─ 场景表现 ────────────────────────────┤
│  sql-optimization     A+  (12次)      │
│  algorithm-design     A   (8次)       │
│  architecture         A   (6次)       │
│  code-review          B+  (15次)      │
│  frontend-dev         C+  (3次) ⚠️    │
├─ 能力标签 ────────────────────────────┤
│  ✅ 边界处理  ✅ 并发安全  ✅ 架构设计  │
│  ✅ 错误处理  ❌ 测试覆盖  ❌ 代码简洁  │
└───────────────────────────────────────┘

建议: Claude 在算法和架构任务上表现优异，
      前端开发较弱（3次任务，平均 C+），
      建议前端任务先发 Codex
```

---

## 三、Result Collector — 结果收集与展示

### 3.1 展示模式

| 模式 | 适用场景 | 展示方式 |
|------|---------|---------|
| **流式** | 单发 | 实时滚动输出 |
| **并排** | 多发（2个） | 左右分栏 |
| **列表** | 多发（3+） | 折叠列表 |
| **diff** | 多发对比 | 高亮差异 |
| **对话** | 群组讨论 | 聊天记录式 |

### 3.2 流式展示（单发）

```
> ask claude "优化 SQL"
[Claude] 🟢 连接中...
[Claude] 💭 思考中...
[Claude] 📄 分析：当前查询缺少索引...
[Claude] 📄 建议：添加复合索引 (user_id, created_at)
[Claude] 📄 预计提升：查询时间从 1.2s → 0.05s
[Claude] ✅ 完成 (12.3s, 3,240 tokens)
```

### 3.3 并排展示（多发对比）

```
> ask claude,codex "写 LRU 缓存"

┌─ Claude ─────────────┐  ┌─ Codex ──────────────┐
│ 🟢 完成 (15.2s)      │  │ 🟢 完成 (8.1s)       │
├────────────────────────┤  ├────────────────────────┤
│ class LRUCache:        │  │ class LRUCache:        │
│   def __init__(...):   │  │   def __init__(...):   │
│     self.lock = ... ⚡ │  │     self.cache = {}    │
│     self.capacity = n  │  │     self.capacity = n  │
│                        │  │                        │
│   def get(self, key):  │  │   def get(self, key):  │
│     with self.lock: ⚡  │  │     if key in self.c.. │
│       ...              │  │       ...                │
└────────────────────────┘  └────────────────────────┘

⚡ = 差异点（Claude 加了线程安全，Codex 没有）
```

### 3.4 智能 Diff 生成

```typescript
function generateDiff(resultA: string, resultB: string): DiffBlock[] {
  // 1. 按行对比
  // 2. 识别代码结构差异（函数缺失、参数不同）
  // 3. 识别逻辑差异（边界处理、错误检查）
  // 4. 标记为：新增 / 删除 / 修改 / 同等
  
  return [
    { type: "equal", lines: [1, 5], content: "..." },
    { type: "insert", lines: [6], content: "self.lock = threading.Lock()", agent: "claude" },
    { type: "equal", lines: [7, 12], content: "..." },
  ];
}
```

---

## 四、Group Chat — 群组讨论

### 4.1 讨论模式

| 模式 | 描述 | 适用场景 |
|------|------|---------|
| **轮询** | 每个 agent 轮流发言 | 结构化讨论 |
| **自由** | 任意 agent 可随时发言 | 头脑风暴 |
| **裁判** | 一个 agent 主持，其他辩论 | 方案选择 |

### 4.2 轮询模式实现

```typescript
async function roundRobinDiscussion(
  room: GroupChat,
  topic: string,
  maxRounds: number = 3
): Promise<Message[]> {
  const messages: Message[] = [];
  
  // Round 0: 用户提问
  messages.push({ agent: "user", content: topic });
  
  for (let round = 1; round <= maxRounds; round++) {
    for (const agentId of room.agent_ids) {
      // 构建上下文（包含之前所有发言）
      const context = buildContext(messages);
      
      // 发送给 agent
      const prompt = `讨论主题：${topic}\n\n历史发言：\n${context}\n\n轮到你发言（第 ${round} 轮）。请给出你的观点，可以反驳或补充其他人的意见。`;
      
      const response = await agents[agentId].send(prompt);
      messages.push({ agent: agentId, content: response, round });
      
      // 实时展示
      console.log(`[${agentId}] ${response}`);
    }
  }
  
  return messages;
}
```

### 4.3 讨论终止条件

```typescript
function shouldTerminate(room: GroupChat): boolean {
  // 1. 用户主动 stop
  if (room.userStopped) return true;
  
  // 2. 达成共识（连续 2 轮没有新观点）
  const lastTwoRounds = getLastRounds(room, 2);
  if (isConsensus(lastTwoRounds)) return true;
  
  // 3. 超时（默认 10 分钟）
  if (Date.now() - room.createdAt > 10 * 60 * 1000) return true;
  
  // 4. 轮数上限
  if (room.currentRound >= room.maxRounds) return true;
  
  return false;
}
```

---

## 五、与架构 v1.0 的关系

本版（v1.1）是架构 v1.0 的**核心模块深化**：

| 架构 v1.0 提到 | 本版 v1.1 细化 |
|--------------|---------------|
| Router Engine | 自动推荐算法、场景标签提取、竞争模式 |
| Judge Panel | ELO 评分、自动标签提取、Agent Profile 更新 |
| Result Collector | 4 种展示模式、智能 diff 生成 |
| Group Chat | 轮询/自由/裁判三种模式 |

---

## 六、下一步

1. 用户确认核心模块设计方向
2. 写 Agent Adapter 详细设计（v1.2）
3. 实现 Codex Adapter 作为 POC

---

*本设计由 大雄（kimi-2.5）基于架构 v1.0 推导，日期 2026-04-29。*
