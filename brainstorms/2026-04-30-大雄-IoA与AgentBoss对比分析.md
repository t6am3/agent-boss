# IoA (Internet of Agents) 深度调研 — 与 Agent Boss 的关系分析

**调研时间**: 2026-04-30 深夜（heartbeat 静默工作）
**调研者**: 大雄
**来源**: arXiv 2407.07061 + GitHub OpenBMB/IoA

---

## 一、IoA 是什么

IoA 是清华 OpenBMB 实验室提出的**智能体互联网框架**。核心理念：让异构 AI Agent 像人类在互联网上协作一样，自动发现彼此、组队、分工、异步执行。

它不是单个更强的 Agent，而是**Agent 协作的"协议层"**——就像 TCP/IP 让不同设备能互联一样，IoA 让不同架构、不同工具、不同知识源的 Agent 能协作。

---

## 二、IoA 核心架构

### 2.1 两层架构

```
Server（中心协调器）          Client（Agent 包装器）
├── Interaction Layer         ├── Interaction Layer
│   ├── Agent Query（发现）     │   ├── Team Formation（组队）
│   ├── Group Setup（建群）      │   └── Communication（通信）
│   └── Message Routing（路由） ├── Data Layer
├── Data Layer                  │   ├── Agent Contact（联系人）
│   ├── Agent Registry（注册表） │   ├── Group Info（群组信息）
│   └── Session Management      │   └── Task Management（任务跟踪）
└── Foundation Layer            └── Foundation Layer
    ├── Data Infrastructure         ├── Agent Integration（集成协议）
    ├── Network Infrastructure     ├── Data Infrastructure
    └── Security Block            └── Network Infrastructure
```

### 2.2 三大关键机制

| 机制 | 说明 | 类比 |
|------|------|------|
| **Agent 注册与发现** | Agent 注册时提交能力描述，其他 Agent 用 `search_client` 按关键词语义匹配找队友 | 互联网 DNS + 搜索引擎 |
| **自主嵌套团队组建** | Agent 发现需要额外 expertise 时，自动创建子群组（sub-group chat），形成树状结构 | 公司项目组 → 子项目组 |
| **对话流控制（FSM）** | 5 状态有限状态机管理群聊：discussion → sync/async assign → pause → conclusion | 会议议程管理器 |

### 2.3 FSM 对话状态（核心设计）

- **s_d (Discussion)**: 头脑风暴、交换想法、澄清需求
- **s_s (Synchronous Task Assignment)**: 同步分配任务，群聊暂停等待完成
- **s_a (Asynchronous Task Assignment)**: 异步分配，不中断当前讨论，并行执行
- **s_p (Pause & Trigger)**: 等待指定异步任务完成后再继续
- **s_c (Conclusion)**: 最终总结，结束协作

状态转换由 LLM 自主决定：`f_LLM: (消息历史, 当前状态) → (下一状态, 下一发言者)`

---

## 三、实验结果（关键数字）

### 3.1 GAIA 基准（真实世界问答）

| 方法 | Overall |
|------|---------|
| GPT-4 | 6.06% |
| AutoGPT-4 | 4.85% |
| AutoGen | 39.39% |
| **IoA (4 个基础 ReAct Agent)** | **40.00%** ✅ |

IoA 用 4 个基础 ReAct Agent（浏览器/代码解释器/Wikidata/YouTube 下载器）超越了所有基线，包括 AutoGen。

### 3.2 开放域指令（AutoGPT + Open Interpreter 协作）

- IoA vs AutoGPT: **76.5% 胜率**
- IoA vs Open Interpreter: **63.4% 胜率**

### 3.3 RAG 问答（知识异构）

GPT-3.5 的 IoA 在 4 个数据集上**整体媲美 GPT-4**（0.610 vs 0.611）：

| 方法 | TriviaQA | NQ | HotpotQA | 2WikiMultiHop |
|------|----------|-----|----------|---------------|
| GPT-4 | 0.902 | 0.692 | 0.566 | 0.284 |
| **IoA + 2 Agents (异构)** | **0.803** | **0.708** | 0.478 | **0.449** |
| **IoA + 3 Agents (同构)** | **0.908** | 0.682 | 0.575 | 0.519 |

**关键发现**：异构知识（不同 Agent 访问不同数据源）有时比同构更好——说明知识多样性有价值。

### 3.4 成本分析

| 设置 | 每任务成本 |
|------|-----------|
| AutoGPT 单机 | $0.39 |
| Open Interpreter 单机 | $0.16 |
| **IoA 整体** | **$0.99** |
| IoA 整体（去重后） | $0.74 |

**主要成本来源**：通信开销（$0.53/任务）。Agent 会重复/改述之前的发言，导致 token 浪费。去重后成本降 50%。

---

## 四、IoA 的局限

1. **通信成本高**: Agent 废话多，50% token 浪费在重复发言
2. **无中央管理者**: Agent 自己管理对话状态和组队，缺乏"老板视角"的进度追踪和汇报
3. **无任务沉淀**: 每次任务结束后没有历史画像积累，下次组队还是从零开始
4. **无权限拦截**: Agent 可以自主决定一切，没有"钱/权限/破坏性操作必须升级给 Owner"的机制
5. **实验规模有限**: 最多 3-4 个 Agent 协作，大规模场景未验证

---

## 五、与 Agent Boss v0.4 的对比

### 5.1 定位差异

