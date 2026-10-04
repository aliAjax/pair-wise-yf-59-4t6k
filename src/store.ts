import { configureStore, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Protest, ProtestStatus, Race, RaceEntry, TimelineEvent } from './types';
import { raceApi } from './api';

// 收船后抗议提交时限：60 分钟（RRS 61.3 / 62.2 的本地实现）
export const PROTEST_WINDOW_MS = 60 * 60 * 1000;

export interface AppState {
  races: Race[];
  entries: RaceEntry[];
  protests: Protest[];
  timeline: TimelineEvent[];
}

const initialEntries: RaceEntry[] = [
  { id: 'entry-1', boat: '海风号', sailNo: 'CHN 218', skipper: '林舟', elapsedSeconds: 3168, penaltySeconds: 0, resultStatus: 'provisional', note: '' },
  { id: 'entry-2', boat: '远岚号', sailNo: 'CHN 106', skipper: '周屿', elapsedSeconds: 3194, penaltySeconds: 30, resultStatus: 'provisional', note: '标记争议' },
  { id: 'entry-3', boat: '北辰号', sailNo: 'CHN 077', skipper: '许澄', elapsedSeconds: 3210, penaltySeconds: 0, resultStatus: 'official', note: '' }
];

const now = new Date();
const initialStart = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
// 示例收船时刻：45 分钟前，抗议截止点为 15 分钟前
const initialRetrieval = new Date(now.getTime() - 45 * 60 * 1000).toISOString();

const initialState: AppState = {
  races: [{
    id: 'race-1',
    name: '海湾长距离赛 第1轮',
    fleet: '统一级',
    course: 'W2 / 东北风 12节',
    startsAt: initialStart,
    status: 'scheduled',
    boatRetrievalAt: initialRetrieval,
    retrievalHistory: [{ time: initialRetrieval, recordedAt: now.toISOString(), reason: '竞赛官登记收船时刻' }]
  }],
  entries: initialEntries,
  protests: [
    {
      id: 'protest-1', raceId: 'race-1', entryId: 'entry-2', reason: '起航后发生舷侧接触', rule: 'RRS 14',
      status: 'reviewing', decision: '', createdAt: now.toISOString(),
      wasLate: false, lateReason: '', lateConfirmedAt: null, history: [], appliedChange: null, superseded: false
    }
  ],
  timeline: [
    { id: 'event-1', time: now.toISOString(), type: 'race', message: '航线 W2 已发布' },
    { id: 'event-2', time: new Date(now.getTime() + 2000).toISOString(), type: 'protest', message: '远岚号抗议进入复核' }
  ]
};

// 抗议截止点 = 收船时刻 + 60 分钟
export function protestDeadline(race: Race): string | null {
  if (!race.boatRetrievalAt) return null;
  return new Date(new Date(race.boatRetrievalAt).getTime() + PROTEST_WINDOW_MS).toISOString();
}

export function isProtestLate(protest: Protest, race: Race | undefined): boolean {
  return isLaterThanDeadline(protest.createdAt, race);
}

// 提交时间晚于抗议截止点（收船 + 60 分钟）即为迟交；未登记收船时刻时暂不算迟交
export function isLaterThanDeadline(createdAt: string, race: Race | undefined): boolean {
  const deadline = race ? protestDeadline(race) : null;
  return deadline !== null && new Date(createdAt).getTime() > new Date(deadline).getTime();
}

// 同一份抗议：同场次、同船、同规则且事件描述相同（忽略所有空白与大小写差异）
export function protestDuplicateKey(payload: { raceId: string; entryId: string; reason: string; rule: string }) {
  return [payload.raceId, payload.entryId, payload.rule.replace(/\s+/g, '').toUpperCase(), payload.reason.replace(/\s+/g, '').toLowerCase()].join('|');
}

function pushTimeline(state: AppState, type: TimelineEvent['type'], message: string, time = new Date().toISOString()) {
  state.timeline.unshift({ id: crypto.randomUUID(), time, type, message });
}

