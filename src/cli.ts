#!/usr/bin/env node

import {
  AddAssetInput,
  AssetStatus,
  AssetType,
  CostMode,
  MissionEventType,
  Score,
} from './domain/types';
import { createApp } from './core/App';

interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | true>;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (command === 'help' || command === undefined) {
    showHelp();
    return;
  }

  const app = await createApp();
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
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  } finally {
    await app.db.close();
  }
}

async function handleAssets(app: Awaited<ReturnType<typeof createApp>>, args: string[]): Promise<void> {
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

  throw new Error('Usage: agent-boss assets <add|list|show>');
}

async function handleMission(app: Awaited<ReturnType<typeof createApp>>, args: string[]): Promise<void> {
  const [action, ...rest] = args;
  const parsed = parseArgs(rest);

  if (action === 'create') {
    const goal = parsed.positionals.join(' ');
    requireArg(goal, 'Usage: agent-boss mission create "<goal>"');
    const candidates = await app.assets.findCandidates(goal);
    const mission = await app.missions.createMission(goal, candidates.map((asset) => asset.id));
    console.log(`Mission created: ${mission.id}`);
    console.log(app.reporter.renderMissionDetail(mission, await app.missions.listEvents(mission.id)));
    return;
  }

  if (action === 'status') {
    const id = parsed.positionals[0];
    if (!id) {
      console.log(app.reporter.renderMissionList(await app.missions.listMissions()));
      return;
    }
    const mission = await requireMission(app, id);
    console.log(app.reporter.renderMissionDetail(mission, await app.missions.listEvents(id)));
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

  throw new Error('Usage: agent-boss mission <create|status|report|event|decide|complete>');
}

async function handleJudge(app: Awaited<ReturnType<typeof createApp>>, args: string[]): Promise<void> {
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

async function updateMissionFromEvent(
  app: Awaited<ReturnType<typeof createApp>>,
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

async function requireMission(app: Awaited<ReturnType<typeof createApp>>, id: string) {
  const mission = await app.missions.getMission(id);
  if (!mission) {
    throw new Error(`Mission not found: ${id}`);
  }
  return mission;
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

function readFlag(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.flags[name];
  return typeof value === 'string' ? value : undefined;
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

function parseScore(value: string): Score {
  return parseUnion(value, ['A+', 'A', 'B+', 'B', 'C', 'D'], 'score');
}

function parseUnion<T extends string>(value: string, allowed: readonly T[], label: string): T {
  if ((allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new Error(`Invalid ${label}: ${value}. Allowed: ${allowed.join(', ')}`);
}

function showHelp(): void {
  console.log(`
Agent Boss v0.4 skeleton

Usage:
  agent-boss assets add <id> --type agent --name "Codex" --plan coding-plan --scenes code,refactor
  agent-boss assets list
  agent-boss assets show <id>

  agent-boss mission create "<goal>"
  agent-boss mission status [missionId]
  agent-boss mission report <missionId>
  agent-boss mission event <missionId> "<content>" --type progress --actor codex
  agent-boss mission decide <missionId> "<question>"
  agent-boss mission complete <missionId> "<summary>"

  agent-boss judge <missionId> <A+|A|B+|B|C|D> "<comment>" --assets codex,claude-code
`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
