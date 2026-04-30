import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const cliPath = path.join(repoRoot, 'dist', 'cli.js');

function runCli(cwd, args) {
  return execFileSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
  });
}

function runCliWithInput(cwd, args, input) {
  return execFileSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
    input,
  });
}

function createFakeOpenClaw(cwd, script) {
  const file = path.join(cwd, 'fake-openclaw');
  writeFileSync(file, script);
  chmodSync(file, 0o755);
  return file;
}

test('CLI smoke: assets, mission, supervisor decision, report, judge', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'agent-boss-cli-'));

  assert.match(
    runCli(cwd, ['assets', 'add', 'codex', '--type', 'agent', '--name', 'Codex', '--plan', 'coding-plan', '--scenes', 'code,refactor', '--cost', 'subscription']),
    /Asset added: codex/,
  );
  assert.match(
    runCli(cwd, ['assets', 'add', 'claude-code', '--type', 'agent', '--name', 'Claude Code', '--plan', 'pro', '--scenes', 'review,design', '--cost', 'subscription']),
    /Asset added: claude-code/,
  );
  assert.match(runCli(cwd, ['assets', 'list']), /codex/);
  assert.match(
    runCli(cwd, ['assets', 'update', 'codex', '--status', 'limited', '--notes', 'quota is being watched']),
    /Asset updated: codex/,
  );

  const created = runCli(cwd, [
    'mission',
    'create',
    'refactor login module',
    '--assets',
    'codex,claude-code',
  ]);
  assert.match(created, /Mission created: m-001/);
  assert.match(created, /Assets: codex, claude-code/);

  assert.match(runCli(cwd, ['mission', 'list']), /m-001/);
  assert.match(
    runCli(cwd, [
      'mission',
      'update',
      'm-001',
      '--stage',
      'executing',
      '--progress',
      '35',
      '--assignee',
      'codex',
      '--next',
      'Review login edge cases.',
      '--event',
      'Implementation pass is moving.',
    ]),
    /Mission Status Board - m-001/,
  );
  assert.match(runCli(cwd, ['mission', 'watch', 'm-001']), /Review login edge cases/);
  assert.match(runCli(cwd, ['mission', 'log', 'm-001', '--limit', '3']), /Implementation pass is moving/);

  const decision = runCli(cwd, [
    'mission',
    'decide',
    'm-001',
    'Should I add tests for this refactor?',
  ]);
  assert.match(decision, /Add tests and continue without asking owner/);
  assert.match(decision, /Escalated to owner: no/);

  const report = runCli(cwd, ['mission', 'report', 'm-001']);
  assert.match(report, /Owner intervention not needed/);
  assert.match(report, /Resources: codex, claude-code/);

  assert.match(
    runCli(cwd, ['mission', 'complete', 'm-001', 'Login refactor finished with tests.']),
    /Mission completed: m-001/,
  );
  assert.match(
    runCli(cwd, ['judge', 'm-001', 'A', 'Safe and useful.', '--assets', 'codex,claude-code']),
    /Evaluation recorded:/,
  );

  assert.match(
    runCli(cwd, ['mission', 'create', 'ship a mock runner', '--assets', 'codex']),
    /Mission created: m-002/,
  );
  assert.match(
    runCli(cwd, ['mission', 'run', 'm-002', '--asset', 'codex', '--scenario', 'confirmation']),
    /Run completed: completed/,
  );
  const runLog = runCli(cwd, ['mission', 'log', 'm-002']);
  assert.match(runLog, /confirmation_requested/);
  assert.match(runLog, /Add tests and continue without asking owner/);
});

test('CLI mission run escalates permission issues to owner', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'agent-boss-run-'));

  runCli(cwd, ['assets', 'add', 'codex', '--type', 'agent', '--name', 'Codex']);
  runCli(cwd, ['mission', 'create', 'inspect private repo', '--assets', 'codex']);

  const output = runCli(cwd, ['mission', 'run', 'm-001', '--asset', 'codex', '--scenario', 'permission']);
  assert.match(output, /Run completed: waiting_owner/);
  assert.match(output, /Escalated to owner: yes/);
  assert.match(output, /Owner needed: yes/);
  assert.match(runCli(cwd, ['mission', 'log', 'm-001']), /resource_escalation/);
});

test('CLI supports an explicit database path', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'agent-boss-db-'));
  const dbPath = path.join(cwd, 'state', 'custom.sqlite');

  assert.match(
    runCli(cwd, ['--db', dbPath, 'assets', 'add', 'local-codex', '--type', 'agent', '--name', 'Local Codex']),
    /Asset added: local-codex/,
  );
  assert.match(runCli(cwd, ['--db', dbPath, 'assets', 'list']), /local-codex/);
});

test('CLI demo runs a full MVP mission loop', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'agent-boss-demo-'));

  const output = runCli(cwd, ['demo']);
  assert.match(output, /Demo mission created: m-001/);
  assert.match(output, /Run completed: completed/);
  assert.match(output, /Escalated to owner: no/);
  assert.match(output, /Demo judged: A/);
  assert.match(output, /MVP demo completed/);
  assert.match(runCli(cwd, ['mission', 'log', 'm-001']), /judged/);
});

test('CLI mission run can use an OpenClaw command adapter', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'agent-boss-openclaw-'));
  const fakeOpenClaw = createFakeOpenClaw(cwd, [
    '#!/bin/sh',
    'echo \'{"reply":"fake OpenClaw completed the mission"}\'',
    '',
  ].join('\n'));

  runCli(cwd, ['assets', 'add', 'openclaw', '--type', 'agent', '--name', 'OpenClaw']);
  runCli(cwd, ['mission', 'create', 'delegate work to openclaw', '--assets', 'openclaw']);

  const output = runCli(cwd, [
    'mission',
    'run',
    'm-001',
    '--runner',
    'openclaw',
    '--asset',
    'openclaw',
    '--openclaw-bin',
    fakeOpenClaw,
    '--timeout',
    '1',
  ]);
  assert.match(output, /Run completed: completed/);
  assert.match(output, /OpenClaw completed/);
  assert.match(runCli(cwd, ['mission', 'log', 'm-001']), /fake OpenClaw completed the mission/);
});

test('Interactive shell can run demo and list missions', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'agent-boss-interactive-'));

  const output = runCliWithInput(cwd, ['interactive'], 'demo\nmissions\nexit\n');
  assert.match(output, /Agent Boss Interactive MVP/);
  assert.match(output, /MVP demo completed/);
  assert.match(output, /m-001/);
  assert.match(output, /Bye/);
});
