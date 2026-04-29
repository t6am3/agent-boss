import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
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
});
