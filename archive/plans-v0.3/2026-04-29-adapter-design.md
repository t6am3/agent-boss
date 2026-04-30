# Agent Boss — Agent Adapter 设计 v1.2

> 版本：v1.2
> 日期：2026-04-29
> 状态：草案（待评审）
> 作者：大雄（kimi-2.5）
> 基于：架构 v1.0 + 核心模块 v1.1

---

## 一、设计原则

**Agent 是黑箱。**

我们不关心 Claude 内部怎么跑，只关心：
1. 怎么启动它
2. 怎么发 query 给它
3. 怎么收它的输出
4. 怎么知道它还活着

每个 adapter 都是独立的进程/连接管理器，互不影响。

---

## 二、通用 Adapter 框架

```typescript
// packages/core/src/adapter/base.ts

export interface AgentAdapter {
  readonly id: string;
  readonly name: string;
  readonly type: "cli" | "websocket";
  
  // 生命周期
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): AgentStatus;
  
  // 发送 query，返回流式输出
  send(query: string, options?: SendOptions): AsyncIterable<Chunk>;
  
  // 取消当前任务
  abort(): void;
}

export type AgentStatus = 
  | "ready"      // 空闲，可接受任务
  | "busy"       // 正在处理任务
  | "offline"    // 未启动或已断开
  | "error";     // 出错，需要重启

export interface Chunk {
  type: "text" | "thinking" | "code" | "error" | "system";
  content: string;
  timestamp: number;
}

export interface SendOptions {
  timeout?: number;        // 默认 120s
  cwd?: string;            // 工作目录
  contextFiles?: string[]; // 附带文件路径
}
```

---

## 三、Codex Adapter（最简单，先做）

### 3.1 接入方式

```bash
codex exec "<query>" --cwd <dir>
```

Codex CLI 输出相对干净，直接 stdout 收集即可。

### 3.2 实现

```typescript
// packages/adapters/src/codex.ts

import { spawn } from "child_process";
import { AgentAdapter, Chunk } from "../core/adapter/base";

export class CodexAdapter implements AgentAdapter {
  readonly id = "codex";
  readonly name = "Codex";
  readonly type = "cli" as const;
  
  private process?: ReturnType<typeof spawn>;
  private abortController = new AbortController();
  
  async start(): Promise<void> {
    // Codex 不需要常驻进程，每次 exec 独立启动
    this.status = "ready";
  }
  
  async stop(): Promise<void> {
    this.abort();
    this.status = "offline";
  }
  
  async *send(query: string, options?: SendOptions): AsyncIterable<Chunk> {
    this.status = "busy";
    this.abortController = new AbortController();
    
    const args = ["exec", query];
    if (options?.cwd) args.push("--cwd", options.cwd);
    
    this.process = spawn("codex", args, {
      cwd: options?.cwd || process.cwd(),
      signal: this.abortController.signal,
    });
    
    try {
      // 流式收集 stdout
      for await (const chunk of this.process.stdout!) {
        yield {
          type: "text",
          content: chunk.toString(),
          timestamp: Date.now(),
        };
      }
      
      // 检查 stderr 是否有错误
      const stderr = await streamToString(this.process.stderr!);
      if (stderr) {
        yield {
          type: "error",
          content: stderr,
          timestamp: Date.now(),
        };
      }
      
    } catch (err) {
      if (this.abortController.signal.aborted) {
        yield { type: "system", content: "[已取消]", timestamp: Date.now() };
      } else {
        yield { type: "error", content: String(err), timestamp: Date.now() };
      }
    } finally {
      this.status = "ready";
      this.process = undefined;
    }
  }
  
  abort(): void {
    this.abortController.abort();
    this.process?.kill("SIGTERM");
    setTimeout(() => this.process?.kill("SIGKILL"), 5000);
  }
  
  getStatus(): AgentStatus {
    return this.status;
  }
  
  private status: AgentStatus = "offline";
}
```

### 3.3 特点

- ✅ 无状态：每次 `exec` 独立进程
- ✅ 输出干净：stdout 纯文本，无 ANSI 控制码
- ✅ 取消简单：`SIGTERM` → `SIGKILL`
- ⚠️ 无流式：Codex exec 是整段输出，不是逐 token

