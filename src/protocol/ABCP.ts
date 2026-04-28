// ABCP - Agent Boss Communication Protocol
// JSON-RPC 2.0 over WebSocket

export interface ABCPMessage {
  jsonrpc: '2.0';
  method: string;
  params?: any;
  id?: number;
}

export const ABCPMethods = {
  DELEGATE: 'boss.delegate',
  REPORT: 'boss.report',
  STATUS: 'boss.status',
  JUDGE: 'boss.judge',
} as const;
