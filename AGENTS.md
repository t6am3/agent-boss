# Agent Boss — 项目规范

> 版本管理、目录结构、工作流约定

---

## 一、目录结构

```
agent-boss/
├── docs/              # 活跃文档（当前版本在用）
│   ├── PRD.md         # 产品需求文档
│   └── TECH-SPEC.md   # 技术方案（通过评审后放这里）
├── archive/           # 归档（废弃/过期/未通过的文档）
│   ├── TECH-SPEC-v0.2-deprecated.md   # 废弃的技术方案
│   └── ...            # 其他归档文件
├── brainstorms/       # 脑暴记录（发散思考，不直接执行）
│   ├── 2026-04-28-大雄.md
│   └── ...
├── src/               # 源代码（未来创建）
├── tests/             # 测试（未来创建）
├── AGENTS.md          # 本文件 — 项目规范
└── README.md          # 项目入口
```

### 规则

| 目录 | 用途 | 谁决定放进去 |
|------|------|-------------|
| `docs/` | **当前在用**的文档，团队成员需要参考 | 评审通过后由作者 + 至少 1 人确认 |
| `archive/` | **废弃/过期/未通过**的文档，保留历史但不要参考 | 作者或管理者标记废弃时 |
| `brainstorms/` | **发散思考**的脑暴记录，记录灵感但不承诺执行 | 任何人随时可写 |
| `src/` | 源代码 | 编码阶段自然产生 |
| `tests/` | 测试 | 同上 |

**核心原则：**
- `docs/` 里的文件 = 当前唯一可信来源
- `archive/` 里的文件 = 历史垃圾，看一眼知道"这版被否了"就行
- `brainstorms/` 里的文件 = 灵感仓库，随时记录，不承诺落地
- 不允许根目录下散落文档（除了 README 和 AGENTS.md）

---

## 二、脑暴管理 (Brainstorms)

### 2.1 目的

`brainstorms/` 目录用于记录发散性思考、灵感、未来方向。与 `docs/` 的区别：

| | `docs/` | `brainstorms/` |
|--|---------|----------------|
| **性质** | 承诺执行的计划 | 发散思考，不承诺 |
| **评审** | 必须经过评审 | 无需评审，随时写 |
| **更新** | 谨慎修改 | 追加为主，不改旧 |
| **署名** | 团队文档 | 必须署名（人 + AI 模型） |

### 2.2 文件命名规范

```
brainstorms/{YYYY-MM-DD}-{署名}.md

示例：
brainstorms/2026-04-28-大雄.md
brainstorms/2026-05-01-刘幼峰.md
```

### 2.3 文件头部模板

```markdown
# {脑暴主题}

> 日期：{YYYY-MM-DD}
> 脑暴者：{名字}（{AI 模型，如 kimi-2.6 / gpt-4}）
> 主题：{一句话概括}

---

## 1. {点子1}
...

## 2. {点子2}
...

---

*本脑暴记录由 {名字}（{模型}）生成，日期 {YYYY-MM-DD}。*
```

### 2.4 使用规则

1. **任何人随时可写**：不需要等任务分配，有灵感就写
2. **追加不删改**：旧脑暴不修改，新想法写新文件
3. **定期回顾**：每月回顾一次，有价值的点子提炼进 PRD
4. **不直接执行**：脑暴内容必须经过评审才能进 `docs/` 变成计划

---

## 三、版本管理

### 3.1 历史追溯

**所有历史版本必须可恢复。** 两种方式：

| 方式 | 适用场景 | 命令 |
|------|---------|------|
| **Git History** | 查看任意提交的完整文件 | `git show <commit>:docs/PRD.md` |
| **Archive 快照** | 快速对比历史版本差异 | 直接打开 `archive/PRD-v0.2-recursive.md` |

**规则：**
- 活跃文档的大版本更新时，旧版必须留 snapshot 在 `archive/`
- Snapshot 命名：`{文件名}-v{版本号}-{简述}.md`
- 如果某版在提交 git 前就被覆盖（未入 git），视为丢失，需在 AGENTS.md 记录

### 3.2 版本记录表

| 文档 | 版本 | 状态 | 位置 | 可追溯 |
|------|------|------|------|--------|
| PRD | v0.1 | **已丢失** | — | ❌ 未提交 git |
| PRD | v0.2 | 归档 | `archive/PRD-v0.2-recursive.md` | ✅ git + archive |
| PRD | v0.3 | 归档 | `archive/PRD-v0.3-superseded-by-v0.4.md` | ✅ git + archive |
| PRD | v0.4 | 活跃草案 | `docs/PRD.md` | ✅ git |
| TECH-SPEC | v0.2 | 废弃 | `archive/TECH-SPEC-v0.2-deprecated.md` | ✅ git + archive |
| TECH-SPEC | v0.4 | 活跃草案 | `docs/TECH-SPEC.md` | ✅ git |
| AGENTS.md | v1.0 | 活跃 | `AGENTS.md` | ✅ git |

### 3.3 文档版本

每个文档头部必须标注版本：

```markdown
# 文档标题

> 版本：v1.2
> 日期：2026-04-28
> 状态：活跃 / 废弃 / 草案
```

