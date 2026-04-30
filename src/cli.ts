#!/usr/bin/env node

import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { BossAgent } from './core/BossAgent';
import {
  AddAssetInput,
  AssetStatus,
  AssetType,
  CostMode,
  Mission,
  MissionStage,
  MissionEventType,
  MissionStatus,
  RiskLevel,
  Score,
  UpdateAssetInput,
} from './domain/types';
import { AppContext, createApp } from './core/App';
import { MissionRunOptions, MissionRunnerKind, MockRunScenario } from './core/MissionRunner';
import { parseBossBrainProvider } from './core/SettingsStore';

interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | true>;
}

interface GlobalArgs {
  command?: string;
  rest: string[];
  dbPath?: string;
  help: boolean;
  version: boolean;
}

type MissionUpdatePatch = Partial<{
  stage: MissionStage;
  status: MissionStatus;
  progress: number;
  risk: RiskLevel;
  ownerNeeded: boolean;
  currentAssignee: string;
  nextAction: string;
  summary: string;
  assetIds: string[];
}>;

async function main(): Promise<void> {
  const global = parseGlobalArgs(process.argv.slice(2));
  const { command, rest } = global;

  if (global.version) {
    console.log('agent-boss 0.1.0');
    return;
  }

  if (global.help || command === 'help' || command === undefined) {
    showHelp();
    return;
  }

  const app = await createApp({ dbPath: global.dbPath });
  try {
    switch (command) {
      case 'assets':
        await handleAssets(app, rest);
        break;
      case 'mission':
        await handleMission(app, rest);
        break;
      case 'judge':
        await handleJudge(app, rest);
        break;
      case 'demo':
        await handleDemo(app, rest);
        break;
      case 'boss':
        await handleBoss(app, rest);
        break;
      case 'interactive':
      case 'tui':
        await handleInteractive(app);
        break;
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  } finally {
    await app.db.close();
  }
}

async function handleBoss(app: AppContext, args: string[]): Promise<void> {
  const [action, ...rest] = args;
  if (!action) {
    await handleInteractive(app);
    return;
  }

  if (action === 'config') {
    await handleBossConfig(app, rest);
    return;
  }

  throw new Error('Usage: agent-boss boss [config|interactive]');
}

async function handleBossConfig(app: AppContext, args: string[]): Promise<void> {
  const [action, ...rest] = args;
  const parsed = parseArgs(rest);

  if (!action || action === 'show' || action === 'status') {
    const config = await app.settings.getBossBrainConfig();
    console.log([
      'Boss brain config',
      `Provider: ${config.provider}`,
      `Model: ${config.model ?? '-'}`,
      `Command: ${config.command ?? '-'}`,
      '',
      config.provider === 'rule'
        ? 'Mode: rule fallback. Boss can run without a model, but only with lightweight deterministic intent handling.'
        : 'Mode: model-backed. Boss uses this brain model for natural language intent handling, then falls back to rules if the model call fails.',
    ].join('\n'));
    return;
  }

  if (action === 'model') {
    const provider = parseBossBrainProvider(readFlag(parsed, 'provider') ?? parsed.positionals[0] ?? '');
    const model = readFlag(parsed, 'model') ?? parsed.positionals[1];
    const command = readFlag(parsed, 'command');
    await app.settings.setBossBrainConfig({ provider, model, command });
    console.log(`Boss brain configured: provider=${provider}, model=${model ?? '-'}`);
    return;
  }

  if (action === 'clear' || action === 'rule') {
    await app.settings.clearBossBrainConfig();
    console.log('Boss brain reset to rule fallback mode.');
    return;
  }

  throw new Error('Usage: agent-boss boss config [show|model --provider codex --model gpt-5.4|clear]');
}

async function handleAssets(app: AppContext, args: string[]): Promise<void> {
  const [action, ...rest] = args;
  const parsed = parseArgs(rest);

  if (action === 'list') {
    console.log(app.reporter.renderAssets(await app.assets.listAssets()));
    return;
  }

  if (action === 'show') {
    const id = parsed.positionals[0];
    requireArg(id, 'Usage: agent-boss assets show <assetId>');
    const asset = await app.assets.getAsset(id);
    if (!asset) {
      throw new Error(`Asset not found: ${id}`);
    }
    console.log(JSON.stringify(asset, null, 2));
    return;
  }

  if (action === 'add') {
    const id = parsed.positionals[0];
    requireArg(id, 'Usage: agent-boss assets add <id> --type agent --name "Codex"');
    const type = parseAssetType(readFlag(parsed, 'type') ?? 'agent');
    const input: AddAssetInput = {
      id,
      type,
      name: readFlag(parsed, 'name') ?? id,
      provider: readFlag(parsed, 'provider'),
      plan: readFlag(parsed, 'plan'),
      scenes: splitCsv(readFlag(parsed, 'scenes')),
      costMode: parseCostMode(readFlag(parsed, 'cost') ?? 'unknown'),
      status: parseAssetStatus(readFlag(parsed, 'status') ?? 'ready'),
      notes: readFlag(parsed, 'notes'),
    };
    const asset = await app.assets.addAsset(input);
    console.log(`Asset added: ${asset.id}`);
    return;
  }

  if (action === 'update') {
    const id = parsed.positionals[0];
    requireArg(id, 'Usage: agent-boss assets update <id> [--name "..."] [--status ready]');
    const patch = readAssetPatch(parsed);
    if (Object.keys(patch).length === 0) {
      throw new Error('No asset fields provided. Use flags like --name, --status, --plan, --scenes.');
    }
    const asset = await app.assets.updateAsset(id, patch);
    console.log(`Asset updated: ${asset.id}`);
    console.log(JSON.stringify(asset, null, 2));
    return;
  }

  throw new Error('Usage: agent-boss assets <add|update|list|show>');
}

async function handleMission(app: AppContext, args: string[]): Promise<void> {
  const [action, ...rest] = args;
  const parsed = parseArgs(rest);

  if (action === 'create') {
    const goal = parsed.positionals.join(' ');
    requireArg(goal, 'Usage: agent-boss mission create "<goal>"');
    const explicitAssets = splitCsv(readFlag(parsed, 'assets'));
    const candidates = explicitAssets
      ? await Promise.all(explicitAssets.map((assetId) => requireAsset(app, assetId)))
      : await app.assets.findCandidates(goal);
    const mission = await app.missions.createMission(goal, candidates.map((asset) => asset.id));
    console.log(`Mission created: ${mission.id}`);
    console.log(app.reporter.renderMissionDetail(mission, await app.missions.listEvents(mission.id)));
    return;
  }

  if (action === 'status' || action === 'list') {
    const id = parsed.positionals[0];
    if (!id) {
      console.log(app.reporter.renderMissionList(await app.missions.listMissions()));
      return;
    }
    const mission = await requireMission(app, id);
    console.log(app.reporter.renderMissionDetail(mission, await app.missions.listEvents(id)));
    return;
  }

  if (action === 'watch') {
    const id = parsed.positionals[0];
    requireArg(id, 'Usage: agent-boss mission watch <missionId> [--follow] [--interval 3] [--cycles 10]');
    const follow = parsed.flags.follow === true;
    const intervalSeconds = parsePositiveInteger(readFlag(parsed, 'interval') ?? '3', 'interval');
    const cycles = readFlag(parsed, 'cycles')
      ? parsePositiveInteger(readFlag(parsed, 'cycles') ?? '1', 'cycles')
      : follow ? Number.POSITIVE_INFINITY : 1;

    for (let index = 0; index < cycles; index += 1) {
      const mission = await requireMission(app, id);
      console.log(app.reporter.renderStatusBoard(mission, await app.missions.listRecentEvents(id, 20)));
      if (index < cycles - 1) {
        console.log('');
        await sleep(intervalSeconds * 1000);
      }
    }
    return;
  }

  if (action === 'log') {
    const id = parsed.positionals[0];
    requireArg(id, 'Usage: agent-boss mission log <missionId> [--limit 50]');
    await requireMission(app, id);
    const limit = readFlag(parsed, 'limit')
      ? parsePositiveInteger(readFlag(parsed, 'limit') ?? '50', 'limit')
      : undefined;
    const events = await app.missions.listEvents(id);
    console.log(app.reporter.renderMissionLog(limit ? events.slice(-limit) : events));
    return;
  }

  if (action === 'update') {
    const id = parsed.positionals[0];
    requireArg(id, 'Usage: agent-boss mission update <missionId> [--stage executing] [--progress 40]');
    const patch = readMissionPatch(parsed);
    if (Object.keys(patch).length === 0) {
      throw new Error('No mission fields provided. Use flags like --stage, --status, --progress, --risk, --next.');
    }
    const mission = await app.missions.updateMission(id, patch);
    const eventType = patch.status === 'blocked' ? 'blocked' : 'progress';
    await app.missions.addEvent({
      missionId: id,
      type: eventType,
      actor: readFlag(parsed, 'actor') ?? 'boss',
      content: readFlag(parsed, 'event') ?? 'Mission state updated.',
      metadata: { patch },
    });
    console.log(`Mission updated: ${id}`);
    console.log(app.reporter.renderStatusBoard(mission, await app.missions.listRecentEvents(id, 20)));
    return;
  }

  if (action === 'run') {
    const id = parsed.positionals[0];
    requireArg(id, 'Usage: agent-boss mission run <missionId> [--runner mock|openclaw|codex|claude|hermes] [--asset codex]');
    const assetId = readFlag(parsed, 'asset');
    if (assetId) {
      await requireAsset(app, assetId);
    }
    const mission = await requireMission(app, id);
    const result = await runMission(app, mission, parsed, assetId);
    const current = await requireMission(app, id);
    console.log(`Run completed: ${result.status}`);
    console.log(`Escalated to owner: ${result.escalatedToOwner ? 'yes' : 'no'}`);
    console.log(app.reporter.renderStatusBoard(current, await app.missions.listRecentEvents(id, 20)));
    return;
  }

  if (action === 'report') {
    const id = parsed.positionals[0];
    requireArg(id, 'Usage: agent-boss mission report <missionId>');
    const mission = await requireMission(app, id);
    console.log(app.reporter.renderReport(mission, await app.missions.listEvents(id)));
    await app.missions.addEvent({
      missionId: id,
      type: 'report',
      actor: 'boss',
      content: 'Report generated for owner.',
    });
    return;
  }

  if (action === 'event') {
    const [id, ...contentParts] = parsed.positionals;
    requireArg(id && contentParts.length > 0 ? id : '', 'Usage: agent-boss mission event <missionId> "<content>"');
    const type = parseMissionEventType(readFlag(parsed, 'type') ?? 'progress');
    const actor = readFlag(parsed, 'actor') ?? 'boss';
    const content = contentParts.join(' ');
    await app.missions.addEvent({ missionId: id, type, actor, content });
    await updateMissionFromEvent(app, id, type, actor, content);
    console.log(`Mission event recorded: ${id}`);
    return;
  }

  if (action === 'decide') {
    const [id, ...questionParts] = parsed.positionals;
    requireArg(id && questionParts.length > 0 ? id : '', 'Usage: agent-boss mission decide <missionId> "<question>"');
    const mission = await requireMission(app, id);
    const question = questionParts.join(' ');
    const decision = await app.supervisor.decide(mission, question);
    const eventType = decision.escalatedToOwner ? 'resource_escalation' : 'decision';
    await app.missions.addEvent({
      missionId: id,
      type: eventType,
      actor: 'boss',
      content: `${decision.decision} Reason: ${decision.reason}`,
      metadata: { question, category: decision.category },
    });
    await app.missions.updateMission(id, {
      status: decision.escalatedToOwner ? 'waiting_owner' : mission.status,
      ownerNeeded: decision.escalatedToOwner,
      risk: decision.escalatedToOwner ? 'high' : mission.risk,
      nextAction: decision.decision,
    });
    console.log(`Decision: ${decision.decision}`);
    console.log(`Escalated to owner: ${decision.escalatedToOwner ? 'yes' : 'no'}`);
    return;
  }

  if (action === 'complete') {
    const [id, ...summaryParts] = parsed.positionals;
    requireArg(id && summaryParts.length > 0 ? id : '', 'Usage: agent-boss mission complete <missionId> "<summary>"');
    const summary = summaryParts.join(' ');
    await app.missions.updateMission(id, {
      stage: 'completed',
      status: 'completed',
      progress: 100,
      risk: 'low',
      ownerNeeded: false,
      summary,
      nextAction: 'Judge the mission and record lessons.',
      completedAt: new Date(),
    });
    await app.missions.addEvent({ missionId: id, type: 'completed', actor: 'boss', content: summary });
    console.log(`Mission completed: ${id}`);
    return;
  }

  throw new Error('Usage: agent-boss mission <create|status|watch|log|update|run|report|event|decide|complete>');
}

async function handleJudge(app: AppContext, args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  const [missionId, score, ...commentParts] = parsed.positionals;
  requireArg(missionId && score && commentParts.length > 0 ? missionId : '', 'Usage: agent-boss judge <missionId> <score> "<comment>"');
  const mission = await requireMission(app, missionId);
  const evaluation = await app.evaluations.judge({
    missionId,
    score: parseScore(score),
    comment: commentParts.join(' '),
    assetIds: splitCsv(readFlag(parsed, 'assets')) ?? mission.assetIds,
    qualityNotes: readFlag(parsed, 'quality'),
    costNotes: readFlag(parsed, 'cost'),
    lessons: readFlag(parsed, 'lessons'),
  });
  console.log(`Evaluation recorded: ${evaluation.id}`);
}

async function handleDemo(app: AppContext, args: string[]): Promise<void> {
  const parsed = parseArgs(args);
  await ensureDemoAssets(app);

  const goal = readFlag(parsed, 'goal') ?? 'Demo MVP: Agent Boss runs a mission without noisy owner confirmations';
  const scenario = parseMockRunScenario(readFlag(parsed, 'scenario') ?? 'confirmation');
  const mission = await app.missions.createMission(goal, ['codex', 'claude-code']);
  console.log(`Demo mission created: ${mission.id}`);

  const result = await app.runner.run(mission, {
    assetId: 'codex',
    scenario,
    question: readFlag(parsed, 'question'),
  });
  const current = await requireMission(app, mission.id);
  console.log(`Run completed: ${result.status}`);
  console.log(`Escalated to owner: ${result.escalatedToOwner ? 'yes' : 'no'}`);
  console.log(app.reporter.renderStatusBoard(current, await app.missions.listRecentEvents(mission.id, 20)));

  console.log('');
  console.log('Report:');
  console.log(app.reporter.renderReport(current, await app.missions.listEvents(mission.id)));
  await app.missions.addEvent({
    missionId: mission.id,
    type: 'report',
    actor: 'boss',
    content: 'Demo report generated.',
  });

  const evaluation = await app.evaluations.judge({
    missionId: mission.id,
    score: result.escalatedToOwner ? 'B' : 'A',
    comment: result.escalatedToOwner
      ? 'Demo paused correctly for owner escalation.'
      : 'Demo completed the MVP mission loop.',
    assetIds: ['codex', 'claude-code'],
    qualityNotes: 'mission run produced event log, status board, report, and judge record',
    costNotes: 'mock runner has no external cost',
    lessons: 'The MVP loop is ready before real adapters are attached.',
  });
  console.log(`Demo judged: ${evaluation.score}`);
  console.log('MVP demo completed.');
}

async function handleInteractive(app: AppContext): Promise<void> {
  const rl = createInterface({ input, output, terminal: input.isTTY });
  const boss = new BossAgent(app);

  console.log('Agent Boss Direct Line');
  console.log('直接跟 Boss 说目标或问进展。输入 help 看示例，exit 退出。');

  try {
    if (input.isTTY) {
      output.write('owner> ');
    }

    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) {
        if (input.isTTY) {
          output.write('owner> ');
        }
        continue;
      }
      if (trimmed === 'exit' || trimmed === 'quit') {
        console.log('Bye.');
        return;
      }
      try {
        await handleInteractiveLine(app, boss, trimmed);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
      }
      if (input.isTTY) {
        output.write('owner> ');
      }
    }
  } finally {
    rl.close();
  }
}