// 抗议成立时记录的成绩改动快照；退回重判时据此恢复
function snapshotEntry(entry: RaceEntry) {
  return {
    elapsedSeconds: entry.elapsedSeconds,
    penaltySeconds: entry.penaltySeconds,
    note: entry.note,
    resultStatus: entry.resultStatus
  };
}

function revokeAppliedChange(state: AppState, protest: Protest, reason: string) {
  if (!protest.appliedChange) return;
  const entry = state.entries.find((item) => item.id === protest.entryId);
  if (entry) {
    const before = snapshotEntry(entry);
    entry.elapsedSeconds = protest.appliedChange.elapsedSeconds;
    entry.penaltySeconds = protest.appliedChange.penaltySeconds;
    entry.note = protest.appliedChange.note;
    entry.resultStatus = protest.appliedChange.resultStatus;
    pushTimeline(state, 'result',
      `${entry.boat} 因抗议 ${protest.id.slice(0, 6)} ${reason}，撤销已据此做出的成绩改动（处罚 ${before.penaltySeconds}s → ${entry.penaltySeconds}s，状态恢复为 ${entry.resultStatus}）`);
  }
  protest.appliedChange = null;
}

// 收船时刻变动后重算每条抗议的迟交状态与所处队列
function pushProtestHistory(protest: Protest) {
  protest.history.push({ status: protest.status, decision: protest.decision, at: new Date().toISOString() });
}

function recomputeAfterRetrievalChange(state: AppState, race: Race) {
  const deadline = protestDeadline(race);
  for (const protest of state.protests) {
    if (protest.raceId !== race.id || protest.superseded) continue;
    const late = !!deadline && new Date(protest.createdAt).getTime() > new Date(deadline).getTime();
    const wasAdjudicated = protest.status === 'resolved' || protest.status === 'rejected';

    // 原来按旧截止点放行（已判定）的抗议，一律退回重判，已据此改过的成绩撤销恢复
    if (wasAdjudicated) {
      revokeAppliedChange(state, protest, '截止点重算，按旧截止点作出的判定退回重判');
      protest.status = 'returned';
      protest.decision = '';
      pushProtestHistory(protest);
      pushTimeline(state, 'protest',
        `抗议 ${protest.id.slice(0, 6)} 原按旧截止点判定，现退回重判，相关成绩改动已撤销`);
    }

    protest.wasLate = late;

    if (late) {
      if (protest.status === 'submitted' || protest.status === 'reviewing') {
        // 尚未判定且在新截止点下迟交：转入待定区，须仲裁补写迟交理由并确认
        protest.status = 'pending';
        protest.lateReason = '';
        protest.lateConfirmedAt = null;
        pushProtestHistory(protest);
        pushTimeline(state, 'protest',
          `抗议 ${protest.id.slice(0, 6)} 按新截止点（${formatTime(deadline!)}）判定为迟交，转入待定区等待迟交确认`);
      }
      // pending 保持待定；returned 保持退回（此前已确认过的迟交理由继续有效）
    } else if (protest.status === 'pending' || protest.status === 'returned') {
      // 在新截止点内：移出待定区 / 重判队列，回到正常待复核队列
      protest.status = 'submitted';
      protest.lateReason = '';
      protest.lateConfirmedAt = null;
      pushProtestHistory(protest);
      pushTimeline(state, 'protest',
        `抗议 ${protest.id.slice(0, 6)} 按新截止点（${formatTime(deadline!)}）判定为准时，回到待复核队列`);
    }
  }
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString();
}

