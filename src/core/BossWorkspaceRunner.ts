import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Mission, MissionEventType } from '../domain/types';
import { MissionRunOptions, MissionRunResult, MissionRunner } from './MissionRunner';
import { MissionStore } from './MissionStore';

interface BashResult {
  label: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  outputPath: string;
}

export class BossWorkspaceRunner implements MissionRunner {
  private readonly workspaceRoot: string;

  constructor(
    private readonly missions: MissionStore,
    private readonly cwd = process.cwd(),
    workspaceRoot?: string,
  ) {
    this.workspaceRoot = workspaceRoot ?? path.join(this.cwd, '.agent-boss', 'workspaces');
  }

  async run(mission: Mission, options: MissionRunOptions = {}): Promise<MissionRunResult> {
    const assetId = options.assetId ?? 'boss-workspace';
    const workspacePath = this.ensureWorkspace(mission);

    await this.record(mission.id, 'assigned', 'boss', 'Boss opened a mission workspace and started local inspection.', {
      runner: 'workspace',
      workspacePath,
    });
    await this.missions.updateMission(mission.id, {
      stage: 'executing',
      status: 'active',
      progress: Math.max(mission.progress, 15),
      risk: mission.risk,
      ownerNeeded: false,
      currentAssignee: assetId,
      assetIds: includeAsset(mission.assetIds, assetId),
      nextAction: 'Inspect the project workspace, run safe checks, and report owner-facing progress.',
    });

    const commands = this.planCommands();
    const results: BashResult[] = [];
    for (const command of commands) {
      if (isDestructiveCommand(command.command)) {
        const summary = `Workspace command requires owner approval: ${command.command}`;
        await this.record(mission.id, 'resource_escalation', 'boss', summary, {
          runner: 'workspace',
          command: command.command,
        });
        await this.missions.updateMission(mission.id, {
          stage: 'executing',
          status: 'waiting_owner',
          progress: 35,
          risk: 'high',
          ownerNeeded: true,
          currentAssignee: assetId,
          summary,
          nextAction: 'Owner approval is required before running a destructive workspace command.',
        });
        return {
          missionId: mission.id,
          runner: 'workspace',
          assetId,
          status: 'waiting_owner',
          escalatedToOwner: true,
          summary,
        };
      }

      const result = await this.runBash(workspacePath, command.label, command.command);
      results.push(result);
      await this.recordCommandResult(mission.id, result);
      if (result.exitCode !== 0) {
        const summary = `Workspace check blocked: ${result.label} failed.`;
        this.writeProgress(workspacePath, mission, results, summary);
        await this.missions.updateMission(mission.id, {
          stage: 'executing',
          status: 'blocked',
          progress: 65,
          risk: 'high',
          ownerNeeded: false,
          currentAssignee: assetId,
          summary,
          nextAction: 'Inspect the audit log, fix the failing check, or delegate the blocker to a worker agent.',
        });
        return {
          missionId: mission.id,
          runner: 'workspace',
          assetId,
          status: 'blocked',
          escalatedToOwner: false,
          summary,
        };
      }
    }

    const summary = this.summarizeSuccess(results);
    this.writeProgress(workspacePath, mission, results, summary);
    await this.missions.updateMission(mission.id, {
      stage: 'completed',
      status: 'completed',
      progress: 100,
      risk: 'low',
      ownerNeeded: false,
      currentAssignee: assetId,
      summary,
      nextAction: 'Report the result to owner or audit the workspace details if needed.',
      completedAt: new Date(),
    });
    await this.record(mission.id, 'completed', 'boss', summary, {
      runner: 'workspace',
      workspacePath,
      commands: results.map((result) => ({
        label: result.label,
        exitCode: result.exitCode,
        outputPath: result.outputPath,
      })),
    });

    return {
      missionId: mission.id,
      runner: 'workspace',
      assetId,
      status: 'completed',
      escalatedToOwner: false,
      summary,
    };
  }