async function handleInteractiveLine(app: AppContext, boss: BossAgent, line: string): Promise<void> {
  const [command, ...rest] = splitCommandLine(line);

  if (!command || command === 'help') {
    console.log(await boss.respond('help'));
    return;
  }

  if (command === 'demo') {
    console.log(await boss.respond('演示一下'));
    return;
  }

  if (command === 'assets') {
    console.log(await boss.respond('资产'));
    return;
  }

  if (command === 'asset') {
    await handleInteractiveAsset(app, rest);
    return;
  }

  if (command === 'missions') {
    console.log(await boss.respond('任务列表'));
    return;
  }

  if (command === 'create') {
    const parsed = parseArgs(rest);
    const goal = parsed.positionals.join(' ');
    requireArg(goal, 'Usage: create "<goal>" [--assets codex,claude-code]');
    const explicitAssets = splitCsv(readFlag(parsed, 'assets'));
    const candidates = explicitAssets
      ? await Promise.all(explicitAssets.map((assetId) => requireAsset(app, assetId)))
      : await app.assets.findCandidates(goal);
    const mission = await app.missions.createMission(goal, candidates.map((asset) => asset.id));
    console.log(`Mission created: ${mission.id}`);
    console.log(app.reporter.renderStatusBoard(mission, await app.missions.listRecentEvents(mission.id, 20)));
    return;
  }

  if (command === 'run') {
    const parsed = parseArgs(rest);
    const id = parsed.positionals[0];
    requireArg(id, 'Usage: run <missionId> [--runner mock|openclaw] [--asset openclaw]');
    const assetId = readFlag(parsed, 'asset');
    if (assetId) {
      await requireAsset(app, assetId);
    }
    const mission = await requireMission(app, id);
    const result = await runMission(app, mission, parsed, assetId);
    const current = await requireMission(app, id);
    console.log(`Run completed: ${result.status}`);
    console.log(app.reporter.renderStatusBoard(current, await app.missions.listRecentEvents(id, 20)));
    return;
  }

  if (command === 'status') {
    const id = rest[0];
    console.log(await boss.respond(id ? `状态 ${id}` : '状态'));
    return;
  }

  if (command === 'log') {
    const id = rest[0];
    console.log(await boss.respond(id ? `审计 ${id}` : '审计'));
    return;
  }

  if (command === 'report') {
    const id = rest[0];
    console.log(await boss.respond(id ? `汇报 ${id}` : '汇报'));
    return;
  }

  if (command === 'judge') {
    await handleJudge(app, rest);
    return;
  }

  console.log(await boss.respond(line));
}

