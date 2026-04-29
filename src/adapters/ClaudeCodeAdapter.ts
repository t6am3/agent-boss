import { IPty, spawn as spawnPty } from "node-pty";
import { spawn } from "child_process";
import stripAnsi from "strip-ansi";
import { Agent, AgentStatus, Chunk, SendOptions } from "./AgentAdapter";

/**
 * Claude Code Adapter
 *
 * Uses PTY (pseudo-terminal) to interact with Claude Code CLI
 * Claude Code is a TUI app, so we need to filter ANSI codes and TUI noise
 */
export class ClaudeCodeAdapter implements Agent {
  readonly id = "claude-code";
  readonly name = "Claude Code";
  readonly type = "cli" as const;

  private pty?: IPty;
  private _status: AgentStatus = "offline";
  private outputBuffer = "";
  private promptDetected = false;

  private claudePath?: string;

  async start(): Promise<void> {
    // Verify claude is available and resolve absolute path
    try {
      this.claudePath = await new Promise<string>((resolve, reject) => {
        const check = spawn("which", ["claude"]);
        let path = "";
        check.stdout.on("data", (d) => { path += d.toString(); });
        check.on("close", (code: number | null) => {
          const clean = path.trim();
          code === 0 && clean ? resolve(clean) : reject(new Error("claude not found"));
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
    if (this.pty) {
      this.pty.write("\x04"); // Ctrl+D
      this.pty.kill();
      this.pty = undefined;
    }
    this._status = "offline";
  }

  async *send(query: string, _options?: SendOptions): AsyncIterable<Chunk> {
    // Start PTY on-demand if not already running
    if (!this.pty || this._status === "offline") {
      const claude = this.claudePath || "claude";
      this.pty = spawnPty(claude, ["-p", "--dangerously-skip-permissions"], {
        cols: 120,
        rows: 40,
        cwd: process.cwd(),
        env: process.env as { [key: string]: string },
      });

      this.pty.onData((data) => {
        this.outputBuffer += data;
      });

      await this.waitForPrompt(30000);
    }

    if (!this.pty) {
      throw new Error("PTY not started. Call start() first.");
    }

    this._status = "busy";
    this.outputBuffer = "";
    this.promptDetected = false;

    // Send query
    this.pty.write(query + "\r");

    // Collect output until next prompt
    const result = await this.collectOutput();

    // Clean and yield
    const cleanOutput = this.cleanOutput(result);

    if (cleanOutput) {
      yield {
        type: "text",
        content: cleanOutput,
        timestamp: Date.now(),
      };
    }

    this._status = "ready";
  }

  abort(): void {
    if (this.pty) {
      this.pty.write("\x03"); // Ctrl+C
      setTimeout(() => {
        this.pty?.kill();
        this._status = "ready";
      }, 5000);
    }
  }

  getStatus(): AgentStatus {
    return this._status;
  }

  private async waitForPrompt(timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const clean = stripAnsi(this.outputBuffer);
      if (this.isPrompt(clean)) {
        this.outputBuffer = ""; // Clear buffer after prompt
        return;
      }
      await sleep(100);
    }
    throw new Error("Timeout waiting for Claude Code prompt");
  }

  private async collectOutput(): Promise<string> {
    const start = Date.now();
    const timeout = 120000; // 2 minutes

    while (Date.now() - start < timeout) {
      const clean = stripAnsi(this.outputBuffer);

      if (this.isPrompt(clean)) {
        // Extract content before prompt
        const promptIndex = this.findPromptIndex(clean);
        if (promptIndex > 0) {
          return this.outputBuffer.substring(0, promptIndex);
        }
      }

      await sleep(100);
    }

    // Timeout - return what we have
    return this.outputBuffer;
  }

  private isPrompt(text: string): boolean {
    // Claude Code prompt patterns
    return (
      text.includes("›") || // Common Claude Code prompt
      text.includes("claude") ||
      text.includes("╭") || // TUI border
      /\$\s*$/.test(text) || // Shell prompt
      />\s*$/.test(text)
    );
  }

  private findPromptIndex(text: string): number {
    const markers = ["›", "╭", "$ ", "> "];
    for (const marker of markers) {
      const idx = text.lastIndexOf(marker);
      if (idx !== -1) {
        return idx;
      }
    }
    return -1;
  }

  private cleanOutput(raw: string): string {
    let cleaned = stripAnsi(raw);

    // Remove TUI border characters
    cleaned = cleaned.replace(/[┌─┐│└┘├┤┬┴┼]/g, "");

    // Remove progress bars
    cleaned = cleaned.replace(/\[=?[\s=]+\]/g, "");

    // Remove box-drawing characters
    cleaned = cleaned.replace(/[╔═╗║╚╝╠╣╦╩╬]/g, "");

    // Remove spinner characters
    cleaned = cleaned.replace(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/g, "");

    // Clean up multiple newlines
    cleaned = cleaned.replace(/\n{3,}/g, "\n\n");

    return cleaned.trim();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