---

## 四、Claude Code Adapter（最难）

### 4.1 问题

Claude Code 是 **TUI 应用**（类似 vim），不是命令行管道。

```bash
$ claude
# 进入交互式终端，有颜色、进度条、菜单...
```

直接 spawn 的话，stdout 里全是 ANSI 控制码和终端渲染指令。

### 4.2 解决方案调研

**方案 A：`claude --print`（如果有）**
```bash
claude --print "optimize this SQL"
# 期望：纯文本输出，无 TUI
```

**方案 B：`claude exec`（子命令）**
```bash
claude exec "optimize this SQL"
# 类似 Codex，直接执行单个任务
```

**方案 C：PTY 模拟 + ANSI 过滤**
```typescript
import { spawn } from "node-pty";

const pty = spawn("claude", [], {
  cols: 80,
  rows: 30,
});

// 发送 query
pty.write("optimize this SQL\n");

// 接收输出，过滤 ANSI 码
pty.onData((data) => {
  const clean = stripAnsi(data);
  // 提取有效内容...
});
```

**方案 D：API 模式（如果 Claude Code 支持）**
```bash
claude --api-mode
# 通过 stdin/stdout 的 JSON 流通信
```

### 4.3 推荐方案

**先做方案 B（exec 子命令），fallback 到方案 C（PTY）。**

理由：
- 如果 `claude exec` 存在 → 和 Codex 一样简单
- 如果不存在 → 用 PTY 模拟，这是 Claude Code 社区常用的方式

### 4.4 PTY 实现（方案 C）

```typescript
// packages/adapters/src/claude-code.ts

import { IPty, spawn as spawnPty } from "node-pty";
import stripAnsi from "strip-ansi";

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly id = "claude-code";
  readonly name = "Claude Code";
  readonly type = "cli" as const;
  
  private pty?: IPty;
  private status: AgentStatus = "offline";
  private outputBuffer = "";
  private resolveOutput?: (value: string) => void;
  
  async start(): Promise<void> {
    // 启动 Claude Code PTY
    this.pty = spawnPty("claude", [], {
      cols: 120,
      rows: 40,
      cwd: process.cwd(),
      env: process.env as { [key: string]: string },
    });
    
    // 等待初始化完成
    await this.waitForPrompt();
    this.status = "ready";
  }
  
  async *send(query: string): AsyncIterable<Chunk> {
    if (!this.pty) throw new Error("PTY not started");
    this.status = "busy";
    
    // 发送 query
    this.pty.write(query + "\r");
    
    // 流式收集输出
    let accumulated = "";
    const checkInterval = setInterval(() => {
      const newOutput = this.extractNewOutput();
      if (newOutput) {
        accumulated += newOutput;
        // 尝试解析输出类型
        const chunks = this.parseOutput(newOutput);
        for (const chunk of chunks) {
          yield chunk;
        }
      }
    }, 100);
    
    // 等待完成信号（检测到提示符）
    await this.waitForPrompt();
    clearInterval(checkInterval);
    
    this.status = "ready";
  }
  
  private onPtyData(data: string): void {
    const clean = stripAnsi(data);
    this.outputBuffer += clean;
    
    // 检测是否回到提示符（表示任务完成）
    if (this.isPrompt(clean)) {
      this.resolveOutput?.(this.outputBuffer);
    }
  }
  
  private isPrompt(line: string): boolean {
    // Claude Code 提示符模式（需实际观察）
    return line.includes("›") || line.includes("claude");
  }
  
  private extractNewOutput(): string {
    // 从 buffer 中提取自上次读取后的新内容
    // 过滤掉 TUI 装饰、进度条等
    return this.filterTuiNoise(this.outputBuffer);
  }
  
  private filterTuiNoise(raw: string): string {
    // 过滤：
    // - 边框字符 ┌─┐│└┘
    // - 进度条 [====>   ]
    // - 颜色标记 [32m[0m
    // - 菜单选项 1. 2. 3.
    return raw
      .replace(/[┌─┐│└┘├┤┬┴┼]/g, "")
      .replace(/\[=?[\s=]+\]/g, "")  // 进度条
      .replace(/\x1b\[[0-9;]*m/g, "") // ANSI
      .trim();
  }
  
  abort(): void {
    this.pty?.write("\x03"); // Ctrl+C
    setTimeout(() => this.pty?.kill(), 5000);
  }
  
  async stop(): Promise<void> {
    this.pty?.write("\x04"); // Ctrl+D
    this.pty?.kill();
    this.status = "offline";
  }
  
  getStatus(): AgentStatus {
    return this.status;
  }
}
```

