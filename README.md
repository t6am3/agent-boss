# Agent Boss

> 递归型多 Agent 编排器 —— Agent 管理 Agent，无限层级扩展

## 愿景

**不是一个工具，而是一个组织。**

Agent Boss 是一套递归的多 Agent 编排协议。每个 Agent Boss 实例既可以管理下属 Agent，也可以被更高层的 Agent Boss 管理。

- **个人级**：管理 4 个 Worker Agent（Codex / Claude / OpenClaw / Hermes）
- **团队级**：一个「组长 Agent Boss」管理多个「个人 Agent Boss」
- **公司级**：一个「CEO Agent Boss」管理多个「组长 Agent Boss」

## 文档

- **产品需求文档 (PRD)**：[飞书云文档](https://feishu.cn/docx/CnKKdNRiUoCXfxxnnAlcL88anAh)
- **技术方案 (TECH-SPEC)**：[飞书云文档](https://feishu.cn/docx/V4MndBj6KofS2RxErh3cxJn6nhd)

> ⚠️ 如果文档链接无法访问，请先联系文档所有者设置公开权限。

## 核心特性

| 特性 | 说明 |
|------|------|
| **递归架构** | 每个 Boss 节点同构，可被更高层管理 |
| **Agent 自动发现** | 自动检测本机 Claude Code / Codex / OpenClaw / Hermes |
| **Query 路由** | 单发、多发、广播三种模式 |
| **评判系统** | 人工打分 + 历史排行榜 |
| **群组讨论** | 多 Agent 在同一个线程里互相交流 |
| **任务委派** | 自动拆解任务，委派给下属 Boss 或 Worker Agent |
| **结果上报** | 逐层汇总，最终返回给用户 |

## 快速开始

```bash
# 克隆仓库
git clone https://github.com/t6am3/agent-boss.git
cd agent-boss

# 安装依赖
npm install

# 启动 Agent Boss
npm start

# 查看可用 Agent
> agents

# 单发查询
> ask claude "fix this bug"

# 多发对比
> ask claude,codex "write a retry decorator"

# 评判打分
> judge 1 A+ "最简洁"

# 群组讨论
> group claude+codex "which design pattern fits here?"
```

## CLI 命令

```bash
agents                      # 查看所有 agent 状态
ask <agent> <query>         # 单发查询
ask <a1,a2> <query>         # 多发对比
ask all <query>             # 广播给所有
compare <id1,id2>           # 并排对比结果
judge <id> <score> "<comment>"  # 打分（A+/A/B/C/D）
group <a1+a2> <topic>       # 创建讨论组
group stop <room-id>        # 结束讨论
tree                        # 查看组织架构（递归模式）
status <boss-name>          # 查看 Boss 状态
delegate <boss> <task>      # 委派任务给下属 Boss
```

## 架构

```
CEO Boss ──→ 部门 Boss ──→ 个人 Boss ──→ Worker Agent
    ↑___________________________________________↓
                    (结果上报)
```

## 技术栈

- **Runtime**: Node.js + TypeScript
- **协议**: JSON-RPC 2.0 over WebSocket (ABCP)
- **CLI**: Ink (React for CLI)
- **存储**: SQLite
- **配置**: YAML

## 开发计划

| 里程碑 | 内容 | 时间 |
|--------|------|------|
| Milestone 1 | 个人级 MVP（Agent 发现 + 路由 + 评判） | 1 周 |
| Milestone 2 | 递归协议（Boss 注册 + 委派 + 上报） | 1 周 |
| Milestone 3 | 多节点组网（跨 Boss 协作 + 审计） | 1 周 |
| Milestone 4 | 企业级（Web Dashboard + RBAC） | 未来 |

## License

MIT
