import { Evaluation, Score } from '../domain/types';
import { Database } from '../storage/Database';
import { MissionStore } from './MissionStore';
import { randomId } from './ids';

export class EvaluationEngine {
  constructor(
    private readonly db: Database,
    private readonly missions: MissionStore,
  ) {}

  async judge(input: {
    missionId: string;
    score: Score;
    comment: string;
    assetIds: string[];
    qualityNotes?: string;
    costNotes?: string;
    lessons?: string;
  }): Promise<Evaluation> {
    const now = Date.now();
    const evaluation: Evaluation = {
      id: randomId('eval'),
      missionId: input.missionId,
      score: input.score,
      comment: input.comment,
      assetIds: input.assetIds,
      qualityNotes: input.qualityNotes,
      costNotes: input.costNotes,
      lessons: input.lessons,
      createdAt: new Date(now),
    };

    await this.db.run(
      `
      INSERT INTO evaluations (
        id, mission_id, score, comment, asset_ids, quality_notes, cost_notes, lessons, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        evaluation.id,
        evaluation.missionId,
        evaluation.score,
        evaluation.comment,
        JSON.stringify(evaluation.assetIds),
        evaluation.qualityNotes ?? null,
        evaluation.costNotes ?? null,
        evaluation.lessons ?? null,
        now,
      ],
    );

    await this.missions.addEvent({
      missionId: input.missionId,
      type: 'judged',
      actor: 'owner',
      content: `${input.score}: ${input.comment}`,
      metadata: { assetIds: input.assetIds },
    });

    return evaluation;
  }
}
