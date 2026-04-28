// Unified Agent Adapter Interface
// All Worker Agents (Claude/Code/OpenClaw/Hermes) must implement this interface
// Based on TECH-SPEC v1.2

export type AgentStatus = 'ready' | 'busy' | 'offline' | 'error';

export interface Chunk {
  type: 'text' | 'thinking' | 'code' | 'error' | 'system';
  content: string;
  timestamp: number;
}

export interface SendOptions {
  timeout?: number;        // Default 120s
  cwd?: string;            // Working directory
  contextFiles?: string[]; // Attached file paths
}

export interface Agent {
  readonly id: string;
  readonly name: string;
  readonly type: 'cli' | 'websocket' | 'gateway';
  
  // Lifecycle
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): AgentStatus;
  
  // Send query, return streaming output
  send(query: string, options?: SendOptions): AsyncIterable<Chunk>;
  
  // Cancel current task
  abort(): void;
}

// Adapter factory for creating specific agent adapters
export interface AdapterFactory {
  create(config: Record<string, unknown>): Agent;
  checkAvailability(): Promise<boolean>;
}
