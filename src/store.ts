import { configureStore, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { Protest, ProtestStatus, Race, RaceEntry, ResultStatus, TimelineEvent } from './types';
import { raceApi } from './api';

export interface AppState {
  races: Race[];
  entries: RaceEntry[];
  protests: Protest[];
  timeline: TimelineEvent[];
}

/** 抗议截止窗口：收船时刻后 60 分钟 */
export const PROTEST_WINDOW_MS = 60 * 60 * 1000;

export function protestDeadline(race: Race): Date | null {
  return race.boatInAt ? new Date(new Date(race.boatInAt).getTime() + PROTEST_WINDOW_MS) : null;
}

export function isProtestLate(race: Race, createdAt: string): boolean {
  const deadline = protestDeadline(race);
  return deadline !== null && new Date(createdAt).getTime() > deadline.getTime();
}

const initialEntries: RaceEntry[] = [
  { id: 'entry-1', boat: '海风号', sailNo: 'CHN 218', skipper: '林舟', elapsedSeconds: 3168, penaltySeconds: 0, resultStatus: 'provisional', note: '' },
  { id: 'entry-2', boat: '远岚号', sailNo: 'CHN 106', skipper: '周屿', elapsedSeconds: 3194, penaltySeconds: 30, resultStatus: 'provisional', note: '标记争议' },
  { id: 'entry-3', boat: '北辰号', sailNo: 'CHN 077', skipper: '许澄', elapsedSeconds: 3210, penaltySeconds: 0, resultStatus: 'official', note: '' }
];

const now = new Date();
const initialStart = new Date(now.getTime() + 15 * 60 * 1000).toISOString();

const initialState: AppState = {
  races: [{ id: 'race-1', name: '海湾长距离赛 第1轮', fleet: '统一级', course: 'W2 / 东北风 12节', startsAt: initialStart, status: 'scheduled' }],
  entries: initialEntries,
  protests: [{ id: 'protest-1', raceId: 'race-1', entryId: 'entry-2', reason: '起航后发生舷侧接触', rule: 'RRS 14', status: 'reviewing', decision: '', lateReason: '', appliedPenalty: 0, createdAt: now.toISOString() }],
  timeline: [
    { id: 'event-1', time: now.toISOString(), type: 'race', message: '航线 W2 已发布' },
    { id: 'event-2', time: new Date(now.getTime() + 2000).toISOString(), type: 'protest', message: '远岚号抗议进入复核' }
  ]
};

const shortId = (id: string) => id.slice(0, 6);

const slice = createSlice({
  name: 'regatta',
  initialState,
  reducers: {
    setRaceStatus(state, action: PayloadAction<{ id: string; status: Race['status'] }>) {
      const race = state.races.find((item) => item.id === action.payload.id);
      if (race) {
        race.status = action.payload.status;
        state.timeline.unshift({ id: crypto.randomUUID(), time: new Date().toISOString(), type: 'race', message: `${race.name} 状态更新为 ${race.status}` });
      }
    },
    /** 竞赛官回填/更正收船时刻，并按新截止点重算所有抗议的准入状态 */
    setBoatInAt(state, action: PayloadAction<{ id: string; boatInAt: string }>) {
      const race = state.races.find((item) => item.id === action.payload.id);
      if (!race) return;
      race.boatInAt = action.payload.boatInAt;
      const deadline = new Date(new Date(action.payload.boatInAt).getTime() + PROTEST_WINDOW_MS);
      const fmt = (d: Date) => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      state.timeline.unshift({ id: crypto.randomUUID(), time: new Date().toISOString(), type: 'system', message: `${race.name} 收船时刻更正为 ${fmt(new Date(action.payload.boatInAt))}，抗议截止点重算为 ${fmt(deadline)}` });

      for (const protest of state.protests.filter((item) => item.raceId === race.id)) {
        const late = new Date(protest.createdAt).getTime() > deadline.getTime();
        if (protest.status === 'pending') {
          if (!late) {
            protest.status = 'submitted';
            state.timeline.unshift({ id: crypto.randomUUID(), time: new Date().toISOString(), type: 'protest', message: `抗议 ${shortId(protest.id)} 截止点重算后在时限内，转出待定区` });
          }
        } else if (protest.status === 'submitted') {
          if (late) {
            protest.status = 'pending';
            state.timeline.unshift({ id: crypto.randomUUID(), time: new Date().toISOString(), type: 'protest', message: `抗议 ${shortId(protest.id)} 截止点重算后逾期，退回待定区` });
          }
        } else if (protest.status === 'reviewing') {
          if (late) {
            protest.status = 'pending';
            state.timeline.unshift({ id: crypto.randomUUID(), time: new Date().toISOString(), type: 'protest', message: `抗议 ${shortId(protest.id)} 原按旧截止点放行，重算后逾期，退回重判` });
          }
        } else if (protest.status === 'resolved') {
          if (late) {
            // 已据此改过的成绩跟着撤销
            const entry = state.entries.find((item) => item.id === protest.entryId);
            if (entry) {
              entry.penaltySeconds = protest.penaltyBefore ?? entry.penaltySeconds;
              entry.resultStatus = (protest.resultStatusBefore ?? entry.resultStatus) as ResultStatus;
            }
            protest.appliedPenalty = 0;
            protest.penaltyBefore = undefined;
            protest.resultStatusBefore = undefined;
            protest.status = 'pending';
            state.timeline.unshift({ id: crypto.randomUUID(), time: new Date().toISOString(), type: 'protest', message: `抗议 ${shortId(protest.id)} 重算后逾期，退回重判，已撤销据此更正的成绩` });
          }
        }
      }
    },
    saveResult(state, action: PayloadAction<{ id: string; elapsedSeconds: number; penaltySeconds: number; note: string; official: boolean }>) {
      const entry = state.entries.find((item) => item.id === action.payload.id);
      if (!entry) return;
      const changed = entry.elapsedSeconds !== action.payload.elapsedSeconds || entry.penaltySeconds !== action.payload.penaltySeconds;
      entry.elapsedSeconds = action.payload.elapsedSeconds;
      entry.penaltySeconds = action.payload.penaltySeconds;
      entry.note = action.payload.note;
      entry.resultStatus = action.payload.official ? 'official' : changed ? 'corrected' : 'provisional';
      state.timeline.unshift({ id: crypto.randomUUID(), time: new Date().toISOString(), type: 'result', message: `${entry.boat} 成绩更正为 ${entry.elapsedSeconds + entry.penaltySeconds} 秒` });
    },
    addProtest(state, action: PayloadAction<{ raceId: string; entryId: string; reason: string; rule: string }>) {
      // 同一场次同一船只的重复提交只留最早那条
      const duplicate = state.protests.find((item) => item.raceId === action.payload.raceId && item.entryId === action.payload.entryId);
      if (duplicate) {
        state.timeline.unshift({ id: crypto.randomUUID(), time: new Date().toISOString(), type: 'system', message: `重复提交的抗议（同场次同船只）已忽略，保留最早一条 ${shortId(duplicate.id)}` });
        return;
      }
      const race = state.races.find((item) => item.id === action.payload.raceId);
      const createdAt = new Date().toISOString();
      const late = race ? isProtestLate(race, createdAt) : false;
      const status: ProtestStatus = late ? 'pending' : 'submitted';
      const protest: Protest = { id: crypto.randomUUID(), ...action.payload, status, decision: '', lateReason: '', appliedPenalty: 0, createdAt };
      state.protests.unshift(protest);
      state.timeline.unshift({ id: crypto.randomUUID(), time: createdAt, type: 'protest', message: late ? `抗议逾期送达，进入待定区，等待仲裁补写迟交理由` : `收到 ${action.payload.rule} 抗议，等待复核` });
    },
    /** 仲裁补写迟交理由并确认，待定抗议转入复核队列 */
    confirmLateProtest(state, action: PayloadAction<{ id: string; lateReason: string }>) {
      const protest = state.protests.find((item) => item.id === action.payload.id);
      if (!protest) return;
      protest.lateReason = action.payload.lateReason;
      protest.status = 'submitted';
      state.timeline.unshift({ id: crypto.randomUUID(), time: new Date().toISOString(), type: 'protest', message: `抗议 ${shortId(protest.id)} 迟交理由已确认（${action.payload.lateReason}），转入复核队列` });
    },
    transitionProtest(state, action: PayloadAction<{ id: string; status: ProtestStatus; decision?: string; penaltySeconds?: number }>) {
      const protest = state.protests.find((item) => item.id === action.payload.id);
      if (!protest) return;
      protest.status = action.payload.status;
      protest.decision = action.payload.decision ?? protest.decision;
      if (action.payload.status === 'resolved' && action.payload.penaltySeconds) {
        const entry = state.entries.find((item) => item.id === protest.entryId);
        if (entry) {
          // 记下撤销前的成绩，供截止点重算时回滚
          protest.penaltyBefore = entry.penaltySeconds;
          protest.resultStatusBefore = entry.resultStatus;
          protest.appliedPenalty = action.payload.penaltySeconds;
          entry.penaltySeconds = action.payload.penaltySeconds;
          entry.resultStatus = 'corrected';
        }
      }
      state.timeline.unshift({ id: crypto.randomUUID(), time: new Date().toISOString(), type: 'protest', message: `抗议 ${shortId(protest.id)} 更新为 ${action.payload.status}${action.payload.decision ? `：${action.payload.decision}` : ''}` });
    }
  }
});

const STORAGE_KEY = 'regatta-control-v1';
const stored = localStorage.getItem(STORAGE_KEY);
const preloadedState = stored ? JSON.parse(stored) as AppState : initialState;

export const { setRaceStatus, setBoatInAt, saveResult, addProtest, confirmLateProtest, transitionProtest } = slice.actions;

export const store = configureStore({
  reducer: { regatta: slice.reducer, [raceApi.reducerPath]: raceApi.reducer },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(raceApi.middleware)
});
store.subscribe(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(store.getState().regatta)));

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