async function handleInteractiveAsset(app: AppContext, args: string[]): Promise<void> {
  const [action, ...rest] = args;
  const parsed = parseArgs(rest);

  if (action === 'add') {
    const id = parsed.positionals[0];
    requireArg(id, 'Usage: asset add <id> --type agent --name "Codex"');
    const input: AddAssetInput = {
      id,
      type: parseAssetType(readFlag(parsed, 'type') ?? 'agent'),
      name: readFlag(parsed, 'name') ?? id,
      provider: readFlag(parsed, 'provider'),
      plan: readFlag(parsed, 'plan'),
      scenes: splitCsv(readFlag(parsed, 'scenes')),
      costMode: parseCostMode(readFlag(parsed, 'cost') ?? 'unknown'),
      status: parseAssetStatus(readFlag(parsed, 'status') ?? 'ready'),
      notes: readFlag(parsed, 'notes'),
    };
    const asset = await app.assets.addAsset(input);
    console.log(`Asset added: ${asset.id}`);
    return;
  }

  if (action === 'update') {
    const id = parsed.positionals[0];
    requireArg(id, 'Usage: asset update <id> [--status ready]');
    const asset = await app.assets.updateAsset(id, readAssetPatch(parsed));
    console.log(`Asset updated: ${asset.id}`);
    return;
  }

  throw new Error('Usage: asset <add|update>');
}