const slice = createSlice({
  name: 'regatta',
  initialState,
  reducers: {
    setRaceStatus(state, action: PayloadAction<{ id: string; status: Race['status'] }>) {
      const race = state.races.find((item) => item.id === action.payload.id);
      if (race) {
        race.status = action.payload.status;
        pushTimeline(state, 'race', `${race.name} 状态更新为 ${race.status}`);
      }
    },
    // 竞赛官登记（回填）或更正收船时刻；截止点随之重算
    setBoatRetrieval(state, action: PayloadAction<{ id: string; time: string; reason: string }>) {
      const race = state.races.find((item) => item.id === action.payload.id);
      if (!race) return;
      const retrievalIso = new Date(action.payload.time).toISOString();
      const isCorrection = race.boatRetrievalAt !== null;
      if (isCorrection && race.boatRetrievalAt === retrievalIso) return;

      race.retrievalHistory.push({
        time: retrievalIso,
        recordedAt: new Date().toISOString(),
        reason: action.payload.reason.trim() || (isCorrection ? '竞赛官更正收船时刻' : '竞赛官回填收船时刻')
      });
      race.boatRetrievalAt = retrievalIso;
      const deadline = protestDeadline(race)!;
      pushTimeline(state, 'race',
        `${isCorrection ? '更正' : '登记'}${race.name}收船时刻：${formatTime(retrievalIso)}，抗议提交截止点${isCorrection ? '重算' : ''}为 ${formatTime(deadline)}`);
      recomputeAfterRetrievalChange(state, race);
    },
    saveResult(state, action: PayloadAction<{ id: string; elapsedSeconds: number; penaltySeconds: number; note: string; official: boolean }>) {
      const entry = state.entries.find((item) => item.id === action.payload.id);
      if (!entry) return;
      const changed = entry.elapsedSeconds !== action.payload.elapsedSeconds || entry.penaltySeconds !== action.payload.penaltySeconds;
      entry.elapsedSeconds = action.payload.elapsedSeconds;
      entry.penaltySeconds = action.payload.penaltySeconds;
      entry.note = action.payload.note;
      entry.resultStatus = action.payload.official ? 'official' : changed ? 'corrected' : 'provisional';
      pushTimeline(state, 'result', `${entry.boat} 成绩更正为 ${entry.elapsedSeconds + entry.penaltySeconds} 秒`);
    },
    addProtest(state, action: PayloadAction<{ raceId: string; entryId: string; reason: string; rule: string; submittedAt?: string }>) {
      const race = state.races.find((item) => item.id === action.payload.raceId);
      const key = protestDuplicateKey(action.payload);
      const duplicate = state.protests.find((item) => protestDuplicateKey(item) === key);
      if (duplicate) {
        // 同一份抗议重复提交：只留最早那条
        pushTimeline(state, 'system',
          `收到 ${action.payload.rule} 抗议的重复提交，与最早登记的抗议 ${duplicate.id.slice(0, 6)} 相同，仅保留最早一条`);
        return;
      }

      const createdAt = action.payload.submittedAt ?? new Date().toISOString();
      const late = isLaterThanDeadline(createdAt, race);
      const protest: Protest = {
        id: crypto.randomUUID(),
        ...action.payload,
        status: late ? 'pending' : 'submitted',
        decision: '',
        createdAt,
        wasLate: late,
        lateReason: '',
        lateConfirmedAt: null,
        history: [],
        appliedChange: null,
        superseded: false
      };
      state.protests.unshift(protest);
      const boatName = state.entries.find((entry) => entry.id === action.payload.entryId)?.boat ?? '';
      if (late) {
        pushTimeline(state, 'protest',
          `收到 ${boatName} ${action.payload.rule} 抗议，超过截止点（${formatTime(protestDeadline(race!)!)}）提交，进入待定区，待仲裁补写迟交理由并确认`,
          createdAt);
      } else {
        pushTimeline(state, 'protest',
          `收到 ${boatName} ${action.payload.rule} 抗议，在截止点内登记，等待复核`,
          createdAt);
      }
    },
    transitionProtest(state, action: PayloadAction<{ id: string; status: ProtestStatus; decision?: string; penaltySeconds?: number }>) {
      const protest = state.protests.find((item) => item.id === action.payload.id);
      if (!protest || protest.superseded) return;
      const previous = protest.status;

      if (action.payload.status === 'reviewing') {
        // 迟交待定 / 退回重判的抗议，未确认迟交理由前不得进入复核
        if (previous === 'pending' || (previous === 'returned' && protest.wasLate)) return;
      }

      protest.status = action.payload.status;
      if (action.payload.decision !== undefined) protest.decision = action.payload.decision;
      protest.history.push({
        status: action.payload.status,
        decision: protest.decision,
        at: new Date().toISOString()
      });

      if (action.payload.status === 'resolved') {
        const entry = state.entries.find((item) => item.id === protest.entryId);
        if (entry) {
          protest.appliedChange = snapshotEntry(entry);
          if (action.payload.penaltySeconds !== undefined) {
            entry.penaltySeconds = action.payload.penaltySeconds;
          }
          entry.resultStatus = 'corrected';
        }
      }

      pushTimeline(state, 'protest',
        `抗议 ${protest.id.slice(0, 6)} 判定经过：${previous} → ${action.payload.status}${protest.decision ? `（${protest.decision}）` : ''}`);
    },
    // 仲裁补写迟交理由并确认，抗议方可从待定区进入复核
    confirmLateProtest(state, action: PayloadAction<{ id: string; lateReason: string }>) {
      const protest = state.protests.find((item) => item.id === action.payload.id);
      if (!protest || protest.superseded) return;
      if (protest.status !== 'pending' && protest.status !== 'returned') return;
      if (!protest.wasLate || !action.payload.lateReason.trim()) return;

      const previous = protest.status;
      protest.lateReason = action.payload.lateReason.trim();
      protest.lateConfirmedAt = new Date().toISOString();
      protest.status = 'reviewing';
      protest.history.push({ status: 'reviewing', decision: protest.decision, at: protest.lateConfirmedAt });
      pushTimeline(state, 'protest',
        `仲裁确认抗议 ${protest.id.slice(0, 6)} 迟交理由：${protest.lateReason}，由${previous === 'pending' ? '待定区' : '重判队列'}进入复核`);
    }
  }
});

