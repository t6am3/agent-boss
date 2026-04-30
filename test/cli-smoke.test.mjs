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
    'case " $* " in *" --agent Nobita "*) ;; *) echo "missing default agent" >&2; exit 2 ;; esac',
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

test('CLI mission run can use a Codex command adapter', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'agent-boss-codex-'));
  const fakeCodex = createFakeOpenClaw(cwd, [
    '#!/bin/sh',
    'case " $* " in *" -m gpt-5.4 "*) ;; *) echo "missing default model" >&2; exit 2 ;; esac',
    'echo \'{"type":"thread.started","thread_id":"t-1"}\'',
    'echo \'{"type":"item.completed","item":{"type":"agent_message","text":"fake Codex completed the mission"}}\'',
    'echo \'{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}\'',
    '',
  ].join('\n'));

  runCli(cwd, ['assets', 'add', 'codex', '--type', 'agent', '--name', 'Codex']);
  runCli(cwd, ['mission', 'create', 'delegate work to codex', '--assets', 'codex']);

  const output = runCli(cwd, [
    'mission',
    'run',
    'm-001',
    '--runner',
    'codex',
    '--asset',
    'codex',
    '--codex-bin',
    fakeCodex,
    '--timeout',
    '1',
  ]);
  assert.match(output, /Run completed: completed/);
  assert.match(output, /Codex completed/);
  assert.match(runCli(cwd, ['mission', 'log', 'm-001']), /fake Codex completed the mission/);
});

test('CLI mission run can use a Claude Code command adapter', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'agent-boss-claude-'));
  const fakeClaude = createFakeOpenClaw(cwd, [
    '#!/bin/sh',
    'case " $* " in *" --output-format json "*) ;; *) echo "missing json output" >&2; exit 2 ;; esac',
    'echo \'{"type":"result","subtype":"success","is_error":false,"result":"fake Claude completed the mission"}\'',
    '',
  ].join('\n'));

  runCli(cwd, ['assets', 'add', 'claude-code', '--type', 'agent', '--name', 'Claude Code']);
  runCli(cwd, ['mission', 'create', 'delegate work to claude', '--assets', 'claude-code']);

  const output = runCli(cwd, [
    'mission',
    'run',
    'm-001',
    '--runner',
    'claude',
    '--asset',
    'claude-code',
    '--claude-bin',
    fakeClaude,
    '--timeout',
    '1',
  ]);
  assert.match(output, /Run completed: completed/);
  assert.match(output, /Claude Code completed/);
  assert.match(runCli(cwd, ['mission', 'log', 'm-001']), /fake Claude completed the mission/);
});

test('CLI mission run can use a Hermes command adapter', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'agent-boss-hermes-'));
  const fakeHermes = createFakeOpenClaw(cwd, [
    '#!/bin/sh',
    'case " $* " in *" --oneshot "*) ;; *) echo "missing oneshot" >&2; exit 2 ;; esac',
    'echo "fake Hermes completed the mission"',
    '',
  ].join('\n'));

  runCli(cwd, ['assets', 'add', 'hermes', '--type', 'agent', '--name', 'Hermes']);
  runCli(cwd, ['mission', 'create', 'delegate work to hermes', '--assets', 'hermes']);

  const output = runCli(cwd, [
    'mission',
    'run',
    'm-001',
    '--runner',
    'hermes',
    '--asset',
    'hermes',
    '--hermes-bin',
    fakeHermes,
    '--timeout',
    '1',
  ]);
  assert.match(output, /Run completed: completed/);
  assert.match(output, /Hermes completed/);
  assert.match(runCli(cwd, ['mission', 'log', 'm-001']), /fake Hermes completed the mission/);
});

test('Interactive shell can run demo and list missions', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'agent-boss-interactive-'));

  const output = runCliWithInput(cwd, ['interactive'], 'demo\nmissions\nexit\n');
  assert.match(output, /Agent Boss Direct Line/);
  assert.match(output, /Boss 演示完成/);
  assert.match(output, /m-001/);
  assert.match(output, /Bye/);
});

test('Boss direct line accepts natural language status, report, and audit', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'agent-boss-boss-line-'));

  const output = runCliWithInput(
    cwd,
    ['boss'],
    [
      '帮我写一个自然语言交互测试任务',
      '现在进展如何',
      '给我汇报',
      '审计',
      'exit',
      '',
    ].join('\n'),
  );

  assert.match(output, /Agent Boss Direct Line/);
  assert.match(output, /我已接单：m-001/);
  assert.match(output, /Boss Progress/);
  assert.match(output, /Boss 汇报 m-001/);
  assert.match(output, /审计 m-001/);
  assert.match(output, /自然语言交互测试任务/);
});

test('Boss direct line treats goal text containing progress words as a new mission', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'agent-boss-goal-intent-'));

  const output = runCliWithInput(
    cwd,
    ['boss'],
    '帮我做一个只看进度的产品方向 smoke\nexit\n',
  );

  assert.match(output, /我已接单：m-001/);
  assert.match(output, /只看进度的产品方向 smoke/);
});

test('Boss direct line can create and run from one natural language message', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'agent-boss-boss-run-'));

  const output = runCliWithInput(
    cwd,
    ['boss'],
    '用 mock 帮我跑一个自然语言自动派发任务\nexit\n',
  );

  assert.match(output, /我已接单并开始执行：m-001/);
  assert.match(output, /状态：执行完成/);
  assert.match(output, /是否需要你：不需要/);
  assert.match(output, /目标：跑一个自然语言自动派发任务/);
});
