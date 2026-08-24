import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api.js'
import { isoDate, shiftDays } from './utils.js'

import MapView from './components/MapView.jsx'
import MapControls from './components/MapControls.jsx'
import ImportPanel from './components/ImportPanel.jsx'
import FieldList from './components/FieldList.jsx'
import FieldSettings from './components/FieldSettings.jsx'
import AnalysisPanel from './components/AnalysisPanel.jsx'

// NASA POWER มีข้อมูลช้ากว่าปัจจุบันราว 3 วัน
const DEFAULT_END = shiftDays(isoDate(new Date()), -3)
const DEFAULT_START = shiftDays(DEFAULT_END, -180)

export default function App() {
  const [status, setStatus] = useState(null)
  const [options, setOptions] = useState(null)

  const [fields, setFields] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [preview, setPreview] = useState([])
  const [drawing, setDrawing] = useState(false)
  const [fitToken, setFitToken] = useState(0)

  const [range, setRange] = useState({ start: DEFAULT_START, end: DEFAULT_END })

  const [analysis, setAnalysis] = useState(null)
  const [analysisLoading, setAnalysisLoading] = useState(false)
  const [analysisError, setAnalysisError] = useState(null)
  const [reloadToken, setReloadToken] = useState(0)

  const [basemap, setBasemap] = useState('satellite')
  const [layer, setLayer] = useState('none')
  const [opacity, setOpacity] = useState(0.8)
  const [overlay, setOverlay] = useState(null)
  const [overlayLoading, setOverlayLoading] = useState(false)
  const [overlayError, setOverlayError] = useState(null)

  const [deleting, setDeleting] = useState(false)

  const [toasts, setToasts] = useState([])
  const toastId = useRef(0)

  const notify = useCallback((message, kind = 'info') => {
    const id = ++toastId.current
    setToasts((t) => [...t, { id, message, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500)
  }, [])

  const selected = fields.find((f) => f.id === selectedId) || null

  // สถานะ Earth Engine — เซิร์ฟเวอร์ต้องใช้เวลายืนยันตัวตนสักครู่หลังเพิ่งสตาร์ต
  // และหน้าเว็บมักถูกเปิดขึ้นก่อนที่ API จะพร้อมรับคำขอด้วยซ้ำ ถ้าถามครั้งเดียว
  // ป้ายสถานะจะค้างที่ "ไม่ได้เชื่อมต่อดาวเทียม" ทั้งที่เชื่อมต่อได้แล้ว จึงถามซ้ำจนกว่าจะพร้อม
  useEffect(() => {
    let timer
    let stopped = false
    let tries = 0

    const poll = async () => {
      if (stopped) return
      try {
        const s = await api.status()
        setStatus(s)
        if (s.gee?.mode === 'earth-engine') return
      } catch {
        setStatus({ ok: false })
      }
      if (++tries < 20) timer = setTimeout(poll, 3000)
    }

    poll()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  }, [])

  // โหลดข้อมูลตั้งต้น
  useEffect(() => {
    api.options().then(setOptions).catch(() => {})
    api
      .listFields()
      .then((res) => {
        setFields(res.fields)
        if (res.fields.length) {
          setSelectedId(res.fields[0].id)
          setFitToken((t) => t + 1)
        }
      })
      .catch((err) => notify(`โหลดรายการแปลงไม่สำเร็จ: ${err.message}`, 'error'))
  }, [notify])

  // คำนวณใหม่ทุกครั้งที่เปลี่ยนแปลง / เปลี่ยนช่วงวันที่ / แก้การตั้งค่า
  useEffect(() => {
    if (!selected) {
      setAnalysis(null)
      return
    }
    let cancelled = false
    setAnalysisLoading(true)
    setAnalysisError(null)

    api
      .analyse({ fieldId: selected.id, start: range.start, end: range.end })
      .then((res) => {
        if (!cancelled) setAnalysis(res)
      })
      .catch((err) => {
        if (!cancelled) {
          setAnalysis(null)
          setAnalysisError(err)
        }
      })
      .finally(() => {
        if (!cancelled) setAnalysisLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [selected?.id, selected?.updatedAt, range.start, range.end, reloadToken])

  // ชั้นซ้อนจาก Earth Engine
  useEffect(() => {
    if (layer === 'none' || !selected) {
      setOverlay(null)
      setOverlayError(null)
      return
    }
    let cancelled = false
    setOverlayLoading(true)
    setOverlayError(null)

    api
      .tiles({
        fieldId: selected.id,
        layer,
        start: range.start,
        end: range.end,
        collection: selected.settings.collection,
      })
      .then((res) => {
        if (!cancelled) setOverlay(res)
      })
      .catch((err) => {
        if (!cancelled) {
          setOverlay(null)
          setOverlayError(err)
        }
      })
      .finally(() => {
        if (!cancelled) setOverlayLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [layer, selected?.id, selected?.settings?.collection, range.start, range.end])


  /** หลังบันทึกแปลงชุดใหม่: เลือกแปลงแรก + ซูมไปหา แล้ว useEffect จะสั่งวิเคราะห์เอง */
  const adoptFields = useCallback((created, { replaced = 0 } = {}) => {
    setFields((prev) => (replaced ? created : [...prev, ...created]))
    setSelectedId(created[0].id)
    setFitToken((t) => t + 1)
  }, [])

  /** เลือกแปลงถัดไปให้อัตโนมัติ เพื่อไม่ให้แผงผลวิเคราะห์ว่างหลังลบ */
  const dropFields = useCallback(
    (ids) => {
      const gone = new Set(ids)
      setFields((prev) => prev.filter((f) => !gone.has(f.id)))
      setSelectedId((cur) => (cur && gone.has(cur) ? fields.find((f) => !gone.has(f.id))?.id ?? null : cur))
    },
    [fields]
  )

  async function handleDeleteField(field) {
    if (!confirm(`ลบแปลง "${field.name}" ออกจากระบบ?`)) return
    setDeleting(true)
    try {
      await api.deleteField(field.id)
      dropFields([field.id])
      notify(`ลบแปลง ${field.name} แล้ว`)
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setDeleting(false)
    }
  }

  async function handleDeleteAll() {
    if (!fields.length) return
    if (!confirm(`ลบแปลงทั้งหมด ${fields.length} แปลงออกจากระบบ?`)) return
    setDeleting(true)
    try {
      const res = await api.deleteAllFields()
      setFields([])
      setSelectedId(null)
      notify(`ลบแปลงทั้งหมด ${res?.removed ?? fields.length} แปลงแล้ว`)
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setDeleting(false)
    }
  }

  async function handleDrawn(geojson) {
    setDrawing(false)
    try {
      const res = await api.createFromGeoJSON({ type: 'FeatureCollection', features: [geojson] })
      const created = res.fields[0]
      setFields((f) => [...f, ...res.fields])
      setSelectedId(created.id)
      notify(`เพิ่มแปลงใหม่ ${created.areaRai.toFixed(2)} ไร่`, 'success')
    } catch (err) {
      notify(err.message, 'error')
    }
  }

  const zoomToSelected = () => setFitToken((t) => t + 1)

  const geeChip = (() => {
    if (!status) return { cls: 'down', text: 'กำลังเชื่อมต่อ…' }
    const mode = status.gee?.mode
    if (mode === 'earth-engine') return { cls: 'live', text: 'Earth Engine พร้อมใช้งาน' }
    if (mode === 'demo') return { cls: 'demo', text: 'โหมดสาธิต (ข้อมูลจำลอง)' }
    return { cls: 'down', text: 'ไม่ได้เชื่อมต่อดาวเทียม' }
  })()

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="brand-mark">💧</span>
          <span>
            IrriSAT-TH
            <small>วางแผนการให้น้ำจากภาพถ่ายดาวเทียม</small>
          </span>
        </div>

        <div className="header-spacer" />

        <div className="header-controls">
          <div>
            <label>ตั้งแต่</label>
            <input
              type="date"
              value={range.start}
              max={range.end}
              onChange={(e) => setRange((r) => ({ ...r, start: e.target.value }))}
            />
          </div>
          <div>
            <label>ถึง</label>
            <input
              type="date"
              value={range.end}
              min={range.start}
              max={DEFAULT_END}
              onChange={(e) => setRange((r) => ({ ...r, end: e.target.value }))}
            />
          </div>
          <span className={`chip ${geeChip.cls}`} title={status?.gee?.error || ''}>
            <span className="dot" />
            {geeChip.text}
          </span>
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-scroll">
            <ImportPanel
              preview={preview}
              setPreview={setPreview}
              existingCount={fields.length}
              onImported={adoptFields}
              notify={notify}
            />

            <FieldList
              fields={fields}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onZoom={zoomToSelected}
              drawing={drawing}
              onToggleDraw={() => setDrawing((d) => !d)}
              onDelete={handleDeleteField}
              onDeleteAll={handleDeleteAll}
              busy={deleting}
            />

            {selected && options && (
              <FieldSettings
                key={selected.id}
                field={selected}
                options={options}
                notify={notify}
                onUpdated={(updated) => setFields((f) => f.map((x) => (x.id === updated.id ? updated : x)))}
                onDeleted={(id) => dropFields([id])}
              />
            )}
          </div>
        </aside>

        <main className="main-area">
          <div style={{ position: 'relative', minHeight: 0 }}>
            <MapView
              fields={fields}
              previewFields={preview}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onDrawn={handleDrawn}
              drawing={drawing}
              basemap={basemap}
              overlay={overlay}
              overlayOpacity={opacity}
              fitToken={fitToken}
            />
            <MapControls
              basemap={basemap}
              setBasemap={setBasemap}
              layer={layer}
              setLayer={setLayer}
              opacity={opacity}
              setOpacity={setOpacity}
              overlay={overlay}
              overlayError={overlayError}
              overlayLoading={overlayLoading}
              disabled={!selected}
            />
            {drawing && (
              <div className="map-overlay card-float" style={{ top: 12, left: 12, maxWidth: 260 }}>
                <strong style={{ fontSize: 12.5 }}>โหมดวาดแปลง</strong>
                <div className="hint">คลิกเพื่อวางจุดรอบพื้นที่ แล้วดับเบิลคลิกเพื่อปิดรูป</div>
              </div>
            )}
          </div>

          <AnalysisPanel
            field={selected}
            analysis={analysis}
            loading={analysisLoading}
            error={analysisError}
            onRetry={() => setReloadToken((t) => t + 1)}
          />
        </main>
      </div>

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  )
}