const STORAGE_KEY = 'regatta-control-v1';
const stored = localStorage.getItem(STORAGE_KEY);

function migrate(raw: AppState): AppState {
  const state = raw as Partial<AppState>;
  const races: Race[] = (state.races ?? initialState.races).map((race) => {
    const retrievalHistory = race.retrievalHistory ?? (race.boatRetrievalAt
      ? [{ time: race.boatRetrievalAt, recordedAt: new Date().toISOString(), reason: '竞赛官登记收船时刻' }]
      : []);
    return { ...race, boatRetrievalAt: race.boatRetrievalAt ?? null, retrievalHistory };
  });
  const protests: Protest[] = (state.protests ?? []).map((protest) => ({
    ...protest,
    wasLate: protest.wasLate ?? false,
    lateReason: protest.lateReason ?? '',
    lateConfirmedAt: protest.lateConfirmedAt ?? null,
    history: protest.history ?? [],
    appliedChange: protest.appliedChange ?? null,
    superseded: protest.superseded ?? false
  }));
  return {
    races,
    entries: state.entries ?? initialState.entries,
    protests,
    timeline: state.timeline ?? initialState.timeline
  };
}

const preloadedState: AppState = stored ? migrate(JSON.parse(stored) as AppState) : initialState;

export const { setRaceStatus, setBoatRetrieval, saveResult, addProtest, transitionProtest, confirmLateProtest } = slice.actions;

export const store = configureStore({
  reducer: { regatta: slice.reducer, [raceApi.reducerPath]: raceApi.reducer },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(raceApi.middleware),
  preloadedState: { regatta: preloadedState, [raceApi.reducerPath]: {} as never }
});
store.subscribe(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(store.getState().regatta)));

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
