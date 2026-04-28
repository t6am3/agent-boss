// Agent Boss Core Orchestrator
// 管理 Worker Agents，处理 Query 路由、评判、群组讨论

import { AgentAdapter } from '../adapters/AgentAdapter';

export class AgentBoss {
  private agents: Map<string, AgentAdapter> = new Map();
  private taskQueue: any[] = [];

  constructor() {
    // TODO: 自动发现本机 Agent
  }

  async start() {
    console.log('Agent Boss started. Type "help" for commands.');
    // TODO: 启动交互式 CLI
  }

  async discoverAgents() {
    // TODO: 扫描进程、检测端口
  }

  async ask(agentIds: string[], query: string) {
    // TODO: 路由 query 到指定 agents
  }

  async compare(taskIds: string[]) {
    // TODO: 并排展示多个结果
  }

  async judge(taskId: string, score: string, comment: string) {
    // TODO: 评判打分
  }

  async group(agentIds: string[], topic: string) {
    // TODO: 创建群组讨论
  }
}
