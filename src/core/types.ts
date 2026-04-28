// Core data models for Agent Boss
// Based on TECH-SPEC v1.0

export type AgentStatus = 'ready' | 'busy' | 'offline' | 'error';

export type RoutingStrategy = 'auto' | 'explicit' | 'broadcast' | 'compete';

export type TaskMode = 'single' | 'multi' | 'group';

export type Score = 'A+' | 'A' | 'B+' | 'B' | 'C' | 'D';

export interface ScoreValue {
  score: Score;
  comment?: string;
}

export interface Agent {
  id: string;
  name: string;
  type: 'cli' | 'websocket' | 'gateway';
  status: AgentStatus;
  
  // Metadata (accumulated at runtime)
  capabilities: string[];
  avgScore: number;
  totalTasks: number;
  elo: number;
  
  // Core operations
  send(query: string, context?: Context): AsyncIterable<Chunk>;
  getStatus(): AgentStatus;
  abort(): void;
}

export interface Context {
  files?: string[];
  cwd?: string;
  previousTasks?: string[];
}

export interface Chunk {
  type: 'text' | 'thinking' | 'code' | 'error' | 'system';
  content: string;
  timestamp: number;
}

export interface Task {
  id: string;
  query: string;
  mode: TaskMode;
  agents: string[];
  context?: Context;
  
  // Results
  results: Map<string, Result>;
  judge?: JudgeRecord;
  
  // Metadata
  createdAt: Date;
  completedAt?: Date;
  tags: string[];
  
  // Recursive extension (reserved)
  parentTaskId?: string;
}

export interface Result {
  agentId: string;
  content: string;
  status: 'completed' | 'failed' | 'partial';
  timeSpent: number;      // seconds
  tokensUsed?: number;
  timestamp: Date;
}

export interface JudgeRecord {
  taskId: string;
  ratings: Map<string, ScoreValue>;
  winner?: string;
  tags: string[];
  createdAt: Date;
}

export interface AgentProfile {
  agentId: string;
  name: string;
  totalTasks: number;
  avgScore: number;
  elo: number;
  capabilities: string[];
  sceneScores: Record<string, SceneScore>;
  updatedAt: Date;
}

export interface SceneScore {
  avg: number;
  count: number;
}

export interface RoutingDecision {
  strategy: RoutingStrategy;
  agents: string[];
  reasoning?: string;
  estimatedTime?: number;
}

export interface GroupChat {
  id: string;
  name: string;
  agentIds: string[];
  messages: ChatMessage[];
  createdAt: Date;
  endedAt?: Date;
}

export interface ChatMessage {
  agent: string;
  content: string;
  round?: number;
  timestamp: Date;
}

// Scene patterns for auto-tagging
export const SCENE_PATTERNS: Record<string, RegExp[]> = {
  'sql-optimization': [/sql/i, /query/i, /database/i, /optimize/i],
  'algorithm-design': [/algorithm/i, /data structure/i, /leetcode/i, /complexity/i],
  'code-review': [/review/i, /refactor/i, /bug/i, /fix/i],
  'architecture': [/architecture/i, /design pattern/i, /microservice/i],
  'frontend-dev': [/react/i, /vue/i, /css/i, /ui/i, /component/i],
  'devops': [/docker/i, /kubernetes/i, /deploy/i, /ci\/cd/i],
  'api-design': [/api/i, /rest/i, /graphql/i, /endpoint/i],
  'testing': [/test/i, /unit test/i, /mock/i, /coverage/i],
};

// Capability patterns for auto-extraction from comments
export const CAPABILITY_PATTERNS: Record<string, RegExp[]> = {
  '边界处理': [/边界/i, /edge case/i, /corner case/i, /空值/i],
  '并发安全': [/并发/i, /线程安全/i, /race condition/i, /lock/i],
  '性能优化': [/性能/i, /optimize/i, /fast/i, /缓存/i, /cache/i],
  '代码简洁': [/简洁/i, /clean/i, /短/i],
  '架构设计': [/架构/i, /设计模式/i, /可扩展/i, /解耦/i],
  '测试覆盖': [/测试/i, /test/i, /覆盖/i, /coverage/i],
  '文档完善': [/文档/i, /注释/i, /doc/i, /README/i],
  '错误处理': [/错误/i, /异常/i, /error/i, /try catch/i],
};

// Score to numeric mapping
export const SCORE_MAP: Record<Score, number> = {
  'A+': 5,
  'A': 4,
  'B+': 3.5,
  'B': 3,
  'C': 2,
  'D': 1,
};
