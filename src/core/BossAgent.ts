import { AddAssetInput, Asset, Mission } from '../domain/types';
import type { AppContext } from './App';
import { MissionRunResult, MissionRunnerKind } from './MissionRunner';

interface RunnerSelection {
  runner: MissionRunnerKind;
  assetId?: string;
}

export class BossAgent {
  constructor(private readonly app: AppContext) {}

  async respond(input: string): Promise<string> {
    const line = input.trim();
    if (!line) {
      return '我在。你可以直接说目标，比如：帮我检查 README，或者问：现在进展如何？';
    }

    if (isHelpRequest(line)) {
      return renderHelp();
    }

    if (isGreeting(line)) {
      return '我在。你只管说目标，我来建 mission、选 worker、盯进度、折叠噪音，再向你汇报。';
    }

    if (isDemoRequest(line)) {
      return this.runDemo();
    }

    if (isAssetRequest(line)) {
      return this.renderAssets();
    }

    if (isAuditRequest(line)) {
      return this.renderAudit(extractMissionId(line));
    }

    if (isReportRequest(line)) {
      return this.renderReport(extractMissionId(line));
    }

    if (isDashboardRequest(line)) {
      return this.renderDashboard(extractMissionId(line));
    }

    if (isRunRequest(line)) {
      return this.runExistingMission(line);
    }

    return this.createMissionFromNaturalGoal(line);
  }

  private async runDemo(): Promise<string> {
    await this.ensureDefaultAssets();
    const mission = await this.app.missions.createMission(
      '演示 Agent Boss 单线工作流：接目标、派发、拦截琐碎确认、汇报并沉淀评价',
      ['codex', 'claude-code'],
    );
    const result = await this.app.runner.run(mission, {
      assetId: 'codex',
      scenario: 'confirmation',
    });
    const current = await this.requireMission(mission.id);
    await this.app.evaluations.judge({
      missionId: mission.id,
      score: result.escalatedToOwner ? 'B' : 'A',
      comment: result.escalatedToOwner
        ? '演示正确暂停给 Owner。'
        : '演示跑通：Boss 拦截了琐碎确认并完成汇报。',
      assetIds: current.assetIds,
      qualityNotes: '交互式 BossAgent 完成了 mission 创建、派发、状态板、汇报和评价。',
      costNotes: '演示使用 mock runner，无外部模型成本。',
      lessons: 'Owner 可以只跟 Boss 对话，子 agent 事件进入审计日志。',
    });

    return [
      'Boss 演示完成。',
      `我创建了 ${mission.id}，派给 codex，拦截了“要不要加测试”这种低价值确认，并完成了评价沉淀。`,
      '',
      await this.renderReport(mission.id),
      '',
      `要看子 agent 审计细节，直接说：审计 ${mission.id}`,
    ].join('\n');
  }

  private async renderAssets(): Promise<string> {
    const assets = await this.app.assets.listAssets();
    return [
      '这是我当前能管理的 AI 资产：',
      this.app.reporter.renderAssets(assets),
      '',
      assets.length > 0
        ? '你可以说：用 claude 帮我检查这个项目，或者：派给 hermes 跑一下。'
        : '现在还没有登记资产。你可以先用外层 CLI 添加，或者让我跑演示。'
    ].join('\n');
  }

  private async renderDashboard(missionId?: string): Promise<string> {
    const mission = missionId ? await this.requireMission(missionId) : await this.latestMission();
    const missions = await this.app.missions.listMissions();
    if (!mission) {
      return '现在还没有 mission。你可以直接说：帮我重构登录模块。';
    }

    return [
      'Boss Dashboard',
      '',
      this.app.reporter.renderMissionList(missions.slice(0, 8)),
      '',
      this.app.reporter.renderStatusBoard(mission, await this.app.missions.listRecentEvents(mission.id, 20)),
    ].join('\n');
  }

  private async renderReport(missionId?: string): Promise<string> {
    const mission = missionId ? await this.requireMission(missionId) : await this.latestMission();
    if (!mission) {
      return '现在还没有 mission 可以汇报。你可以直接把目标发给我。';
    }
    const events = await this.app.missions.listEvents(mission.id);
    await this.app.missions.addEvent({
      missionId: mission.id,
      type: 'report',
      actor: 'boss',
      content: 'BossAgent natural language report generated.',
    });

    return [
      `Boss 汇报 ${mission.id}`,
      '',
      this.app.reporter.renderReport(mission, events),
      '',
      '我默认折叠子 agent 的执行噪音；要看完整过程，说：审计 ' + mission.id,
    ].join('\n');
  }

