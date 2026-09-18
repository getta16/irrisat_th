import { Router } from 'express'
import { getField } from '../services/store.js'
import { ownerOf } from '../services/auth.js'
import { getNdviSeries, getNdviTiles, geeStatus, initEarthEngine, COLLECTIONS } from '../services/gee.js'
import { getDailyWeather } from '../services/weather.js'
import { runWaterBalance, demoNdviSeries, SOIL_TYPES, CROPS } from '../services/irrigation.js'
import { ALLOW_DEMO } from '../config.js'

const router = Router()

// แคชในหน่วยความจำ — GEE กับ NASA POWER ตอบช้าและมีโควตา จึงไม่ควรเรียกซ้ำถี่ ๆ
const cache = new Map()
const TTL_MS = 30 * 60 * 1000

function cached(key, producer) {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value
  const value = producer().catch((err) => {
    cache.delete(key)
    throw err
  })
  cache.set(key, { at: Date.now(), value })
  if (cache.size > 200) cache.delete(cache.keys().next().value)
  return value
}

const iso = (d) => d.toISOString().slice(0, 10)
const shiftDays = (n) => iso(new Date(Date.now() + n * 86400000))

/** NASA POWER มีข้อมูลช้ากว่าปัจจุบันไม่กี่วัน จึงต้องถอยวันสิ้นสุดให้ */
const WEATHER_LAG_DAYS = 3

function resolveRange(query) {
  const end = query.end || shiftDays(-WEATHER_LAG_DAYS)
  const start = query.start || iso(new Date(Date.parse(`${end}T00:00:00Z`) - 180 * 86400000))
  if (Date.parse(start) > Date.parse(end)) throw new Error('วันเริ่มต้นต้องมาก่อนวันสิ้นสุด')
  return { start, end }
}

router.get('/options', (_req, res) => {
  res.json({
    soils: Object.entries(SOIL_TYPES).map(([id, v]) => ({ id, ...v })),
    crops: Object.entries(CROPS).map(([id, v]) => ({ id, ...v })),
    collections: Object.values(COLLECTIONS),
  })
})

/**
 * POST /api/analysis
 * body: { fieldId } หรือ { geometry, centroid, areaM2 }  + { start, end, settings, collection }
 */
