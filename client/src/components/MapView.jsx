import { useEffect, useRef } from 'react'
import L from 'leaflet'
import '@geoman-io/leaflet-geoman-free'
import { colorFor, fmtArea } from '../utils.js'

const BASEMAPS = {
  satellite: {
    label: 'ภาพดาวเทียม',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Esri, Maxar, Earthstar Geographics',
    maxZoom: 19,
    labels:
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
  },
  street: {
    label: 'แผนที่ถนน',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  },
}

// ศูนย์กลางประเทศไทย ใช้เป็นมุมมองเริ่มต้น
const THAILAND = { center: [15.0, 101.0], zoom: 6 }

export default function MapView({
  fields,
  previewFields,
  selectedId,
  onSelect,
  onDrawn,
  drawing,
  basemap,
  overlay,
  overlayOpacity,
  fitToken,
}) {
  const holder = useRef(null)
  const map = useRef(null)
  const baseLayer = useRef(null)
  const labelLayer = useRef(null)
  const overlayLayer = useRef(null)
  const fieldLayer = useRef(null)
  const previewLayer = useRef(null)
  const handlers = useRef({})

  handlers.current = { onSelect, onDrawn }

  // สร้างแผนที่ครั้งเดียว
  useEffect(() => {
    if (map.current) return

    const m = L.map(holder.current, {
      center: THAILAND.center,
      zoom: THAILAND.zoom,
      zoomControl: false,
      attributionControl: true,
    })
    L.control.zoom({ position: 'bottomright' }).addTo(m)
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(m)

    // featureGroup ไม่ใช่ layerGroup เพราะต้องเรียก getBounds() เพื่อซูมให้พอดีกับแปลง
    fieldLayer.current = L.featureGroup().addTo(m)
    previewLayer.current = L.featureGroup().addTo(m)

    m.pm.setGlobalOptions({
      snappable: true,
      templineStyle: { color: '#35c98f', weight: 2 },
      hintlineStyle: { color: '#35c98f', dashArray: '4,4', weight: 2 },
      pathOptions: { color: '#35c98f', fillColor: '#35c98f', fillOpacity: 0.25, weight: 2 },
    })

    m.on('pm:create', (e) => {
      const geojson = e.layer.toGeoJSON()
      m.removeLayer(e.layer)
      handlers.current.onDrawn?.(geojson)
    })

    map.current = m

    // Leaflet ไม่รู้ตัวเมื่อกล่องที่ครอบเปลี่ยนขนาด (เช่นตอนย่อ/ขยายแผงผลลัพธ์)
    const ro = new ResizeObserver(() => m.invalidateSize({ animate: false }))
    ro.observe(holder.current)

    return () => {
      ro.disconnect()
      m.remove()
      map.current = null
    }
  }, [])

  // แผนที่ฐาน
  useEffect(() => {
    const m = map.current
    if (!m) return
    const cfg = BASEMAPS[basemap] || BASEMAPS.satellite

    if (baseLayer.current) m.removeLayer(baseLayer.current)
    if (labelLayer.current) {
      m.removeLayer(labelLayer.current)
      labelLayer.current = null
    }

    baseLayer.current = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom: cfg.maxZoom,
    }).addTo(m)
    baseLayer.current.setZIndex(1)

    if (cfg.labels) {
      labelLayer.current = L.tileLayer(cfg.labels, { maxZoom: cfg.maxZoom }).addTo(m)
      labelLayer.current.setZIndex(3)
    }
  }, [basemap])

  // ชั้นซ้อน NDVI / Kc จาก Earth Engine
  useEffect(() => {
    const m = map.current
    if (!m) return
    if (overlayLayer.current) {
      m.removeLayer(overlayLayer.current)
      overlayLayer.current = null
    }
    if (!overlay?.urlFormat) return

    overlayLayer.current = L.tileLayer(overlay.urlFormat, {
      opacity: overlayOpacity,
      maxZoom: 20,
      attribution: 'Google Earth Engine',
    }).addTo(m)
    overlayLayer.current.setZIndex(2)
  }, [overlay])

  useEffect(() => {
    overlayLayer.current?.setOpacity(overlayOpacity)
  }, [overlayOpacity])

  // แปลงที่บันทึกไว้
  useEffect(() => {
    const group = fieldLayer.current
    if (!group) return
    group.clearLayers()

    fields.forEach((field, i) => {
      const color = colorFor(i)
      const active = field.id === selectedId
      const layer = L.geoJSON(
        { type: 'Feature', geometry: field.geometry, properties: {} },
        {
          style: {
            color,
            weight: active ? 3 : 2,
            opacity: 1,
            fillColor: color,
            fillOpacity: active ? 0.22 : 0.1,
            dashArray: active ? null : '5,4',
          },
        }
      )
      layer.bindTooltip(`<b>${escapeHtml(field.name)}</b><br>${fmtArea(field.areaRai)}`, { sticky: true })
      layer.on('click', () => handlers.current.onSelect?.(field.id))
      group.addLayer(layer)
    })
  }, [fields, selectedId])

  // แปลงที่เพิ่งนำเข้า ยังไม่ได้บันทึก
  useEffect(() => {
    const group = previewLayer.current
    if (!group) return
    group.clearLayers()

    previewFields.forEach((f) => {
      const layer = L.geoJSON(
        { type: 'Feature', geometry: f.geometry, properties: {} },
        { style: { color: '#35c98f', weight: 2.5, fillColor: '#35c98f', fillOpacity: 0.2, dashArray: '2,5' } }
      )
      layer.bindTooltip(`${escapeHtml(f.name)} · ${fmtArea(f.areaRai)}`, { sticky: true })
      group.addLayer(layer)
    })

    if (previewFields.length) {
      const bounds = group.getBounds()
      if (bounds?.isValid()) map.current?.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 })
    }
  }, [previewFields])

  // โหมดวาดพื้นที่
  useEffect(() => {
    const m = map.current
    if (!m) return
    if (drawing) m.pm.enableDraw('Polygon', { finishOn: 'dblclick' })
    else m.pm.disableDraw()
  }, [drawing])

  // ซูมไปยังแปลงที่เลือก
  useEffect(() => {
    if (!fitToken || !selectedId) return
    const field = fields.find((f) => f.id === selectedId)
    if (!field?.bbox) return
    const [w, s, e, n] = field.bbox
    map.current?.fitBounds(
      [
        [s, w],
        [n, e],
      ],
      { padding: [60, 60], maxZoom: 17 }
    )
  }, [fitToken, selectedId, fields])

  return <div ref={holder} className="map" />
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

export { BASEMAPS }
