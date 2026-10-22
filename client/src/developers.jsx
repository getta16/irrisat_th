/**
 * หน้า "API ข้อมูลแปลง" (developers.html)
 *
 * แสดงแปลงของบัญชีที่ล็อกอินอยู่ พร้อม URL ของ /api/v1 ที่เอาไปใช้ต่อใน Postman / QGIS / Power BI / script
 * และให้กดดูคำตอบจริงได้ทันที — ฝั่งหน้าเว็บเรียกผ่าน /api/portal ด้วย token Google
 * จึงไม่ต้องเอา API key มาใส่ในเบราว์เซอร์ (คีย์ใช้นอกเว็บเท่านั้น)
 */
import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'
import { api, publicApiBase } from './api.js'
import { useAuth } from './useAuth.js'
import { fmt, fmtArea, isoDate, shiftDays, thaiDate, downloadJson, historyMinDate } from './utils.js'
import SignInButton from './components/SignInButton.jsx'
import UserMenu from './components/UserMenu.jsx'
import './styles.css'
import './developers.css'

const DEFAULT_END = shiftDays(isoDate(new Date()), -3)
const DEFAULT_START = shiftDays(DEFAULT_END, -90)

/** เส้นทางของ API v1 — `params` คือช่องที่ให้กรอกในส่วนทดลองเรียก */
const ENDPOINTS = [
  {
    id: 'areas',
    path: '/areas',
    title: 'รายการแปลง',
    desc: 'id ชื่อ พื้นที่ (ม.² / ไร่ / เฮกตาร์) จุดศูนย์กลาง พืช ดิน ของทุกแปลงในบัญชี',
    params: ['geometry'],
  },
  {
    id: 'geojson',
    path: '/areas.geojson',
    title: 'แปลงทั้งหมดเป็น GeoJSON',
    desc: 'FeatureCollection เปิดใน QGIS ได้ตรง ๆ',
    params: [],
    file: 'geojson',
  },
  {
    id: 'area',
    path: '/areas/:id',
    title: 'แปลงเดียว',
    desc: 'ข้อมูลแปลงพร้อมรูปทรง',
    params: ['area'],
  },
  {
    id: 'ndvi',
    path: '/areas/:id/ndvi',
    title: 'NDVI + Kc ตามภาพดาวเทียม',
    desc: 'เฉพาะวันที่มีภาพจริง พร้อมสัดส่วนแปลงที่มองเห็น (coverage)',
    params: ['area', 'range', 'satellite'],
    csv: true,
  },
  {
    id: 'timeseries',
    path: '/areas/:id/timeseries',
    title: 'NDVI + Kc รายวัน',
    desc: 'ทุกวันในช่วง เติมค่าระหว่างภาพ — weather=1 เพิ่ม ET₀ / ETc / ฝน',
    params: ['area', 'range', 'satellite', 'weather'],
    csv: true,
  },
  {
    id: 'latest',
    path: '/ndvi/latest',
    title: 'ค่าล่าสุดทุกแปลง',
    desc: 'ภาพล่าสุดของแต่ละแปลง ย้อนหลังไม่เกิน days วัน (สูงสุด 180)',
    params: ['days', 'satellite'],
    csv: true,
  },
]

function buildPath(ep, q) {
  const path = ep.path.replace(':id', q.areaId ? encodeURIComponent(q.areaId) : ':id')
  const p = new URLSearchParams()
  if (ep.params.includes('geometry') && q.geometry) p.set('geometry', '1')
  if (ep.params.includes('range')) {
    if (q.start) p.set('start', q.start)
    if (q.end) p.set('end', q.end)
  }
  if (ep.params.includes('days') && q.days) p.set('days', String(q.days))
  if (ep.params.includes('satellite')) {
    if (q.collection) p.set('collection', q.collection)
    if (q.maxCloud !== '' && q.maxCloud !== null) p.set('maxCloud', String(q.maxCloud))
  }
  if (ep.params.includes('weather') && q.weather) p.set('weather', '1')
  const qs = p.toString()
  return qs ? `${path}?${qs}` : path
}

const withFormat = (path, format) => `${path}${path.includes('?') ? '&' : '?'}format=${format}`

