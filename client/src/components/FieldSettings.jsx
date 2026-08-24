import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { fmtArea, downloadJson } from '../utils.js'

export default function FieldSettings({ field, options, onUpdated, onDeleted, notify }) {
  const [draft, setDraft] = useState(field)
  const [saving, setSaving] = useState(false)
  const [newIrrigation, setNewIrrigation] = useState({ date: new Date().toISOString().slice(0, 10), mm: '' })

  useEffect(() => setDraft(field), [field.id, field.updatedAt])

  const dirty = JSON.stringify(draft) !== JSON.stringify(field)

  const setSetting = (key, value) => setDraft((d) => ({ ...d, settings: { ...d.settings, [key]: value } }))

  async function save(patchOverride) {
    setSaving(true)
    try {
      const patch = patchOverride || { name: draft.name, settings: draft.settings, irrigations: draft.irrigations }
      const res = await api.updateField(field.id, patch)
      onUpdated(res.field)
      notify('บันทึกการตั้งค่าแล้ว — กำลังคำนวณใหม่', 'success')
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!confirm(`ลบแปลง "${field.name}" ออกจากระบบ?`)) return
    try {
      await api.deleteField(field.id)
      onDeleted(field.id)
      notify('ลบแปลงแล้ว')
    } catch (err) {
      notify(err.message, 'error')
    }
  }

  function addIrrigation() {
    const mm = Number(newIrrigation.mm)
    if (!newIrrigation.date || !(mm > 0)) return
    const next = [...(draft.irrigations || []).filter((r) => r.date !== newIrrigation.date), { date: newIrrigation.date, mm }].sort(
      (a, b) => a.date.localeCompare(b.date)
    )
    setDraft((d) => ({ ...d, irrigations: next }))
    setNewIrrigation({ ...newIrrigation, mm: '' })
  }

  const crop = options.crops.find((c) => c.id === draft.settings.crop)

  return (
    <div className="panel">
      <div className="panel-title">
        รายละเอียดแปลง
        <button className="btn ghost sm" onClick={() => downloadJson(`${field.name}.geojson`, geojsonOf(field))}>
          ⬇ GeoJSON
        </button>
      </div>

      <div className="field-group">
        <div className="form-row">
          <label>ชื่อแปลง</label>
          <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
        </div>

        <div className="hint" style={{ marginTop: -4 }}>
          พื้นที่ {fmtArea(field.areaRai)} ({(field.areaHa).toFixed(2)} เฮกตาร์ · {Math.round(field.areaM2).toLocaleString()} ตร.ม.)
        </div>

        <div className="form-row two">
          <div className="form-row">
            <label>ชนิดพืช</label>
            <select value={draft.settings.crop} onChange={(e) => setSetting('crop', e.target.value)}>
              {options.crops.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label>ชนิดดิน</label>
            <select value={draft.settings.soil} onChange={(e) => setSetting('soil', e.target.value)}>
              {options.soils.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="form-row two">
          <div className="form-row">
            <label>ความลึกราก (ม.)</label>
            <input
              type="number"
              step="0.1"
              min="0.1"
              placeholder={crop ? String(crop.rootDepth) : ''}
              value={draft.settings.rootDepth ?? ''}
              onChange={(e) => setSetting('rootDepth', e.target.value === '' ? null : Number(e.target.value))}
            />
          </div>
          <div className="form-row">
            <label>ยอมให้ดินพร่องได้ (p)</label>
            <input
              type="number"
              step="0.05"
              min="0.05"
              max="0.9"
              placeholder={crop ? String(crop.p) : ''}
              value={draft.settings.p ?? ''}
              onChange={(e) => setSetting('p', e.target.value === '' ? null : Number(e.target.value))}
            />
          </div>
        </div>

        <div className="form-row two">
          <div className="form-row">
            <label>ดาวเทียม</label>
            <select value={draft.settings.collection} onChange={(e) => setSetting('collection', e.target.value)}>
              {options.collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label>ประสิทธิภาพระบบน้ำ</label>
            <input
              type="number"
              step="0.05"
              min="0.3"
              max="1"
              value={draft.settings.irrigationEfficiency ?? 0.85}
              onChange={(e) => setSetting('irrigationEfficiency', Number(e.target.value))}
            />
          </div>
        </div>

        <div className="form-row">
          <label>วันปลูก (ไม่บังคับ)</label>
          <input
            type="date"
            value={draft.settings.plantingDate || ''}
            onChange={(e) => setSetting('plantingDate', e.target.value || null)}
          />
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <div className="panel-title" style={{ marginBottom: 6 }}>บันทึกการให้น้ำ</div>
        {(draft.irrigations || []).length > 0 && (
          <div className="preview-list" style={{ maxHeight: 120 }}>
            {draft.irrigations.map((r) => (
              <div key={r.date} className="preview-row">
                <span className="nm">{r.date}</span>
                <span className="ar">{r.mm} มม.</span>
                <button
                  className="btn ghost sm"
                  onClick={() => setDraft((d) => ({ ...d, irrigations: d.irrigations.filter((x) => x.date !== r.date) }))}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="btn-row" style={{ marginTop: 6 }}>
          <input
            type="date"
            value={newIrrigation.date}
            onChange={(e) => setNewIrrigation({ ...newIrrigation, date: e.target.value })}
            style={{ flex: 1.4, border: '1px solid var(--line-strong)', borderRadius: 7, padding: '6px 9px' }}
          />
          <input
            type="number"
            placeholder="มม."
            value={newIrrigation.mm}
            onChange={(e) => setNewIrrigation({ ...newIrrigation, mm: e.target.value })}
            style={{ flex: 1, border: '1px solid var(--line-strong)', borderRadius: 7, padding: '6px 9px' }}
          />
          <button className="btn" onClick={addIrrigation}>
            เพิ่ม
          </button>
        </div>
      </div>

      <div className="btn-row" style={{ marginTop: 14 }}>
        <button className="btn primary" style={{ flex: 1 }} onClick={() => save()} disabled={!dirty || saving}>
          {saving ? <span className="spinner" /> : dirty ? 'บันทึกและคำนวณใหม่' : 'บันทึกแล้ว'}
        </button>
        <button className="btn danger" onClick={remove}>
          ลบ
        </button>
      </div>
    </div>
  )
}

const geojsonOf = (field) => ({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: field.name, areaRai: field.areaRai, ...field.properties },
      geometry: field.geometry,
    },
  ],
})
