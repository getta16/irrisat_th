/**
 * API ภายนอก (อ่านอย่างเดียว) — ข้อมูลแปลง + NDVI + Kc ให้ script / QGIS / Power BI ดึงไปใช้
 * ไม่ต้องใช้คีย์ (ดู services/publicAccess.js) และเห็นเฉพาะแปลงของ PUBLIC_API_OWNER
 *
 *   GET /api/v1/areas                  รายการแปลง (?geometry=1 แนบรูปทรงด้วย)
 *   GET /api/v1/areas.geojson          รายการแปลงเป็น FeatureCollection
 *   GET /api/v1/areas/:id              แปลงเดียว พร้อมรูปทรง
 *   GET /api/v1/areas/:id/ndvi         NDVI + Kc ตามวันที่มีภาพดาวเทียมจริง
 *   GET /api/v1/areas/:id/timeseries   NDVI + Kc รายวัน (เติมค่าระหว่างภาพ) (?weather=1 เพิ่ม ET₀/ETc/ฝน)
 *   GET /api/v1/ndvi/latest            ค่าล่าสุดของทุกแปลง
 *
 * ต่างจาก /api/analysis ตรงที่ไม่มีวันตกไปใช้ข้อมูลจำลอง — ถ้า Earth Engine ใช้ไม่ได้จะตอบ error
 * เพราะผู้ใช้ API มองไม่เห็นป้าย "ข้อมูลจำลอง" บนหน้าเว็บ ตัวเลขปลอมจะหลุดไปปนกับของจริง
 */
import { Router } from 'express'
import { listFields, getField } from '../services/store.js'
import { geeStatus, initEarthEngine, COLLECTIONS } from '../services/gee.js'
import { getUsableNdvi, MIN_COVERAGE } from '../services/ndvi.js'
import { cached } from '../services/cache.js'
import { resolveRange } from '../services/range.js'
import { getDailyWeather } from '../services/weather.js'
import { ndviToKc, interpolateDaily, KC_SLOPE, KC_INTERCEPT, KC_MAX } from '../services/irrigation.js'
import { API_MAX_RANGE_DAYS } from '../config.js'

const router = Router()

const KC_FORMULA = `Kc = ${KC_SLOPE} × NDVI ${KC_INTERCEPT < 0 ? '-' : '+'} ${Math.abs(KC_INTERCEPT)}, จำกัดช่วง [0, ${KC_MAX}]`

/** ภาพล่าสุดของ /ndvi/latest หาย้อนหลังได้ไกลสุดเท่านี้ */
const LATEST_MAX_DAYS = 180
/** แปลงที่ส่งไป Earth Engine พร้อมกัน — มากกว่านี้เสี่ยงโดนจำกัดโควตา */
const LATEST_CONCURRENCY = 3

const isTrue = (v) => v === true || v === 'true' || v === '1' || v === 1
const round = (v, d = 3) => (v === null || v === undefined ? null : Math.round(v * 10 ** d) / 10 ** d)
const iso = (d) => d.toISOString().slice(0, 10)

// ── ตัวช่วย ────────────────────────────────────────────────────────────

function summarizeArea(f, { withGeometry = false } = {}) {
  return {
    id: f.id,
    name: f.name,
    areaM2: round(f.areaM2, 1),
    areaRai: round(f.areaRai, 3),
    areaHa: round(f.areaHa, 4),
    centroid: f.centroid,
    bbox: f.bbox,
    crop: f.settings?.crop ?? null,
    soil: f.settings?.soil ?? null,
    plantingDate: f.settings?.plantingDate ?? null,
    collection: f.settings?.collection || 'S2',
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
    ...(withGeometry ? { geometry: f.geometry } : {}),
  }
}

