import { Asset, Mission, MissionEvent } from '../domain/types';

export class Reporter {
  renderAssets(assets: Asset[]): string {
    if (assets.length === 0) {
      return 'No assets registered. Use: agent-boss assets add <id> --type agent --name "Codex"';
    }

    const rows = assets.map((asset) => [
      asset.id.padEnd(16),
      asset.type.padEnd(7),
      asset.status.padEnd(8),
      (asset.plan ?? '-').padEnd(14),
      (asset.scenes.join(',') || '-'),
    ].join('  '));

    return [
      ['id'.padEnd(16), 'type'.padEnd(7), 'status'.padEnd(8), 'plan'.padEnd(14), 'scenes'].join('  '),
      ...rows,
    ].join('\n');
  }

  renderMissionList(missions: Mission[]): string {
    if (missions.length === 0) {
      return 'No missions yet. Use: agent-boss mission create "<goal>"';
    }

    const rows = missions.map((mission) => [
      mission.id.padEnd(8),
      mission.stage.padEnd(10),
      `${mission.progress}%`.padEnd(8),
      mission.risk.padEnd(7),
      mission.ownerNeeded ? 'yes'.padEnd(6) : 'no'.padEnd(6),
      truncate(mission.nextAction ?? '-', 48),
    ].join('  '));

    return [
      ['id'.padEnd(8), 'stage'.padEnd(10), 'progress'.padEnd(8), 'risk'.padEnd(7), 'owner'.padEnd(6), 'next'].join('  '),
      ...rows,
    ].join('\n');
  }

  renderMissionDetail(mission: Mission, events: MissionEvent[] = []): string {
    const recent = events.slice(-5).map((event) =>
      `- ${formatTime(event.createdAt)} [${event.type}/${event.actor}] ${event.content}`,
    );

    return [
      `Mission: ${mission.id}`,
      `Goal: ${mission.goal}`,
      `Stage: ${mission.stage}`,
      `Status: ${mission.status}`,
      `Progress: ${mission.progress}%`,
      `Risk: ${mission.risk}`,
      `Owner needed: ${mission.ownerNeeded ? 'yes' : 'no'}`,
      `Current assignee: ${mission.currentAssignee ?? '-'}`,
      `Assets: ${mission.assetIds.length > 0 ? mission.assetIds.join(', ') : '-'}`,
      `Next: ${mission.nextAction ?? '-'}`,
      `Summary: ${mission.summary ?? '-'}`,
      `Updated: ${formatTime(mission.updatedAt)}`,
      '',
      'Recent events:',
      recent.length > 0 ? recent.join('\n') : '- none',
    ].join('\n');
  }

  renderStatusBoard(mission: Mission, events: MissionEvent[]): string {
    const recent = events.slice(-6);
    const blockers = events.filter((event) =>
      event.type === 'blocked' || event.type === 'resource_escalation',
    );
    const lastBlocker = blockers.at(-1);
    const lastProgress = events.filter((event) => event.type === 'progress').at(-1);

    return [
      `Mission Status Board - ${mission.id}`,
      `Goal: ${mission.goal}`,
      '',
      `Stage: ${mission.stage} | Status: ${mission.status} | Progress: ${mission.progress}%`,
      `Risk: ${mission.risk} | Owner needed: ${mission.ownerNeeded ? 'yes' : 'no'}`,
      `Current assignee: ${mission.currentAssignee ?? '-'}`,
      `Assets: ${mission.assetIds.length > 0 ? mission.assetIds.join(', ') : '-'}`,
      `Last progress: ${lastProgress ? lastProgress.content : mission.summary ?? 'No progress recorded yet.'}`,
      `Blocker: ${lastBlocker ? lastBlocker.content : 'None recorded.'}`,
      `Next: ${mission.nextAction ?? 'Record the next event or assign a worker.'}`,
      `Updated: ${formatTime(mission.updatedAt)} (${formatAge(mission.updatedAt)} ago)`,
      '',
      'Recent signal:',
      recent.length > 0
        ? recent.map((event) => `- ${formatTime(event.createdAt)} [${event.type}/${event.actor}] ${event.content}`).join('\n')
        : '- none',
    ].join('\n');
  }

  renderMissionLog(events: MissionEvent[]): string {
    if (events.length === 0) {
      return 'No mission events recorded.';
    }

    return events.map((event) => {
      const metadata = event.metadata ? ` ${JSON.stringify(event.metadata)}` : '';
      return `${formatTime(event.createdAt)}  ${event.type.padEnd(22)}  ${event.actor.padEnd(12)}  ${event.content}${metadata}`;
    }).join('\n');
  }

  renderReport(mission: Mission, events: MissionEvent[]): string {
    const progress = events.filter((event) => event.type === 'progress').slice(-3);
    const blockers = events.filter((event) => event.type === 'blocked' || event.type === 'resource_escalation').slice(-3);

    return [
      mission.ownerNeeded ? 'Owner intervention required.' : 'Owner intervention not needed.',
      `Goal: ${mission.goal}`,
      `Progress: ${mission.progress}% / ${mission.stage}`,
      `Risk: ${mission.risk}`,
      `Done: ${progress.length > 0 ? progress.map((event) => event.content).join(' | ') : mission.summary ?? 'No progress recorded yet.'}`,
      `Blockers: ${blockers.length > 0 ? blockers.map((event) => event.content).join(' | ') : 'None recorded.'}`,
      `Resources: ${mission.assetIds.length > 0 ? mission.assetIds.join(', ') : 'None assigned.'}`,
      `Next: ${mission.nextAction ?? 'Record the next event or assign a worker.'}`,
    ].join('\n');
  }
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

function formatTime(date: Date): string {
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, 'Z');
}

function formatAge(date: Date): string {
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  return `${Math.floor(hours / 24)}d`;
}
