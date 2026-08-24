/**
 * แบบจำลองความต้องการน้ำของพืช
 *
 *   NDVI ──▶ Kc ──▶ ETc = Kc × ET₀ ──▶ สมดุลน้ำในเขตราก ──▶ คำแนะนำการให้น้ำ
 *
 * ความสัมพันธ์ Kc–NDVI ใช้สมการเชิงเส้นของ IrriSAT: Kc = 1.37 × NDVI − 0.086
 * (Trout et al. 2008; Hornbuckle et al. 2016)
 */

export const KC_SLOPE = 1.37
export const KC_INTERCEPT = -0.086
export const KC_MAX = 1.25

/** ปริมาณน้ำที่ดินอุ้มไว้ได้ทั้งหมด (มม. ต่อความลึกดิน 1 เมตร) */
export const SOIL_TYPES = {
  sand: { label: 'ดินทราย', taw: 70 },
  loamy_sand: { label: 'ดินทรายร่วน', taw: 95 },
  sandy_loam: { label: 'ดินร่วนปนทราย', taw: 120 },
  loam: { label: 'ดินร่วน', taw: 160 },
  clay_loam: { label: 'ดินร่วนเหนียว', taw: 180 },
  silty_clay: { label: 'ดินเหนียวปนทรายแป้ง', taw: 190 },
  clay: { label: 'ดินเหนียว', taw: 200 },
}

/** ค่าตั้งต้นรายพืช — rootDepth (ม.), p = สัดส่วนน้ำที่ยอมให้พร่องก่อนต้องให้น้ำ */
export const CROPS = {
  rice: { label: 'ข้าว', rootDepth: 0.5, p: 0.2, ponded: true },
  maize: { label: 'ข้าวโพด', rootDepth: 1.0, p: 0.55 },
  sugarcane: { label: 'อ้อย', rootDepth: 1.2, p: 0.65 },
  cassava: { label: 'มันสำปะหลัง', rootDepth: 1.0, p: 0.4 },
  vegetable: { label: 'พืชผัก', rootDepth: 0.4, p: 0.35 },
  orchard: { label: 'ไม้ผล/ไม้ยืนต้น', rootDepth: 1.2, p: 0.5 },
  cotton: { label: 'ฝ้าย', rootDepth: 1.2, p: 0.65 },
  other: { label: 'อื่น ๆ', rootDepth: 0.8, p: 0.5 },
}

export const ndviToKc = (ndvi) => Math.min(KC_MAX, Math.max(0, KC_SLOPE * ndvi + KC_INTERCEPT))

/**
 * ฝนที่พืชใช้ได้จริง — ฝนไม่เกิน 25 มม./วัน ถือว่าซึมลงดินหมด
 * ส่วนที่เกินคิดว่าไหลบ่าไป 40%
 */
export function effectiveRain(rain) {
  if (rain <= 25) return rain
  return 25 + (rain - 25) * 0.6
}

const addDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const daysBetween = (a, b) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000)

/**
 * เติม NDVI ให้ครบทุกวันด้วยการประมาณค่าเชิงเส้นระหว่างวันที่มีภาพ
 * วันก่อนภาพแรก/หลังภาพสุดท้ายจะคงค่าเดิมไว้ และถูกทำเครื่องหมายว่าเป็นค่าประมาณ
 */
export function interpolateDaily(series, dates) {
  if (!series.length) return dates.map((date) => ({ date, ndvi: null, interpolated: true }))

  const pts = [...series].sort((a, b) => a.date.localeCompare(b.date))
  const out = []
  let i = 0

  for (const date of dates) {
    while (i < pts.length - 1 && pts[i + 1].date <= date) i++

    const cur = pts[i]
    const next = pts[i + 1]

    if (date === cur.date) {
      out.push({ date, ndvi: cur.ndvi, interpolated: false, observed: true })
    } else if (date < pts[0].date) {
      out.push({ date, ndvi: pts[0].ndvi, interpolated: true, extrapolated: true })
    } else if (!next) {
      out.push({ date, ndvi: cur.ndvi, interpolated: true, extrapolated: true })
    } else {
      const span = daysBetween(cur.date, next.date)
      const t = span ? daysBetween(cur.date, date) / span : 0
      out.push({ date, ndvi: cur.ndvi + (next.ndvi - cur.ndvi) * t, interpolated: true })
    }
  }
  return out
}

/**
 * รวมทุกอย่างเข้าด้วยกันเป็นตารางรายวัน + สรุปผล
 *
 * @param {object} p
 * @param {Array} p.ndviSeries   ค่า NDVI จากดาวเทียม [{date, ndvi, coverage}]
 * @param {Array} p.weatherDays  ข้อมูลอากาศรายวัน [{date, et0, rain, ...}]
 * @param {object} p.settings    {soil, crop, rootDepth, p, irrigationEfficiency}
 * @param {Array} [p.irrigations] บันทึกการให้น้ำที่ผ่านมา [{date, mm}]
 */