async function runMission(
  app: AppContext,
  mission: Mission,
  parsed: ParsedArgs,
  assetId?: string,
) {
  const runner = parseMissionRunnerKind(readFlag(parsed, 'runner') ?? 'mock');
  const options = readMissionRunOptions(parsed, assetId);

  if (runner === 'openclaw') {
    return app.openClawRunner.run(mission, options);
  }
  if (runner === 'codex') {
    return app.codexRunner.run(mission, options);
  }
  if (runner === 'claude') {
    return app.claudeRunner.run(mission, options);
  }
  if (runner === 'hermes') {
    return app.hermesRunner.run(mission, options);
  }

  return app.runner.run(mission, options);
}

async function ensureDemoAssets(app: AppContext): Promise<void> {
  await upsertAsset(app, {
    id: 'codex',
    type: 'agent',
    name: 'Codex',
    plan: 'coding-plan',
    scenes: ['code', 'refactor', 'mvp'],
    costMode: 'subscription',
    status: 'ready',
    notes: 'Default demo worker asset.',
  });
  await upsertAsset(app, {
    id: 'claude-code',
    type: 'agent',
    name: 'Claude Code',
    plan: 'pro',
    scenes: ['review', 'design'],
    costMode: 'subscription',
    status: 'ready',
    notes: 'Default demo reviewer asset.',
  });
}

