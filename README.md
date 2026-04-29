# Agent Boss

> 递归型多 Agent 编排器 — 不是工具，是组织。

## 文档

| 文档 | 位置 | 链接 |
|------|------|------|
| **产品需求文档 (PRD)** | `docs/PRD.md` | https://feishu.cn/docx/CnKKdNRiUoCXfxxnnAlcL88anAh |
| **项目规范** | `AGENTS.md` | — |

## 核心理念

Agent Boss 是一套**递归的多 Agent 编排协议**。每个 Agent Boss 实例既可以管理下属 Agent，也可以被更高层的 Agent Boss 管理。

```
CEO Boss ──→ 部门 Boss ──→ 个人 Boss ──→ Worker Agent
    ↑___________________________________________↓
                    (结果上报)
```

## 愿景

**个人级**：你管理 4 个 Agent（Codex / Claude / OpenClaw / Hermes）  
**团队级**：一个组长 Agent Boss 管理 5 个个人 Agent Boss  
**公司级**：一个 CEO Agent Boss 管理 10 个组长 Agent Boss  

## 核心功能

- **Query 路由**：`ask claude "fix this"` / `ask claude,codex "fix this"`
- **结果对比**：并排展示 + diff 视图
- **评判打分**：`judge 1 A+` → 历史排行榜
- **群组讨论**：`group claude+codex "discuss"`
- **递归委派**：`delegate "前端-Boss" "任务"` → 自动拆解上报

## 技术栈

- Runtime: Node.js + TypeScript
- Protocol: JSON-RPC 2.0 over WebSocket (ABCP)
- Storage: SQLite
- CLI: ink (React for Terminal)

## 项目规范

见 [AGENTS.md](AGENTS.md) — 目录结构、版本管理、Git 工作流、文档质量门槛。

## 状态

✅ **Milestone 1 (个人级 MVP) 代码骨架已完成** — 2026-04-29

- 核心模块：RouterEngine / JudgePanel / ResultCollector / AgentBoss
- 适配器：Codex ✅ / Claude Code ✅ / OpenClaw ⚠️ 骨架
- CLI：完整命令解析
- 编译验证：⚠️ TypeScript 安装受阻（Node 25 / bnpm 兼容性问题），需手动处理

### 已知问题（已解决 ✅）

- ~~TypeScript 编译验证：Node 25 + npm 11 + bnpm 镜像导致 `tsc` 安装受阻~~
- **根因**：`npm config` 全局设置了 `omit=["dev"]`，导致所有 devDependencies 被跳过
- **解决**：`npm install --omit=none` 覆盖该配置
- **验证**：`tsc --noEmit` 0 errors，`tsx src/cli.ts --help` 正常启动
- `@types/ws` 已正确安装

---

*作者: 刘幼峰 + 大雄*
