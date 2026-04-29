// Result Collector - Display and comparison
// Based on TECH-SPEC v1.1

import { Result, Task } from './types';

export type DisplayMode = 'stream' | 'side-by-side' | 'list' | 'diff' | 'chat';

export class ResultCollector {
  private results: Map<string, Result> = new Map();

  addResult(result: Result): void {
    this.results.set(result.agentId, result);
  }

  getResult(agentId: string): Result | undefined {
    return this.results.get(agentId);
  }

  getAllResults(): Result[] {
    return Array.from(this.results.values());
  }

  isComplete(expectedAgents: string[]): boolean {
    return expectedAgents.every((id) => this.results.has(id));
  }

  render(mode: DisplayMode): string {
    switch (mode) {
      case 'side-by-side':
        return this.renderSideBySide();
      case 'diff':
        return this.renderDiff();
      case 'list':
        return this.renderList();
      case 'chat':
        return this.renderChat();
      default:
        return this.renderStream();
    }
  }

  private renderSideBySide(): string {
    const results = this.getAllResults();
    if (results.length !== 2) {
      return this.renderList();
    }

    const [a, b] = results;
    return `
┌─ ${a.agentId} ─────────────┐  ┌─ ${b.agentId} ─────────────┐
│ ${a.status === 'completed' ? '🟢' : '🔴'} ${a.timeSpent}s        │  │ ${b.status === 'completed' ? '🟢' : '🔴'} ${b.timeSpent}s        │
├────────────────────────┤  ├────────────────────────┤
${this.formatSideBySideContent(a.content, b.content)}
└────────────────────────┘  └────────────────────────┘
`;
  }

  private formatSideBySideContent(a: string, b: string): string {
    const aLines = a.split('\n');
    const bLines = b.split('\n');
    const maxLen = Math.max(
      ...aLines.map((l) => l.length),
      ...bLines.map((l) => l.length)
    );
    const width = Math.min(maxLen, 40);

    const lines: string[] = [];
    const maxRows = Math.max(aLines.length, bLines.length);

    for (let i = 0; i < maxRows; i++) {
      const aLine = (aLines[i] || '').substring(0, width).padEnd(width);
      const bLine = (bLines[i] || '').substring(0, width).padEnd(width);
      lines.push(`│ ${aLine} │  │ ${bLine} │`);
    }

    return lines.join('\n');
  }

  private renderDiff(): string {
    // Simple line-by-line diff
    const results = this.getAllResults();
    if (results.length < 2) {
      return this.renderList();
    }

    const [a, b] = results;
    return `Diff view (TODO: implement proper diff algorithm):
${a.agentId} vs ${b.agentId}
---
${a.content.substring(0, 200)}...
---
${b.content.substring(0, 200)}...`;
  }

  private renderList(): string {
    const results = this.getAllResults();
    return results
      .map(
        (r) =>
          `[${r.agentId}] ${r.status === 'completed' ? '✅' : '❌'} (${r.timeSpent}s)\n${r.content.substring(0, 100)}...`
      )
      .join('\n\n---\n\n');
  }

  private renderChat(): string {
    // For group chat mode
    const results = this.getAllResults();
    return results
      .map((r) => `[${r.agentId}]\n${r.content}`)
      .join('\n\n');
  }

  private renderStream(): string {
    const results = this.getAllResults();
    return results.map((r) => r.content).join('\n');
  }

  clear(): void {
    this.results.clear();
  }
}