export function runWaterBalance({ ndviSeries = [], weatherDays = [], settings = {}, irrigations = [] }) {
  const soil = SOIL_TYPES[settings.soil] || SOIL_TYPES.loam
  const crop = CROPS[settings.crop] || CROPS.other

  const rootDepth = Number(settings.rootDepth) > 0 ? Number(settings.rootDepth) : crop.rootDepth
  const depletionFraction = Number(settings.p) > 0 ? Number(settings.p) : crop.p
  const efficiency = Number(settings.irrigationEfficiency) > 0 ? Number(settings.irrigationEfficiency) : 0.85

  const taw = soil.taw * rootDepth // มม. ในเขตราก
  const raw = taw * depletionFraction // พร่องได้ถึงเท่านี้ก่อนพืชเริ่มเครียด

  const dates = weatherDays.map((d) => d.date)
  const ndviDaily = interpolateDaily(ndviSeries, dates)
  const ndviByDate = new Map(ndviDaily.map((d) => [d.date, d]))
  const irrigationByDate = new Map(irrigations.map((r) => [r.date, Number(r.mm) || 0]))

  let deficit = Number(settings.initialDeficit) >= 0 ? Number(settings.initialDeficit) : 0
  let cumEtc = 0
  let cumRain = 0
  let cumIrrigation = 0

  const days = weatherDays.map((w) => {
    const n = ndviByDate.get(w.date) || {}
    const ndvi = n.ndvi
    const kc = ndvi === null || ndvi === undefined ? null : ndviToKc(ndvi)
    const etc = kc === null ? null : kc * w.et0
    const peff = effectiveRain(w.rain || 0)
    const applied = irrigationByDate.get(w.date) || 0

    if (etc !== null) cumEtc += etc
    cumRain += peff
    cumIrrigation += applied

    const before = deficit
    deficit = Math.min(taw, Math.max(0, before + (etc || 0) - peff - applied * efficiency))

    return {
      date: w.date,
      ndvi: ndvi === null || ndvi === undefined ? null : round(ndvi, 3),
      observed: !!n.observed,
      extrapolated: !!n.extrapolated,
      kc: kc === null ? null : round(kc, 3),
      et0: round(w.et0, 2),
      etc: etc === null ? null : round(etc, 2),
      rain: round(w.rain || 0, 1),
      effectiveRain: round(peff, 1),
      irrigation: round(applied, 1),
      deficit: round(deficit, 1),
      stress: deficit > raw,
      cumEtc: round(cumEtc, 1),
      cumRain: round(cumRain, 1),
      cumIrrigation: round(cumIrrigation, 1),
    }
  })

  const last = days[days.length - 1]
  const recent = days.slice(-7).filter((d) => d.etc !== null)
  const avgEtc = recent.length ? recent.reduce((s, d) => s + d.etc, 0) / recent.length : 0

  // ประมาณว่าอีกกี่วันจะพร่องถึงจุดที่ต้องให้น้ำ (สมมติไม่มีฝนเลย)
  // ตัดที่ 30 วัน เพราะไกลกว่านั้นการคาดการณ์ไม่มีความหมายในทางปฏิบัติ
  const HORIZON_DAYS = 30
  const remaining = last ? raw - last.deficit : raw
  const rawDays = avgEtc > 0 ? Math.max(0, Math.floor(remaining / avgEtc)) : null
  const beyondHorizon = rawDays !== null && rawDays > HORIZON_DAYS
  const daysUntilIrrigation = rawDays === null ? null : Math.min(rawDays, HORIZON_DAYS)

  const recommendedMm = last && last.deficit > 0 ? last.deficit / efficiency : 0

  return {
    settings: {
      soil: settings.soil || 'loam',
      soilLabel: soil.label,
      crop: settings.crop || 'other',
      cropLabel: crop.label,
      rootDepth,
      p: depletionFraction,
      irrigationEfficiency: efficiency,
      taw: round(taw, 1),
      raw: round(raw, 1),
    },
    days,
    summary: {
      periodStart: days[0]?.date || null,
      periodEnd: last?.date || null,
      observations: ndviSeries.length,
      currentNdvi: last?.ndvi ?? null,
      currentKc: last?.kc ?? null,
      currentDeficit: last?.deficit ?? null,
      underStress: !!last?.stress,
      avgDailyEtc: round(avgEtc, 2),
      totalEtc: round(cumEtc, 1),
      totalRain: round(days.reduce((s, d) => s + d.rain, 0), 1),
      totalEffectiveRain: round(cumRain, 1),
      totalIrrigation: round(cumIrrigation, 1),
      daysUntilIrrigation,
      beyondHorizon,
      recommendedIrrigationMm: round(recommendedMm, 1),
      nextIrrigationDate:
        last && daysUntilIrrigation !== null && !beyondHorizon ? addDays(last.date, daysUntilIrrigation) : null,
    },
  }
}

/**
 * NDVI จำลองสำหรับโหมดสาธิต (ตอนที่ยังไม่ได้ตั้งค่า Earth Engine)
 * สร้างเป็นเส้นโค้งการเจริญเติบโตรูประฆัง + สัญญาณรบกวนที่คงที่ตามพิกัดแปลง
 */
export function demoNdviSeries({ start, end, lat = 15, lon = 100, revisitDays = 5 }) {
  const out = []
  const total = daysBetween(start, end)
  // ใช้พิกัดเป็นเมล็ดสุ่ม เพื่อให้แปลงเดิมได้กราฟเดิมทุกครั้ง
  let seed = Math.floor(Math.abs(lat * 1000) + Math.abs(lon * 1000)) % 9973
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }

  for (let i = 0; i <= total; i += revisitDays) {
    const date = addDays(start, i)
    const t = total ? i / total : 0
    const growth = Math.exp(-Math.pow((t - 0.55) / 0.28, 2)) // ยอดโค้งที่ราว 55% ของช่วงเวลา
    const ndvi = 0.16 + 0.68 * growth + (rand() - 0.5) * 0.05
    if (rand() < 0.28) continue // จำลองวันที่ภาพติดเมฆจนใช้ไม่ได้
    out.push({
      date,
      ndvi: round(Math.min(0.92, Math.max(0.05, ndvi)), 3),
      pixels: 0,
      coverage: round(0.7 + rand() * 0.3, 2),
      demo: true,
    })
  }
  return out
}

function round(v, n) {
  if (v === null || v === undefined || !Number.isFinite(v)) return null
  const f = 10 ** n
  return Math.round(v * f) / f
}
