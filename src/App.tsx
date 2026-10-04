import { useEffect, useMemo, useState } from 'react';
import { App as AntApp, Alert, Badge, Button, Card, Col, Descriptions, Empty, Form, Input, Layout, List, Menu, Row, Select, Space, Statistic, Table, Tag, Timeline, Typography, message } from 'antd';
import { ClockCircleOutlined, FlagOutlined, PlusOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { addProtest, confirmLateProtest, protestDeadline, protestDuplicateKey, saveResult, setBoatRetrieval, setRaceStatus, transitionProtest, type AppDispatch, type RootState } from './store';
import { useGetOfficialsQuery } from './api';
import type { Protest, ProtestStatus, RaceEntry } from './types';

const { Header, Content, Sider } = Layout;

const resultSchema = z.object({
  id: z.string().min(1),
  elapsedSeconds: z.number().positive(),
  penaltySeconds: z.number().min(0),
  note: z.string().max(120)
});
const protestSchema = z.object({
  entryId: z.string().min(1),
  reason: z.string().min(4),
  rule: z.string().min(2)
});

const STATUS_META: Record<ProtestStatus, { label: string; color: string }> = {
  submitted: { label: '已登记待复核', color: 'default' },
  pending: { label: '迟交待定', color: 'warning' },
  reviewing: { label: '复核中', color: 'processing' },
  returned: { label: '退回重判', color: 'error' },
  resolved: { label: '抗议成立', color: 'success' },
  rejected: { label: '已驳回', color: 'default' }
};

function countdown(target: string, now: number) {
  const seconds = Math.max(0, Math.floor((new Date(target).getTime() - now) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

// ISO 时间 -> datetime-local 输入框值
function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function ControlPage() {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const race = useSelector((state: RootState) => state.regatta.races[0]);
  const entries = useSelector((state: RootState) => state.regatta.entries);
  const [now, setNow] = useState(Date.now());
  const [retrievalValue, setRetrievalValue] = useState(race.boatRetrievalAt ? toLocalInput(race.boatRetrievalAt) : toLocalInput(new Date().toISOString()));
  const [retrievalReason, setRetrievalReason] = useState('');
  const [api, contextHolder] = message.useMessage();
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer); }, []);
  const sorted = useMemo(() => [...entries].sort((a, b) => a.elapsedSeconds + a.penaltySeconds - b.elapsedSeconds - b.penaltySeconds), [entries]);
  const deadline = protestDeadline(race);

  const saveRetrieval = () => {
    if (!retrievalValue || Number.isNaN(new Date(retrievalValue).getTime())) {
      api.error('请填写有效的收船时刻');
      return;
    }
    dispatch(setBoatRetrieval({ id: race.id, time: new Date(retrievalValue).toISOString(), reason: retrievalReason }));
    api.success(race.boatRetrievalAt ? '收船时刻已更正，抗议截止点已重算' : '收船时刻已登记，抗议截止点为收船后 60 分钟');
    setRetrievalReason('');
  };

  return (
    <>
      {contextHolder}
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Row gutter={[18, 18]}>
          <Col xs={24} lg={10}>
            <Card className="hero-card">
              <Badge status={race.status === 'running' ? 'processing' : 'success'} text={`比赛状态：${race.status}`} />
              <Statistic title="距离起航" value={countdown(race.startsAt, now)} prefix={<ClockCircleOutlined />} />
              <Descriptions column={1} style={{ marginTop: 18 }}>
                <Descriptions.Item label="组别">{race.fleet}</Descriptions.Item>
                <Descriptions.Item label="航线">{race.course}</Descriptions.Item>
              </Descriptions>
              <Space wrap>
                <Button type="primary" icon={<FlagOutlined />} onClick={() => dispatch(setRaceStatus({ id: race.id, status: 'running' }))}>开始比赛</Button>
                <Button onClick={() => dispatch(setRaceStatus({ id: race.id, status: 'finished' }))}>结束比赛</Button>
                <Button onClick={() => dispatch(setRaceStatus({ id: race.id, status: 'scheduled' }))}>重置排队</Button>
              </Space>
            </Card>
          </Col>
          <Col xs={24} lg={14}>
            <Card title={t('control')} extra={<Tag color="blue">{sorted.length} 艘参赛船</Tag>}>
              <Table rowKey="id" pagination={false} dataSource={sorted} columns={[
                { title: '排名', render: (_v, _r, index) => index + 1, width: 64 },
                { title: '船名', dataIndex: 'boat' },
                { title: '帆号', dataIndex: 'sailNo' },
                { title: '船长', dataIndex: 'skipper' },
                { title: '当前净用时', render: (_v, r: RaceEntry) => `${r.elapsedSeconds + r.penaltySeconds}s` },
                { title: '状态', render: (_v, r: RaceEntry) => <Tag color={r.resultStatus === 'official' ? 'green' : r.resultStatus === 'corrected' ? 'orange' : 'default'}>{r.resultStatus}</Tag> }
              ]} />
            </Card>
          </Col>
        </Row>
        <Row gutter={[18, 18]}>
          <Col xs={24} lg={10}>
            <Card title="收船时刻登记">
              <Alert
                type={race.boatRetrievalAt ? 'info' : 'warning'}
                showIcon
                style={{ marginBottom: 16 }}
                message={race.boatRetrievalAt ? '抗议提交截止点 = 收船 + 60 分钟' : '尚未登记收船时刻，抗议时限无法起算'}
                description={race.boatRetrievalAt
                  ? <Space direction="vertical" size={0}>
                      <span>收船：{new Date(race.boatRetrievalAt).toLocaleString()}</span>
                      <span>截止：{deadline ? new Date(deadline).toLocaleString() : '—'}</span>
                    </Space>
                  : '请竞赛官在收船后及时回填；此前提交的抗议将在登记时统一按截止点重算。'}
              />
              <Form layout="vertical">
                <Form.Item label={race.boatRetrievalAt ? '更正后的收船时刻' : '收船时刻（可回填）'} required>
                  <Input type="datetime-local" value={retrievalValue} onChange={(e) => setRetrievalValue(e.target.value)} />
                </Form.Item>
                <Form.Item label={race.boatRetrievalAt ? '更正理由（必填留痕）' : '备注'}>
                  <Input.TextArea rows={2} value={retrievalReason} onChange={(e) => setRetrievalReason(e.target.value)} placeholder={race.boatRetrievalAt ? '例如：收船记录单誊写误差，按 A 标门冲线记录修正' : '例如：全部船只完成回收'} />
                </Form.Item>
                <Button type="primary" onClick={saveRetrieval}>{race.boatRetrievalAt ? '更正并重算截止点' : '登记收船时刻'}</Button>
              </Form>
            </Card>
          </Col>
          <Col xs={24} lg={14}>
            <Card title="收船时刻变更记录">
              {race.retrievalHistory.length === 0 ? <Empty description="暂无记录" /> : (
                <Timeline items={[...race.retrievalHistory].reverse().map((record, index) => ({
                  color: index === 0 ? 'green' : 'gray',
                  children: <>
                    <b>{index === 0 ? (race.retrievalHistory.length > 1 ? '当前（最近更正）' : '已登记') : '历史记录'}</b>
                    <div>收船时刻：{new Date(record.time).toLocaleString()}</div>
                    <div>{record.reason}</div>
                    <small>操作时间：{new Date(record.recordedAt).toLocaleString()}</small>
                  </>
                }))} />
              )}
            </Card>
          </Col>
        </Row>
      </Space>
    </>
  );
}

function ResultsPage() {
  const dispatch = useDispatch<AppDispatch>();
  const entries = useSelector((state: RootState) => state.regatta.entries);
  const [api, contextHolder] = message.useMessage();
  const { register, handleSubmit, reset, formState: { errors } } = useForm<z.infer<typeof resultSchema>>({
    resolver: zodResolver(resultSchema),
    defaultValues: { id: entries[0]?.id, elapsedSeconds: 3200, penaltySeconds: 0, note: '' }
  });
  const submit = (values: z.infer<typeof resultSchema>) => {
    dispatch(saveResult({ ...values, official: false }));
    api.success('成绩已更正并进入待发布状态');
    reset();
  };
  return (
    <>
      {contextHolder}
      <Row gutter={[18, 18]}>
        <Col xs={24} lg={10}>
          <Card title="成绩更正">
            <Form layout="vertical" onFinish={handleSubmit(submit)}>
              <Form.Item label="参赛船" validateStatus={errors.id ? 'error' : undefined} help={errors.id?.message}>
                <select {...register('id')} className="native-select">{entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.boat} / {entry.sailNo}</option>)}</select>
              </Form.Item>
              <Form.Item label="净用时（秒）"><Input type="number" {...register('elapsedSeconds', { valueAsNumber: true })} /></Form.Item>
              <Form.Item label="处罚秒数"><Input type="number" {...register('penaltySeconds', { valueAsNumber: true })} /></Form.Item>
              <Form.Item label="更正原因"><Input.TextArea rows={3} {...register('note')} /></Form.Item>
              <Button htmlType="submit" type="primary">保存更正</Button>
            </Form>
          </Card>
        </Col>
        <Col xs={24} lg={14}>
          <Card title="临时与正式成绩">
            <List dataSource={entries} renderItem={(entry) => (
              <List.Item actions={[
                <Button key="publish" size="small" type="link" onClick={() => dispatch(saveResult({ id: entry.id, elapsedSeconds: entry.elapsedSeconds, penaltySeconds: entry.penaltySeconds, note: entry.note, official: true }))}>发布正式</Button>
              ]}>
                <List.Item.Meta title={`${entry.boat} · ${entry.elapsedSeconds + entry.penaltySeconds} 秒`} description={entry.note || '无更正说明'} />
                <Tag color={entry.resultStatus === 'official' ? 'green' : 'orange'}>{entry.resultStatus}</Tag>
              </List.Item>
            )} />
          </Card>
        </Col>
      </Row>
    </>
  );
}

