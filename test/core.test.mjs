import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
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

test('MissionStore reserves unique mission ids across concurrent app contexts', async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'agent-boss-concurrent-missions-'));
  const dbPath = path.join(cwd, 'shared.sqlite');
  const apps = [];

  try {
    for (let index = 0; index < 4; index += 1) {
      apps.push(await createApp({ cwd, dbPath }));
    }

    const missions = await Promise.all(
      apps.map((app, index) => app.missions.createMission(`Concurrent mission ${index + 1}`, ['codex'])),
    );
    const ids = missions.map((mission) => mission.id);

    assert.equal(new Set(ids).size, missions.length);
    assert.deepEqual(ids.sort(), ['m-001', 'm-002', 'm-003', 'm-004']);
  } finally {
    await Promise.all(apps.map((app) => app.db.close()));
  }
});

test('OpenClawRunner extracts text from payload responses', async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'agent-boss-openclaw-payload-'));
  const fakeOpenClaw = path.join(cwd, 'fake-openclaw');
  writeFileSync(
    fakeOpenClaw,
    [
      '#!/bin/sh',
      'echo \'{"runId":"run-1","status":"ok","result":{"payloads":[{"text":"payload smoke ok","mediaUrl":null}]}}\'',
      '',
    ].join('\n'),
  );
  chmodSync(fakeOpenClaw, 0o755);

  const app = await createApp({ cwd });
  try {
    const mission = await app.missions.createMission('Run OpenClaw payload response', ['openclaw']);
    const result = await app.openClawRunner.run(mission, {
      assetId: 'openclaw',
      command: fakeOpenClaw,
      timeoutSeconds: 1,
    });
    const finalMission = await app.missions.getMission(mission.id);

    assert.equal(result.status, 'completed');
    assert.match(result.summary, /payload smoke ok/);
    assert.doesNotMatch(finalMission.summary, /runId/);
  } finally {
    await app.db.close();
  }
});

test('OpenClawRunner records a blocker when the command fails', async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'agent-boss-openclaw-core-'));
  const fakeOpenClaw = path.join(cwd, 'fake-openclaw');
  writeFileSync(fakeOpenClaw, ['#!/bin/sh', 'echo "gateway closed" >&2', 'exit 2', ''].join('\n'));
  chmodSync(fakeOpenClaw, 0o755);

  const app = await createApp({ cwd });
  try {
    const mission = await app.missions.createMission('Run OpenClaw through the gateway', ['openclaw']);
    const result = await app.openClawRunner.run(mission, {
      assetId: 'openclaw',
      command: fakeOpenClaw,
      timeoutSeconds: 1,
    });
    const finalMission = await app.missions.getMission(mission.id);
    const events = await app.missions.listEvents(mission.id);

    assert.equal(result.status, 'blocked');
    assert.equal(result.escalatedToOwner, false);
    assert.equal(finalMission.status, 'blocked');
    assert.ok(events.some((event) => event.type === 'blocked'));
    assert.match(finalMission.summary, /gateway closed/);
  } finally {
    await app.db.close();
  }
});

test('CodexRunner extracts text from JSONL exec responses', async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'agent-boss-codex-core-'));
  const fakeCodex = path.join(cwd, 'fake-codex');
  writeFileSync(
    fakeCodex,
    [
      '#!/bin/sh',
      'echo \'{"type":"thread.started","thread_id":"t-1"}\'',
      'echo \'{"type":"item.completed","item":{"id":"item-1","type":"agent_message","text":"codex payload ok"}}\'',
      'echo \'{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}\'',
      '',
    ].join('\n'),
  );
  chmodSync(fakeCodex, 0o755);

  const app = await createApp({ cwd });
  try {
    const mission = await app.missions.createMission('Run Codex through exec', ['codex']);
    const result = await app.codexRunner.run(mission, {
      assetId: 'codex',
      command: fakeCodex,
      timeoutSeconds: 1,
    });
    const finalMission = await app.missions.getMission(mission.id);

    assert.equal(result.status, 'completed');
    assert.match(result.summary, /codex payload ok/);
    assert.doesNotMatch(finalMission.summary, /thread.started/);
  } finally {
    await app.db.close();
  }
});

test('ClaudeRunner extracts result text from JSON output', async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'agent-boss-claude-core-'));
  const fakeClaude = path.join(cwd, 'fake-claude');
  writeFileSync(
    fakeClaude,
    [
      '#!/bin/sh',
      'echo \'{"type":"result","subtype":"success","is_error":false,"result":"claude payload ok","usage":{"input_tokens":1}}\'',
      '',
    ].join('\n'),
  );
  chmodSync(fakeClaude, 0o755);

  const app = await createApp({ cwd });
  try {
    const mission = await app.missions.createMission('Run Claude through print', ['claude-code']);
    const result = await app.claudeRunner.run(mission, {
      assetId: 'claude-code',
      command: fakeClaude,
      timeoutSeconds: 1,
    });
    const finalMission = await app.missions.getMission(mission.id);

    assert.equal(result.status, 'completed');
    assert.match(result.summary, /claude payload ok/);
    assert.doesNotMatch(finalMission.summary, /input_tokens/);
  } finally {
    await app.db.close();
  }
});

test('HermesRunner records one-shot text output', async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'agent-boss-hermes-core-'));
  const fakeHermes = path.join(cwd, 'fake-hermes');
  writeFileSync(fakeHermes, ['#!/bin/sh', 'echo "hermes payload ok"', ''].join('\n'));
  chmodSync(fakeHermes, 0o755);

  const app = await createApp({ cwd });
  try {
    const mission = await app.missions.createMission('Run Hermes through one-shot', ['codex']);
    const result = await app.hermesRunner.run(mission, {
      assetId: 'hermes',
      command: fakeHermes,
      timeoutSeconds: 1,
    });
    const finalMission = await app.missions.getMission(mission.id);

    assert.equal(result.status, 'completed');
    assert.match(result.summary, /hermes payload ok/);
    assert.match(finalMission.summary, /Hermes completed/);
    assert.deepEqual(finalMission.assetIds, ['codex', 'hermes']);
  } finally {
    await app.db.close();
  }
});
