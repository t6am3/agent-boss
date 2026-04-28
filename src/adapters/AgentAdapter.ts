// 统一 Agent Adapter 接口
// 所有 Worker Agent（Claude/Code/OpenClaw/Hermes）必须实现此接口

export interface AgentAdapter {
  name: string;
  type: 'cli' | 'websocket' | 'api';
  status: 'ready' | 'busy' | 'offline';
  
  // 发送 query，返回流式结果
  send(query: string, context?: any): AsyncGenerator<string>;
  
  // 终止当前任务
  terminate(): Promise<void>;
}