async function upsertAsset(app: AppContext, input: AddAssetInput): Promise<void> {
  const existing = await app.assets.getAsset(input.id);
  if (!existing) {
    await app.assets.addAsset(input);
    return;
  }

  const { id, ...patch } = input;
  await app.assets.updateAsset(id, patch);
}

async function updateMissionFromEvent(
  app: AppContext,
  missionId: string,
  type: MissionEventType,
  actor: string,
  content: string,
): Promise<void> {
  const mission = await requireMission(app, missionId);

  if (type === 'progress') {
    await app.missions.updateMission(missionId, {
      stage: 'executing',
      status: 'active',
      progress: Math.min(90, mission.progress + 10),
      currentAssignee: actor,
      summary: content,
      nextAction: 'Review progress and record the next concrete event.',
    });
  }

  if (type === 'blocked') {
    await app.missions.updateMission(missionId, {
      status: 'blocked',
      risk: 'high',
      currentAssignee: actor,
      summary: content,
      nextAction: 'Use mission decide to resolve or escalate the blocker.',
    });
  }
}

async function requireMission(app: AppContext, id: string) {
  const mission = await app.missions.getMission(id);
  if (!mission) {
    throw new Error(`Mission not found: ${id}`);
  }
  return mission;
}

async function requireAsset(app: AppContext, id: string) {
  const asset = await app.assets.getAsset(id);
  if (!asset) {
    throw new Error(`Asset not found: ${id}`);
  }
  return asset;
}