| 维度 | IoA | Agent Boss v0.4 |
|------|-----|-----------------|
| **角色关系** | Agent 之间平等协作 | Owner → Boss → Worker Agent 层级管理 |
| **核心问题** | "异构 Agent 怎么互相发现和对话" | "老板怎么管理 AI 劳动力，不被琐事打扰" |
| **控制权** | 分布式，Agent 自治 | 集中式，Boss 决策 |
| **通信协议** | 标准化消息协议（header + payload） | 通过各 Agent 原生 CLI 调用（`codex exec`/`claude -p`） |
| **任务管理** | FSM 状态机管理群聊 | Mission 状态机 + Supervisor 决策拦截 |
| **历史沉淀** | ❌ 无 | ✅ EvaluationEngine 记录评分 |
| **成本意识** | ❌ 无 | ✅ AssetLedger 记录 plan/token 消耗 |
| **Owner 隔离** | ❌ Agent 全权处理 | ✅ Supervisor Policy 拦截琐碎确认 |

### 5.2 互补性分析

**IoA 强的地方，Agent Boss 弱：**
- IoA 有标准化的 Agent 集成协议，Agent Boss 的适配器是各自为政（CodexAdapter/ClaudeCodeAdapter/OpenClawAdapter）
- IoA 有 Agent 注册发现机制，Agent Boss 是手动登记 AssetLedger
- IoA 有嵌套团队组建，Agent Boss 目前只有单层 Mission → Worker

**Agent Boss 强的地方，IoA 弱：**
- Agent Boss 有 Owner 视角的汇报和风险升级，IoA 的 Agent 全程自治无汇报
- Agent Boss 有 Supervisor 拦截琐碎确认，IoA 的 Agent 会把所有判断自己做（包括可能不该做的）
- Agent Boss 有 AssetLedger 成本追踪和 EvaluationEngine 历史画像，IoA 没有
- Agent Boss 有自然语言 Boss 终端（`"帮我检查 README"` → 自动执行），IoA 需要编程式调用 API

### 5.3 可能的融合方向

**方向 A：Agent Boss 用 IoA 作为 Worker Agent 接入层**
```
Owner 自然语言输入
  → BossBrain 意图识别
    → BossAgent 创建 Mission
      → MissionRunner 通过 IoA 协议分发任务
        → IoA Server 路由到各 Agent Client
          → Codex / Claude / OpenClaw / Hermes 执行
      → Supervisor 监控 IoA 群聊状态
    → Reporter 向 Owner 汇报
```

好处：Agent Boss 不再需要维护 N 个不同的 Adapter，统一通过 IoA 协议接入。IoA 负责 Agent 发现和组队，Agent Boss 负责管理和汇报。

**方向 B：IoA 的 FSM 对话状态接入 Agent Boss Mission 状态机**

IoA 的 5 种对话状态（discussion/sync/async/pause/conclusion）可以映射到 Agent Boss 的 MissionStage：
- discussion → planning
- sync/async assign → executing
- pause → blocked
- conclusion → completed

Agent Boss 的 Reporter 可以把 IoA 群聊的实时状态展示给 Owner。

**方向 C：Agent Boss 作为 IoA 的"管理员 Agent"**

在 IoA 的框架中，Agent Boss 可以注册为一个特殊 Agent（Manager Agent），拥有：
- 更高的权限（可以查看所有群聊状态）
- 特殊的通信规则（Worker Agent 的 money/permission/destructive 请求必须路由到 Manager）
- 任务分配的最终决策权（覆盖 Agent 的自主组队决定）

---

## 六、对 Agent Boss P0/P1 的启示

### P0（当前）
- Agent Boss 的 Adapter 层可以继续用当前 CLI 调用方式（足够简单直接）
- 但如果未来要支持更多第三方 Agent，考虑兼容 IoA 的 Agent Integration Protocol

### P1（短期）
- **智能选择 Agent**: 可以参考 IoA 的 `search_client` 语义匹配，替代当前的关键词正则
- **嵌套 Mission**: 当前 Mission 是扁平的，可以考虑树状 sub-mission（像 IoA 的嵌套团队）
- **通信成本意识**: IoA 的 $0.99/任务成本是个警示——Agent Boss 应该记录每次 Mission 的 token 消耗，未来做成本优化

### P2（长期）
- 如果 Agent Boss 要做递归组织（Personal → Department → CEO），IoA 的分布式 Server/Client 架构是现成的网络层
- Agent Boss 可以定义自己的消息协议（扩展 IoA 的 header/payload），加入 Supervisor Decision 和 Owner Escalation 字段

---

## 七、结论

IoA 和 Agent Boss 不是竞品，而是**不同层级的互补系统**：

- **IoA = 协议层**（Agent 怎么互联协作）
- **Agent Boss = 管理层**（谁来决策、怎么汇报、如何沉淀）

Agent Boss 的下一步演进可以考虑：
1. 短期：保持现有 Adapter 层，继续完善 Mission/Supervisor/Reporter 核心体验
2. 中期：如果 Worker Agent 种类激增，考虑接入 IoA 的 Agent 注册发现机制
3. 长期：如果要做分布式多 Boss 协作，IoA 的 Server/Client 架构是现成的网络层

**一句话**：IoA 证明了一件事——**异构 Agent 协作可以产生 1+1>2 的效果**。Agent Boss 的价值在于让这种协作"可被管理、可被汇报、可被沉淀"。

---

*本文件为 heartbeat 静默工作产出，非紧急，供用户后续参考。*
