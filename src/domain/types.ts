export type AssetType = 'agent' | 'model' | 'plan' | 'tool';
export type AssetStatus = 'ready' | 'limited' | 'offline' | 'unknown';
export type CostMode = 'free' | 'subscription' | 'usage' | 'internal' | 'unknown';

export interface Asset {
  id: string;
  type: AssetType;
  name: string;
  provider?: string;
  plan?: string;
  scenes: string[];
  costMode: CostMode;
  status: AssetStatus;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AddAssetInput {
  id: string;
  type: AssetType;
  name: string;
  provider?: string;
  plan?: string;
  scenes?: string[];
  costMode?: CostMode;
  status?: AssetStatus;
  notes?: string;
}

export type MissionStage =
  | 'intake'
  | 'planning'
  | 'executing'
  | 'reviewing'
  | 'reporting'
  | 'completed';

export type MissionStatus =
  | 'active'
  | 'blocked'
  | 'waiting_resource'
  | 'waiting_owner'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface Mission {
  id: string;
  goal: string;
  stage: MissionStage;
  status: MissionStatus;
  progress: number;
  risk: RiskLevel;
  ownerNeeded: boolean;
  currentAssignee?: string;
  nextAction?: string;
  summary?: string;
  assetIds: string[];
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export type MissionEventType =
  | 'created'
  | 'planned'
  | 'assigned'
  | 'progress'
  | 'blocked'
  | 'confirmation_requested'
  | 'decision'
  | 'resource_escalation'
  | 'report'
  | 'completed'
  | 'failed'
  | 'judged';

export interface MissionEvent {
  id: string;
  missionId: string;
  type: MissionEventType;
  actor: string;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

export type DecisionCategory = 'normal' | 'money' | 'permission' | 'destructive';

export interface SupervisorDecision {
  id: string;
  missionId: string;
  question: string;
  decision: string;
  reason: string;
  category: DecisionCategory;
  escalatedToOwner: boolean;
  createdAt: Date;
}

export type Score = 'A+' | 'A' | 'B+' | 'B' | 'C' | 'D';

export interface Evaluation {
  id: string;
  missionId: string;
  score: Score;
  comment: string;
  assetIds: string[];
  qualityNotes?: string;
  costNotes?: string;
  lessons?: string;
  createdAt: Date;
}
