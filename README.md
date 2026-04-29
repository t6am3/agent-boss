# Agent Boss

> 管理 AI 劳动力和模型资产的任务监工台。

## 文档

| 文档 | 位置 | 状态 |
|------|------|------|
| **产品需求文档 (PRD v0.4)** | `docs/PRD.md` | 活跃草案 |
| **技术方案 (TECH-SPEC v0.4)** | `docs/TECH-SPEC.md` | 活跃草案 |
| **项目规范** | `AGENTS.md` | 活跃 |

## 核心理念

Agent Boss 的第一性目标不是让多个 Agent 同时回答问题，而是让用户像老板一样只提目标，由 Boss 管理过程。

```
Owner 提目标
    ↓
Agent Boss 管过程：资产、派发、进度、确认、验收、汇报
    ↓
Worker Agents 执行：Codex / Claude Code / OpenClaw / Hermes / ...
    ↓
结果、成本、质量、经验沉淀回组织记忆
```

## 核心概念

- **Mission**：一个需要被管理到结束的目标，不只是一次 query。
- **Asset Ledger**：集中登记 agent、model、coding plan、token/额度、成本偏好和适用场景。
- **Supervisor Policy**：Boss 默认代替用户处理琐碎确认，只在钱、权限、破坏性操作上升级给用户。
- **Mission Status Board**：终端里的老板视角状态板，展示进度、风险、资源消耗和下一步。
- **Report**：按需或定期汇报目标、完成度、阻塞、风险、资源使用和是否需要用户介入。

## 长期愿景

Agent Boss 可以从个人 AI 资产监工台，逐步演进成真正的 Agent 公司：

- **个人级**：Personal Boss 管理个人 AI 资产和 Mission。
- **团队级**：Department Boss 管理多个 Personal Boss。
- **公司级**：CEO Boss 管理多个 Department Boss，目标自上而下，结果逐层上报。

## 技术栈

- Runtime: Node.js + TypeScript
- Protocol: JSON-RPC 2.0 over WebSocket (ABCP)
- Storage: SQLite
- CLI: ink (React for Terminal)

## 当前状态

✅ **PRD v0.4 已重写** — 2026-04-29

- 产品核心从“多 Agent 编排器”调整为“AI 监工台”。
- P0 MVP 聚焦：资产台账、Mission 创建、终端状态板、确认拦截、进度追问、结果沉淀。
- PRD v0.3 已归档到 `archive/PRD-v0.3-superseded-by-v0.4.md`。

✅ **TECH-SPEC v0.4 已对齐**

- 技术方案已围绕 `Mission`、`Asset Ledger`、`Supervisor Policy` 和 `Mission Status Board` 重写。
- 下一步可以进入 P0 本地 CLI 监工台实现。

⚠️ **现有代码将归档重写**

- 当前 `src/` 是 v0.3 风格历史骨架。
- 这套代码不作为 v0.4 实现依据；实现 P0 前先归档到 `archive/src-v0.3-task-router/`。
- 新 `src/` 从 Mission、Asset、Supervisor、Reporter 开始重写。
- TypeScript 依赖问题已解决：此前是全局 `npm config omit=["dev"]` 导致 devDependencies 被跳过，使用 `npm install --omit=none` 可覆盖。

## 下一步

1. 归档旧 `src/`，重建干净的 v0.4 `src/`。
2. 实现 SQLite 存储和 v0.4 核心类型。
3. 优先实现 `assets`、`mission create`、`mission status`、`mission report`、`judge`。

---

*作者: 刘幼峰 + Codex*
