import WebSocket from "ws";
import { Agent, AgentStatus, Chunk, SendOptions } from "./AgentAdapter";

/**
 * OpenClaw Adapter
 *
 * Connects to OpenClaw Gateway via WebSocket
 * Uses sessions_spawn for task execution
 */
export class OpenClawAdapter implements Agent {
  readonly id = "openclaw";
  readonly name = "OpenClaw";
  readonly type = "gateway" as const;

  private ws?: WebSocket;
  private _status: AgentStatus = "offline";
  private gatewayUrl = "ws://127.0.0.1:18789";

  async start(): Promise<void> {
    // Check if Gateway is running
    const isRunning = await this.checkGateway();
    if (!isRunning) {
      this._status = "offline";
      throw new Error(
        "OpenClaw Gateway not running. Start with: openclaw gateway start"
      );
    }

    this._status = "ready";
  }

  async stop(): Promise<void> {
    this.ws?.close();
    this.ws = undefined;
    this._status = "offline";
  }

  async *send(query: string, _options?: SendOptions): AsyncIterable<Chunk> {
    if (this._status === "offline") {
      throw new Error("Adapter not started. Call start() first.");
    }

    this._status = "busy";

    try {
      // Since we can't directly import OpenClaw runtime APIs,
      // we'll use a subprocess approach or direct WebSocket
      // For now, this is a placeholder that simulates the flow

      yield {
        type: "system",
        content: "[OpenClaw] Task submitted to Gateway",
        timestamp: Date.now(),
      };

      // TODO: Implement actual WebSocket communication
      // 1. Connect to ws://127.0.0.1:18789
      // 2. Send JSON-RPC message with task
      // 3. Wait for response
      // 4. Stream results back

      // Simulated response for now
      await new Promise((resolve) => setTimeout(resolve, 2000));

      yield {
        type: "text",
        content: "[OpenClaw response placeholder - implement WebSocket communication]",
        timestamp: Date.now(),
      };

    } catch (err) {
      yield {
        type: "error",
        content: String(err),
        timestamp: Date.now(),
      };
    } finally {
      this._status = "ready";
    }
  }

  abort(): void {
    // OpenClaw may not support task cancellation
    // Best effort: disconnect and reconnect
    this.ws?.close();
    this._status = "ready";
  }

  getStatus(): AgentStatus {
    return this._status;
  }

  private async checkGateway(): Promise<boolean> {
    try {
      const ws = new WebSocket(this.gatewayUrl);

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          ws.close();
          reject(new Error("Connection timeout"));
        }, 3000);

        ws.on("open", () => {
          clearTimeout(timer);
          resolve();
        });

        ws.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });

      ws.close();
      return true;
    } catch {
      return false;
    }
  }
}
