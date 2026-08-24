import { useRef, useState } from 'react'
import { api } from '../api.js'
import { fmtArea } from '../utils.js'

const ACCEPT = '.zip,.kmz,.kml,.geojson,.json,.gpx,.shp,.dbf,.prj,.shx,.cpg'

const CRS_OPTIONS = [
  { value: '', label: 'อ่านจากไฟล์อัตโนมัติ' },
  { value: '32647', label: 'UTM Zone 47N — WGS84 (EPSG:32647)' },
  { value: '32648', label: 'UTM Zone 48N — WGS84 (EPSG:32648)' },
  { value: '24047', label: 'UTM Zone 47N — Indian 1975 (EPSG:24047)' },
  { value: '24048', label: 'UTM Zone 48N — Indian 1975 (EPSG:24048)' },
  { value: '3857', label: 'Web Mercator (EPSG:3857)' },
  { value: '4326', label: 'WGS84 lat/lon (EPSG:4326)' },
]

export default function ImportPanel({ preview, setPreview, onImported, existingCount = 0, notify }) {
  const inputRef = useRef(null)
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [epsg, setEpsg] = useState('')
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(() => new Set())
  const [replace, setReplace] = useState(false)

  function reset() {
    setPreview([])
    setSelected(new Set())
    setReplace(false)
  }

  async function handleFiles(fileList) {
    const files = [...fileList]
    if (!files.length) return

    setBusy(true)
    setError(null)
    try {
      const res = await api.importFiles(files, { epsg })
      setPreview(res.fields)
      setSelected(new Set(res.fields.map((_, i) => i)))

      const msg = [`อ่านได้ ${res.count} แปลง`]
      if (res.skipped?.length) msg.push(`ข้ามไป ${res.skipped.length} รายการ`)
      notify(`${msg.join(' · ')} — ตรวจแล้วกดนำเข้า`, 'success')
    } catch (err) {
      setError(err)
      setPreview([])
      setSelected(new Set())
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  /** นำแปลงที่เลือกเข้าระบบจริง แล้วให้หน้าหลักเลือก + วิเคราะห์ให้ทันที */
  async function importFields() {
    const chosen = preview.filter((_, i) => selected.has(i))
    if (!chosen.length) return
    if (replace && existingCount && !confirm(`ลบแปลงเดิม ${existingCount} แปลงทิ้ง แล้วใช้ ${chosen.length} แปลงที่นำเข้าแทน?`)) return

    setBusy(true)
    try {
      const res = await api.createFields(chosen, { replace })
      reset()
      onImported(res.fields, { replaced: res.replaced || 0 })
      const note = res.replaced ? ` (แทนที่แปลงเดิม ${res.replaced} แปลง)` : ''
      notify(`นำเข้า ${res.fields.length} แปลงแล้ว${note} — กำลังวิเคราะห์`, 'success')
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const toggle = (i) => {
    const next = new Set(selected)
    next.has(i) ? next.delete(i) : next.add(i)
    setSelected(next)
  }

  const toggleAll = () => {
    if (selected.size === preview.length) setSelected(new Set())
    else setSelected(new Set(preview.map((_, i) => i)))
  }

  const rename = (i, name) => setPreview(preview.map((f, k) => (k === i ? { ...f, name } : f)))

  const totalRai = preview.filter((_, i) => selected.has(i)).reduce((s, f) => s + f.areaRai, 0)

  return (
    <div className="panel">
      <div className="panel-title">นำเข้าแปลงจากไฟล์</div>

      <div
        className={`dropzone${over ? ' over' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          handleFiles(e.dataTransfer.files)
        }}
      >
        <span className="icon">{busy ? <span className="spinner" /> : '🗺️'}</span>
        <strong>{busy ? 'กำลังอ่านไฟล์…' : 'ลากไฟล์มาวาง หรือคลิกเพื่อเลือก'}</strong>
        <span>Shapefile ให้เลือก .shp .shx .dbf .prj พร้อมกัน หรือบีบเป็น .zip</span>
        <div className="format-list">
          {['.zip', '.shp', '.kml', '.kmz', '.geojson', '.gpx'].map((f) => (
            <span key={f} className="format-tag">
              {f}
            </span>
          ))}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        style={{ display: 'none' }}
        onChange={(e) => handleFiles(e.target.files)}
      />

      <div className="form-row" style={{ marginTop: 10 }}>
        <label>ระบบพิกัดของไฟล์</label>
        <select value={epsg} onChange={(e) => setEpsg(e.target.value)}>
          {CRS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <p className="hint">
          Shapefile ที่มีไฟล์ .prj มาด้วยจะแปลงพิกัดให้เองอัตโนมัติ — เลือกตรงนี้เฉพาะตอนที่ไฟล์ไม่ได้บอกระบบพิกัดไว้
        </p>
      </div>

      {error && (
        <div className="note error" style={{ marginTop: 10 }}>
          <strong>{error.message}</strong>
          {error.hint && <span>{error.hint}</span>}
        </div>
      )}

      {preview.length > 0 && (
        <>
          <div className="panel-title" style={{ margin: '12px 0 0' }}>
            แปลงที่อ่านได้
            <button className="btn ghost sm" onClick={toggleAll}>
              {selected.size === preview.length ? 'ไม่เลือกเลย' : 'เลือกทั้งหมด'}
            </button>
          </div>

          <div className="preview-list">
            {preview.map((f, i) => (
              <div key={i} className="preview-row">
                <input
                  type="checkbox"
                  checked={selected.has(i)}
                  onChange={() => toggle(i)}
                  title="เลือกนำเข้าแปลงนี้"
                />
                <input
                  className="nm nm-input"
                  value={f.name}
                  onChange={(e) => rename(i, e.target.value)}
                  title="แก้ชื่อแปลงก่อนนำเข้าได้"
                />
                <span className="ar">{fmtArea(f.areaRai)}</span>
              </div>
            ))}
          </div>

          {existingCount > 0 && (
            <label className="check-row">
              <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
              <span>
                ลบแปลงเดิมทั้งหมด ({existingCount}) แล้วใช้ชุดนี้แทน
              </span>
            </label>
          )}

          <div className="btn-row" style={{ marginTop: 8 }}>
            <button
              className="btn primary"
              style={{ flex: 1 }}
              onClick={importFields}
              disabled={busy || !selected.size}
            >
              {busy ? <span className="spinner" /> : `นำเข้า ${selected.size} แปลง (${totalRai.toFixed(1)} ไร่)`}
            </button>
            <button className="btn" onClick={reset} disabled={busy}>
              ยกเลิก
            </button>
          </div>
        </>
      )}
    </div>
  )
}
