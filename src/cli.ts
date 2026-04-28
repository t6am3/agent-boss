#!/usr/bin/env node

/**
 * Agent Boss CLI
 * 
 * Commands:
 *   ask <query>              - Send query to recommended agent
 *   ask <agent> <query>     - Send query to specific agent
 *   ask all <query>         - Broadcast to all agents
 *   compare <taskId>        - Compare results side-by-side
 *   judge <taskId> <score>   - Judge task results
 *   leaderboard              - Show agent rankings
 *   group <agents> <topic>   - Start group discussion
 *   profile <agent>         - Show agent profile
 *   agents                   - List registered agents
 *   help                     - Show this help
 */

import { AgentBoss } from './core/AgentBoss';
import { AgentProfile } from './core/types';

const boss = new AgentBoss();

async function main() {
  await boss.start();
  
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    showHelp();
    return;
  }
  
  const command = args[0];
  
  switch (command) {
    case 'ask':
      await handleAsk(args.slice(1));
      break;
    case 'compare':
      await handleCompare(args.slice(1));
      break;
    case 'judge':
      await handleJudge(args.slice(1));
      break;
    case 'leaderboard':
      await handleLeaderboard(args.slice(1));
      break;
    case 'group':
      await handleGroup(args.slice(1));
      break;
    case 'profile':
      await handleProfile(args.slice(1));
      break;
    case 'agents':
      handleAgents();
      break;
    case 'help':
    default:
      showHelp();
  }
}

async function handleAsk(args: string[]) {
  if (args.length === 0) {
    console.error('Usage: ask [<agent>] <query>');
    return;
  }
  
  // Check if first arg is an agent name
  const status = boss.getStatus();
  let agentIds: string[] | undefined;
  let query: string;
  
  if (args[0] === 'all') {
    agentIds = status.agents;
    query = args.slice(1).join(' ');
  } else if (status.agents.includes(args[0])) {
    agentIds = [args[0]];
    query = args.slice(1).join(' ');
  } else {
    query = args.join(' ');
  }
  
  if (!query) {
    console.error('Query is required');
    return;
  }
  
  const task = await boss.ask(query, agentIds);
  console.log(`\nTask ID: ${task.id}`);
  console.log(`Agents: ${task.agents.join(', ')}`);
  
  // Display results
  for (const [agentId, result] of task.results.entries()) {
    const status = result.status === 'completed' ? '✅' : '❌';
    console.log(`\n${status} [${agentId}] (${result.timeSpent.toFixed(1)}s)`);
    console.log(result.content.substring(0, 500));
    if (result.content.length > 500) {
      console.log('... (truncated)');
    }
  }
}

async function handleCompare(args: string[]) {
  console.log('Compare not yet implemented');
}

async function handleJudge(args: string[]) {
  if (args.length < 2) {
    console.error('Usage: judge <taskId> <score> [<comment>]');
    return;
  }
  
  const taskId = args[0];
  const score = args[1] as any;
  const comment = args.slice(2).join(' ');
  
  // TODO: Get actual agent IDs from task
  console.log(`Judging task ${taskId} with score ${score}`);
  console.log(`Comment: ${comment || 'none'}`);
}

async function handleLeaderboard(args: string[]) {
  const scene = args[0];
  const leaderboard = boss.getLeaderboard(scene);
  
  console.log(`\n🏆 Leaderboard${scene ? ` - ${scene}` : ''}`);
  console.log('─'.repeat(50));
  
  leaderboard.forEach((profile, index) => {
    const rank = index + 1;
    const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '  ';
    const sceneScore = scene ? profile.sceneScores[scene]?.avg.toFixed(1) || '-' : '';
    
    console.log(
      `${medal} #${rank} ${profile.name.padEnd(15)} ELO: ${Math.round(profile.elo)}  Tasks: ${profile.totalTasks}${sceneScore ? `  Scene: ${sceneScore}` : ''}`
    );
  });
}

async function handleGroup(args: string[]) {
  if (args.length < 2) {
    console.error('Usage: group <agent1,agent2> <topic>');
    return;
  }
  
  const agentIds = args[0].split(',');
  const topic = args.slice(1).join(' ');
  
  console.log(`Starting group discussion with ${agentIds.join(', ')}`);
  console.log(`Topic: ${topic}`);
  
  const room = await boss.group(agentIds, topic);
  
  console.log(`\n📄 Discussion complete. Room ID: ${room.id}`);
  console.log(`Messages: ${room.messages.length}`);
}

async function handleProfile(args: string[]) {
  if (args.length === 0) {
    console.error('Usage: profile <agent>');
    return;
  }
  
  const agentId = args[0];
  const profile = boss.getProfile(agentId);
  
  if (!profile) {
    console.error(`Agent ${agentId} not found`);
    return;
  }
  
  renderProfile(profile);
}

function renderProfile(profile: AgentProfile) {
  console.log(`\n┌─ ${profile.name} ─────────────────────────┐`);
  console.log(`│ 总分: ${profile.avgScore.toFixed(1)}/5.0                    │`);
  console.log(`│ 任务数: ${profile.totalTasks}                          │`);
  console.log(`│ ELO: ${Math.round(profile.elo)}                         │`);
  console.log(`├─ 场景表现 ────────────────────────────┤`);
  
  const scenes = Object.entries(profile.sceneScores);
  if (scenes.length === 0) {
    console.log(`│ 暂无场景数据                          │`);
  } else {
    scenes.forEach(([scene, score]) => {
      const scoreStr = `${score.avg.toFixed(1)} (${score.count}次)`;
      console.log(`│  ${scene.padEnd(20)} ${scoreStr.padEnd(15)} │`);
    });
  }
  
  console.log(`├─ 能力标签 ────────────────────────────┤`);
  
  if (profile.capabilities.length === 0) {
    console.log(`│ 暂无标签                              │`);
  } else {
    const tags = profile.capabilities.map(c => `✅ ${c}`).join('  ');
    console.log(`│ ${tags.padEnd(38)} │`);
  }
  
  console.log(`└───────────────────────────────────────┘`);
}

function handleAgents() {
  const status = boss.getStatus();
  
  console.log('\n📋 Registered Agents');
  console.log('─'.repeat(40));
  
  status.agents.forEach((agentId) => {
    const profile = boss.getProfile(agentId);
    const status = profile ? `🟢 ready` : '⚪ unknown';
    console.log(`${status} ${agentId}`);
  });
  
  if (status.agents.length === 0) {
    console.log('No agents registered. Use registerAgent() to add agents.');
  }
}

function showHelp() {
  console.log(`
🤖 Agent Boss CLI

Usage:
  ask <query>                    Ask recommended agent
  ask <agent> <query>           Ask specific agent
  ask all <query>               Broadcast to all agents
  compare <taskId>              Compare results side-by-side
  judge <taskId> <score>        Judge results (A+/A/B+/B/C/D)
  leaderboard [<scene>]          Show agent rankings
  group <agents> <topic>          Start group discussion
  profile <agent>                Show agent profile
  agents                         List registered agents
  help                           Show this help

Examples:
  ask "optimize this SQL"
  ask claude "review this code"
  ask all "write a LRU cache"
  leaderboard sql-optimization
  group claude,codex "which design pattern?"
`);
}

main().catch(console.error);