### 4.5 风险

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| Claude Code TUI 格式变更 | 高 | 高 | 定期更新过滤规则 |
| PTY 输出解析不准 | 中 | 中 | 增加人工校验模式 |
| 进程泄漏 | 低 | 中 | 超时自动 kill |

---

## 五、OpenClaw Adapter

### 5.1 接入方式

OpenClaw Gateway 已经运行（PID 12614），支持 WebSocket。

```typescript
// 直接通过 sessions_spawn 调用
import { sessions_spawn } from "openclaw";

const result = await sessions_spawn({
  task: query,
  agentId: "nobita",
  mode: "run",
  timeoutSeconds: 120,
});
```

### 5.2 实现

```typescript
// packages/adapters/src/openclaw.ts

export class OpenClawAdapter implements AgentAdapter {
  readonly id = "openclaw";
  readonly name = "OpenClaw";
  readonly type = "gateway" as const;
  
  private status: AgentStatus = "offline";
  private currentTaskId?: string;
  
  async start(): Promise<void> {
    // 检查 Gateway 是否运行
    const running = await this.checkGateway();
    this.status = running ? "ready" : "offline";
  }
  
  async *send(query: string): AsyncIterable<Chunk> {
    this.status = "busy";
    
    try {
      // 启动子任务
      const task = await sessions_spawn({
        task: query,
        agentId: "nobita",  // 或配置中指定
        mode: "run",
        timeoutSeconds: 120,
      });
      
      this.currentTaskId = task.sessionKey;
      
      // 轮询获取结果（OpenClaw 没有流式输出）
      const result = await this.pollResult(task.sessionKey, 120000);
      
      yield {
        type: "text",
        content: result,
        timestamp: Date.now(),
      };
      
    } catch (err) {
      yield {
        type: "error",
        content: String(err),
        timestamp: Date.now(),
      };
    } finally {
      this.status = "ready";
      this.currentTaskId = undefined;
    }
  }
  
  private async pollResult(sessionKey: string, timeout: number): Promise<string> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      // 查询 session 状态
      const status = await this.getSessionStatus(sessionKey);
      if (status.state === "completed") {
        return status.result || "(无输出)";
      }
      if (status.state === "failed") {
        throw new Error(status.error || "任务失败");
      }
      await sleep(1000);
    }
    throw new Error("任务超时");
  }
  
  abort(): void {
    if (this.currentTaskId) {
      // 尝试取消子任务
      // OpenClaw 可能没有取消 API，只能等超时
    }
  }
  
  async stop(): Promise<void> {
    this.status = "offline";
  }
  
  getStatus(): AgentStatus {
    return this.status;
  }
  
  private async checkGateway(): Promise<boolean> {
    // 检查 ws://127.0.0.1:18789 是否可连
    try {
      const ws = new WebSocket("ws://127.0.0.1:18789");
      await new Promise((resolve, reject) => {
        ws.on("open", resolve);
        ws.on("error", reject);
        setTimeout(() => reject(new Error("timeout")), 3000);
      });
      ws.close();
      return true;
    } catch {
      return false;
    }
  }
}
```

### 5.3 特点

- ✅ 异步执行：OpenClaw 任务在后台跑
- ⚠️ 非流式：需要轮询结果
- ⚠️ 取消困难：可能没有取消 API
- ⚠️ 状态不透明：不知道内部执行到哪一步

---

## 六、Hermes Adapter（待定）

### 6.1 当前状态

未知。需要先调研：

```bash
# 调研任务
ps aux | grep hermes  # 确认进程
lsof -i | grep hermes # 确认端口
curl http://localhost:PORT/health  # 确认 API
```

### 6.2 可能的接入方式

