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
      return this.renderInternalCapabilities();
    }

    if (isGoalRequest(line)) {
      return this.createMissionFromNaturalGoal(line);
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
      `我创建了 ${mission.id}，自己推进执行，拦截了“要不要加测试”这种低价值确认，并完成了评价沉淀。`,
      '',
      await this.renderReport(mission.id),
      '',
      `要看底层审计细节，直接说：审计 ${mission.id}`,
    ].join('\n');
  }

  private async renderInternalCapabilities(): Promise<string> {
    const assets = await this.app.assets.listAssets();
    return [
      '你一般不用关心这些。',
      '',
      '我的默认工作方式是：你给目标，我在自己的 workspace 里用文件系统、bash 和必要的浏览器观察来推进；需要时我再调用本机已接上的 agent。',
      '',
      '当前内部连接状态：',
      assets.length > 0 ? this.app.reporter.renderAssets(assets) : '还没有登记 worker。',
      '',
      assets.length > 0
        ? '这些只作为审计和调度依据，默认不会要求你选择。'
        : '现在还没有登记 worker，但 Boss 仍然可以先创建 mission 和记录进度。'
    ].join('\n');
  }

  private async renderDashboard(missionId?: string): Promise<string> {
    const mission = missionId ? await this.requireMission(missionId) : await this.latestMission();
    const missions = await this.app.missions.listMissions();
    if (!mission) {
      return '现在还没有 mission。你可以直接说：帮我重构登录模块。';
    }

    return [
      'Boss Progress',
      '',
      `当前任务：${mission.id}（共 ${missions.length} 个 mission）`,
      renderOwnerProgress(mission, await this.app.missions.listRecentEvents(mission.id, 20)),
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
      renderOwnerProgress(mission, events),
      '',
      '我默认折叠执行细节；要看完整过程，说：审计 ' + mission.id,
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
      '这是底层事件流：派发、进度、阻塞、决策、完成和评价都会在这里留痕。默认不推给 Owner。',
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
      `当前进度：0% / planning`,
      `下一步：我会组织执行资源并开始推进。`,
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
    const statusLine = result.status === 'completed'
      ? '执行完成'
      : result.status === 'waiting_owner'
        ? '需要你介入'
        : '执行受阻';
    return [
      `状态：${statusLine}`,
      `是否需要你：${result.escalatedToOwner ? '需要' : '不需要'}`,
      `摘要：${toOwnerSummary(result.summary)}`,
      '',
      renderOwnerProgress(mission, await this.app.missions.listRecentEvents(mission.id, 20)),
    ].join('\n');
  }
}

function renderOwnerProgress(mission: Mission, events: { type: string; content: string }[]): string {
  const lastProgress = [...events].reverse().find((event) => event.type === 'progress');
  const lastBlocker = [...events].reverse().find((event) =>
    event.type === 'blocked' || event.type === 'resource_escalation',
  );
  const needOwner = mission.ownerNeeded ? '需要你介入' : '不需要你介入';
  const status = mission.status === 'completed'
    ? '已完成'
    : mission.status === 'blocked'
      ? '有阻塞'
      : mission.status === 'waiting_owner'
        ? '等你处理'
        : '推进中';

  return [
    `目标：${mission.goal}`,
    `状态：${status}，进度 ${mission.progress}%`,
    `风险：${mission.risk}，${needOwner}`,
    `最近进展：${lastProgress ? toOwnerSummary(lastProgress.content) : toOwnerSummary(mission.summary ?? '还没有新的执行进展。')}`,
    `阻塞：${lastBlocker ? lastBlocker.content : '无'}`,
    `下一步：${toOwnerNextAction(mission.nextAction)}`,
  ].join('\n');
}

function toOwnerSummary(summary: string): string {
  return summary
    .replace(/^OpenClaw completed:\s*/i, '已完成：')
    .replace(/^Codex completed:\s*/i, '已完成：')
    .replace(/^Claude Code completed:\s*/i, '已完成：')
    .replace(/^Hermes completed:\s*/i, '已完成：')
    .replace(/^Mock runner completed mission with .+\.$/i, '任务已完成，过程已记录。')
    .replace(/^Boss reviewed the result and accepted the mock output\.$/i, '我已验收当前结果。');
}

function toOwnerNextAction(nextAction?: string): string {
  if (!nextAction) {
    return '我会继续推进并在有风险时汇报。';
  }
  if (/Register or choose worker assets|Assign first pass/i.test(nextAction)) {
    return '我会组织执行资源并开始推进。';
  }
  if (/Generate report and judge/i.test(nextAction)) {
    return '我会整理结果并等待你的下一步指示。';
  }
  return nextAction;
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
  return /^(assets?|资产|员工|workers?|agents?|连接了谁|能用谁|有哪些 agent|有哪些模型|有什么工具|有哪些工具|工具|能力)$/i.test(line);
}

function isGoalRequest(line: string): boolean {
  return /^(请|麻烦)?(帮我|我要|我想|给我|创建一个?任务|新建一个?任务|开一个?任务)/i.test(line)
    && /(做|写|重构|检查|实现|修复|整理|接入|设计|跑|验证|测试|分析|调查|研究|生成|改|加|删|迁移|优化)/i.test(line);
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
    '默认模式：你给目标，只看进度；我管理过程和细节。',
    '',
    '直接说：',
    '- 帮我重构登录模块',
    '- 现在进展如何？',
    '- 给我汇报',
    '- 演示一下',
    '',
    '需要看细节时再说：审计 m-001。',
    '内部能力保持简单：workspace、文件系统、bash，必要时看浏览器或调用本机 agent。其他都不应该变成你要操作的工具面板。',
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
