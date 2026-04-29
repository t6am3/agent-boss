// Agent Boss Core Orchestrator
// Manages Worker Agents, handles query routing, judging, and group discussions
// Based on TECH-SPEC v1.0

import { CodexAdapter } from '../adapters/CodexAdapter';
import { ClaudeCodeAdapter } from '../adapters/ClaudeCodeAdapter';
import { OpenClawAdapter } from '../adapters/OpenClawAdapter';
import { Agent } from '../adapters/AgentAdapter';
import { AgentProfile, Task, TaskMode, Context, JudgeRecord, GroupChat, ChatMessage } from './types';
import { RouterEngine } from './RouterEngine';
import { JudgePanel } from './JudgePanel';
import { ResultCollector } from './ResultCollector';

export class AgentBoss {
  private agents: Map<string, Agent> = new Map();
  private profiles: Map<string, AgentProfile> = new Map();
  private tasks: Map<string, Task> = new Map();
  private groupChats: Map<string, GroupChat> = new Map();
  
  private router: RouterEngine;
  private judgePanel: JudgePanel;
  
  // Task counter for IDs
  private taskCounter = 0;
  
  constructor() {
    this.router = new RouterEngine(this.profiles);
    this.judgePanel = new JudgePanel(this.profiles);
  }

  async start(): Promise<void> {
    console.log('🤖 Agent Boss started');
    console.log('Type "help" for commands');
    await this.discoverAgents();
  }

  async discoverAgents(): Promise<void> {
    // Auto-register available agents
    const available: Agent[] = [];
    
    // Try Codex
    try {
      const codex = new CodexAdapter();
      await codex.start();
      available.push(codex);
      this.registerAgent(codex);
    } catch {
      // Codex not available
    }
    
    // Try Claude Code
    try {
      const claude = new ClaudeCodeAdapter();
      await claude.start();
      available.push(claude);
      this.registerAgent(claude);
    } catch {
      // Claude Code not available
    }
    
    // Try OpenClaw (skeleton — likely fails to connect)
    try {
      const openclaw = new OpenClawAdapter();
      await openclaw.start();
      available.push(openclaw);
      this.registerAgent(openclaw);
    } catch {
      // OpenClaw not available
    }
    
    if (available.length === 0) {
      console.log('⚠️  No agents available. Install codex or claude CLI.');
    } else {
      console.log(`✅ Registered ${available.length} agent(s): ${available.map(a => a.name).join(', ')}`);
    }
  }

  registerAgent(agent: Agent): void {
    this.agents.set(agent.id, agent);
    
    // Initialize profile if not exists
    if (!this.profiles.has(agent.id)) {
      this.profiles.set(agent.id, {
        agentId: agent.id,
        name: agent.name,
        totalTasks: 0,
        avgScore: 0,
        elo: 1500,
        capabilities: [],
        sceneScores: {},
        updatedAt: new Date(),
      });
    }
    
    // Update router with new profiles
    this.router.updateProfiles(this.profiles);
  }

  async ask(query: string, agentIds?: string[], context?: Context): Promise<Task> {
    // Routing decision
    const decision = this.router.route(query, agentIds);
    console.log(`💡 ${decision.reasoning || 'Routing...'}`);
    
    // Create task
    const task: Task = {
      id: `task-${++this.taskCounter}`,
      query,
      mode: decision.agents.length > 1 ? 'multi' : 'single',
      agents: decision.agents,
      context,
      results: new Map(),
      tags: this.router.extractTags(query),
      createdAt: new Date(),
    };
    
    this.tasks.set(task.id, task);
    
    // Execute with selected agents
    await this.executeTask(task);
    
    return task;
  }

  async askAll(query: string, context?: Context): Promise<Task> {
    const allAgents = Array.from(this.agents.keys());
    return this.ask(query, allAgents, context);
  }