  private async renderAudit(missionId?: string): Promise<string> {
    const mission = missionId ? await this.requireMission(missionId) : await this.latestMission();
    if (!mission) {
      return '现在还没有 mission 可以审计。';
    }
    const events = await this.app.missions.listEvents(mission.id);
    return [
      `审计 ${mission.id}`,
      `目标：${mission.goal}`,
      '',
      this.app.reporter.renderMissionLog(events),
      '',
      '这些是 Boss 和子 agent 的事件流：派发、进度、阻塞、决策、完成和评价都会在这里留痕。',
    ].join('\n');
  }

  private async runExistingMission(line: string): Promise<string> {
    const missionId = extractMissionId(line);
    const mission = missionId ? await this.requireMission(missionId) : await this.latestMission();
    if (!mission) {
      return '我还没有 mission 可以执行。你可以直接说目标，比如：用 hermes 帮我检查 README。';
    }

    const selection = await this.resolveRunner(line, mission);
    const result = await this.runMission(mission, selection);
    return this.renderRunResult(result);
  }

  private async createMissionFromNaturalGoal(line: string): Promise<string> {
    const selection = detectRunner(line);
    if (selection?.assetId) {
      await this.ensureKnownAsset(selection.assetId);
    }

    const goal = cleanGoal(line);
    const candidates = selection?.assetId
      ? [await this.app.assets.getAsset(selection.assetId)].filter(isAsset)
      : await this.app.assets.findCandidates(goal);
    const assetIds = candidates.map((asset) => asset.id);
    const mission = await this.app.missions.createMission(goal, assetIds);

    if (shouldAutoRun(line, selection)) {
      const resolved = selection ?? await this.resolveRunner(line, mission);
      const result = await this.runMission(mission, resolved);
      const renderedResult = await this.renderRunResult(result);
      return [
        `我已接单并开始执行：${mission.id}`,
        `目标：${mission.goal}`,
        '',
        renderedResult,
      ].join('\n');
    }

    return [
      `我已接单：${mission.id}`,
      `目标：${mission.goal}`,
      `我初步安排的资产：${assetIds.length > 0 ? assetIds.join(', ') : '暂未匹配到 ready worker'}`,
      `下一步：${mission.nextAction}`,
      '',
      '你可以继续说：开始执行，或问我：现在进展如何？',
    ].join('\n');
  }

  private async resolveRunner(line: string, mission: Mission): Promise<RunnerSelection> {
    const explicit = detectRunner(line);
    if (explicit) {
      if (explicit.assetId) {
        await this.ensureKnownAsset(explicit.assetId);
      }
      return explicit;
    }

    const preferredAsset = mission.currentAssignee ?? mission.assetIds[0];
    if (preferredAsset) {
      return runnerForAsset(preferredAsset);
    }

    return { runner: 'mock', assetId: 'mock-worker' };
  }

  private async runMission(mission: Mission, selection: RunnerSelection): Promise<MissionRunResult> {
    const options = { assetId: selection.assetId };
    if (selection.runner === 'openclaw') {
      return this.app.openClawRunner.run(mission, options);
    }
    if (selection.runner === 'codex') {
      return this.app.codexRunner.run(mission, options);
    }
    if (selection.runner === 'claude') {
      return this.app.claudeRunner.run(mission, options);
    }
    if (selection.runner === 'hermes') {
      return this.app.hermesRunner.run(mission, options);
    }
    return this.app.runner.run(mission, options);
  }

  private async latestMission(): Promise<Mission | undefined> {
    const missions = await this.app.missions.listMissions();
    return missions.find((mission) => mission.status !== 'completed' && mission.status !== 'cancelled') ?? missions[0];
  }

  private async requireMission(id: string): Promise<Mission> {
    const mission = await this.app.missions.getMission(id);
    if (!mission) {
      throw new Error(`Mission not found: ${id}`);
    }
    return mission;
  }

  private async ensureDefaultAssets(): Promise<void> {
    await this.ensureKnownAsset('codex');
    await this.ensureKnownAsset('claude-code');
  }

  private async ensureKnownAsset(assetId: string): Promise<void> {
    if (await this.app.assets.getAsset(assetId)) {
      return;
    }
    await this.app.assets.addAsset(defaultAsset(assetId));
  }

  private async renderRunResult(result: MissionRunResult): Promise<string> {
    const mission = await this.requireMission(result.missionId);
    return [
      `执行结果：${result.status}`,
      `Runner：${result.runner}`,
      `Worker：${result.assetId}`,
      `是否需要 Owner：${result.escalatedToOwner ? '需要' : '不需要'}`,
      `摘要：${result.summary}`,
      '',
      this.app.reporter.renderStatusBoard(mission, await this.app.missions.listRecentEvents(mission.id, 20)),
    ].join('\n');
  }
}

