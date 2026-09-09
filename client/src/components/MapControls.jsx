const NDVI_PALETTE = ['#a50026', '#d73027', '#fdae61', '#fee08b', '#d9ef8b', '#a6d96a', '#66bd63', '#1a9850', '#006837']
const KC_PALETTE = ['#f7f4e9', '#dbe7b4', '#a8d18a', '#5fae63', '#26804a', '#0d5236']

const LAYERS = [
  { id: 'none', label: 'ปิด' },
  { id: 'ndvi', label: 'NDVI' },
  { id: 'kc', label: 'Kc' },
  { id: 'truecolor', label: 'ภาพจริง' },
]

export default function MapControls({
  basemap,
  setBasemap,
  layer,
  setLayer,
  opacity,
  setOpacity,
  overlay,
  overlayError,
  overlayLoading,
  fieldOpacity,
  setFieldOpacity,
  disabled,
}) {
  const palette = layer === 'kc' ? KC_PALETTE : NDVI_PALETTE
  const range = layer === 'kc' ? ['0', '1.2'] : ['0', '0.9']

  return (
    <div className="map-overlay map-tools">
      <div className="card-float">
        <div className="layer-switch" style={{ marginBottom: 8 }}>
          {['satellite', 'street'].map((b) => (
            <button key={b} className={basemap === b ? 'on' : ''} onClick={() => setBasemap(b)}>
              {b === 'satellite' ? 'ภาพดาวเทียม' : 'แผนที่ถนน'}
            </button>
          ))}
        </div>

        <div className="slider-row">
          <label htmlFor="field-opacity">
            ความทึบสีแปลง
            <span className="slider-value">{Math.round(fieldOpacity * 100)}%</span>
          </label>
          <input
            id="field-opacity"
            type="range"
            min="0"
            max="0.8"
            step="0.02"
            value={fieldOpacity}
            onChange={(e) => setFieldOpacity(Number(e.target.value))}
            title="ลากไปทางซ้ายจนสุดเพื่อให้เหลือแต่เส้นขอบแปลง"
          />
        </div>

        <div className="legend-title" style={{ marginBottom: 4 }}>ชั้นข้อมูลจากดาวเทียม</div>
        <div className="layer-switch">
          {LAYERS.map((l) => (
            <button
              key={l.id}
              className={layer === l.id ? 'on' : ''}
              onClick={() => setLayer(l.id)}
              disabled={disabled && l.id !== 'none'}
              title={disabled ? 'เลือกแปลงก่อน' : undefined}
            >
              {l.label}
            </button>
          ))}
        </div>

        {layer !== 'none' && (
          <>
            {overlayLoading && (
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 8, display: 'flex', gap: 6 }}>
                <span className="spinner" /> กำลังสร้างภาพจาก Earth Engine…
              </div>
            )}

            {overlayError && (
              <div className="note error" style={{ marginTop: 8, marginBottom: 0, maxWidth: 240 }}>
                {overlayError.message}
                {overlayError.hint && <span style={{ display: 'block' }}>{overlayError.hint}</span>}
              </div>
            )}

            {overlay && layer !== 'truecolor' && (
              <div style={{ marginTop: 10, width: 190 }}>
                <div className="legend-title">{layer === 'kc' ? 'ค่าสัมประสิทธิ์พืช (Kc)' : 'ดัชนีพืชพรรณ (NDVI)'}</div>
                <div
                  className="legend-bar"
                  style={{ background: `linear-gradient(90deg, ${palette.join(',')})` }}
                />
                <div className="legend-scale">
                  <span>{range[0]}</span>
                  <span>{layer === 'kc' ? 'พืชคลุมหนา →' : 'ดินเปล่า → พืชหนาแน่น'}</span>
                  <span>{range[1]}</span>
                </div>
              </div>
            )}

            {overlay && (
              <div className="slider-row">
                <label htmlFor="overlay-opacity">
                  ความทึบชั้นซ้อน
                  <span className="slider-value">{Math.round(opacity * 100)}%</span>
                </label>
                <input
                  id="overlay-opacity"
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.05"
                  value={opacity}
                  onChange={(e) => setOpacity(Number(e.target.value))}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