/** ชุดดาวเทียม + เพดานเมฆ: query ก่อน แล้วค่อยค่าที่ตั้งไว้ในแปลง */
function satelliteParams(query, field) {
  const collection = String(query.collection || field?.settings?.collection || 'S2').toUpperCase()
  if (!COLLECTIONS[collection]) {
    throw new RangeError(`collection ต้องเป็น ${Object.keys(COLLECTIONS).join(' หรือ ')}`)
  }
  const maxCloud = Number(query.maxCloud ?? field?.settings?.maxCloud ?? 60)
  if (!Number.isFinite(maxCloud) || maxCloud < 0 || maxCloud > 100) {
    throw new RangeError('maxCloud ต้องเป็นตัวเลข 0-100')
  }
  return { collection, maxCloud }
}

function meta(extra) {
  return {
    source: 'earth-engine',
    kcFormula: KC_FORMULA,
    minCoverage: MIN_COVERAGE,
    generatedAt: new Date().toISOString(),
    ...extra,
  }
}

/** Earth Engine ยังไม่พร้อม = ระบบฝั่งเรายังไม่ได้ตั้งค่า ไม่ใช่ความผิดของผู้เรียก */
async function assertEarthEngine() {
  await initEarthEngine() // ตอนเพิ่งเปิดเซิร์ฟเวอร์ยังเชื่อมต่ออยู่ — รอให้เสร็จก่อนตัดสิน
  const s = geeStatus()
  if (s.ready) return
  const err = new Error(s.error || 'Earth Engine ยังไม่พร้อมใช้งาน')
  err.status = 503
  throw err
}

function findArea(req, res) {
  const field = getField(req.params.id, req.apiOwner)
  if (!field) res.status(404).json({ error: 'ไม่พบแปลงนี้' })
  return field
}

// ── CSV ────────────────────────────────────────────────────────────────

function csvCell(v) {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function sendCsv(res, filename, columns, rows) {
  const lines = [columns.join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))]
  // BOM ให้ Excel อ่านชื่อแปลงภาษาไทยถูก
  res.set('Content-Type', 'text/csv; charset=utf-8')
  res.set('Content-Disposition', `attachment; filename="${filename}"`)
  res.send(`﻿${lines.join('\r\n')}\r\n`)
}

const wantsCsv = (req) => String(req.query.format || '').toLowerCase() === 'csv'
const safeName = (s) => String(s).replace(/[^\w\-]+/g, '_').slice(0, 60) || 'area'

// ── เส้นทาง ────────────────────────────────────────────────────────────

router.get('/areas', (req, res) => {
  const withGeometry = isTrue(req.query.geometry)
  const areas = listFields(req.apiOwner).map((f) => summarizeArea(f, { withGeometry }))
  // req.apiOwner เป็น null ได้เมื่อเรียกผ่าน /api/portal ในโหมดไม่บังคับล็อกอิน
  res.json({ owner: req.apiOwner?.email ?? null, count: areas.length, areas })
})

// ต้องประกาศก่อน /areas/:id ไม่อย่างนั้น "areas.geojson" จะถูกจับเป็น id
router.get('/areas.geojson', (req, res) => {
  const features = listFields(req.apiOwner).map((f) => {
    // centroid/bbox ซ้ำกับรูปทรงอยู่แล้ว และ QGIS แสดง object ในตารางคุณสมบัติไม่ได้
    const { geometry, centroid: _c, bbox: _b, ...props } = summarizeArea(f, { withGeometry: true })
    return { type: 'Feature', id: f.id, geometry, properties: props }
  })
  res.type('application/geo+json').send(JSON.stringify({ type: 'FeatureCollection', features }))
})

router.get('/areas/:id', (req, res) => {
  const field = findArea(req, res)
  if (!field) return
  res.json({ area: summarizeArea(field, { withGeometry: true }) })
})

