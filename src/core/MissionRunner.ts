import { execFile } from 'node:child_process';
import { Mission, MissionEventType, SupervisorDecision } from '../domain/types';
import { MissionStore } from './MissionStore';
import { Supervisor } from './Supervisor';

export type MissionRunnerKind = 'mock' | 'openclaw';
export type MockRunScenario = 'happy' | 'confirmation' | 'permission' | 'blocked';
export type MissionRunStatus = 'completed' | 'waiting_owner' | 'blocked';

export interface MissionRunOptions {
  assetId?: string;
  scenario?: MockRunScenario;
  question?: string;
  command?: string;
  agentId?: string;
  timeoutSeconds?: number;
  thinking?: string;
  message?: string;
}

export interface MissionRunResult {
  missionId: string;
  runner: MissionRunnerKind;
  assetId: string;
  status: MissionRunStatus;
  escalatedToOwner: boolean;
  summary: string;
}

export interface MissionRunner {
  run(mission: Mission, options?: MissionRunOptions): Promise<MissionRunResult>;
}

export class MockMissionRunner implements MissionRunner {
  constructor(
    private readonly missions: MissionStore,
    private readonly supervisor: Supervisor,
  ) {}

  async run(mission: Mission, options: MissionRunOptions = {}): Promise<MissionRunResult> {
    const scenario = options.scenario ?? 'confirmation';
    const assetId = options.assetId ?? mission.currentAssignee ?? mission.assetIds[0] ?? 'mock-worker';

    await this.record(mission.id, 'assigned', 'boss', `Assigned mission to ${assetId}.`, {
      runner: 'mock',
      scenario,
      assetId,
    });

    await this.missions.updateMission(mission.id, {
      stage: 'executing',
      status: 'active',
      progress: Math.max(mission.progress, 15),
      risk: mission.risk,
      ownerNeeded: false,
      currentAssignee: assetId,
      nextAction: `${assetId} is executing the first pass.`,
    });

    await this.record(
      mission.id,
      'progress',
      assetId,
      `Started execution for: ${mission.goal}`,
      { progress: 15 },
    );

    const question = options.question ?? defaultScenarioQuestion(scenario);
    if (question) {
      const decision = await this.handleWorkerQuestion(mission.id, assetId, question);
      if (decision.escalatedToOwner) {
        return {
          missionId: mission.id,
          runner: 'mock',
          assetId,
          status: 'waiting_owner',
          escalatedToOwner: true,
          summary: decision.decision,
        };
      }
    }

    if (scenario === 'blocked') {
      const summary = `${assetId} hit a blocker that Boss must re-plan.`;
      await this.record(mission.id, 'blocked', assetId, summary, { runner: 'mock' });
      await this.missions.updateMission(mission.id, {
        stage: 'executing',
        status: 'blocked',
        progress: 45,
        risk: 'high',
        currentAssignee: assetId,
        summary,
        nextAction: 'Boss should inspect the blocker, ask for attempted fixes, and reassign or narrow scope.',
      });
      return {
        missionId: mission.id,
        runner: 'mock',
        assetId,
        status: 'blocked',
        escalatedToOwner: false,
        summary,
      };
    }

    await this.record(mission.id, 'progress', assetId, 'Worker produced a first-pass result.', {
      progress: 60,
    });
    await this.missions.updateMission(mission.id, {
      stage: 'reviewing',
      status: 'active',
      progress: 75,
      risk: 'medium',
      ownerNeeded: false,
      currentAssignee: assetId,
      summary: 'Worker produced a first-pass result.',
      nextAction: 'Boss reviews the result and decides whether to accept or request changes.',
    });

    await this.record(mission.id, 'progress', 'boss', 'Boss reviewed the result and accepted the mock output.', {
      progress: 90,
    });

    const summary = `Mock runner completed mission with ${assetId}.`;
    await this.missions.updateMission(mission.id, {
      stage: 'completed',
      status: 'completed',
      progress: 100,
      risk: 'low',
      ownerNeeded: false,
      currentAssignee: assetId,
      summary,
      nextAction: 'Generate report and judge the mission.',
      completedAt: new Date(),
    });
    await this.record(mission.id, 'completed', 'boss', summary, { runner: 'mock', assetId });

    return {
      missionId: mission.id,
      runner: 'mock',
      assetId,
      status: 'completed',
      escalatedToOwner: false,
      summary,
    };
  }

