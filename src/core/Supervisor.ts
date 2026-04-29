import { DecisionCategory, Mission, SupervisorDecision } from '../domain/types';
import { Database } from '../storage/Database';
import { randomId } from './ids';

export class Supervisor {
  constructor(private readonly db: Database) {}

  classify(question: string): DecisionCategory {
    if (/(pay|paid|buy|purchase|billing|quota|token limit|budget|cost)/i.test(question)) {
      return 'money';
    }
    if (/(login|auth|authorize|api key|secret|credential|private access|permission)/i.test(question)) {
      return 'permission';
    }
    if (/(delete|remove|overwrite|publish|deploy|merge|send message|external|drop|truncate)/i.test(question)) {
      return 'destructive';
    }
    return 'normal';
  }

  async decide(mission: Mission, question: string): Promise<SupervisorDecision> {
    const category = this.classify(question);
    const escalatedToOwner = category !== 'normal';
    const now = Date.now();
    const decision: SupervisorDecision = {
      id: randomId('dec'),
      missionId: mission.id,
      question,
      decision: escalatedToOwner ? 'Pause and ask owner before proceeding.' : defaultDecision(question),
      reason: escalatedToOwner
        ? `This is a ${category} issue and crosses the supervisor boundary.`
        : 'This is reversible execution detail, so Boss can decide without interrupting owner.',
      category,
      escalatedToOwner,
      createdAt: new Date(now),
    };

    await this.db.run(
      `
      INSERT INTO supervisor_decisions (
        id, mission_id, question, decision, reason, category, escalated_to_owner, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        decision.id,
        decision.missionId,
        decision.question,
        decision.decision,
        decision.reason,
        decision.category,
        decision.escalatedToOwner ? 1 : 0,
        now,
      ],
    );

    return decision;
  }
}

function defaultDecision(question: string): string {
  if (/(test|spec|coverage)/i.test(question)) {
    return 'Add tests and continue without asking owner.';
  }
  if (/(edge|boundary|null|empty|error)/i.test(question)) {
    return 'Cover the edge case and document the behavior.';
  }
  if (/(stuck|blocked|cannot|fail)/i.test(question)) {
    return 'Ask the worker for blocker, attempted fixes, and next concrete action.';
  }
  if (/(explain|document|summary)/i.test(question)) {
    return 'Keep the explanation concise and attach it to the mission report.';
  }
  return 'Choose the lowest-risk reversible option and keep the mission moving.';
}
