import { useState } from 'react'
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Scatter,
  ReferenceLine,
} from 'recharts'
import { fmt, thaiDate, downloadCsv } from '../utils.js'

const TABS = [
  { id: 'summary', label: 'สรุป' },
  { id: 'ndvi', label: 'NDVI & Kc' },
  { id: 'water', label: 'สมดุลน้ำ' },
  { id: 'table', label: 'ตารางข้อมูล' },
]

export default function AnalysisPanel({ field, analysis, loading, error, onRetry }) {
  const [tab, setTab] = useState('summary')
  const [expanded, setExpanded] = useState(true)

  if (!field) {
    return (
      <div className="results" style={{ maxHeight: 'none' }}>
        <div className="results-body" style={{ padding: 18 }}>
          <div className="empty-state" style={{ padding: 8 }}>
            เลือกแปลงจากรายการด้านซ้าย เพื่อดูค่า NDVI และคำแนะนำการให้น้ำ
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="results">
      <div className="results-head">
        <div className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={tab === t.id && expanded ? 'on' : ''}
              onClick={() => {
                setTab(t.id)
                setExpanded(true)
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        {loading && (
          <span style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className="spinner" /> กำลังประมวลผล
          </span>
        )}
        {analysis && (
          <button
            className="btn ghost sm"
            onClick={() => downloadCsv(`${field.name}-irrisat.csv`, analysis.days)}
          >
            ⬇ CSV
          </button>
        )}
        <button
          className="btn ghost sm"
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? 'ย่อแผงผลลัพธ์เพื่อขยายแผนที่' : 'ขยายแผงผลลัพธ์'}
        >
          {expanded ? '▾ ย่อ' : '▴ ขยาย'}
        </button>
      </div>

      <div className="results-body" hidden={!expanded}>
        {error && (
          <div className="note error">
            <strong>{error.message}</strong>
            {error.detail && <span>{error.detail}</span>}
            <div style={{ marginTop: 8 }}>
              <button className="btn sm" onClick={onRetry}>
                ลองใหม่
              </button>
            </div>
          </div>
        )}

        {analysis?.ndvi?.warning && <div className="note warn">{analysis.ndvi.warning}</div>}

        {analysis?.ndvi?.source === 'demo' && (
          <div className="note info">
            <strong>กำลังแสดงข้อมูลจำลอง — NDVI ที่เห็นเป็นค่าสมมติ</strong>
            ข้อมูลอากาศและ ET₀ เป็นของจริงจาก NASA POWER แต่ค่า NDVI ยังไม่ได้มาจากดาวเทียม
            เพราะเชื่อมต่อ Google Earth Engine ไม่ได้
            {analysis.ndvi.error && <em style={{ display: 'block' }}>({analysis.ndvi.error})</em>}
            ตั้งค่า service account ตามขั้นตอนใน README แล้วรีสตาร์ทเซิร์ฟเวอร์เพื่อใช้ข้อมูลจริง
          </div>
        )}

        {!analysis && !error && !loading && (
          <div className="empty-state">ยังไม่มีผลการคำนวณ</div>
        )}

        {analysis && tab === 'summary' && <Summary field={field} a={analysis} />}
        {analysis && tab === 'ndvi' && <NdviChart a={analysis} />}
        {analysis && tab === 'water' && <WaterChart a={analysis} />}
        {analysis && tab === 'table' && <DataTable a={analysis} />}
      </div>
    </div>
  )
}

/* ── สรุปตัวเลขสำคัญ ─────────────────────────────────────────── */

function Summary({ field, a }) {
  const s = a.summary
  const volumeM3 = (s.recommendedIrrigationMm * field.areaM2) / 1000
  const stressed = s.underStress

  return (
    <>
      <div className="stat-grid">
        <Stat label="NDVI ล่าสุด" value={fmt(s.currentNdvi, 2)} />
        <Stat label="ค่าสัมประสิทธิ์พืช Kc" value={fmt(s.currentKc, 2)} />
        <Stat label="การใช้น้ำเฉลี่ย" value={fmt(s.avgDailyEtc, 1)} unit="มม./วัน" />
        <Stat
          label="น้ำที่พร่องอยู่ในดิน"
          value={fmt(s.currentDeficit, 0)}
          unit={`มม. / ${fmt(a.settings.raw, 0)}`}
          tone={stressed ? 'alert' : 'good'}
        />
        <Stat
          label="ควรให้น้ำ"
          value={fmt(s.recommendedIrrigationMm, 0)}
          unit="มม."
          tone="accent"
        />
        <Stat label="คิดเป็นปริมาตร" value={volumeM3 >= 1000 ? fmt(volumeM3 / 1000, 1) : fmt(volumeM3, 0)} unit={volumeM3 >= 1000 ? 'พัน ลบ.ม.' : 'ลบ.ม.'} tone="accent" />
      </div>

      <div className={`note ${stressed ? 'warn' : 'info'}`}>
        <strong>
          {stressed
            ? '⚠️ ดินพร่องน้ำเกินระดับที่พืชรับได้แล้ว ควรให้น้ำโดยเร็ว'
            : s.beyondHorizon
              ? 'ความชื้นในดินยังเพียงพอ — ยังไม่ต้องให้น้ำภายใน 30 วันข้างหน้า'
              : s.daysUntilIrrigation === 0
                ? 'ถึงรอบให้น้ำแล้ว'
                : `ประมาณการ: ให้น้ำครั้งถัดไปในอีก ${s.daysUntilIrrigation ?? '—'} วัน (ราว ${thaiDate(s.nextIrrigationDate)})`}
        </strong>
        คำนวณจากดิน{a.settings.soilLabel} ความลึกราก {a.settings.rootDepth} ม. อุ้มน้ำได้ {fmt(a.settings.taw, 0)} มม.
        ให้น้ำเมื่อพร่องเกิน {fmt(a.settings.raw, 0)} มม. — ยังไม่รวมพยากรณ์ฝนล่วงหน้า
      </div>

      <div className="stat-grid">
        <Stat label="การใช้น้ำสะสม (ETc)" value={fmt(s.totalEtc, 0)} unit="มม." />
        <Stat label="ฝนสะสม" value={fmt(s.totalRain, 0)} unit="มม." />
        <Stat label="ฝนที่ใช้ได้จริง" value={fmt(s.totalEffectiveRain, 0)} unit="มม." />
        <Stat label="ให้น้ำไปแล้ว" value={fmt(s.totalIrrigation, 0)} unit="มม." />
        <Stat label="ภาพดาวเทียมที่ใช้ได้" value={s.observations} unit="ภาพ" />
        <Stat label="ช่วงข้อมูล" value={`${thaiDate(s.periodStart)} – ${thaiDate(s.periodEnd)}`} dense />
      </div>
    </>
  )
}

function Stat({ label, value, unit, tone, dense }) {
  return (
    <div className={`stat${tone ? ` ${tone}` : ''}`}>
      <div className="label">{label}</div>
      <div className={`value${dense ? ' dense' : ''}`}>
        {value}
        {unit && <small>{unit}</small>}
      </div>
    </div>
  )
}

/* ── กราฟ ─────────────────────────────────────────────────────── */

const CHART_MARGIN = { top: 5, right: 6, left: 0, bottom: 0 }
const axisProps = { tick: { fontSize: 11 }, tickLine: false, axisLine: { stroke: '#dde4df' } }
const tooltipStyle = {
  contentStyle: { fontSize: 12, borderRadius: 8, border: '1px solid #dde4df', fontFamily: 'IBM Plex Sans Thai' },
  labelFormatter: thaiDate,
}

function NdviChart({ a }) {
  const data = a.days.map((d) => ({ ...d, ndviObserved: d.observed ? d.ndvi : null }))

  return (
    <div className="chart-box">
      <div className="chart-title">
        NDVI จากดาวเทียม และค่าสัมประสิทธิ์พืช Kc — จุดทึบคือวันที่มีภาพจริง เส้นระหว่างจุดคือค่าประมาณเชิงเส้น
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={CHART_MARGIN}>
          <CartesianGrid stroke="#eef1ee" vertical={false} />
          <XAxis dataKey="date" {...axisProps} tickFormatter={thaiDate} minTickGap={40} />
          <YAxis yAxisId="l" width={34} domain={[0, 1]} {...axisProps} />
          <YAxis yAxisId="r" width={34} orientation="right" domain={[0, 1.3]} {...axisProps} />
          <Tooltip {...tooltipStyle} formatter={(v, n) => [Number(v).toFixed(3), n]} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Area isAnimationActive={false} yAxisId="l" type="monotone" dataKey="ndvi" name="NDVI" stroke="#17795e" fill="#17795e" fillOpacity={0.12} strokeWidth={2} dot={false} connectNulls />
          <Line isAnimationActive={false} yAxisId="r" type="monotone" dataKey="kc" name="Kc" stroke="#2f7ec2" strokeWidth={2} dot={false} strokeDasharray="4 3" connectNulls />
          <Scatter isAnimationActive={false} yAxisId="l" dataKey="ndviObserved" name="ภาพดาวเทียม" fill="#0d5236" shape="circle" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

function WaterChart({ a }) {
  return (
    <>
      <div className="chart-box" style={{ marginBottom: 12 }}>
        <div className="chart-title">
          การใช้น้ำรายวัน (มม.) — ETc คือความต้องการน้ำจริงของพืช (Kc × ET₀) · ฝนอ่านจากแกนขวา
        </div>
        <ResponsiveContainer width="100%" height={210}>
          <ComposedChart data={a.days} margin={CHART_MARGIN}>
            <CartesianGrid stroke="#eef1ee" vertical={false} />
            <XAxis dataKey="date" {...axisProps} tickFormatter={thaiDate} minTickGap={40} />
            <YAxis yAxisId="et" width={34} domain={[0, 'auto']} {...axisProps} />
            <YAxis yAxisId="rain" orientation="right" width={34} {...axisProps} />
            <Tooltip {...tooltipStyle} formatter={(v, n) => [`${Number(v).toFixed(1)} มม.`, n]} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar isAnimationActive={false} yAxisId="rain" dataKey="rain" name="ฝน" fill="#9ec9e8" barSize={4} />
            <Line isAnimationActive={false} yAxisId="et" type="monotone" dataKey="et0" name="ET₀ อ้างอิง" stroke="#b6741a" strokeWidth={1.4} dot={false} strokeDasharray="3 3" />
            <Line isAnimationActive={false} yAxisId="et" type="monotone" dataKey="etc" name="ETc พืชใช้จริง" stroke="#17795e" strokeWidth={2} dot={false} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-box">
        <div className="chart-title">
          น้ำที่พร่องไปจากดิน (มม.) — เมื่อเส้นแตะระดับ RAW ที่ {fmt(a.settings.raw, 0)} มม. คือถึงเวลาให้น้ำ
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={a.days} margin={CHART_MARGIN}>
            <CartesianGrid stroke="#eef1ee" vertical={false} />
            <XAxis dataKey="date" {...axisProps} tickFormatter={thaiDate} minTickGap={40} />
            <YAxis width={34} domain={[0, Math.ceil(a.settings.taw / 10) * 10]} reversed {...axisProps} />
            <Tooltip {...tooltipStyle} formatter={(v, n) => [`${Number(v).toFixed(1)} มม.`, n]} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <ReferenceLine
              y={a.settings.raw}
              stroke="#b4392f"
              strokeDasharray="5 4"
              label={{ value: 'RAW — ควรให้น้ำ', position: 'insideBottomLeft', fontSize: 11, fill: '#b4392f' }}
            />
            <Area isAnimationActive={false} type="monotone" dataKey="deficit" name="น้ำที่พร่อง" stroke="#2f7ec2" fill="#2f7ec2" fillOpacity={0.18} strokeWidth={2} />
            <Bar isAnimationActive={false} dataKey="irrigation" name="ให้น้ำ" fill="#159c7a" barSize={5} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  )
}

/* ── ตาราง ────────────────────────────────────────────────────── */

const COLUMNS = [
  ['date', 'วันที่'],
  ['ndvi', 'NDVI'],
  ['kc', 'Kc'],
  ['et0', 'ET₀'],
  ['etc', 'ETc'],
  ['rain', 'ฝน'],
  ['effectiveRain', 'ฝนใช้ได้'],
  ['irrigation', 'ให้น้ำ'],
  ['deficit', 'พร่อง'],
  ['cumEtc', 'ETc สะสม'],
]

function DataTable({ a }) {
  const rows = [...a.days].reverse()
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {COLUMNS.map(([k, l]) => (
              <th key={k}>{l}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.date} className={d.stress ? 'stress' : ''}>
              <td>
                {d.date}
                {d.observed && <span className="badge-obs" title="มีภาพดาวเทียมวันนี้" />}
              </td>
              <td>{fmt(d.ndvi, 3)}</td>
              <td>{fmt(d.kc, 2)}</td>
              <td>{fmt(d.et0, 1)}</td>
              <td>{fmt(d.etc, 1)}</td>
              <td>{fmt(d.rain, 1)}</td>
              <td>{fmt(d.effectiveRain, 1)}</td>
              <td>{d.irrigation ? fmt(d.irrigation, 0) : '·'}</td>
              <td>{fmt(d.deficit, 0)}</td>
              <td>{fmt(d.cumEtc, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