/** ค่าตามภาพดาวเทียมจริงเท่านั้น — ไม่มีการเติมค่า เหมาะกับงานวิเคราะห์/สอบทาน */
router.get('/areas/:id/ndvi', async (req, res, next) => {
  try {
    const field = findArea(req, res)
    if (!field) return
    const { start, end } = resolveRange(req.query, { maxDays: API_MAX_RANGE_DAYS })
    const { collection, maxCloud } = satelliteParams(req.query, field)
    await assertEarthEngine()

    const series = await getUsableNdvi({ geometry: field.geometry, start, end, collection, maxCloud })
    const observations = series.map((o) => ({
      date: o.date,
      ndvi: round(o.ndvi),
      kc: round(ndviToKc(o.ndvi)),
      coverage: round(o.coverage, 2),
      pixels: o.pixels,
    }))

    if (wantsCsv(req)) {
      return sendCsv(
        res,
        `ndvi_${safeName(field.name)}_${start}_${end}.csv`,
        ['area_id', 'area_name', 'date', 'ndvi', 'kc', 'coverage', 'pixels'],
        observations.map((o) => ({ area_id: field.id, area_name: field.name, ...o }))
      )
    }

    res.json({
      area: { id: field.id, name: field.name },
      range: { start, end },
      meta: meta({ collection, maxCloud }),
      count: observations.length,
      observations,
    })
  } catch (err) {
    next(err)
  }
})

/**
 * ค่ารายวันทุกวันในช่วง — วันที่ไม่มีภาพเติมด้วยการประมาณเชิงเส้นระหว่างภาพ
 * observed = วันที่มีภาพจริง, extrapolated = ก่อนภาพแรก/หลังภาพสุดท้าย (คงค่าไว้ ความเชื่อมั่นต่ำ)
 */
