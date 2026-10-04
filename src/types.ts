export type RaceStatus = 'scheduled' | 'running' | 'finished';
export type ProtestStatus = 'pending' | 'submitted' | 'reviewing' | 'resolved' | 'rejected';
export type ResultStatus = 'provisional' | 'corrected' | 'official';

export interface Race {
  id: string;
  name: string;
  fleet: string;
  course: string;
  startsAt: string;
  /** 收船时刻，竞赛官可回填和更正；抗议截止点为其后 60 分钟 */
  boatInAt?: string;
  status: RaceStatus;
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

export interface Protest {
  id: string;
  raceId: string;
  entryId: string;
  reason: string;
  rule: string;
  status: ProtestStatus;
  decision: string;
  /** 迟交理由：收船 60 分钟后送达的抗议，仲裁补写理由并确认后才能进复核 */
  lateReason: string;
  /** 接受抗议时实际加到成绩上的处罚秒数，用于截止点重算时撤销 */
  appliedPenalty: number;
  /** 撤销处罚时恢复的成绩快照 */
  penaltyBefore?: number;
  resultStatusBefore?: ResultStatus;
  createdAt: string;
}

export interface TimelineEvent {
  id: string;
  time: string;
  type: 'race' | 'result' | 'protest' | 'system';
  message: string;
}