  private async handleWorkerQuestion(
    missionId: string,
    assetId: string,
    question: string,
  ): Promise<SupervisorDecision> {
    await this.record(missionId, 'confirmation_requested', assetId, question);
    const mission = await this.requireMission(missionId);
    const decision = await this.supervisor.decide(mission, question);
    const eventType: MissionEventType = decision.escalatedToOwner ? 'resource_escalation' : 'decision';

    await this.record(missionId, eventType, 'boss', `${decision.decision} Reason: ${decision.reason}`, {
      question,
      category: decision.category,
    });

    await this.missions.updateMission(missionId, {
      status: decision.escalatedToOwner ? 'waiting_owner' : 'active',
      ownerNeeded: decision.escalatedToOwner,
      risk: decision.escalatedToOwner ? 'high' : mission.risk,
      nextAction: decision.decision,
      currentAssignee: assetId,
      summary: decision.escalatedToOwner ? question : mission.summary,
    });

    return decision;
  }

  private async requireMission(missionId: string): Promise<Mission> {
    const mission = await this.missions.getMission(missionId);
    if (!mission) {
      throw new Error(`Mission not found: ${missionId}`);
    }
    return mission;
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

export class OpenClawRunner implements MissionRunner {
  constructor(
    private readonly missions: MissionStore,
    private readonly supervisor: Supervisor,
    private readonly defaultCommand = process.env.AGENT_BOSS_OPENCLAW_BIN ?? 'openclaw',
    private readonly defaultAgentId = process.env.AGENT_BOSS_OPENCLAW_AGENT ?? 'Nobita',
  ) {}

  async run(mission: Mission, options: MissionRunOptions = {}): Promise<MissionRunResult> {
    const assetId = options.assetId ?? mission.currentAssignee ?? 'openclaw';
    const command = options.command ?? this.defaultCommand;
    const timeoutSeconds = options.timeoutSeconds ?? 120;
    const agentId = options.agentId ?? this.defaultAgentId;

    await this.record(mission.id, 'assigned', 'boss', `Assigned mission to OpenClaw via ${command}.`, {
      runner: 'openclaw',
      assetId,
      command,
      agentId,
      timeoutSeconds,
    });
    await this.missions.updateMission(mission.id, {
      stage: 'executing',
      status: 'active',
      progress: Math.max(mission.progress, 20),
      risk: mission.risk,
      ownerNeeded: false,
      currentAssignee: assetId,
      nextAction: 'OpenClaw is running one agent turn.',
    });

    const prompt = options.message ?? buildOpenClawPrompt(mission);
    await this.record(mission.id, 'progress', assetId, 'OpenClaw agent turn started.', {
      runner: 'openclaw',
      timeoutSeconds,
    });

    const args = buildOpenClawArgs(prompt, { ...options, agentId });

    try {
      const execution = await runCommand(command, args, (timeoutSeconds + 10) * 1000);
      const response = parseOpenClawResponse(execution.stdout);
      const summary = response.text
        ? `OpenClaw completed: ${truncate(response.text, 500)}`
        : 'OpenClaw completed without textual output.';

      await this.record(mission.id, 'progress', assetId, summary, {
        runner: 'openclaw',
        stdout: truncate(execution.stdout, 4000),
        stderr: truncate(execution.stderr, 4000),
        parsed: response.parsed,
      });
      await this.missions.updateMission(mission.id, {
        stage: 'completed',
        status: 'completed',
        progress: 100,
        risk: 'low',
        ownerNeeded: false,
        currentAssignee: assetId,
        summary,
        nextAction: 'Generate report and judge the mission.',
        completedAt: new Date(),
      });
      await this.record(mission.id, 'completed', 'boss', summary, { runner: 'openclaw', assetId });

      return {
        missionId: mission.id,
        runner: 'openclaw',
        assetId,
        status: 'completed',
        escalatedToOwner: false,
        summary,
      };
    } catch (err) {
      const failure = commandFailureToText(err);
      const category = classifyRunnerFailure(failure);
      const escalatedToOwner = category === 'money' || category === 'permission' || category === 'destructive';
      const status = escalatedToOwner ? 'waiting_owner' : 'blocked';
      const summary = `OpenClaw runner failed: ${truncate(failure, 500)}`;

      await this.record(mission.id, escalatedToOwner ? 'resource_escalation' : 'blocked', assetId, summary, {
        runner: 'openclaw',
        category,
        command,
        args: redactArgs(args),
      });
      await this.missions.updateMission(mission.id, {
        stage: 'executing',
        status,
        progress: Math.max(mission.progress, 20),
        risk: 'high',
        ownerNeeded: escalatedToOwner,
        currentAssignee: assetId,
        summary,
        nextAction: escalatedToOwner
          ? 'Owner action is required before OpenClaw can continue.'
          : 'Check OpenClaw gateway health or rerun with --runner mock while the gateway is repaired.',
      });

      return {
        missionId: mission.id,
        runner: 'openclaw',
        assetId,
        status,
        escalatedToOwner,
        summary,
      };
    }
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

function defaultScenarioQuestion(scenario: MockRunScenario): string | undefined {
  if (scenario === 'happy') {
    return undefined;
  }
  if (scenario === 'permission') {
    return 'Need login permission for the private repository before continuing.';
  }
  if (scenario === 'blocked') {
    return 'Should I add tests before continuing?';
  }
  return 'Should I add tests before continuing?';
}

function buildOpenClawPrompt(mission: Mission): string {
  return [
    'You are a worker agent managed by Agent Boss.',
    `Mission ID: ${mission.id}`,
    `Goal: ${mission.goal}`,
    '',
    'Return a concise result for the Boss.',
    'If you are blocked by money, login, permission, destructive actions, or external delivery, say so explicitly.',
    'For reversible implementation details, make the safest reasonable choice and continue.',
  ].join('\n');
}

function buildOpenClawArgs(prompt: string, options: MissionRunOptions): string[] {
  const args = ['agent', '--message', prompt, '--json', '--timeout', String(options.timeoutSeconds ?? 120)];
  if (options.agentId) {
    args.push('--agent', options.agentId);
  }
  if (options.thinking) {
    args.push('--thinking', options.thinking);
  }
  return args;
}

function runCommand(command: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 5 }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function parseOpenClawResponse(stdout: string): { text: string; parsed?: unknown } {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return { text: '' };
  }

  const json = parseLastJson(trimmed);
  if (!json) {
    return { text: trimmed };
  }

  const text = pickText(json) ?? JSON.stringify(json);
  return { text, parsed: json };
}

function parseLastJson(value: string): unknown | undefined {
  try {
    return JSON.parse(value);
  } catch {
    // OpenClaw can print non-JSON warnings before the JSON payload.
  }

  const start = value.lastIndexOf('{');
  if (start === -1) {
    return undefined;
  }
  try {
    return JSON.parse(value.slice(start));
  } catch {
    return undefined;
  }
}

function pickText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = pickText(item);
      if (nested) {
        return nested;
      }
    }
    return undefined;
  }
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  for (const key of ['reply', 'message', 'output', 'text', 'content', 'payloads', 'result', 'response']) {
    const candidate = record[key];
    if (typeof candidate === 'string') {
      return candidate;
    }
    const nested = pickText(candidate);
    if (nested) {
      return nested;
    }
  }
  return undefined;
}