function detectRunner(line: string): RunnerSelection | undefined {
  if (/(claude\s*code|claude|克劳德)/i.test(line)) {
    return { runner: 'claude', assetId: 'claude-code' };
  }
  if (/hermes/i.test(line)) {
    return { runner: 'hermes', assetId: 'hermes' };
  }
  if (/(openclaw|open\s*claw)/i.test(line)) {
    return { runner: 'openclaw', assetId: 'openclaw' };
  }
  if (/codex/i.test(line)) {
    return { runner: 'codex', assetId: 'codex' };
  }
  if (/(mock|模拟|演示 worker)/i.test(line)) {
    return { runner: 'mock', assetId: 'mock-worker' };
  }
  return undefined;
}

function isAsset(asset: Asset | undefined): asset is Asset {
  return Boolean(asset);
}

function runnerForAsset(assetId: string): RunnerSelection {
  if (assetId === 'claude-code') {
    return { runner: 'claude', assetId };
  }
  if (assetId === 'hermes') {
    return { runner: 'hermes', assetId };
  }
  if (assetId === 'openclaw') {
    return { runner: 'openclaw', assetId };
  }
  if (assetId === 'codex') {
    return { runner: 'codex', assetId };
  }
  return { runner: 'mock', assetId };
}

function shouldAutoRun(line: string, selection?: RunnerSelection): boolean {
  return Boolean(selection) || /(开始|执行|跑|run|派发|派给|交给|立刻|马上)/i.test(line);
}

function cleanGoal(line: string): string {
  const cleaned = line
    .replace(/^(请|麻烦)?(boss|老板|agent boss)[,，\s]*/i, '')
    .replace(/^(请|麻烦)?(帮我|我要|我想|给我|创建一个?任务|新建一个?任务|开一个?任务)\s*/i, '')
    .replace(/^(请|麻烦)?(用|让|派给|交给)\s*(claude\s*code|claude|hermes|openclaw|open\s*claw|codex|mock|模拟)\s*(来|帮我|执行|跑)?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || line;
}

function extractMissionId(line: string): string | undefined {
  return /m-\d+/i.exec(line)?.[0].toLowerCase();
}

function isHelpRequest(line: string): boolean {
  return /^(help|帮助|怎么用|你能干啥|你会什么)$/i.test(line);
}

function isGreeting(line: string): boolean {
  return /^(hi|hello|你好|老板在吗|在吗)$/i.test(line);
}

function isDemoRequest(line: string): boolean {
  return /^(demo|演示|演示一下|给我演示|跑个演示)$/i.test(line);
}

function isAssetRequest(line: string): boolean {
  return /^(assets?|资产|员工|workers?|agents?|连接了谁|能用谁|有哪些 agent|有哪些模型)$/i.test(line);
}

function isAuditRequest(line: string): boolean {
  return /(审计|日志|log|子\s*agent|worker.*干了什么|干了啥|过程细节)/i.test(line);
}

function isReportRequest(line: string): boolean {
  return /(汇报|report|总结一下|结果如何|完成了吗)/i.test(line);
}

function isDashboardRequest(line: string): boolean {
  return /(dashboard|看板|状态板|进展|进度|做到哪|现在怎么样|status|missions?|任务列表)/i.test(line);
}

function isRunRequest(line: string): boolean {
  return /(开始执行|执行|跑一下|跑起来|run|派发|派给|交给)/i.test(line) && !looksLikeNewGoal(line);
}

function looksLikeNewGoal(line: string): boolean {
  return /(帮我|我要|我想|请你|创建|新建|开一个?任务)/i.test(line);
}

function renderHelp(): string {
  return [
    '你现在是在和 Agent Boss 单线对话。',
    '',
    '你可以直接说：',
    '- 帮我重构登录模块',
    '- 用 hermes 帮我检查 README',
    '- 现在进展如何？',
    '- 给我汇报',
    '- 审计 m-001',
    '- 演示一下',
    '- 资产',
    '',
    '我的默认行为：我会折叠子 agent 噪音，只把目标、进度、阻塞、风险、下一步和需要你介入的事汇报给你。',
  ].join('\n');
}

function defaultAsset(id: string): AddAssetInput {
  if (id === 'claude-code') {
    return {
      id,
      type: 'agent',
      name: 'Claude Code',
      plan: 'local',
      scenes: ['code', 'review', 'design'],
      costMode: 'subscription',
    };
  }
  if (id === 'hermes') {
    return {
      id,
      type: 'agent',
      name: 'Hermes',
      plan: 'local',
      scenes: ['automation', 'tools', 'agent'],
      costMode: 'subscription',
    };
  }
  if (id === 'openclaw') {
    return {
      id,
      type: 'agent',
      name: 'OpenClaw',
      plan: 'local',
      scenes: ['automation', 'gateway', 'feishu'],
      costMode: 'subscription',
    };
  }
  if (id === 'codex') {
    return {
      id,
      type: 'agent',
      name: 'Codex',
      plan: 'coding-plan',
      scenes: ['code', 'refactor', 'mvp'],
      costMode: 'subscription',
    };
  }
  return {
    id,
    type: 'agent',
    name: id,
    scenes: [],
    costMode: 'unknown',
  };
}