function LateConfirmForm({ item }: { item: Protest }) {
  const dispatch = useDispatch<AppDispatch>();
  const [lateReason, setLateReason] = useState(item.lateReason);
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Input.TextArea
        rows={2}
        value={lateReason}
        onChange={(e) => setLateReason(e.target.value)}
        placeholder="补写迟交理由（如：事件发生时正处于绕标混战，回港后船具受损需先处置）"
      />
      <Button
        size="small"
        type="primary"
        disabled={!lateReason.trim()}
        onClick={() => { dispatch(confirmLateProtest({ id: item.id, lateReason })); setLateReason(''); }}
      >
        仲裁补写理由并确认，进入复核
      </Button>
    </Space>
  );
}

function ProtestActions({ item }: { item: Protest }) {
  const dispatch = useDispatch<AppDispatch>();
  switch (item.status) {
    case 'submitted':
      return <Button size="small" onClick={() => dispatch(transitionProtest({ id: item.id, status: 'reviewing' }))}>进入复核</Button>;
    case 'reviewing':
      return (
        <Space direction="vertical">
          <Button size="small" type="primary" onClick={() => dispatch(transitionProtest({ id: item.id, status: 'resolved', decision: '接受抗议并处以30秒处罚', penaltySeconds: 30 }))}>接受并处罚</Button>
          <Button size="small" danger onClick={() => dispatch(transitionProtest({ id: item.id, status: 'rejected', decision: '证据不足，维持原成绩' }))}>驳回</Button>
        </Space>
      );
    case 'returned':
      return item.wasLate
        ? <LateConfirmForm item={item} />
        : <Button size="small" onClick={() => dispatch(transitionProtest({ id: item.id, status: 'reviewing' }))}>重新进入复核</Button>;
    case 'pending':
      return <LateConfirmForm item={item} />;
    default:
      return null;
  }
}

