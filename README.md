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
- v0.3 时代的架构计划已归档到 `archive/plans-v0.3/`，不再作为实现依据。

✅ **v0.4 骨架已打样**

- 旧 `src/` 已归档到 `archive/src-v0.3-task-router/`。
- 新 `src/` 已从 Mission、Asset、Supervisor、Reporter 开始重写。
- 当前 CLI 已支持 `assets add/update/list/show`、`mission create/status/watch/log/update/run/report/event/decide/complete`、`judge` 的本地监工闭环。
- `mission run` 已接入 `MockMissionRunner`，可以自动写入 assigned / progress / confirmation_requested / decision / completed events。
- `mission run --runner openclaw` 已接入 OpenClaw CLI，通过 `openclaw agent --json --message ...` 执行真实 agent turn。
- `demo` 可以一键跑完整 MVP；`interactive` 可以进入交互式 shell。
- 支持 `--db <path>` 指向独立 SQLite 文件，方便 dogfood、测试和多工作区隔离。
- TypeScript 依赖问题已解决：此前是全局 `npm config omit=["dev"]` 导致 devDependencies 被跳过，使用 `npm install --omit=none` 可覆盖。

## Quickstart

```bash
npm install --omit=none
npm run build

node dist/cli.js demo
node dist/cli.js interactive

node dist/cli.js assets add codex --type agent --name Codex --plan coding-plan --scenes code,refactor --cost subscription
node dist/cli.js assets add claude-code --type agent --name "Claude Code" --plan pro --scenes review,design --cost subscription
node dist/cli.js assets list

node dist/cli.js mission create "重构登录模块，要求安全、可测试、不要大改架构" --assets codex,claude-code
node dist/cli.js mission list
node dist/cli.js mission update m-001 --stage executing --progress 35 --assignee codex --next "让 reviewer 检查认证边界"
node dist/cli.js mission watch m-001
node dist/cli.js mission log m-001
node dist/cli.js mission run m-001 --runner mock --asset codex --scenario confirmation
node dist/cli.js assets add openclaw --type agent --name OpenClaw --scenes automation,feishu
node dist/cli.js mission run m-001 --runner openclaw --asset openclaw --timeout 120
node dist/cli.js mission decide m-001 "Should I add tests for this refactor?"
node dist/cli.js mission report m-001
node dist/cli.js mission complete m-001 "登录模块重构完成，已补安全边界和测试"
node dist/cli.js judge m-001 A "安全边界处理好，成本可以接受" --assets codex,claude-code
```

本地数据保存在 `.agent-boss/agent-boss.sqlite`，该目录默认不入仓。

## 下一步

1. 将 `MissionRunner` 从 Mock 扩展到真实本地命令型 runner。
2. 按新架构重写 Codex / Claude / OpenClaw adapter。
3. 记录 usage ledger，让每次 run 自动沉淀耗时、资产、结果质量。

---

*作者: 刘幼峰 + Codex*