| 方式 | 条件 |
|------|------|
| CLI | Hermes 有命令行工具 |
| WebSocket | Hermes 有 Gateway |
| HTTP API | Hermes 有 REST API |
| 文件队列 | Hermes 通过文件系统通信 |

### 6.3 占位实现

```typescript
export class HermesAdapter implements AgentAdapter {
  readonly id = "hermes";
  readonly name = "Hermes";
  readonly type = "unknown" as const;
  
  async start(): Promise<void> {
    throw new Error("Hermes 接口未调研，请先运行调研命令");
  }
  
  // ... 其他方法同样抛出错误
}
```

---

## 七、Adapter Registry

### 7.1 注册表

```typescript
// packages/core/src/registry.ts

export class AdapterRegistry {
  private adapters = new Map<string, AgentAdapter>();
  
  register(adapter: AgentAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }
  
  get(id: string): AgentAdapter | undefined {
    return this.adapters.get(id);
  }
  
  list(): AgentAdapter[] {
    return Array.from(this.adapters.values());
  }
  
  async discover(): Promise<AgentStatus[]> {
    // 自动检测本机可用的 agent
    const results: AgentStatus[] = [];
    
    // 检测 Codex
    if (await this.isCommandAvailable("codex")) {
      const adapter = new CodexAdapter();
      await adapter.start();
      this.register(adapter);
      results.push(adapter.getStatus());
    }
    
    // 检测 Claude Code
    if (await this.isCommandAvailable("claude")) {
      const adapter = new ClaudeCodeAdapter();
      await adapter.start();
      this.register(adapter);
      results.push(adapter.getStatus());
    }
    
    // 检测 OpenClaw
    if (await this.checkPort(18789)) {
      const adapter = new OpenClawAdapter();
      await adapter.start();
      this.register(adapter);
      results.push(adapter.getStatus());
    }
    
    return results;
  }
  
  private async isCommandAvailable(cmd: string): Promise<boolean> {
    try {
      await execAsync(`which ${cmd}`);
      return true;
    } catch {
      return false;
    }
  }
  
  private async checkPort(port: number): Promise<boolean> {
    try {
      const conn = await net.createConnection({ port, host: "127.0.0.1" });
      conn.destroy();
      return true;
    } catch {
      return false;
    }
  }
}
```

### 7.2 生命周期管理

```
启动流程：
1. AdapterRegistry.discover() → 检测可用 agent
2. 逐个 start() → 初始化连接
3. 状态 = ready | offline | error

运行时：
- Router 从 Registry 获取 agent
- 发送 query → 状态变为 busy
- 完成后 → 状态变回 ready
- 异常 → 状态变为 error，可重试 restart

关闭流程：
1. 所有 agent stop()
2. 清理进程和连接
```

---

## 八、实现顺序

| 优先级 | Adapter | 理由 |
|--------|---------|------|
| **P0** | Codex | 最简单，先跑通完整链路 |
| **P0** | Claude Code | 核心 agent，必须有 |
| **P1** | OpenClaw | 已有 Gateway，轮询实现 |
| **P2** | Hermes | 需调研接口 |

---

## 九、验证计划

### 9.1 单 agent 测试

```bash
# 测试 Codex
> ask codex "hello"
期望：Codex 回复，状态正确，超时正常

# 测试 Claude Code
> ask claude "hello"
期望：Claude 回复，无 TUI 噪音，可取消

# 测试 OpenClaw
> ask openclaw "hello"
期望：通过 Gateway 调用 nobita，返回结果
```

### 9.2 多 agent 测试

```bash
# 测试并发
> ask codex,claude "写个函数"
期望：两个同时跑，互不干扰，结果分别展示

# 测试取消
> ask codex "写个复杂程序"
# 按 Ctrl+C
期望：Codex 进程被终止，状态回到 ready
```

---

## 十、下一步

1. 实现 Codex Adapter（1-2 小时）
2. 实现 Claude Code Adapter（3-4 小时，含 TUI 过滤）
3. 实现 OpenClaw Adapter（2 小时）
4. 调研 Hermes 接口

---

*本设计由 大雄（kimi-2.5）基于架构 v1.0 + 核心模块 v1.1 推导，日期 2026-04-29。*