### 3.4 状态流转

```
草案 (Draft) → 评审中 (Review) → 活跃 (Active) → 废弃 (Deprecated)
     ↑_____________________________________________|
     （大改版时回到草案，旧版进 archive）
```

- **草案**：刚写出来，随便改
- **评审中**：等人看，收集反馈
- **活跃**：评审通过，团队按此执行
- **废弃**：被新版本替代，移入 `archive/`

### 3.5 废弃规则

什么情况下文档进 `archive/`：
1. 写了新版本替代旧版本（旧版进 archive，标记版本号）
2. 评审未通过，明确不采用
3. 技术方案过时，不再适用
4. 项目方向变更，原有文档失效

**命名规范：**
```
archive/TECH-SPEC-v0.2-deprecated.md
archive/PRD-v0.1-superseded-by-v0.2.md
```

---

## 四、Git 工作流

### 3.1 提交规范

```
type(scope): subject

body（可选）
```

| type | 用途 |
|------|------|
| `feat` | 新功能 |
| `fix` | 修复 bug |
| `docs` | 文档变更 |
| `refactor` | 重构 |
| `archive` | 文档归档/废弃 |
| `chore` | 杂项 |

**示例：**
```bash
git commit -m "docs: update PRD with recursive architecture"
git commit -m "archive: move TECH-SPEC v0.2 to archive (superseded)"
git commit -m "feat: add agent discovery module"
```

### 3.2 分支策略

```
main        ← 永远可部署/可阅读
  ↑
feature/xxx   ← 功能分支，PR 合并后删除
```

- `main` 分支上的 `docs/` 目录 = 当前唯一可信来源
- 任何文档修改先分支，PR 合并（哪怕自己 PR 自己）
- 不要直接 push main（除非紧急修复）

### 3.3 Tag 规范

```
v0.1.0   # 第一个可用版本
v0.2.0   # 递归架构引入
v1.0.0   # 正式版
```

---

## 五、文档质量门槛

什么文档能进 `docs/`，什么只能留在 `archive/`：

| 检查项 | 活跃文档必须满足 | 草案可以豁免 |
|--------|----------------|-------------|
| 目标读者明确 | ✅ | ⚠️ |
| 验收标准可量化 | ✅ | ⚠️ |
| 技术方案可执行 | ✅ | ⚠️ |
| 没有已知重大漏洞 | ✅ | ❌ |
| 至少 1 人评审通过 | ✅ | ❌ |

**评审方式：**
- PR Review：GitHub PR 里评论
- 飞书评论：直接在云文档里批注
- 口头确认：至少有人说过"这版可以"

---

## 六、项目治理

### 5.1 决策记录 (ADR)

重要技术/产品决策写入 `docs/adr/`：

```markdown
# ADR-001: 递归架构设计

- 状态：已接受
- 日期：2026-04-28
- 决策：采用树型拓扑而非星型拓扑
- 理由：无限扩展 + 局部自治 + 故障隔离
- 替代方案：AutoGen 星型（ rejected：单点瓶颈）
```

### 5.2 变更日志

`CHANGELOG.md` 按版本记录：

```markdown
## v0.3.0 — 2026-04-28
### 新增
- PRD v0.3：聚焦用户需求，去除技术接口
- 5 个拓展方向（路由策略、Agent 画像、组织学习、成本意识、工作流编排）

### 变更
- PRD 从 v0.2 升级至 v0.3

### 废弃
- TECH-SPEC v0.2（技术方案重写中）
```

---

## 七、当前状态

| 文件 | 版本 | 状态 | 位置 |
|------|------|------|------|
| PRD | v0.4 | 活跃草案 | `docs/PRD.md` |
| TECH-SPEC | v0.4 | 活跃草案 | `docs/TECH-SPEC.md` |
| 设计文档 | v1.0-v1.3 | 草案 | `docs/plans/` |
| AGENTS.md | v1.0 | 活跃 | `AGENTS.md` |
| README | v1.0 | 活跃 | `README.md` |

### 设计文档清单

| 版本 | 文档 | 内容 | 状态 |
|------|------|------|------|
| v1.0 | `2026-04-29-system-architecture-design.md` | 系统架构、数据模型、SQLite 表结构、扩展点 | 草案 |
| v1.1 | `2026-04-29-core-modules-design.md` | Router Engine 自动推荐、Judge ELO 评分、Result Collector、Group Chat | 草案 |
| v1.2 | `2026-04-29-adapter-design.md` | Codex/Claude Code/OpenClaw/Hermes 适配器实现细节 | 草案 |
| v1.3 | `2026-04-29-recursive-layer-design.md` | 递归层：同构节点、任务拆解、跨部门协作 | 草案（远期） |

---

## 八、下一步

- [ ] 归档旧 `src/` 到 `archive/src-v0.3-task-router/`，重建干净的 v0.4 `src/`
- [ ] 实现 v0.4 P0：`assets`、`mission create`、`mission status`、`mission report`、`judge`
- [ ] 创建 `docs/adr/` 目录，记录关键决策

---

*本文件由 大雄 编写，刘幼峰 确认。*