function parseArgs(args: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | true> = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[index + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        index += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(arg);
    }
  }

  return { positionals, flags };
}

function splitCommandLine(line: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let escaped = false;

  for (const char of line) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (escaped) {
    current += '\\';
  }
  if (quote) {
    throw new Error('Unterminated quote in command.');
  }
  if (current) {
    args.push(current);
  }

  return args;
}

function parseGlobalArgs(args: string[]): GlobalArgs {
  const result: GlobalArgs = { rest: [], help: false, version: false };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--db') {
      const next = args[index + 1];
      if (!next || next.startsWith('--')) {
        throw new Error('Usage: agent-boss --db <path> <command>');
      }
      result.dbPath = next;
      index += 1;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      result.help = true;
      continue;
    }

    if (arg === '--version' || arg === '-v') {
      result.version = true;
      continue;
    }

    result.command = arg;
    result.rest = args.slice(index + 1);
    return result;
  }

  return result;
}

function readFlag(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.flags[name];
  return typeof value === 'string' ? value : undefined;
}

function readRawFlag(parsed: ParsedArgs, name: string): string | true | undefined {
  return parsed.flags[name];
}

function readAssetPatch(parsed: ParsedArgs): UpdateAssetInput {
  const patch: UpdateAssetInput = {};
  const type = readFlag(parsed, 'type');
  const name = readFlag(parsed, 'name');
  const provider = readFlag(parsed, 'provider');
  const plan = readFlag(parsed, 'plan');
  const scenes = splitCsv(readFlag(parsed, 'scenes'));
  const cost = readFlag(parsed, 'cost');
  const status = readFlag(parsed, 'status');
  const notes = readFlag(parsed, 'notes');

  if (type) patch.type = parseAssetType(type);
  if (name) patch.name = name;
  if (provider) patch.provider = provider;
  if (plan) patch.plan = plan;
  if (scenes) patch.scenes = scenes;
  if (cost) patch.costMode = parseCostMode(cost);
  if (status) patch.status = parseAssetStatus(status);
  if (notes) patch.notes = notes;

  return patch;
}

