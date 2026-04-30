# EvaluationEngine 历史画像累积 — 设计草案

**日期**: 2026-04-30
**署名**: 大雄（kimi/k2p5）
**类型**: brainstorm（无需 review，追加写入）

---

## 一、现状

`EvaluationEngine.judge()` 目前只做一件事：**插入一条评价记录**。

```typescript
// 当前行为
judge({ missionId, score, comment, assetIds }) 
  → INSERT INTO evaluations (单次记录)
  → addEvent(missionId, 'judged', ...)
```

问题：评价完就完了。没有：**Agent 历史画像更新**、**ELO 排名**、**场景能力标签累积**、**下次推荐依据**。

---

## 二、PRD v0.4 要求

> **结果评估与沉淀**
> - `judge <missionId>` 能评价结果质量、代决策、成本是否值得
> - 系统更新 agent/model/plan 在场景下的表现
> - Mission 结束后生成复盘：做法、结果、成本、质量、经验、下次建议
> - **历史记录可用于后续智能选择**

---

## 三、最小可行方案（MVP 级别）

### 3.1 数据层扩展

在现有 `evaluations` 表基础上，新增 `agent_profiles` 表：

```sql
CREATE TABLE agent_profiles (
  asset_id TEXT PRIMARY KEY,      -- 对应 assets.id
  total_missions INTEGER DEFAULT 0,
  total_evaluations INTEGER DEFAULT 0,
  avg_score REAL DEFAULT 0,        -- A+/A/B+ 映射 5/4/3.5 后的均值
  recent_score REAL DEFAULT 0,     -- 最近 5 次评价的均值
  success_rate REAL DEFAULT 0,     -- score ≥ B+ 的比例
  common_tags TEXT,                -- JSON: { "测试覆盖": 3, "边界处理": 2 }
  total_cost REAL DEFAULT 0,       -- 累计成本（$）
  last_used_at INTEGER,
  updated_at INTEGER
);
```

### 3.2 评价触发画像更新

在 `EvaluationEngine.judge()` 末尾增加：

```typescript
async updateProfiles(evaluation: Evaluation): Promise<void> {
  for (const assetId of evaluation.assetIds) {
    const profile = await this.db.getAgentProfile(assetId);
    const newProfile = computeProfileUpdate(profile, evaluation);
    await this.db.upsertAgentProfile(newProfile);
  }
}

function computeProfileUpdate(old: Profile | null, eval: Evaluation): Profile {
  const scoreMap: Record<Score, number> = { 'A+': 5, 'A': 4, 'B+': 3.5, 'B': 3, 'C': 2, 'D': 1 };
  const score = scoreMap[eval.score];
  
  return {
    assetId: eval.assetIds[0],
    totalMissions: (old?.totalMissions ?? 0) + 1,
    totalEvaluations: (old?.totalEvaluations ?? 0) + 1,
    avgScore: old 
      ? (old.avgScore * old.totalEvaluations + score) / (old.totalEvaluations + 1)
      : score,
    recentScore: score,  // 简化：只记最近一次，未来扩展为滑动窗口
    successRate: old
      ? (old.successRate * old.totalEvaluations + (score >= 3.5 ? 1 : 0)) / (old.totalEvaluations + 1)
      : (score >= 3.5 ? 1 : 0),
    // commonTags: 从 eval.lessons/comment 中提取关键词（后续扩展）
    totalCost: (old?.totalCost ?? 0),  // 当前无成本数据，占位
    lastUsedAt: Date.now(),
    updatedAt: Date.now(),
  };
}
```

### 3.3 CLI 展示

```bash
> assets profile codex
Asset: codex (Codex)
Missions: 12 | Evaluations: 15 | Avg: 4.2/5.0 | Recent: 4.0
Success rate: 87% | Total cost: $0.00
Common strengths: 快速实现, 代码质量

> assets leaderboard
Rank  Asset        Missions  Avg    Recent  Success
1     claude-code  8         4.5    4.5     100%
2     codex        12        4.2    4.0     87%
3     openclaw     3         3.5    3.5     67%
```

### 3.4 对 AssetLedger.findCandidates() 的影响

当前 `findCandidates` 用关键词匹配打分：

```typescript
// 当前：纯关键词匹配
findCandidates(goal: string) → 按场景标签匹配
```

扩展为**混合评分**：
```typescript
findCandidates(goal: string, context?: { preferQuality?: boolean }) {
  const keywordMatches = matchByKeywords(goal, assets);
  const profileBoosts = keywordMatches.map(asset => ({
    ...asset,
    score: asset.sceneScore * 0.5 + (profileMap[asset.id]?.avgScore ?? 3) * 0.3 
           + (profileMap[asset.id]?.successRate ?? 0.5) * 0.2,
  }));
  return profileBoosts.sort((a, b) => b.score - a.score);
}
```

---

## 四、与 IoA 论文的关联

IoA 实验显示：**异构 Agent 的知识多样性**是协作增益的关键来源（RAG 实验中异构组有时优于同构组）。

对 Agent Boss 的启示：历史画像不应只追踪"哪个 Agent 更强"，还应追踪**擅长什么场景**、**处理过什么类型的任务**。这样 `findCandidates` 就能在"类似任务"时优先召回历史表现好的 Agent，在"全新任务"时尝试未充分验证的 Agent（探索 vs 利用的平衡）。

---

## 五、实现优先级

| 优先级 | 功能 | 说明 |
|--------|------|------|
| P0 | `agent_profiles` 表 + upsert 逻辑 | judge 时自动更新 |
| P0 | `assets profile <id>` CLI | 查看单个 Agent 历史 |
| P1 | `assets leaderboard` CLI | 排行榜 |
| P1 | `findCandidates` 混合评分 | 历史画像影响推荐 |
| P2 | 滑动窗口 `recentScore` | 最近 N 次而非单次 |
| P2 | `commonTags` 自动提取 | 从 comment/lessons 中提取关键词 |
| P3 | 成本追踪 | 对接真实 API 账单 |

---

## 六、一句话总结

当前 EvaluationEngine 是"记一笔账"，需要升级为"一本账簿"——让每次 judge 都自动更新 Agent 的历史画像，最终让 AssetLedger 的推荐从"猜"变成"有据可依"。

---

*本文件为 brainstorm，发散思考，无需 review，可追加写入。*
