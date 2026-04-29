# Agent Boss

> 管理 AI 劳动力和模型资产的任务监工台。

## 文档

| 文档 | 位置 | 状态 |
|------|------|------|
| **产品需求文档 (PRD v0.4)** | `docs/PRD.md` | 活跃草案 |
| **技术方案 (TECH-SPEC v1.0)** | `docs/TECH-SPEC.md` | 待按 PRD v0.4 对齐 |
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

⚠️ **技术方案待对齐**

- `docs/TECH-SPEC.md` 仍基于 PRD v0.3，可作为历史参考。
- 下一步需要把技术方案从 `ask/query` 优先改为 `mission/status/assets` 优先。

✅ **代码骨架可编译**

- 当前代码仍是 v0.3 风格骨架：RouterEngine / JudgePanel / ResultCollector / AgentBoss。
- 已在本地验证 `npm install` 和 `npm run build` 可通过。
- TypeScript 依赖问题已解决：此前是全局 `npm config omit=["dev"]` 导致 devDependencies 被跳过，使用 `npm install --omit=none` 可覆盖。

## 下一步

1. 基于 PRD v0.4 重写 TECH-SPEC。
2. 调整 Milestone 1：优先实现 `assets`、`mission create`、`mission status`、`mission report`。
3. 再把已有 `ask`、`judge`、`profile` 能力接入 Mission 和资产沉淀。

---

*作者: 刘幼峰 + Codex*
