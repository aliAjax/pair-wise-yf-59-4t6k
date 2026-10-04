export type RaceStatus = 'scheduled' | 'running' | 'finished';
// submitted: 已登记待复核 | pending: 迟交待定区 | reviewing: 复核中
// returned: 截止点重算后退回重判 | resolved: 抗议成立 | rejected: 抗议驳回
export type ProtestStatus = 'submitted' | 'pending' | 'reviewing' | 'returned' | 'resolved' | 'rejected';
export type ResultStatus = 'provisional' | 'corrected' | 'official';

export interface BoatRetrievalRecord {
  time: string;
  recordedAt: string;
  reason: string;
}

export interface Race {
  id: string;
  name: string;
  fleet: string;
  course: string;
  startsAt: string;
  status: RaceStatus;
  // 收船时刻（仲裁抗议时限的起算点），可由竞赛官回填、更正
  boatRetrievalAt: string | null;
  retrievalHistory: BoatRetrievalRecord[];
}

export interface RaceEntry {
  id: string;
  boat: string;
  sailNo: string;
  skipper: string;
  elapsedSeconds: number;
  penaltySeconds: number;
  resultStatus: ResultStatus;
  note: string;
}

export interface ProtestDecision {
  status: ProtestStatus;
  decision: string;
  at: string;
}

export interface ProtestAppliedChange {
  elapsedSeconds: number;
  penaltySeconds: number;
  note: string;
  resultStatus: ResultStatus;
}

export interface Protest {
  id: string;
  raceId: string;
  entryId: string;
  reason: string;
  rule: string;
  status: ProtestStatus;
  decision: string;
  createdAt: string;
  // 提交时依据的收船时刻与是否迟交（收船时刻被更正后会重算）
  wasLate: boolean;
  lateReason: string;
  lateConfirmedAt: string | null;
  // 判定经过，全部留痕到时间线
  history: ProtestDecision[];
  // 抗议成立时对成绩做过的改动快照，退回重判时据此撤销恢复
  appliedChange: ProtestAppliedChange | null;
  superseded: boolean;
}

export interface TimelineEvent {
  id: string;
  time: string;
  type: 'race' | 'result' | 'protest' | 'system';
  message: string;
}