function commandFailureToText(err: unknown): string {
  if (err && typeof err === 'object') {
    const record = err as Record<string, unknown>;
    const outputParts = [
      typeof record.stderr === 'string' ? record.stderr : undefined,
      typeof record.stdout === 'string' ? record.stdout : undefined,
    ].filter(Boolean);
    if (outputParts.length > 0) {
      return cleanCommandOutput(outputParts.join('\n'));
    }
    if (typeof record.message === 'string') {
      return cleanCommandOutput(record.message.replace(/--message[\s\S]*?--json/, '--message [mission prompt redacted] --json'));
    }
  }
  return err instanceof Error ? err.message : String(err);
}

function cleanCommandOutput(value: string): string {
  const lines = value.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return false;
    }
    if (/^\(node:\d+\)/.test(trimmed)) {
      return false;
    }
    if (trimmed.includes('DeprecationWarning')) {
      return false;
    }
    if (trimmed.includes('OPENCLAW_PLUGIN_SDK_COMPAT_DEPRECATED')) {
      return false;
    }
    if (trimmed.includes('Bundled plugins must use scoped plugin-sdk subpaths')) {
      return false;
    }
    if (trimmed.includes('Migration guide: https://docs.openclaw.ai/plugins/sdk-migration')) {
      return false;
    }
    if (trimmed.startsWith('(Use `') && trimmed.includes('trace-deprecation')) {
      return false;
    }
    return true;
  });
  return lines.join('\n').trim() || value.trim();
}

function classifyRunnerFailure(failure: string): 'normal' | 'money' | 'permission' | 'destructive' {
  if (/(pay|paid|buy|purchase|billing|quota|token limit|budget|cost)/i.test(failure)) {
    return 'money';
  }
  if (/(login|auth|authorize|api key|secret|credential|private access|permission|unauthorized|forbidden)/i.test(failure)) {
    return 'permission';
  }
  if (/(delete|remove|overwrite|publish|deploy|merge|send message|drop|truncate)/i.test(failure)) {
    return 'destructive';
  }
  return 'normal';
}

function redactArgs(args: string[]): string[] {
  const redacted: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    redacted.push(args[index]);
    if (args[index] === '--message' && index + 1 < args.length) {
      redacted.push('[mission prompt redacted]');
      index += 1;
    }
  }
  return redacted;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}
