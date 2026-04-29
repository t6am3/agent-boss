// Router Engine - Smart query routing
// Based on TECH-SPEC v1.1

import {
  AgentProfile,
  RoutingDecision,
  RoutingStrategy,
  SCENE_PATTERNS,
} from './types';

export class RouterEngine {
  constructor(private profiles: Map<string, AgentProfile>) {}

  route(query: string, explicitAgents?: string[]): RoutingDecision {
    // Explicit routing: user specified agents
    if (explicitAgents && explicitAgents.length > 0) {
      return {
        strategy: explicitAgents.length > 1 ? 'compete' : 'explicit',
        agents: explicitAgents,
        reasoning: `用户指定: ${explicitAgents.join(', ')}`,
      };
    }

    // Auto routing: based on historical performance
    return this.autoRoute(query);
  }

  private autoRoute(query: string): RoutingDecision {
    // Step 1: Extract scene tags
    const tags = this.extractTags(query);
    const primaryTag = tags[0] || 'general';

    // Step 2: Query agent performance in this scene
    const candidates = Array.from(this.profiles.values()).map((profile) => {
      const scene = profile.sceneScores[primaryTag];
      return {
        agentId: profile.agentId,
        sceneScore: scene?.avg || 0,
        globalScore: profile.avgScore,
        confidence: scene?.count || 0,
      };
    });

    // Step 3: Composite scoring (scene 70% + global 30%)
    const ranked = candidates
      .map((c) => ({
        ...c,
        composite: c.sceneScore * 0.7 + c.globalScore * 0.3,
      }))
      .sort((a, b) => b.composite - a.composite);

    const top = ranked[0];
    if (!top) {
      return {
        strategy: 'broadcast',
        agents: Array.from(this.profiles.keys()),
        reasoning: '无历史数据，广播给所有 agent',
      };
    }

    const hasEnoughData = top.confidence >= 3;

    if (hasEnoughData) {
      return {
        strategy: 'auto',
        agents: [top.agentId],
        reasoning: `${top.agentId} 在 "${primaryTag}" 场景下评分 ${top.sceneScore.toFixed(1)}（${top.confidence} 次记录）`,
      };
    } else {
      // Competition mode: not enough data, compare top 2
      const second = ranked[1];
      return {
        strategy: 'compete',
        agents: second ? [top.agentId, second.agentId] : [top.agentId],
        reasoning: `"${primaryTag}" 场景数据不足（仅 ${top.confidence} 次），启动竞争模式`,
      };
    }
  }

  extractTags(query: string): string[] {
    const tags: string[] = [];
    for (const [scene, patterns] of Object.entries(SCENE_PATTERNS)) {
      if (patterns.some((p) => p.test(query))) {
        tags.push(scene);
      }
    }
    return tags.length > 0 ? tags : ['general'];
  }

  updateProfiles(profiles: Map<string, AgentProfile>): void {
    this.profiles = profiles;
  }
}