router.get('/areas/:id/timeseries', async (req, res, next) => {
  try {
    const field = findArea(req, res)
    if (!field) return
    const { start, end } = resolveRange(req.query, { maxDays: API_MAX_RANGE_DAYS })
    const { collection, maxCloud } = satelliteParams(req.query, field)
    const withWeather = isTrue(req.query.weather)
    await assertEarthEngine()

    const series = await getUsableNdvi({ geometry: field.geometry, start, end, collection, maxCloud })

    let weatherByDate = null
    if (withWeather) {
      const { lat, lon } = field.centroid
      const wx = await cached(`wx|${lat.toFixed(3)}|${lon.toFixed(3)}|${start}|${end}`, () =>
        getDailyWeather({ lat, lon, start, end })
      ).catch((err) => {
        // แยกให้ชัดว่าพังที่ NASA POWER ไม่ใช่ Earth Engine — ผู้เรียกจะได้รู้ว่าตัด weather=1 ออกแล้วยังได้ NDVI/Kc
        throw Object.assign(new Error(String(err?.message || err)), {
          status: 502,
          upstream: 'NASA POWER',
          hint: 'ข้อมูลอากาศใช้ไม่ได้ชั่วคราว ลองใหม่ หรือเรียกโดยไม่ใส่ weather=1 เพื่อรับเฉพาะ NDVI/Kc',
        })
      })
      weatherByDate = new Map(wx.days.map((d) => [d.date, d]))
    }

    const dates = []
    for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${end}T00:00:00Z`); t += 86400000) {
      dates.push(iso(new Date(t)))
    }

    const days = interpolateDaily(series, dates).map((d) => {
      const kc = d.ndvi === null ? null : ndviToKc(d.ndvi)
      const row = {
        date: d.date,
        ndvi: round(d.ndvi),
        kc: round(kc),
        observed: !!d.observed,
        extrapolated: !!d.extrapolated,
      }
      if (weatherByDate) {
        const w = weatherByDate.get(d.date)
        row.et0 = w ? round(w.et0, 2) : null
        row.etc = w && kc !== null ? round(kc * w.et0, 2) : null
        row.rain = w ? round(w.rain || 0, 1) : null
      }
      return row
    })

    if (wantsCsv(req)) {
      const cols = ['area_id', 'area_name', 'date', 'ndvi', 'kc', 'observed', 'extrapolated']
      if (withWeather) cols.push('et0', 'etc', 'rain')
      return sendCsv(
        res,
        `timeseries_${safeName(field.name)}_${start}_${end}.csv`,
        cols,
        days.map((d) => ({ area_id: field.id, area_name: field.name, ...d }))
      )
    }

    res.json({
      area: { id: field.id, name: field.name },
      range: { start, end },
      meta: meta({
        collection,
        maxCloud,
        observations: series.length,
        ...(withWeather ? { weatherSource: 'NASA POWER (ET₀ แบบ FAO-56 Penman-Monteith)' } : {}),
      }),
      count: days.length,
      days,
    })
  } catch (err) {
    next(err)
  }
})

/**
 * ภาพล่าสุดของทุกแปลงในบัญชี — ?days=60 คือหาย้อนหลังกี่วัน
 * แปลงที่ดึงไม่สำเร็จจะมี error แยกเป็นรายแปลง ไม่ทำให้ทั้งคำขอล้ม
 */
router.get('/ndvi/latest', async (req, res, next) => {
  try {
    const lookback = Number(req.query.days ?? 60)
    if (!Number.isFinite(lookback) || lookback < 1 || lookback > LATEST_MAX_DAYS) {
      throw new RangeError(`days ต้องอยู่ระหว่าง 1-${LATEST_MAX_DAYS}`)
    }
    await assertEarthEngine()

    // ไม่ต้องหักวันเหมือนข้อมูลอากาศ — ภาพดาวเทียมเข้า Earth Engine ภายใน 1-2 วัน
    const end = iso(new Date())
    const start = iso(new Date(Date.now() - lookback * 86400000))
    const fields = listFields(req.apiOwner)

    const results = new Array(fields.length)
    let cursor = 0
    const worker = async () => {
      while (cursor < fields.length) {
        const i = cursor++
        const f = fields[i]
        const base = { id: f.id, name: f.name }
        try {
          const { collection, maxCloud } = satelliteParams(req.query, f)
          const series = await getUsableNdvi({ geometry: f.geometry, start, end, collection, maxCloud })
          const last = series[series.length - 1]
          results[i] = last
            ? {
                ...base,
                collection,
                date: last.date,
                ndvi: round(last.ndvi),
                kc: round(ndviToKc(last.ndvi)),
                coverage: round(last.coverage, 2),
                ageDays: Math.round((Date.parse(end) - Date.parse(last.date)) / 86400000),
              }
            : { ...base, collection, date: null, ndvi: null, kc: null, note: `ไม่มีภาพที่ใช้ได้ใน ${lookback} วันที่ผ่านมา` }
        } catch (err) {
          results[i] = { ...base, error: String(err?.message || err) }
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(LATEST_CONCURRENCY, fields.length) }, worker))

    if (wantsCsv(req)) {
      return sendCsv(
        res,
        `ndvi_latest_${end}.csv`,
        ['id', 'name', 'collection', 'date', 'ndvi', 'kc', 'coverage', 'ageDays', 'error'],
        results
      )
    }

    res.json({ range: { start, end }, meta: meta({}), count: results.length, areas: results })
  } catch (err) {
    next(err)
  }
})

router.use((_req, res) => res.status(404).json({ error: 'ไม่มีเส้นทางนี้ใน API v1' }))

// ตอบ error เป็นรูปแบบเดียวกันทั้ง v1 — ไม่ปล่อยให้ตกไปที่ตัวจัดการ error กลางซึ่งตอบ 500 เสมอ
// eslint-disable-next-line no-unused-vars
router.use((err, req, res, _next) => {
  const status = err instanceof RangeError ? 400 : err.status || 502
  const detail = String(err?.message || err)
  if (status >= 500) console.error(`[api/v1] ${req.apiKeyHint || '-'} ${req.method} ${req.originalUrl}:`, detail)
  if (status === 400) return res.status(400).json({ error: detail })
  const upstream = err.upstream || 'Earth Engine'
  res.status(status).json({
    error: status === 503 ? `${upstream} ยังไม่พร้อมใช้งาน` : `ดึงข้อมูลจาก ${upstream} ไม่สำเร็จ`,
    detail,
    ...(err.hint ? { hint: err.hint } : {}),
  })
})

export default router