function readMissionPatch(parsed: ParsedArgs): MissionUpdatePatch {
  const patch: MissionUpdatePatch = {};
  const stage = readFlag(parsed, 'stage');
  const status = readFlag(parsed, 'status');
  const progress = readFlag(parsed, 'progress');
  const risk = readFlag(parsed, 'risk');
  const ownerNeeded = readRawFlag(parsed, 'owner-needed');
  const assignee = readFlag(parsed, 'assignee') ?? readFlag(parsed, 'current-assignee');
  const next = readFlag(parsed, 'next');
  const summary = readFlag(parsed, 'summary');
  const assetIds = splitCsv(readFlag(parsed, 'assets'));

  if (stage) patch.stage = parseMissionStage(stage);
  if (status) patch.status = parseMissionStatus(status);
  if (progress) patch.progress = parseProgress(progress);
  if (risk) patch.risk = parseRiskLevel(risk);
  if (ownerNeeded !== undefined) patch.ownerNeeded = parseBooleanFlag(ownerNeeded);
  if (assignee) patch.currentAssignee = assignee;
  if (next) patch.nextAction = next;
  if (summary) patch.summary = summary;
  if (assetIds) patch.assetIds = assetIds;

  return patch;
}

function readMissionRunOptions(parsed: ParsedArgs, assetId?: string): MissionRunOptions {
  const timeout = readFlag(parsed, 'timeout');
  return {
    assetId,
    scenario: parseMockRunScenario(readFlag(parsed, 'scenario') ?? 'confirmation'),
    question: readFlag(parsed, 'question'),
    command: readFlag(parsed, 'openclaw-bin') ?? readFlag(parsed, 'codex-bin') ?? readFlag(parsed, 'claude-bin') ?? readFlag(parsed, 'hermes-bin'),
    agentId: readFlag(parsed, 'openclaw-agent'),
    timeoutSeconds: timeout ? parsePositiveInteger(timeout, 'timeout') : undefined,
    thinking: readFlag(parsed, 'thinking'),
    message: readFlag(parsed, 'message'),
    model: readFlag(parsed, 'codex-model') ?? readFlag(parsed, 'claude-model') ?? readFlag(parsed, 'hermes-model'),
    sandbox: readFlag(parsed, 'codex-sandbox'),
    profile: readFlag(parsed, 'codex-profile'),
    provider: readFlag(parsed, 'hermes-provider'),
    permissionMode: readFlag(parsed, 'claude-permission-mode'),
  };
}

