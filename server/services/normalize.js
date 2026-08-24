/**
 * ทำความสะอาดรูปทรงที่นำเข้ามา ให้เหลือเฉพาะ "พื้นที่แปลง" ที่ประมวลผลได้จริง
 */
import { area, bbox, centroid, buffer as turfBuffer, truncate } from '@turf/turf'

const POLYGONAL = new Set(['Polygon', 'MultiPolygon'])
const LINEAR = new Set(['LineString', 'MultiLineString'])

/** คีย์ที่มักถูกใช้เป็นชื่อแปลงในไฟล์ GIS */
const NAME_KEYS = ['name', 'Name', 'NAME', 'field', 'FIELD', 'ชื่อ', 'ชื่อแปลง', 'title', 'Title', 'label', 'LABEL', 'id', 'ID', 'FID', 'OBJECTID']

function pickName(props, fallback) {
  if (props) {
    for (const key of NAME_KEYS) {
      const v = props[key]
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim()
    }
  }
  return fallback
}

/** ปิดวงแหวนที่ผู้ผลิตไฟล์ลืมปิด (จุดแรก ≠ จุดสุดท้าย) */
function closeRings(geometry) {
  const fix = (ring) => {
    if (ring.length < 3) return ring
    const [a, b] = [ring[0], ring[ring.length - 1]]
    if (a[0] !== b[0] || a[1] !== b[1]) return [...ring, [...a]]
    return ring
  }
  if (geometry.type === 'Polygon') geometry.coordinates = geometry.coordinates.map(fix)
  if (geometry.type === 'MultiPolygon') geometry.coordinates = geometry.coordinates.map((p) => p.map(fix))
  return geometry
}

/** เส้นปิดที่ลากรอบพื้นที่ (พบบ่อยใน KML ที่วาดจาก Google Earth) → แปลงเป็นรูปปิด */
function lineToPolygon(geometry) {
  const rings = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates
  const polys = rings
    .filter((r) => r.length >= 4)
    .map((r) => {
      const [a, b] = [r[0], r[r.length - 1]]
      const closed = a[0] === b[0] && a[1] === b[1] ? r : [...r, [...a]]
      return [closed]
    })
  if (!polys.length) return null
  return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys }
}

/**
 * @param {object} featureCollection
 * @param {object} [opts]
 * @param {number} [opts.pointBufferM=50] รัศมีที่ใช้แปลงจุดให้เป็นพื้นที่วงกลม (เมตร) — 0 = ข้ามจุดไป
 * @param {number} [opts.minAreaM2=100] พื้นที่ต่ำกว่านี้ถือว่าเป็นเศษขยะ
 */
export function normalizeToFields(featureCollection, opts = {}) {
  const { pointBufferM = 50, minAreaM2 = 100 } = opts

  const fields = []
  const skipped = []

  featureCollection.features.forEach((feature, i) => {
    const props = feature.properties || {}
    const fallbackName = `แปลงที่ ${fields.length + 1}`
    let geometry = feature.geometry

    if (!geometry) {
      skipped.push({ index: i, reason: 'ไม่มีรูปทรง' })
      return
    }

    if (geometry.type === 'GeometryCollection') {
      geometry = (geometry.geometries || []).find((g) => POLYGONAL.has(g.type)) || geometry.geometries?.[0]
      if (!geometry) {
        skipped.push({ index: i, reason: 'GeometryCollection ว่างเปล่า' })
        return
      }
    }

    if (LINEAR.has(geometry.type)) {
      const poly = lineToPolygon(geometry)
      if (!poly) {
        skipped.push({ index: i, reason: 'เส้นมีจุดน้อยเกินกว่าจะปิดเป็นพื้นที่ได้' })
        return
      }
      geometry = poly
    }

    if (geometry.type === 'Point' || geometry.type === 'MultiPoint') {
      if (!pointBufferM) {
        skipped.push({ index: i, reason: 'เป็นจุด ไม่ใช่พื้นที่' })
        return
      }
      const pt = geometry.type === 'Point' ? geometry : { type: 'Point', coordinates: geometry.coordinates[0] }
      const buffered = turfBuffer({ type: 'Feature', properties: {}, geometry: pt }, pointBufferM, { units: 'meters' })
      if (!buffered?.geometry) {
        skipped.push({ index: i, reason: 'สร้างพื้นที่จากจุดไม่สำเร็จ' })
        return
      }
      geometry = buffered.geometry
    }

    if (!POLYGONAL.has(geometry.type)) {
      skipped.push({ index: i, reason: `ยังไม่รองรับรูปทรงชนิด ${geometry.type}` })
      return
    }

    geometry = closeRings(structuredClone(geometry))

    // ตัดทศนิยมเหลือ 7 ตำแหน่ง (~1 ซม.) และตัดค่า Z ทิ้ง — GEE ไม่รับพิกัด 3 มิติ
    const clean = truncate({ type: 'Feature', properties: {}, geometry }, { precision: 7, coordinates: 2, mutate: true })

    const m2 = area(clean)
    if (m2 < minAreaM2) {
      skipped.push({ index: i, reason: `พื้นที่เล็กเกินไป (${m2.toFixed(0)} ตร.ม.)` })
      return
    }

    const c = centroid(clean).geometry.coordinates

    fields.push({
      name: pickName(props, fallbackName),
      geometry: clean.geometry,
      properties: props,
      areaM2: m2,
      areaRai: m2 / 1600, // 1 ไร่ = 1,600 ตร.ม.
      areaHa: m2 / 10000,
      centroid: { lon: c[0], lat: c[1] },
      bbox: bbox(clean),
    })
  })

  return { fields, skipped }
}
