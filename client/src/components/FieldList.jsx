import { colorFor, fmtArea } from '../utils.js'

export default function FieldList({
  fields,
  selectedId,
  onSelect,
  onZoom,
  drawing,
  onToggleDraw,
  onDelete,
  onDeleteAll,
  busy,
}) {
  return (
    <div className="panel">
      <div className="panel-title">
        แปลงเพาะปลูก
        {fields.length > 0 && <span className="count">{fields.length}</span>}
        <span style={{ flex: 1 }} />
        {fields.length > 0 && (
          <button className="btn ghost sm danger" onClick={onDeleteAll} disabled={busy} title="ลบแปลงทั้งหมด">
            🗑 ลบทั้งหมด
          </button>
        )}
      </div>

      <button className={`btn block${drawing ? ' primary' : ''}`} onClick={onToggleDraw}>
        {drawing ? '⏹ หยุดวาด (ดับเบิลคลิกเพื่อจบรูป)' : '✏️ วาดแปลงบนแผนที่'}
      </button>

      {fields.length === 0 ? (
        <div className="empty-state">
          <span className="big">🌾</span>
          ยังไม่มีแปลงในระบบ
          <br />
          นำเข้าไฟล์ขอบเขต หรือวาดแปลงบนแผนที่เพื่อเริ่มต้น
        </div>
      ) : (
        <div style={{ marginTop: 8 }}>
          {fields.map((field, i) => (
            <div key={field.id} className={`field-item${field.id === selectedId ? ' active' : ''}`}>
              <span className="field-swatch" style={{ background: colorFor(i) }} />
              <button
                className="meta"
                onClick={() => {
                  onSelect(field.id)
                  onZoom()
                }}
              >
                <span className="name">{field.name}</span>
                <span className="sub">
                  {fmtArea(field.areaRai)} · {field.centroid.lat.toFixed(4)}, {field.centroid.lon.toFixed(4)}
                </span>
              </button>
              <button
                className="btn ghost sm field-del"
                title={`ลบแปลง ${field.name}`}
                disabled={busy}
                onClick={() => onDelete(field)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
