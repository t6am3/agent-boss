import { spawn } from "child_process";
import { Agent, AgentStatus, Chunk, SendOptions } from "./AgentAdapter";

/**
 * Codex Adapter
 * 
 * Simplest adapter - Codex CLI has clean output
 * Command: codex exec "<query>" --cwd <dir>
 */
export class CodexAdapter implements Agent {
  readonly id = "codex";
  readonly name = "Codex";
  readonly type = "cli" as const;

  private currentProcess?: ReturnType<typeof spawn>;
  private abortController = new AbortController();
  private _status: AgentStatus = "offline";

  async start(): Promise<void> {
    // Verify codex is available
    try {
      await new Promise<void>((resolve, reject) => {
        const check = spawn("which", ["codex"]);
        check.on("close", (code) => {
          code === 0 ? resolve() : reject(new Error("codex not found"));
        });
      });
      this._status = "ready";
    } catch {
      this._status = "offline";
      throw new Error("codex CLI not found. Install with: npm install -g @openai/codex");
    }
  }

  async stop(): Promise<void> {
    this.abort();
    this._status = "offline";
  }

  async *send(query: string, options?: SendOptions): AsyncIterable<Chunk> {
    if (this._status === "offline") {
      throw new Error("Adapter not started. Call start() first.");
    }

    this._status = "busy";
    this.abortController = new AbortController();

    const args = ["exec", query];
    if (options?.cwd) {
      args.push("--cwd", options.cwd);
    }

    this.currentProcess = spawn("codex", args, {
      cwd: options?.cwd || process.cwd(),
      env: process.env,
    });

    const startTime = Date.now();

    try {
      // Stream stdout
      for await (const data of this.currentProcess.stdout!) {
        yield {
          type: "text",
          content: data.toString(),
          timestamp: Date.now(),
        };
      }

      // Check stderr for errors
      const stderrChunks: Buffer[] = [];
      for await (const data of this.currentProcess.stderr!) {
        stderrChunks.push(data);
      }
      const stderr = Buffer.concat(stderrChunks).toString();

      if (stderr && stderr.includes("error")) {
        yield {
          type: "error",
          content: stderr,
          timestamp: Date.now(),
        };
      }

      // Wait for process to complete
      const exitCode = await new Promise<number>((resolve) => {
        this.currentProcess!.on("close", resolve);
      });

      if (exitCode !== 0) {
        yield {
          type: "error",
          content: `Process exited with code ${exitCode}`,
          timestamp: Date.now(),
        };
      }

    } catch (err) {
      if (this.abortController.signal.aborted) {
        yield {
          type: "system",
          content: "[已取消]",
          timestamp: Date.now(),
        };
      } else {
        yield {
          type: "error",
          content: String(err),
          timestamp: Date.now(),
        };
      }
    } finally {
      this._status = "ready";
      this.currentProcess = undefined;
    }
  }

  abort(): void {
    this.abortController.abort();
    if (this.currentProcess) {
      this.currentProcess.kill("SIGTERM");
      // Force kill after 5 seconds
      setTimeout(() => {
        if (this.currentProcess && !this.currentProcess.killed) {
          this.currentProcess.kill("SIGKILL");
        }
      }, 5000);
    }
  }

  getStatus(): AgentStatus {
    return this._status;
  }
}