function splitCsv(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function requireArg(value: string | undefined, message: string): asserts value is string {
  if (!value) {
    throw new Error(message);
  }
}

function parseAssetType(value: string): AssetType {
  return parseUnion(value, ['agent', 'model', 'plan', 'tool'], 'asset type');
}

function parseAssetStatus(value: string): AssetStatus {
  return parseUnion(value, ['ready', 'limited', 'offline', 'unknown'], 'asset status');
}

function parseCostMode(value: string): CostMode {
  return parseUnion(value, ['free', 'subscription', 'usage', 'internal', 'unknown'], 'cost mode');
}

function parseMissionEventType(value: string): MissionEventType {
  return parseUnion(value, [
    'created',
    'planned',
    'assigned',
    'progress',
    'blocked',
    'confirmation_requested',
    'decision',
    'resource_escalation',
    'report',
    'completed',
    'failed',
    'judged',
  ], 'mission event type');
}

function parseMissionStage(value: string): MissionStage {
  return parseUnion(value, ['intake', 'planning', 'executing', 'reviewing', 'reporting', 'completed'], 'mission stage');
}

function parseMissionStatus(value: string): MissionStatus {
  return parseUnion(value, ['active', 'blocked', 'waiting_resource', 'waiting_owner', 'completed', 'failed', 'cancelled'], 'mission status');
}

function parseMissionRunnerKind(value: string): MissionRunnerKind {
  return parseUnion(value, ['mock', 'openclaw', 'codex', 'claude', 'hermes'], 'mission runner');
}

function parseMockRunScenario(value: string): MockRunScenario {
  return parseUnion(value, ['happy', 'confirmation', 'permission', 'blocked'], 'mock run scenario');
}

function parseRiskLevel(value: string): RiskLevel {
  return parseUnion(value, ['low', 'medium', 'high'], 'risk level');
}

function parseScore(value: string): Score {
  return parseUnion(value, ['A+', 'A', 'B+', 'B', 'C', 'D'], 'score');
}

function parseProgress(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
    throw new Error(`Invalid progress: ${value}. Allowed: integer 0-100`);
  }
  return parsed;
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid ${label}: ${value}. Allowed: positive integer`);
  }
  return parsed;
}

function parseBooleanFlag(value: string | true): boolean {
  if (value === true) {
    return true;
  }
  if (/^(true|yes|1)$/i.test(value)) {
    return true;
  }
  if (/^(false|no|0)$/i.test(value)) {
    return false;
  }
  throw new Error(`Invalid boolean: ${value}. Allowed: true/false`);
}

function parseUnion<T extends string>(value: string, allowed: readonly T[], label: string): T {
  if ((allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new Error(`Invalid ${label}: ${value}. Allowed: ${allowed.join(', ')}`);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function showHelp(): void {
  console.log(`
Agent Boss v0.4 skeleton

Usage:
  agent-boss [--db .agent-boss/dev.sqlite] <command>

  agent-boss demo
  agent-boss boss
  agent-boss boss config show
  agent-boss boss config model --provider codex --model gpt-5.4
  agent-boss boss config clear
  agent-boss interactive

  agent-boss assets add <id> --type agent --name "Codex" --plan coding-plan --scenes code,refactor
  agent-boss assets update <id> --status limited --notes "quota low"
  agent-boss assets list
  agent-boss assets show <id>

  agent-boss mission create "<goal>"
  agent-boss mission create "<goal>" --assets codex,claude-code
  agent-boss mission list
  agent-boss mission status [missionId]
  agent-boss mission watch <missionId> [--follow] [--interval 3] [--cycles 10]
  agent-boss mission log <missionId> [--limit 50]
  agent-boss mission update <missionId> --stage executing --progress 40 --next "review"
  agent-boss mission run <missionId> [--runner mock|openclaw|codex|claude|hermes] [--asset codex]
  agent-boss mission run <missionId> --runner openclaw --asset openclaw --timeout 120
  agent-boss mission run <missionId> --runner codex --asset codex --codex-model gpt-5.4 --timeout 180
  agent-boss mission run <missionId> --runner claude --asset claude-code --timeout 180
  agent-boss mission run <missionId> --runner hermes --asset hermes --timeout 180
  agent-boss mission report <missionId>
  agent-boss mission event <missionId> "<content>" --type progress --actor codex
  agent-boss mission decide <missionId> "<question>"
  agent-boss mission complete <missionId> "<summary>"

  agent-boss judge <missionId> <A+|A|B+|B|C|D> "<comment>" --assets codex,claude-code
`);
}

function showInteractiveHelp(): void {
  console.log(`
Interactive commands:
  默认只做两件事：给目标、看进度
  直接说自然语言：帮我重构登录模块
  问进度：现在进展如何
  要汇报：给我汇报
  演示：演示一下
  需要细节时：审计 m-001
  仍兼容这些显式命令：
  demo
  assets
  asset add <id> --type agent --name "Codex" --scenes code,review
  asset update <id> --status limited --notes "quota low"
  missions
  create "<goal>" [--assets codex,claude-code]
  run <missionId> [--runner mock|openclaw|codex|claude|hermes] [--asset codex] [--scenario happy|confirmation|permission|blocked]
  status <missionId>
  log <missionId>
  report <missionId>
  judge <missionId> <A+|A|B+|B|C|D> "<comment>" [--assets codex,claude-code]
  exit
`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