router.post('/', async (req, res) => {
  try {
    const body = req.body || {}
    let geometry = body.geometry
    let centroid = body.centroid
    let areaM2 = body.areaM2
    let settings = body.settings || {}
    let irrigations = body.irrigations || []

    if (body.fieldId) {
      const field = getField(body.fieldId, ownerOf(req))
      if (!field) return res.status(404).json({ error: 'ไม่พบแปลงนี้' })
      geometry = field.geometry
      centroid = field.centroid
      areaM2 = field.areaM2
      settings = { ...field.settings, ...settings }
      irrigations = body.irrigations || field.irrigations || []
    }

    if (!geometry) return res.status(400).json({ error: 'ต้องระบุ fieldId หรือ geometry' })
    if (!centroid) return res.status(400).json({ error: 'ต้องระบุจุดศูนย์กลางของแปลง (centroid)' })

    const { start, end } = resolveRange(body)
    const collection = settings.collection || body.collection || 'S2'
    const maxCloud = Number(body.maxCloud ?? settings.maxCloud ?? 60)

    const geomKey = JSON.stringify(geometry).slice(0, 400)

    // ── NDVI ────────────────────────────────────────────────────────
    let ndviSeries = []
    let ndviSource = 'earth-engine'
    let ndviWarning = null
    let ndviError = null

    try {
      await initEarthEngine()
      ndviSeries = await cached(`ndvi|${collection}|${start}|${end}|${maxCloud}|${geomKey}`, () =>
        getNdviSeries({ geometry, start, end, collection, maxCloud })
      )
      // ภาพที่มองเห็นแปลงน้อยกว่า 40% ถือว่าเชื่อถือไม่ได้ (เมฆบังเกือบหมด)
      const usable = ndviSeries.filter((d) => d.coverage >= 0.4)
      if (usable.length) ndviSeries = usable
    } catch (err) {
      if (!ALLOW_DEMO) {
        return res.status(502).json({ error: 'ดึงข้อมูล NDVI จาก Earth Engine ไม่สำเร็จ', detail: err.message })
      }
      ndviSource = 'demo'
      ndviError = err.message
      ndviSeries = demoNdviSeries({
        start,
        end,
        lat: centroid.lat,
        lon: centroid.lon,
        revisitDays: (COLLECTIONS[collection] || COLLECTIONS.S2).revisitDays,
      })
    }

    if (!ndviSeries.length && ALLOW_DEMO) {
      ndviWarning = 'ไม่พบภาพดาวเทียมที่ปลอดเมฆในช่วงเวลานี้ ลองขยายช่วงวันที่ หรือเพิ่มเพดานเมฆที่ยอมรับได้'
    }

    // ── อากาศ + ET₀ ─────────────────────────────────────────────────
    const weather = await cached(
      `wx|${centroid.lat.toFixed(3)}|${centroid.lon.toFixed(3)}|${start}|${end}`,
      () => getDailyWeather({ lat: centroid.lat, lon: centroid.lon, start, end })
    )

    if (!weather.days.length) {
      return res.status(502).json({ error: 'ไม่ได้รับข้อมูลอากาศสำหรับช่วงเวลานี้' })
    }

    // ── สมดุลน้ำ ────────────────────────────────────────────────────
    const result = runWaterBalance({ ndviSeries, weatherDays: weather.days, settings, irrigations })

    res.json({
      range: { start, end },
      collection,
      ndvi: {
        source: ndviSource,
        observations: ndviSeries,
        warning: ndviWarning,
        error: ndviError,
      },
      weather: { source: weather.source, elevation: weather.elevation },
      ...result,
    })
  } catch (err) {
    console.error('analysis failed:', err)
    res.status(500).json({ error: 'ประมวลผลไม่สำเร็จ', detail: String(err?.message || err) })
  }
})

/**
 * POST /api/analysis/tiles — ชั้นแผนที่ NDVI / Kc / ภาพสีธรรมชาติ
 */
router.post('/tiles', async (req, res) => {
  try {
    const body = req.body || {}
    let geometry = body.geometry
    if (body.fieldId) {
      const field = getField(body.fieldId, ownerOf(req))
      if (!field) return res.status(404).json({ error: 'ไม่พบแปลงนี้' })
      geometry = field.geometry
    }
    if (!geometry) return res.status(400).json({ error: 'ต้องระบุ fieldId หรือ geometry' })

    const { start, end } = resolveRange(body)
    const layer = body.layer || 'ndvi'
    const collection = body.collection || 'S2'
    const maxCloud = Number(body.maxCloud ?? 60)

    const key = `tiles|${layer}|${collection}|${start}|${end}|${maxCloud}|${JSON.stringify(geometry).slice(0, 400)}`
    const tiles = await cached(key, () => getNdviTiles({ geometry, start, end, collection, maxCloud, layer }))
    res.json(tiles)
  } catch (err) {
    const detail = String(err?.message || err)
    const status = geeStatus()
    // แยกให้ชัดว่าเป็น "ยังไม่ได้ตั้งค่า" หรือ "ตั้งค่าแล้วแต่สิทธิ์ไม่พอ" — วิธีแก้คนละทาง
    const hint = !status.ready
      ? 'ยังไม่ได้ตั้งค่า Earth Engine — ดูขั้นตอนใน README'
      : /ไม่มีสิทธิ์/.test(detail)
        ? 'เชื่อมต่อ Earth Engine ได้แล้ว แต่ service account ยังไม่มีสิทธิ์สร้างชั้นแผนที่ (ดู detail)'
        : undefined
    console.error('tiles failed:', detail)
    res.status(502).json({ error: 'สร้างชั้นแผนที่จาก Earth Engine ไม่สำเร็จ', detail, hint })
  }
})

export default router
