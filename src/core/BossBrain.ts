import { execFile } from 'node:child_process';
import { Mission } from '../domain/types';
import { BossBrainConfig } from './SettingsStore';

export type BossIntentName =
  | 'help'
  | 'greeting'
  | 'demo'
  | 'capabilities'
  | 'audit'
  | 'report'
  | 'progress'
  | 'run'
  | 'create';

export type BossIntentRunner = 'mock' | 'openclaw' | 'codex' | 'claude' | 'hermes';

export interface BossIntent {
  intent: BossIntentName;
  goal?: string;
  missionId?: string;
  runner?: BossIntentRunner;
  autoRun?: boolean;
}

export class BossBrain {
  async interpret(input: string, config: BossBrainConfig, missions: Mission[]): Promise<BossIntent | undefined> {
    if (config.provider === 'rule') {
      return undefined;
    }

    const prompt = buildIntentPrompt(input, missions);
    const command = config.command ?? defaultCommand(config.provider);
    const args = buildBrainArgs(prompt, config);
    const execution = await runCommand(command, args, 60_000);
    return parseIntent(cleanCommandOutput(execution.stdout));
  }
}

function buildIntentPrompt(input: string, missions: Mission[]): string {
  const missionSummary = missions.slice(0, 8).map((mission) => ({
    id: mission.id,
    goal: mission.goal,
    status: mission.status,
    progress: mission.progress,
  }));

  return [
    'You are the brain of Agent Boss. Classify the owner message into one JSON intent.',
    'Return JSON only. No markdown. No explanation.',
    '',
    'Allowed JSON shape:',
    '{"intent":"help|greeting|demo|capabilities|audit|report|progress|run|create","goal":"optional","missionId":"optional m-001","runner":"optional mock|openclaw|codex|claude|hermes","autoRun":true}',
    '',
    'Rules:',
    '- If the owner gives a goal, use intent=create even if the goal contains words like progress/status/report.',
    '- If the owner asks where things are, use progress.',
    '- If the owner asks for a summary/result, use report.',
    '- If the owner asks for logs/details/audit/sub-agent work, use audit.',
    '- If the owner asks what tools/capabilities/models are available, use capabilities.',
    '- If the owner says demo or 演示, use demo.',
    '- If the owner explicitly says run/start/execute an existing mission, use run.',
    '- Owner should not be asked to choose tools unless they explicitly named one.',
    '',
    `Known missions: ${JSON.stringify(missionSummary)}`,
    `Owner message: ${input}`,
  ].join('\n');
}

function buildBrainArgs(prompt: string, config: BossBrainConfig): string[] {
  if (config.provider === 'codex') {
    const args = ['exec', '--json', '--ephemeral'];
    args.push('-m', config.model ?? process.env.AGENT_BOSS_CODEX_MODEL ?? 'gpt-5.4');
    args.push('--sandbox', 'read-only', '-C', process.cwd(), prompt);
    return args;
  }

  if (config.provider === 'claude') {
    const args = ['-p', '--output-format', 'json', '--no-session-persistence'];
    if (config.model) {
      args.push('--model', config.model);
    }
    args.push(prompt);
    return args;
  }

  if (config.provider === 'hermes') {
    const args: string[] = [];
    if (config.model) {
      args.push('--model', config.model);
    }
    args.push('--oneshot', prompt);
    return args;
  }

  return [];
}

function defaultCommand(provider: BossBrainConfig['provider']): string {
  if (provider === 'codex') {
    return process.env.AGENT_BOSS_CODEX_BIN ?? 'codex';
  }
  if (provider === 'claude') {
    return process.env.AGENT_BOSS_CLAUDE_BIN ?? 'claude';
  }
  if (provider === 'hermes') {
    return process.env.AGENT_BOSS_HERMES_BIN ?? 'hermes';
  }
  return 'true';
}

function runCommand(command: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 * 2 }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function parseIntent(output: string): BossIntent | undefined {
  const text = extractText(output);
  const jsonText = extractJson(text);
  if (!jsonText) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(jsonText) as Partial<BossIntent>;
    if (!parsed.intent || !isBossIntentName(parsed.intent)) {
      return undefined;
    }
    return {
      intent: parsed.intent,
      goal: typeof parsed.goal === 'string' ? parsed.goal : undefined,
      missionId: typeof parsed.missionId === 'string' ? parsed.missionId.toLowerCase() : undefined,
      runner: isBossIntentRunner(parsed.runner) ? parsed.runner : undefined,
      autoRun: typeof parsed.autoRun === 'boolean' ? parsed.autoRun : undefined,
    };
  } catch {
    return undefined;
  }
}

function extractText(output: string): string {
  const trimmed = output.trim();
  if (!trimmed) {
    return '';
  }

  const parsed = parseJson(trimmed);
  if (parsed) {
    const text = pickText(parsed);
    if (text) {
      return text;
    }
  }

  let lastText = '';
  for (const line of trimmed.split(/\r?\n/)) {
    const event = parseJson(line.trim());
    if (!event || typeof event !== 'object') {
      continue;
    }
    const record = event as Record<string, unknown>;
    if (record.type === 'item.completed') {
      lastText = pickText(record.item) ?? lastText;
    }
  }
  return lastText || trimmed;
}

function extractJson(text: string): string | undefined {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : undefined;
}

function parseJson(value: string): unknown | undefined {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function pickText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const key of ['result', 'text', 'content', 'message', 'output', 'response']) {
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

function cleanCommandOutput(value: string): string {
  return value.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();
    return trimmed && !trimmed.includes('DeprecationWarning') && !/^\(node:\d+\)/.test(trimmed);
  }).join('\n').trim() || value.trim();
}

function isBossIntentName(value: unknown): value is BossIntentName {
  return typeof value === 'string'
    && ['help', 'greeting', 'demo', 'capabilities', 'audit', 'report', 'progress', 'run', 'create'].includes(value);
}

function isBossIntentRunner(value: unknown): value is BossIntentRunner {
  return typeof value === 'string'
    && ['mock', 'openclaw', 'codex', 'claude', 'hermes'].includes(value);
}