function copy(text, setCopied) {
  navigator.clipboard?.writeText(text).then(
    () => {
      setCopied(text)
      setTimeout(() => setCopied((c) => (c === text ? null : c)), 1500)
    },
    () => {}
  )
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ── หน้าหลัก ──────────────────────────────────────────────────────────

function DevelopersPage() {
  const auth = useAuth()
  const authed = auth.phase === 'ready'

  const [info, setInfo] = useState(null)
  const [areas, setAreas] = useState(null)
  const [crops, setCrops] = useState({})
  const [loadError, setLoadError] = useState(null)
  const [copied, setCopied] = useState(null)

  const [endpointId, setEndpointId] = useState('ndvi')
  const [query, setQuery] = useState({
    areaId: '',
    start: DEFAULT_START,
    end: DEFAULT_END,
    collection: '',
    maxCloud: '',
    weather: true,
    days: 60,
    geometry: false,
  })

  const base = useMemo(() => publicApiBase(), [])

  useEffect(() => {
    if (!authed) return
    let cancelled = false
    setLoadError(null)
    Promise.all([api.portalInfo(), api.portal('/areas'), api.options().catch(() => null)])
      .then(([i, list, opts]) => {
        if (cancelled) return
        setInfo(i)
        setAreas(list.areas)
        setCrops(Object.fromEntries((opts?.crops || []).map((c) => [c.id, c.label])))
        setQuery((q) => (q.areaId || !list.areas.length ? q : { ...q, areaId: list.areas[0].id }))
      })
      .catch((err) => !cancelled && setLoadError(err))
    return () => {
      cancelled = true
    }
  }, [authed])

  const pickArea = (id, ep = 'ndvi') => {
    setQuery((q) => ({ ...q, areaId: id }))
    setEndpointId(ep)
    document.getElementById('try')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  if (auth.phase === 'loading') {
    return (
      <div className="boot-screen">
        <span className="spinner" />
        <span>กำลังตรวจสอบการเข้าสู่ระบบ…</span>
      </div>
    )
  }

  return (
    <div className="dev-page">
      <header className="header dev-header">
        <a className="brand" href={import.meta.env.BASE_URL}>
          <span
            className="brand-mark"
            style={{ backgroundImage: `url(${import.meta.env.BASE_URL}logo.svg)` }}
            aria-hidden="true"
          />
          <span>
            IRRISAT-THAI
            <small>API ข้อมูลแปลง</small>
          </span>
        </a>
        <div className="header-spacer" />
        <div className="header-controls">
          <a className="header-link" href={import.meta.env.BASE_URL}>
            ← กลับหน้าแผนที่
          </a>
          {auth.user ? (
            <UserMenu user={auth.user} onSignOut={() => auth.signOut()} />
          ) : (
            auth.phase === 'signed-out' && (
              <SignInButton clientId={auth.clientId} error={auth.error} busy={auth.checking} />
            )
          )}
        </div>
      </header>

      <main className="dev-main">
        <section className="dev-hero">
          <h1>API ข้อมูลแปลง</h1>
          <p>
            ดึงขอบเขตแปลง ค่า NDVI และค่าสัมประสิทธิ์พืช Kc จากดาวเทียม ไปใช้ต่อใน Postman, QGIS, Power BI, Excel
            หรือ script ของคุณ โดยยืนยันตัวตนด้วย API key ที่ผูกกับอีเมล — แต่ละคีย์เห็นเฉพาะแปลงของอีเมลนั้น
          </p>
        </section>

        {!authed ? (
          <section className="card dev-card">
            <h2>ลงชื่อเข้าใช้เพื่อดูแปลงของคุณ</h2>
            <p className="dev-muted">หน้านี้แสดงเฉพาะแปลงของบัญชีที่ลงชื่อเข้าใช้ กดปุ่มลงชื่อเข้าใช้ด้านบนขวา</p>
            {auth.error && <div className="note error">{auth.error}</div>}
          </section>
        ) : (
          <>
            {loadError && (
              <div className="note error">
                <strong>{loadError.message}</strong>
                {loadError.detail && <span>{loadError.detail}</span>}
              </div>
            )}

            <Connection base={base} info={info} copied={copied} setCopied={setCopied} />

            <section className="card dev-card">
              <div className="dev-card-head">
                <h2>แปลงของ {info?.email || auth.user?.email || 'คุณ'}</h2>
                {areas && <span className="dev-muted">{areas.length} แปลง</span>}
              </div>
              <AreaTable areas={areas} crops={crops} base={base} copied={copied} setCopied={setCopied} onPick={pickArea} />
            </section>

            <Explorer
              areas={areas || []}
              endpointId={endpointId}
              setEndpointId={setEndpointId}
              query={query}
              setQuery={setQuery}
              base={base}
              info={info}
              copied={copied}
              setCopied={setCopied}
            />

            <Reference />
          </>
        )}
      </main>
    </div>
  )
}

// ── การเชื่อมต่อ ───────────────────────────────────────────────────────

function Connection({ base, info, copied, setCopied }) {
  const postman = `${import.meta.env.BASE_URL}postman/IRRISAT-THAI-API-v1.postman_collection.json`
  return (
    <section className="card dev-card">
      <h2>การเชื่อมต่อ</h2>
      <dl className="dev-kv">
        <dt>Base URL</dt>
        <dd>
          <code>{base}</code>
          <CopyButton text={base} copied={copied} setCopied={setCopied} />
        </dd>
        <dt>ยืนยันตัวตน</dt>
        <dd>
          <span className="dev-badge ok">ไม่ต้องใช้ API key</span>
          <span className="dev-muted"> ส่งเฉพาะแปลงของ {info?.publicApiOwner ?? 'gettiraput@gmail.com'}</span>
        </dd>
        <dt>ข้อจำกัด</dt>
        <dd>
          {info?.rateLimitPerMin ?? 60} คำขอ/นาที/IP · ย้อนหลังได้ถึง 10 ปี (ไม่เกิน {(info?.maxRangeDays ?? 4020).toLocaleString()} วันต่อครั้ง) ·
          ครั้งแรกของแต่ละแปลงใช้เวลา 3–15 วินาทีต่อข้อมูล 1 ปี (10 ปีราว 1 นาที)
        </dd>
        <dt>Postman</dt>
        <dd>
          <a className="btn sm" href={postman} download>
            ⬇ ดาวน์โหลด Postman collection
          </a>
          <span className="dev-muted"> Import แล้วกด Send ที่ “01 รายการแปลง” ก่อน</span>
        </dd>
      </dl>
    </section>
  )
}

function CopyButton({ text, copied, setCopied, label = 'คัดลอก' }) {
  return (
    <button className="btn ghost sm dev-copy" onClick={() => copy(text, setCopied)}>
      {copied === text ? '✓ คัดลอกแล้ว' : label}
    </button>
  )
}

// ── ตารางแปลง ──────────────────────────────────────────────────────────

function AreaTable({ areas, crops, base, copied, setCopied, onPick }) {
  if (!areas) {
    return (
      <div className="dev-muted dev-loading">
        <span className="spinner" /> กำลังโหลดรายการแปลง…
      </div>
    )
  }
  if (!areas.length) return <div className="empty-state">บัญชีนี้ยังไม่มีแปลง — เพิ่มแปลงจากหน้าแผนที่ก่อน</div>

  return (
    <div className="table-wrap dev-table">
      <table>
        <thead>
          <tr>
            <th>ชื่อแปลง</th>
            <th>พื้นที่</th>
            <th>พืช</th>
            <th>ดาวเทียม</th>
            <th>id</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {areas.map((a) => (
            <tr key={a.id}>
              <td>{a.name}</td>
              <td>{fmtArea(a.areaRai)}</td>
              <td>{crops[a.crop] || a.crop || '—'}</td>
              <td>{a.collection === 'LANDSAT' ? 'Landsat' : 'Sentinel-2'}</td>
              <td>
                <code className="dev-id">{a.id}</code>
                <CopyButton text={a.id} copied={copied} setCopied={setCopied} />
              </td>
              <td className="dev-actions">
                <button className="btn sm" onClick={() => onPick(a.id, 'ndvi')}>
                  NDVI
                </button>
                <button className="btn sm ghost" onClick={() => onPick(a.id, 'timeseries')}>
                  รายวัน
                </button>
                <CopyButton
                  text={`${base}/areas/${a.id}/timeseries?weather=1&format=csv`}
                  copied={copied}
                  setCopied={setCopied}
                  label="URL CSV"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── ทดลองเรียก ─────────────────────────────────────────────────────────

const CODE_TABS = [
  { id: 'curl', label: 'curl' },
  { id: 'ps', label: 'PowerShell' },
  { id: 'py', label: 'Python' },
]

function codeFor(tab, url) {
  if (tab === 'ps') {
    return `Invoke-RestMethod "${url}"`
  }
  if (tab === 'py') {
    return `import requests\n\nr = requests.get("${url}", timeout=120)\nr.raise_for_status()\ndata = r.json()`
  }
  return `curl "${url}"`
}

function Explorer({ areas, endpointId, setEndpointId, query, setQuery, base, info, copied, setCopied }) {
  const ep = ENDPOINTS.find((e) => e.id === endpointId)
  const needsArea = ep.path.includes(':id')
  const path = buildPath(ep, query)
  const url = `${base}${path}`

  const [codeTab, setCodeTab] = useState('curl')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [downloading, setDownloading] = useState(false)

  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value
    setQuery((q) => ({ ...q, [k]: v }))
  }

  const run = async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    const t0 = performance.now()
    try {
      const body = ep.file === 'geojson' ? JSON.parse(await (await api.portalFile(path)).text()) : await api.portal(path)
      setResult({ path, body, ms: Math.round(performance.now() - t0), endpoint: ep.id })
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }

  const downloadCsv = async () => {
    setDownloading(true)
    try {
      const blob = await api.portalFile(withFormat(path, 'csv'))
      saveBlob(blob, `${ep.id}_${query.start || 'latest'}_${query.end || ''}.csv`.replace(/_+\.csv$/, '.csv'))
    } catch (err) {
      setError(err)
    } finally {
      setDownloading(false)
    }
  }

  const blocked = needsArea && !query.areaId

  return (
    <section className="card dev-card" id="try">
      <h2>ทดลองเรียก API</h2>
      <p className="dev-muted">
        เลือกเส้นทางและพารามิเตอร์ แล้วกด “เรียกดูข้อมูลจริง” — ผลที่ได้เหมือนกับที่ Postman / script ได้รับ
        เพียงแต่หน้านี้ใช้บัญชี Google ที่ลงชื่อเข้าใช้แทนคีย์
      </p>

      <div className="dev-endpoints">
        {ENDPOINTS.map((e) => (
          <button
            key={e.id}
            className={`dev-endpoint${e.id === endpointId ? ' on' : ''}`}
            onClick={() => {
              setEndpointId(e.id)
              setResult(null)
              setError(null)
            }}
          >
            <span className="dev-method">GET</span>
            <span className="dev-ep-path">{e.path}</span>
            <span className="dev-ep-title">{e.title}</span>
          </button>
        ))}
      </div>
      <p className="dev-ep-desc">{ep.desc}</p>

      <div className="dev-form">
        {needsArea && (
          <label className="dev-field wide">
            <span>แปลง</span>
            <select value={query.areaId} onChange={set('areaId')}>
              {!areas.length && <option value="">— ไม่มีแปลง —</option>}
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({fmtArea(a.areaRai)})
                </option>
              ))}
            </select>
          </label>
        )}
        {ep.params.includes('range') && (
          <>
            <label className="dev-field">
              <span>start</span>
              <input type="date" value={query.start} min={historyMinDate()} max={query.end} onChange={set('start')} />
            </label>
            <label className="dev-field">
              <span>end</span>
              <input type="date" value={query.end} min={query.start} onChange={set('end')} />
            </label>
          </>
        )}
        {ep.params.includes('days') && (
          <label className="dev-field">
            <span>days</span>
            <input type="number" min={1} max={180} value={query.days} onChange={set('days')} />
          </label>
        )}
        {ep.params.includes('satellite') && (
          <>
            <label className="dev-field">
              <span>collection</span>
              <select value={query.collection} onChange={set('collection')}>
                <option value="">ตามที่ตั้งไว้ในแปลง</option>
                <option value="S2">S2 (Sentinel-2)</option>
                <option value="LANDSAT">LANDSAT</option>
              </select>
            </label>
            <label className="dev-field">
              <span>maxCloud (%)</span>
              <input type="number" min={0} max={100} placeholder="60" value={query.maxCloud} onChange={set('maxCloud')} />
            </label>
          </>
        )}
        {ep.params.includes('weather') && (
          <label className="dev-check">
            <input type="checkbox" checked={query.weather} onChange={set('weather')} />
            weather=1 (เพิ่ม ET₀ / ETc / ฝน)
          </label>
        )}
        {ep.params.includes('geometry') && (
          <label className="dev-check">
            <input type="checkbox" checked={query.geometry} onChange={set('geometry')} />
            geometry=1 (แนบรูปทรงแปลง)
          </label>
        )}
      </div>

      <div className="dev-url">
        <span className="dev-method">GET</span>
        <code>{url}</code>
        <CopyButton text={url} copied={copied} setCopied={setCopied} label="คัดลอก URL" />
      </div>

      <div className="dev-code">
        <div className="dev-code-tabs">
          {CODE_TABS.map((t) => (
            <button key={t.id} className={codeTab === t.id ? 'on' : ''} onClick={() => setCodeTab(t.id)}>
              {t.label}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <CopyButton text={codeFor(codeTab, url)} copied={copied} setCopied={setCopied} />
        </div>
        <pre>{codeFor(codeTab, url)}</pre>
      </div>

      <div className="btn-row dev-run">
        <button className="btn primary" onClick={run} disabled={loading || blocked}>
          {loading ? (
            <>
              <span className="spinner" /> กำลังดึงข้อมูล…
            </>
          ) : (
            '▶ เรียกดูข้อมูลจริง'
          )}
        </button>
        {ep.csv && (
          <button className="btn" onClick={downloadCsv} disabled={downloading || blocked}>
            {downloading ? 'กำลังสร้าง CSV…' : '⬇ CSV'}
          </button>
        )}
        {result && (
          <button className="btn ghost" onClick={() => downloadJson(`${ep.id}.json`, result.body)}>
            ⬇ JSON
          </button>
        )}
      </div>

      {error && (
        <div className="note error">
          <strong>{error.message}</strong>
          {error.detail && <span>{error.detail}</span>}
        </div>
      )}

      {result && <ResultView result={result} />}
    </section>
  )
}

// ── แสดงผลลัพธ์ ────────────────────────────────────────────────────────

/** แปลงคำตอบแต่ละแบบให้เป็นแถวตาราง */
function rowsOf(body) {
  if (Array.isArray(body?.observations)) return body.observations
  if (Array.isArray(body?.days)) return body.days
  if (Array.isArray(body?.areas)) return body.areas
  if (Array.isArray(body?.features)) return body.features.map((f) => ({ id: f.id, ...f.properties }))
  if (body?.area) return [body.area]
  return []
}

const isScalar = (v) => v === null || ['string', 'number', 'boolean'].includes(typeof v)

function ResultView({ result }) {
  const { body } = result
  const rows = rowsOf(body)
  const columns = rows.length ? Object.keys(rows[0]).filter((k) => rows.some((r) => isScalar(r[k]))) : []
  const hasSeries = rows.length > 1 && 'date' in rows[0] && 'ndvi' in rows[0] && result.endpoint !== 'latest'
  const [showRaw, setShowRaw] = useState(false)

  const raw = JSON.stringify(body, null, 2)
  const rawShown = raw.length > 60000 ? `${raw.slice(0, 60000)}\n… (ตัดเหลือ 60,000 ตัวอักษร — กด ⬇ JSON เพื่อดูทั้งหมด)` : raw

  return (
    <div className="dev-result">
      <div className="dev-result-head">
        <span className="dev-badge ok">200 OK</span>
        <span className="dev-muted">
          {result.ms.toLocaleString()} ms · {rows.length.toLocaleString()} แถว
          {body?.range && ` · ${thaiDate(body.range.start)} – ${thaiDate(body.range.end)}`}
          {body?.meta?.collection && ` · ${body.meta.collection}`}
        </span>
      </div>

      {hasSeries && <SeriesChart rows={rows} />}

      {rows.length > 0 && (
        <div className="table-wrap dev-table">
          <table>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 400).map((r, i) => (
                <tr key={r.id || r.date || i}>
                  {columns.map((c) => (
                    <td key={c}>{cell(r[c])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 400 && <div className="dev-muted">แสดง 400 แถวแรก — ดาวน์โหลด CSV / JSON เพื่อดูทั้งหมด</div>}

      <button className="btn ghost sm" onClick={() => setShowRaw((v) => !v)}>
        {showRaw ? '▾ ซ่อน JSON' : '▸ ดู JSON ที่ API ตอบกลับ'}
      </button>
      {showRaw && <pre className="dev-json">{rawShown}</pre>}
    </div>
  )
}

function cell(v) {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'boolean') return v ? '✓' : '·'
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString() : fmt(v, Math.abs(v) < 10 ? 3 : 1)
  if (typeof v === 'string' && v.length > 40) return `${v.slice(0, 40)}…`
  return isScalar(v) ? String(v) : '…'
}

function SeriesChart({ rows }) {
  const data = rows.map((r) => ({ ...r, ndviObserved: r.observed === false ? null : r.ndvi }))
  const axis = { tick: { fontSize: 11 }, tickLine: false, axisLine: { stroke: '#dde4df' } }
  return (
    <div className="chart-box dev-chart">
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={data} margin={{ top: 5, right: 6, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#eef1ee" vertical={false} />
          <XAxis dataKey="date" {...axis} tickFormatter={thaiDate} minTickGap={40} />
          <YAxis width={34} domain={[0, 1.3]} {...axis} />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #dde4df' }}
            labelFormatter={thaiDate}
            formatter={(v, n) => [Number(v).toFixed(3), n]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line isAnimationActive={false} type="monotone" dataKey="ndvi" name="NDVI" stroke="#17795e" strokeWidth={2} dot={false} connectNulls />
          <Line isAnimationActive={false} type="monotone" dataKey="kc" name="Kc" stroke="#2f7ec2" strokeWidth={2} strokeDasharray="4 3" dot={false} connectNulls />
          <Scatter isAnimationActive={false} dataKey="ndviObserved" name="ภาพดาวเทียม" fill="#0d5236" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── อ้างอิง ────────────────────────────────────────────────────────────

function Reference() {
  return (
    <section className="card dev-card">
      <h2>เส้นทางทั้งหมด</h2>
      <div className="table-wrap dev-table">
        <table>
          <thead>
            <tr>
              <th>เส้นทาง</th>
              <th>คืนอะไร</th>
              <th>CSV</th>
            </tr>
          </thead>
          <tbody>
            {ENDPOINTS.map((e) => (
              <tr key={e.id}>
                <td>
                  <code>GET {e.path}</code>
                </td>
                <td>{e.desc}</td>
                <td>{e.csv ? 'format=csv' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>พารามิเตอร์</h3>
      <ul className="dev-list">
        <li>
          <code>start</code>, <code>end</code> — รูปแบบ <code>YYYY-MM-DD</code> ไม่ใส่ = 180 วันย้อนหลัง
        </li>
        <li>
          <code>fromYear</code> — ปี ค.ศ. เช่น <code>fromYear=2018</code> = ตั้งแต่ 1 ม.ค. 2018 (ใช้แทน start) ย้อนหลังได้ถึง 10 ปี ·
          ข้อมูลก่อนปี 2019 ควรใช้ <code>collection=LANDSAT</code> — Sentinel-2 ในไทยก่อนปลายปี 2018 มีภาพเพียง 3–7 ภาพ/ปี
        </li>
        <li>
          <code>collection</code> — <code>S2</code> (Sentinel-2) หรือ <code>LANDSAT</code> ไม่ใส่ = ตามที่ตั้งไว้ในแปลง
        </li>
        <li>
          <code>maxCloud</code> — เพดานเมฆของภาพ 0–100 (ค่าเริ่มต้น 60)
        </li>
        <li>
          <code>format=csv</code> — ได้ไฟล์ CSV (UTF-8 มี BOM เปิดใน Excel ภาษาไทยได้)
        </li>
      </ul>

      <h3>อ่านค่าให้ถูก</h3>
      <ul className="dev-list">
        <li>
          <code>kc</code> คำนวณจาก Kc = 1.37 × NDVI − 0.086 จำกัดช่วง 0–1.25 (บอกไว้ใน <code>meta.kcFormula</code>)
        </li>
        <li>
          <code>observed: true</code> = วันที่มีภาพจริง · <code>extrapolated: true</code> = ก่อนภาพแรกหรือหลังภาพสุดท้าย
          ใช้ค่าภาพที่ใกล้ที่สุดค้างไว้ ความเชื่อมั่นต่ำกว่า
        </li>
        <li>
          <code>coverage</code> = สัดส่วนแปลงที่มองเห็นเทียบกับวันที่เห็นชัดที่สุดในช่วง ภาพที่ต่ำกว่า 0.4 ถูกตัดทิ้งแล้ว
        </li>
        <li>API ไม่มีข้อมูลจำลอง — ถ้า Earth Engine ใช้ไม่ได้จะตอบ 502 / 503 เสมอ</li>
      </ul>

      <h3>รหัสตอบกลับ</h3>
      <ul className="dev-list">
        <li>
          <code>400</code> พารามิเตอร์ผิด · <code>401</code> ไม่มีคีย์หรือคีย์ผิด · <code>404</code> ไม่พบแปลง (หรือไม่ใช่แปลงของคีย์นี้)
        </li>
        <li>
          <code>429</code> เรียกเกินโควตา ดู header <code>Retry-After</code> · <code>502</code> / <code>503</code> Earth Engine หรือ NASA POWER มีปัญหา
        </li>
      </ul>
    </section>
  )
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <DevelopersPage />
  </React.StrictMode>
)
