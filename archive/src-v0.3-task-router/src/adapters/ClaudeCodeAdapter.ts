import { spawn } from "child_process";
import stripAnsi from "strip-ansi";
import { Agent, AgentStatus, Chunk, SendOptions } from "./AgentAdapter";

/**
 * Claude Code Adapter (non-PTY version)
 *
 * Uses `claude -p` (print mode) for non-interactive execution.
 * Falls back gracefully when PTY is unavailable (Node 25 compat).
 */
export class ClaudeCodeAdapter implements Agent {
  readonly id = "claude-code";
  readonly name = "Claude Code";
  readonly type = "cli" as const;

  private currentProcess?: ReturnType<typeof spawn>;
  private _status: AgentStatus = "offline";

  async start(): Promise<void> {
    try {
      await new Promise<void>((resolve, reject) => {
        const check = spawn("which", ["claude"]);
        check.on("close", (code: number | null) => {
          code === 0 ? resolve() : reject(new Error("claude not found"));
        });
      });
      this._status = "ready";
    } catch {
      this._status = "offline";
      throw new Error(
        "claude CLI not found. Install with: npm install -g @anthropics/claude-code"
      );
    }
  }

  async stop(): Promise<void> {
    this.abort();
    this._status = "offline";
  }

  async *send(query: string, _options?: SendOptions): AsyncIterable<Chunk> {
    if (this._status === "offline") {
      throw new Error("Adapter not started. Call start() first.");
    }

    this._status = "busy";

    const args = ["-p", "--dangerously-skip-permissions", query];
    this.currentProcess = spawn("claude", args, {
      cwd: process.cwd(),
      env: process.env,
    });

    const startTime = Date.now();

    try {
      let stdout = "";
      for await (const data of this.currentProcess.stdout!) {
        stdout += data.toString();
      }

      const stderrChunks: Buffer[] = [];
      for await (const data of this.currentProcess.stderr!) {
        stderrChunks.push(data);
      }
      const stderr = Buffer.concat(stderrChunks).toString();

      if (stderr) {
        yield {
          type: "error",
          content: this.cleanOutput(stderr),
          timestamp: Date.now(),
        };
      }

      if (stdout) {
        yield {
          type: "text",
          content: this.cleanOutput(stdout),
          timestamp: Date.now(),
        };
      }

      const exitCode = await new Promise<number>((resolve) => {
        this.currentProcess!.on("close", resolve);
      });

      if (exitCode !== 0 && !stdout) {
        yield {
          type: "error",
          content: `Process exited with code ${exitCode}`,
          timestamp: Date.now(),
        };
      }

    } catch (err) {
      yield {
        type: "error",
        content: String(err),
        timestamp: Date.now(),
      };
    } finally {
      this._status = "ready";
      this.currentProcess = undefined;
    }
  }

  abort(): void {
    if (this.currentProcess) {
      this.currentProcess.kill("SIGTERM");
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

  private cleanOutput(raw: string): string {
    let cleaned = stripAnsi(raw);
    // Remove TUI border characters
    cleaned = cleaned.replace(/[┌─┐│└┘├┤┬┴┼╔═╗║╚╝╠╣╦╩╬]/g, "");
    // Remove progress bars
    cleaned = cleaned.replace(/\[=?[\s=]+\]/g, "");
    // Remove spinner characters
    cleaned = cleaned.replace(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/g, "");
    // Clean up multiple newlines
    cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
    return cleaned.trim();
  }
}
