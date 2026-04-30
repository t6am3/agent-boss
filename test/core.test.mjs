import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createApp } = require('../dist/core/App.js');
const { Supervisor } = require('../dist/core/Supervisor.js');
const { Reporter } = require('../dist/core/Reporter.js');

test('Supervisor handles ordinary execution detail without owner escalation', () => {
  const supervisor = new Supervisor({});

  assert.equal(supervisor.classify('Should I add tests for this refactor?'), 'normal');
  assert.equal(supervisor.classify('Need login permission for private repo'), 'permission');
  assert.equal(supervisor.classify('Should I buy more tokens?'), 'money');
  assert.equal(supervisor.classify('Can I delete the old migration?'), 'destructive');
});

test('Reporter renders owner-oriented mission report', () => {
  const reporter = new Reporter();
  const mission = {
    id: 'm-001',
    goal: 'Refactor login module',
    stage: 'executing',
    status: 'active',
    progress: 40,
    risk: 'medium',
    ownerNeeded: false,
    currentAssignee: 'codex',
    nextAction: 'Ask reviewer to check auth edge cases.',
    assetIds: ['codex', 'claude-code'],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const output = reporter.renderReport(mission, [
    {
      id: 'ev-1',
      missionId: 'm-001',
      type: 'progress',
      actor: 'codex',
      content: 'Initial refactor draft is complete.',
      createdAt: new Date(),
    },
  ]);

  assert.match(output, /Owner intervention not needed/);
  assert.match(output, /Refactor login module/);
  assert.match(output, /Initial refactor draft is complete/);
  assert.match(output, /codex, claude-code/);
});

test('Reporter renders mission status board with blockers and next action', () => {
  const reporter = new Reporter();
  const mission = {
    id: 'm-002',
    goal: 'Build the mission status board',
    stage: 'executing',
    status: 'blocked',
    progress: 55,
    risk: 'high',
    ownerNeeded: false,
    currentAssignee: 'boss',
    nextAction: 'Reject noisy confirmation and keep moving.',
    assetIds: ['codex'],
    createdAt: new Date('2026-04-29T00:00:00Z'),
    updatedAt: new Date('2026-04-29T00:05:00Z'),
  };

  const output = reporter.renderStatusBoard(mission, [
    {
      id: 'ev-1',
      missionId: 'm-002',
      type: 'progress',
      actor: 'boss',
      content: 'CLI update command is implemented.',
      createdAt: new Date('2026-04-29T00:03:00Z'),
    },
    {
      id: 'ev-2',
      missionId: 'm-002',
      type: 'blocked',
      actor: 'worker',
      content: 'Worker asked a noisy reversible question.',
      createdAt: new Date('2026-04-29T00:04:00Z'),
    },
  ]);

  assert.match(output, /Mission Status Board - m-002/);
  assert.match(output, /Worker asked a noisy reversible question/);
  assert.match(output, /Reject noisy confirmation/);
});

test('MockMissionRunner completes a mission and records supervisor decisions', async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'agent-boss-core-'));
  const app = await createApp({ cwd });

  try {
    await app.assets.addAsset({
      id: 'codex',
      type: 'agent',
      name: 'Codex',
      scenes: ['code'],
    });
    const mission = await app.missions.createMission('Ship the runner loop', ['codex']);
    const result = await app.runner.run(mission, { assetId: 'codex', scenario: 'confirmation' });
    const finalMission = await app.missions.getMission(mission.id);
    const events = await app.missions.listEvents(mission.id);

    assert.equal(result.status, 'completed');
    assert.equal(result.escalatedToOwner, false);
    assert.equal(finalMission.status, 'completed');
    assert.equal(finalMission.progress, 100);
    assert.ok(events.some((event) => event.type === 'confirmation_requested'));
    assert.ok(events.some((event) => event.type === 'decision'));
  } finally {
    await app.db.close();
  }
});