function ProtestCard({ item, boatName }: { item: Protest; boatName?: string }) {
  const meta = STATUS_META[item.status];
  return (
    <List.Item>
      <List.Item.Meta
        title={
          <Space wrap>
            <Tag color={meta.color}>{meta.label}</Tag>
            <span>{item.rule}</span>
            {item.wasLate && <Tag color={item.lateConfirmedAt ? 'gold' : 'warning'}>{item.lateConfirmedAt ? '迟交已确认' : '超截止点提交'}</Tag>}
          </Space>
        }
        description={
          <Space direction="vertical" size={2}>
            <div>{item.reason}</div>
            <small>{boatName} · 提交于 {new Date(item.createdAt).toLocaleString()}</small>
            {item.lateReason && <small>迟交理由：{item.lateReason}（{item.lateConfirmedAt ? new Date(item.lateConfirmedAt).toLocaleString() : '未确认'}）</small>}
            {item.decision && <small>判定：{item.decision}</small>}
          </Space>
        }
      />
      <ProtestActions item={item} />
    </List.Item>
  );
}

function ProtestsPage() {
  const dispatch = useDispatch<AppDispatch>();
  const protests = useSelector((state: RootState) => state.regatta.protests);
  const timeline = useSelector((state: RootState) => state.regatta.timeline);
  const entries = useSelector((state: RootState) => state.regatta.entries);
  const race = useSelector((state: RootState) => state.regatta.races[0]);
  const [api, contextHolder] = message.useMessage();
  const deadline = protestDeadline(race);
  const { register, handleSubmit, reset, watch, formState: { errors } } = useForm<z.infer<typeof protestSchema>>({ resolver: zodResolver(protestSchema), defaultValues: { entryId: entries[0]?.id, reason: '', rule: 'RRS 14' } });
  const currentEntry = watch('entryId');
  const currentRule = watch('rule');
  const currentReason = watch('reason');

  const activeProtests = protests.filter((item) => !item.superseded);
  const pendingProtests = activeProtests.filter((item) => item.status === 'pending' || (item.status === 'returned' && item.wasLate));
  const queueProtests = activeProtests.filter((item) => !pendingProtests.includes(item));

  const isDuplicate = (values: z.infer<typeof protestSchema>) =>
    activeProtests.some((item) => protestDuplicateKey(item) === protestDuplicateKey({ raceId: race.id, ...values }));

  const submit = (values: z.infer<typeof protestSchema>) => {
    dispatch(addProtest({ raceId: race.id, ...values }));
    if (isDuplicate(values)) {
      api.warning('该抗议此前已登记过，重复提交只保留最早一条（已记入时间线）');
    } else if (deadline && Date.now() > new Date(deadline).getTime()) {
      api.warning('已超过收船后 60 分钟截止点，抗议进入待定区，须仲裁补写迟交理由并确认');
    } else {
      api.success('抗议已在截止点内登记');
    }
    reset({ entryId: entries[0]?.id, reason: '', rule: 'RRS 14' });
  };

  return (
    <>
      {contextHolder}
      <Alert
        type={deadline ? 'info' : 'warning'}
        showIcon
        style={{ marginBottom: 18 }}
        message={deadline ? `本场抗议截止点：${new Date(deadline).toLocaleString()}（收船后 60 分钟）` : '本场尚未登记收船时刻，抗议时限未起算'}
        description={deadline
          ? `收船时刻 ${new Date(race.boatRetrievalAt!).toLocaleString()}；超截止点提交的抗议先进入待定区，仲裁补写迟交理由并确认后才能复核。收船时刻更正时截止点自动重算。`
          : '请竞赛官先在「竞赛控制」页登记收船时刻。'}
      />
      <Row gutter={[18, 18]}>
        <Col xs={24} lg={7}>
          <Card title="提交抗议">
            <Form layout="vertical" onFinish={handleSubmit(submit)}>
              <Form.Item label="参赛船" validateStatus={errors.entryId ? 'error' : undefined}>
                <select className="native-select" {...register('entryId')}>{entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.boat}</option>)}</select>
              </Form.Item>
              <Form.Item label="适用规则" validateStatus={errors.rule ? 'error' : undefined} help={errors.rule?.message}><Input {...register('rule')} /></Form.Item>
              <Form.Item label="事件描述" validateStatus={errors.reason ? 'error' : undefined} help={errors.reason?.message}><Input.TextArea rows={4} {...register('reason')} /></Form.Item>
              {currentEntry && currentRule && currentReason?.trim().length >= 4 && isDuplicate({ entryId: currentEntry, rule: currentRule, reason: currentReason }) && (
                <Tag color="warning" style={{ marginBottom: 12 }}>检测到重复抗议：同船同规则同描述，提交后只保留最早一条</Tag>
              )}
              <Button type="primary" htmlType="submit" icon={<PlusOutlined />}>登记抗议</Button>
            </Form>
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Card
              title={<Space><Tag color="warning">待定区</Tag>迟交抗议</Space>}
              extra={<Badge count={pendingProtests.length} showZero color="#faad14" />}
            >
              {pendingProtests.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无迟交抗议" /> : (
                <List dataSource={pendingProtests} renderItem={(item) => <ProtestCard key={item.id} item={item} boatName={entries.find((entry) => entry.id === item.entryId)?.boat} />} />
              )}
            </Card>
            <Card title="冲突复核队列">
              {queueProtests.length === 0 ? <Empty /> : (
                <List dataSource={queueProtests} renderItem={(item) => <ProtestCard key={item.id} item={item} boatName={entries.find((entry) => entry.id === item.entryId)?.boat} />} />
              )}
            </Card>
          </Space>
        </Col>
        <Col xs={24} lg={7}>
          <Card title="事件时间线"><Timeline items={timeline.map((event) => ({
            color: event.type === 'protest' ? 'orange' : event.type === 'result' ? 'green' : event.type === 'system' ? 'red' : 'blue',
            children: <><b>{event.type}</b><div>{event.message}</div><small>{new Date(event.time).toLocaleString()}</small></>
          }))} /></Card>
        </Col>
      </Row>
    </>
  );
}

