// Judge Panel - Scoring and ELO system
// Based on TECH-SPEC v1.1

import {
  AgentProfile,
  JudgeRecord,
  Score,
  ScoreValue,
  SCORE_MAP,
  CAPABILITY_PATTERNS,
} from './types';

export class JudgePanel {
  constructor(private profiles: Map<string, AgentProfile>) {}

  record(judge: JudgeRecord): void {
    // Update each agent's profile
    for (const [agentId, scoreValue] of judge.ratings.entries()) {
      const profile = this.profiles.get(agentId);
      if (!profile) continue;

      this.updateProfile(profile, scoreValue, judge.tags);
    }

    // Update ELO if there's a winner
    if (judge.winner) {
      this.updateElo(judge);
    }
  }

  private updateProfile(
    profile: AgentProfile,
    scoreValue: ScoreValue,
    tags: string[]
  ): void {
    const scoreValueNum = SCORE_MAP[scoreValue.score];

    // 1. Update global average
    profile.totalTasks += 1;
    profile.avgScore = this.weightedAvg(
      profile.avgScore,
      scoreValueNum,
      profile.totalTasks
    );

    // 2. Update scene scores
    for (const tag of tags) {
      const scene = profile.sceneScores[tag] || { avg: 0, count: 0 };
      scene.count += 1;
      scene.avg = this.weightedAvg(scene.avg, scoreValueNum, scene.count);
      profile.sceneScores[tag] = scene;
    }

    // 3. Extract capabilities from comment
    if (scoreValue.comment) {
      const caps = this.extractCapabilities(scoreValue.comment);
      for (const cap of caps) {
        if (!profile.capabilities.includes(cap)) {
          profile.capabilities.push(cap);
        }
      }
    }

    profile.updatedAt = new Date();
  }

  private updateElo(judge: JudgeRecord): void {
    const winnerId = judge.winner;
    if (!winnerId) return;

    const winner = this.profiles.get(winnerId);
    if (!winner) return;

    // Find loser (highest scored non-winner, or first non-winner)
    let loserId: string | undefined;
    for (const [agentId, scoreValue] of judge.ratings.entries()) {
      if (agentId !== winnerId) {
        loserId = agentId;
        break;
      }
    }

    if (!loserId) return;
    const loser = this.profiles.get(loserId);
    if (!loser) return;

    // ELO update
    const kFactor = 32;
    const expectedWin =
      1 / (1 + 10 ** ((loser.elo - winner.elo) / 400));

    winner.elo += kFactor * (1 - expectedWin);
    loser.elo += kFactor * (0 - expectedWin);

    winner.updatedAt = new Date();
    loser.updatedAt = new Date();
  }

  private weightedAvg(
    current: number,
    newValue: number,
    count: number
  ): number {
    return (current * (count - 1) + newValue) / count;
  }

  private extractCapabilities(comment: string): string[] {
    const caps: string[] = [];
    for (const [cap, patterns] of Object.entries(CAPABILITY_PATTERNS)) {
      if (patterns.some((p) => p.test(comment))) {
        caps.push(cap);
      }
    }
    return caps;
  }

  getLeaderboard(scene?: string): AgentProfile[] {
    const profiles = Array.from(this.profiles.values());

    if (scene) {
      // Sort by scene score
      return profiles
        .map((p) => ({
          ...p,
          sceneScore: p.sceneScores[scene]?.avg || 0,
        }))
        .sort((a, b) => b.sceneScore - a.sceneScore);
    }

    // Sort by ELO
    return profiles.sort((a, b) => b.elo - a.elo);
  }
}