  private ensureWorkspace(mission: Mission): string {
    const workspacePath = path.join(this.workspaceRoot, mission.id);
    const artifactsPath = path.join(workspacePath, 'artifacts');
    mkdirSync(artifactsPath, { recursive: true });
    writeFileSync(path.join(workspacePath, 'goal.md'), [`# ${mission.id}`, '', mission.goal, ''].join('\n'));
    writeFileSync(path.join(workspacePath, 'plan.md'), [
      '# Boss Workspace Plan',
      '',
      '- Inspect the project structure.',
      '- Run safe local checks.',
      '- Record outputs under artifacts/.',
      '- Report only owner-facing progress unless audit is requested.',
      '',
    ].join('\n'));
    return workspacePath;
  }

  private planCommands(): Array<{ label: string; command: string }> {
    const commands = [
      { label: 'pwd', command: 'pwd' },
      { label: 'project-files', command: 'rg --files | head -80' },
    ];
    if (existsSync(path.join(this.cwd, '.git'))) {
      commands.push({ label: 'git-status', command: 'git status --short' });
    }
    if (existsSync(path.join(this.cwd, 'package.json'))) {
      commands.push({ label: 'npm-test', command: 'npm test' });
    }
    return commands;
  }

  private async runBash(workspacePath: string, label: string, command: string): Promise<BashResult> {
    const execution = await execBash(command, this.cwd);
    const outputPath = path.join(workspacePath, 'artifacts', `${String(Date.now())}-${slug(label)}.txt`);
    writeFileSync(outputPath, [
      `$ ${command}`,
      '',
      '## stdout',
      execution.stdout || '(empty)',
      '',
      '## stderr',
      execution.stderr || '(empty)',
      '',
      `exitCode=${execution.exitCode}`,
      '',
    ].join('\n'));
    return { label, command, ...execution, outputPath };
  }

  private async recordCommandResult(missionId: string, result: BashResult): Promise<void> {
    const eventType: MissionEventType = result.exitCode === 0 ? 'progress' : 'blocked';
    const content = result.exitCode === 0
      ? `Workspace check passed: ${result.label}.`
      : `Workspace check failed: ${result.label}.`;
    await this.record(missionId, eventType, 'boss', content, {
      runner: 'workspace',
      command: result.command,
      exitCode: result.exitCode,
      outputPath: result.outputPath,
      stdout: truncate(result.stdout, 2000),
      stderr: truncate(result.stderr, 2000),
    });
  }

  private writeProgress(workspacePath: string, mission: Mission, results: BashResult[], summary: string): void {
    writeFileSync(path.join(workspacePath, 'progress.md'), [
      '# Boss Progress',
      '',
      `Mission: ${mission.id}`,
      `Goal: ${mission.goal}`,
      `Summary: ${summary}`,
      '',
      '## Checks',
      ...results.map((result) =>
        `- ${result.exitCode === 0 ? 'pass' : 'fail'} ${result.label}: ${path.relative(workspacePath, result.outputPath)}`,
      ),
      '',
    ].join('\n'));
  }

  private summarizeSuccess(results: BashResult[]): string {
    const npmTest = results.find((result) => result.label === 'npm-test');
    if (npmTest) {
      return 'Boss workspace check completed: project files inspected and npm test passed.';
    }
    return 'Boss workspace check completed: project files inspected and audit artifacts recorded.';
  }

  private async record(
    missionId: string,
    type: MissionEventType,
    actor: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.missions.addEvent({ missionId, type, actor, content, metadata });
  }
}

function execBash(command: string, cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile('bash', ['-lc', command], { cwd, timeout: 120_000, maxBuffer: 1024 * 1024 * 5 }, (error, stdout, stderr) => {
      const exitCode = error
        ? typeof (error as { code?: unknown }).code === 'number'
          ? (error as { code: number }).code
          : 1
        : 0;
      resolve({ stdout, stderr, exitCode });
    });
  });
}

function isDestructiveCommand(command: string): boolean {
  return /\b(rm|mv|chmod|chown|sudo)\b|>\s*|>>|git\s+(reset|clean|push|commit)|npm\s+publish|drop\s+table|truncate\s+table/i
    .test(command);
}

function includeAsset(assetIds: string[], assetId: string): string[] {
  return assetIds.includes(assetId) ? assetIds : [...assetIds, assetId];
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'command';
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}