function Shell() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { data = [] } = useGetOfficialsQuery();
  return (
    <AntApp>
      <Layout className="shell">
      <Header className="header">
        <Space><SafetyCertificateOutlined style={{ fontSize: 24 }} /><Typography.Title level={4} style={{ margin: 0, color: 'white' }}>{t('title')}</Typography.Title></Space>
        <Space><Tag>{data.length} 名值班人员</Tag><Button ghost onClick={() => void i18n.changeLanguage(i18n.language.startsWith('zh') ? 'en' : 'zh')}>{t('language')}</Button></Space>
      </Header>
      <Layout>
        <Sider width={210} breakpoint="lg" collapsedWidth="0" theme="light">
          <Menu mode="inline" selectedKeys={[location.pathname]} onClick={({ key }) => navigate(key)} items={[
            { key: '/', label: t('control'), icon: <FlagOutlined /> },
            { key: '/results', label: t('results'), icon: <ClockCircleOutlined /> },
            { key: '/protests', label: t('protests'), icon: <SafetyCertificateOutlined /> }
          ]} />
        </Sider>
        <Content className="content"><Routes>
          <Route path="/" element={<ControlPage />} />
          <Route path="/results" element={<ResultsPage />} />
          <Route path="/protests" element={<ProtestsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes></Content>
      </Layout>
      </Layout>
    </AntApp>
  );
}

export default function App() { return <BrowserRouter><Shell /></BrowserRouter>; }