  private async executeTask(task: Task): Promise<void> {
    const collector = new ResultCollector();
    
    // Parallel execution
    const promises = task.agents.map(async (agentId) => {
      const agent = this.agents.get(agentId);
      if (!agent) {
        task.results.set(agentId, {
          agentId,
          content: '',
          status: 'failed',
          timeSpent: 0,
          timestamp: new Date(),
        });
        return;
      }
      
      const startTime = Date.now();
      let content = '';
      
      try {
        for await (const chunk of agent.send(task.query, task.context)) {
          content += chunk.content;
          // TODO: Real-time streaming display
        }
        
        const timeSpent = (Date.now() - startTime) / 1000;
        
        task.results.set(agentId, {
          agentId,
          content,
          status: 'completed',
          timeSpent,
          timestamp: new Date(),
        });
        
      } catch (err) {
        task.results.set(agentId, {
          agentId,
          content: String(err),
          status: 'failed',
          timeSpent: (Date.now() - startTime) / 1000,
          timestamp: new Date(),
        });
      }
    });
    
    await Promise.all(promises);
    task.completedAt = new Date();
    
    // Display results
    const displayMode = task.agents.length > 1 ? 'side-by-side' : 'stream';
    console.log(collector.render(displayMode as any));
  }

  judge(taskId: string, ratings: Map<string, { score: string; comment?: string }>, winner?: string): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      console.error(`Task ${taskId} not found`);
      return;
    }
    
    const judgeRecord: JudgeRecord = {
      taskId,
      ratings: ratings as any,
      winner,
      tags: task.tags,
      createdAt: new Date(),
    };
    
    task.judge = judgeRecord;
    this.judgePanel.record(judgeRecord);
    
    console.log('✅ Judge recorded');
  }

  async group(agentIds: string[], topic: string, maxRounds: number = 3): Promise<GroupChat> {
    const room: GroupChat = {
      id: `room-${++this.taskCounter}`,
      name: topic,
      agentIds,
      messages: [{ agent: 'user', content: topic, timestamp: new Date() }],
      createdAt: new Date(),
    };
    
    this.groupChats.set(room.id, room);
    
    // Round-robin discussion
    for (let round = 1; round <= maxRounds; round++) {
      for (const agentId of agentIds) {
        const agent = this.agents.get(agentId);
        if (!agent) continue;
        
        const context = this.buildChatContext(room);
        const prompt = `讨论主题：${topic}\n\n历史发言：\n${context}\n\n轮到你发言（第 ${round} 轮）。请给出你的观点，可以反驳或补充其他人的意见。`;
        
        try {
          let response = '';
          for await (const chunk of agent.send(prompt)) {
            response += chunk.content;
          }
          
          room.messages.push({
            agent: agentId,
            content: response,
            round,
            timestamp: new Date(),
          });
          
          console.log(`[${agentId}] ${response.substring(0, 100)}...`);
          
        } catch (err) {
          console.error(`[${agentId}] Error: ${err}`);
        }
      }
      
      // Check for consensus
      if (this.checkConsensus(room)) {
        console.log('✅ 达成共识');
        break;
      }
    }
    
    room.endedAt = new Date();
    return room;
  }

  private buildChatContext(room: GroupChat): string {
    return room.messages
      .map((m) => `[${m.agent}] ${m.content}`)
      .join('\n');
  }

  private checkConsensus(room: GroupChat): boolean {
    // Simple heuristic: check last 2 rounds for agreement keywords
    const lastMessages = room.messages.slice(-room.agentIds.length * 2);
    const hasAgreement = lastMessages.some((m) =>
      /同意|赞同|没错|是的|agree|yes/i.test(m.content)
    );
    return hasAgreement;
  }

  getStatus(): { agents: string[]; tasks: number; rooms: number } {
    return {
      agents: Array.from(this.agents.keys()),
      tasks: this.tasks.size,
      rooms: this.groupChats.size,
    };
  }

  getProfile(agentId: string): AgentProfile | undefined {
    return this.profiles.get(agentId);
  }

  getLeaderboard(scene?: string): AgentProfile[] {
    return this.judgePanel.getLeaderboard(scene);
  }
}
