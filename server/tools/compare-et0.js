/**
 * เทียบ ET₀ ที่ระบบได้จาก NASA POWER กับ ET₀ ที่คำนวณจากข้อมูลสถานีตรวจอากาศ (เช่น กรมอุตุนิยมวิทยา)
 * ทั้งสองฝั่งใช้ et0Penman() ตัวเดียวกับระบบ ความต่างที่ได้จึงมาจากข้อมูลอากาศล้วน ๆ
 *
 *   node server/tools/compare-et0.js --station สถานี.csv --lat 13.82 --lon 100.04 --elev 5 \
 *        [--wind-height 10] [--wind-unit ms|knot|kmh] [--out ผลเทียบ.csv]
 *
 * เทียบกับ ET₀ ของระบบอื่น (เช่น IrriSAT https://www.irrisat.app) ได้ด้วย โดยใส่ CSV ที่มีแค่ date, et0
 * แล้วใช้พิกัดจุดศูนย์กลางแปลงเป็น --lat --lon
 *
 * คอลัมน์ใน CSV (ชื่อไม่สนตัวพิมพ์ ต้องมีอย่างน้อย date, tmax, tmin — หรือ date, et0):
 *   date          YYYY-MM-DD หรือ DD/MM/YYYY (ปี พ.ศ. แปลงให้อัตโนมัติ)
 *   tmax, tmin    °C
 *   rh            ความชื้นสัมพัทธ์เฉลี่ย %  — หรือ rhmax + rhmin (แม่นกว่า ถ้ามี)
 *   wind          ความเร็วลม ที่ความสูง --wind-height ม. หน่วยตาม --wind-unit
 *   solar         รังสีดวงอาทิตย์ MJ m⁻² วัน⁻¹  — หรือ sunshine (ชั่วโมงแดด)
 *   et0           (ไม่บังคับ) ถ้าสถานีมี ET₀ คำนวณไว้แล้ว จะใช้ค่านี้แทนการคำนวณเอง
 *
 * ข้อมูลขาดหายจัดการตาม FAO-56 บทที่ 3: ไม่มีลม → ใช้ 2 m/s, ไม่มีรังสี/ชั่วโมงแดด → ประมาณจาก Tmax−Tmin
 */
import fs from 'node:fs'
import { parseArgs } from 'node:util'
import {
  et0Penman,
  getDailyWeather,
  extraterrestrialRadiation,
  dayOfYear,
  satVapourPressure,
} from '../services/weather.js'

const { values: opt } = parseArgs({
  options: {
    station: { type: 'string' },
    lat: { type: 'string' },
    lon: { type: 'string' },
    elev: { type: 'string', default: '0' },
    'wind-height': { type: 'string', default: '10' },
    'wind-unit': { type: 'string', default: 'ms' },
    out: { type: 'string' },
  },
})

if (!opt.station || !opt.lat || !opt.lon) {
  console.error('ต้องระบุ --station <ไฟล์ CSV> --lat <ละติจูด> --lon <ลองจิจูด> (ดูวิธีใช้ที่หัวไฟล์)')
  process.exit(1)
}

const lat = Number(opt.lat)
const lon = Number(opt.lon)
const elevation = Number(opt.elev)
const windHeight = Number(opt['wind-height'])
const WIND_FACTOR = { ms: 1, knot: 0.514444, kmh: 1 / 3.6 }[opt['wind-unit']]
if (!WIND_FACTOR) throw new Error(`--wind-unit ต้องเป็น ms, knot หรือ kmh (ได้ "${opt['wind-unit']}")`)

// ---------- อ่าน CSV สถานี ----------

const COLUMN_ALIASES = {
  date: ['date', 'วันที่'],
  tmax: ['tmax', 'max_temp', 'อุณหภูมิสูงสุด'],
  tmin: ['tmin', 'min_temp', 'อุณหภูมิต่ำสุด'],
  rh: ['rh', 'rhmean', 'rh_mean', 'ความชื้นสัมพัทธ์'],
  rhmax: ['rhmax', 'rh_max'],
  rhmin: ['rhmin', 'rh_min'],
  wind: ['wind', 'ws', 'wind_speed', 'ลม'],
  solar: ['solar', 'rs', 'radiation'],
  sunshine: ['sunshine', 'n', 'sunshine_hours', 'ชั่วโมงแดด'],
  et0: ['et0', 'eto'],
}

function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
  const split = (l) => l.split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
  const header = split(lines[0]).map((h) => h.toLowerCase())
  const index = {}
  for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
    const i = header.findIndex((h) => aliases.includes(h))
    if (i >= 0) index[key] = i
  }
  // ไฟล์ที่มี et0 มาแล้ว (เช่น ส่งออกจาก IrriSAT) ไม่ต้องมี tmax/tmin
  const required = index.et0 === undefined ? ['date', 'tmax', 'tmin'] : ['date']
  for (const need of required) {
    if (index[need] === undefined) throw new Error(`ไม่พบคอลัมน์ "${need}" ในไฟล์สถานี (หัวตาราง: ${header.join(', ')})`)
  }
  return lines.slice(1).map((line) => {
    const cells = split(line)
    const row = {}
    for (const [key, i] of Object.entries(index)) row[key] = key === 'date' ? cells[i] : num(cells[i])
    row.date = normalizeDate(row.date)
    return row
  })
}

/** ช่องว่าง, "-", "T" (ฝนเล็กน้อย) หรือค่าว่างแบบ -99.9 ถือว่าไม่มีข้อมูล */
function num(s) {
  if (s === undefined || s === '' || s === '-') return null
  const v = Number(s)
  return Number.isFinite(v) && v > -99 ? v : null
}

function normalizeDate(s) {
  let y, m, d
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) [y, m, d] = s.split('-').map(Number)
  else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) [d, m, y] = s.split('/').map(Number)
  else throw new Error(`อ่านวันที่ "${s}" ไม่ได้ — ใช้ YYYY-MM-DD หรือ DD/MM/YYYY`)
  if (y > 2400) y -= 543 // ปี พ.ศ.
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

// ---------- ET₀ ฝั่งสถานี ----------

/** แปลงลมที่ความสูง z ม. เป็นที่ 2 ม. (FAO-56 สมการที่ 47) */
const windAt2m = (uz) => (uz * 4.87) / Math.log(67.8 * windHeight - 5.42)

function stationEt0(row) {
  if (row.et0 !== null && row.et0 !== undefined) {
    // ยังคืนลมที่ 2 ม. ไว้ด้วย เพื่อให้เทียบตัวแปรอากาศรายตัวได้แม้ใช้ ET₀ สำเร็จรูป
    const wind = row.wind != null ? windAt2m(row.wind * WIND_FACTOR) : undefined
    return { et0: row.et0, wind, solar: row.solar ?? undefined, notes: ['ใช้ ET₀ ของสถานี'] }
  }

  const { tmax, tmin } = row
  const doy = dayOfYear(row.date)
  const notes = []

  // ความชื้น: RHmax/RHmin ให้ ea ที่แม่นกว่า (FAO-56 สมการที่ 17) — แปลงกลับเป็น RH เทียบเท่าเพื่อส่งเข้า et0Penman
  let rh = row.rh
  if (row.rhmax != null && row.rhmin != null) {
    const ea = (satVapourPressure(tmin) * row.rhmax + satVapourPressure(tmax) * row.rhmin) / 200
    const es = (satVapourPressure(tmax) + satVapourPressure(tmin)) / 2
    rh = (ea / es) * 100
  }
  if (rh == null) {
    // ไม่มีความชื้น: ถือว่าจุดน้ำค้าง ≈ Tmin (FAO-56 สมการที่ 48)
    const es = (satVapourPressure(tmax) + satVapourPressure(tmin)) / 2
    rh = (satVapourPressure(tmin) / es) * 100
    notes.push('ไม่มี RH')
  }

  let wind = 2
  if (row.wind != null) wind = windAt2m(row.wind * WIND_FACTOR)
  else notes.push('ไม่มีลม')

  const Ra = extraterrestrialRadiation(lat, doy)
  let solar = row.solar
  if (solar == null && row.sunshine != null) {
    // Angstrom (FAO-56 สมการที่ 35) ใช้ค่าคงที่มาตรฐาน as = 0.25, bs = 0.50
    const phi = (Math.PI / 180) * lat
    const decl = 0.409 * Math.sin((2 * Math.PI * doy) / 365 - 1.39)
    const N = (24 / Math.PI) * Math.acos(-Math.tan(phi) * Math.tan(decl))
    solar = (0.25 + (0.5 * row.sunshine) / N) * Ra
  }
  if (solar == null) {
    // Hargreaves radiation (FAO-56 สมการที่ 50) kRs = 0.16 สำหรับพื้นที่ในแผ่นดิน
    solar = 0.16 * Math.sqrt(Math.max(0, tmax - tmin)) * Ra
    notes.push('ไม่มีรังสี')
  }

  return { et0: et0Penman({ tmax, tmin, rh, wind, solarMJ: solar, lat, elevation, doy }), wind, solar, notes }
}

// ---------- สถิติ ----------

/** obs = สถานี (ค่าอ้างอิง), sim = NASA POWER */
function stats(pairs) {
  const n = pairs.length
  if (n < 2) return null
  const o = pairs.map((p) => p[0])
  const s = pairs.map((p) => p[1])
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length
  const mo = mean(o)
  const ms = mean(s)
  let sxy = 0, sxx = 0, syy = 0, se = 0, sae = 0, sd = 0
  for (let i = 0; i < n; i++) {
    const e = s[i] - o[i]
    sxy += (o[i] - mo) * (s[i] - ms)
    sxx += (o[i] - mo) ** 2
    syy += (s[i] - ms) ** 2
    se += e * e
    sae += Math.abs(e)
    sd += (Math.abs(s[i] - mo) + Math.abs(o[i] - mo)) ** 2
  }
  const rmse = Math.sqrt(se / n)
  const slope = sxx ? sxy / sxx : NaN
  return {
    n,
    meanObs: mo,
    meanSim: ms,
    MBE: ms - mo,
    MAE: sae / n,
    RMSE: rmse,
    'rRMSE%': (rmse / mo) * 100,
    R2: sxx && syy ? (sxy * sxy) / (sxx * syy) : NaN,
    slope,
    intercept: ms - slope * mo,
    NSE: sxx ? 1 - se / sxx : NaN,
    d: sd ? 1 - se / sd : NaN, // Willmott index of agreement
  }
}

const fmt = (v) => (typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(3) : v)

// ---------- main ----------

const station = parseCsv(fs.readFileSync(opt.station, 'utf8')).sort((a, b) => a.date.localeCompare(b.date))
if (!station.length) throw new Error('ไฟล์สถานีไม่มีข้อมูล')

const start = station[0].date
const end = station.at(-1).date
console.log(`สถานี: ${station.length} วัน (${start} ถึง ${end}) ที่ ${lat}, ${lon} สูง ${elevation} ม.`)
console.log('กำลังดึง NASA POWER ...')

const power = await getDailyWeather({ lat, lon, start, end })
const powerByDate = new Map(power.days.map((d) => [d.date, d]))

const rows = []
const gapCount = {}
for (const st of station) {
  const pw = powerByDate.get(st.date)
  if (!pw || (st.et0 == null && (st.tmax == null || st.tmin == null))) continue
  const r = stationEt0(st)
  for (const note of r.notes) gapCount[note] = (gapCount[note] ?? 0) + 1
  rows.push({ date: st.date, st, pw, et0Station: r.et0, wind2m: r.wind, solarSt: r.solar, notes: r.notes.join('; ') })
}

if (!rows.length) throw new Error('ไม่มีวันที่ตรงกันระหว่างสถานีกับ NASA POWER')

const pairsOf = (fn) => rows.map(fn).filter(([a, b]) => a != null && b != null)

const table = {
  'ET₀ (มม./วัน)': stats(pairsOf((r) => [r.et0Station, r.pw.et0])),
  'Tmax (°C)': stats(pairsOf((r) => [r.st.tmax, r.pw.tmax])),
  'Tmin (°C)': stats(pairsOf((r) => [r.st.tmin, r.pw.tmin])),
  'ลมที่ 2 ม. (m/s)': stats(pairsOf((r) => [r.st.wind != null ? r.wind2m : null, r.pw.wind])),
  'รังสี (MJ/m²/วัน)': stats(pairsOf((r) => [r.st.solar ?? (r.st.sunshine != null ? r.solarSt : null), r.pw.solar])),
}

// ET₀ รายเดือน (ค่าเฉลี่ยรายวันในเดือน) — กรรมการมักถามว่าคลาดเคลื่อนช่วงฤดูไหน
const monthly = {}
for (const r of rows) {
  const m = r.date.slice(0, 7)
  ;(monthly[m] ??= []).push([r.et0Station, r.pw.et0])
}

console.log(`\nจับคู่ได้ ${rows.length} วัน  (sim = NASA POWER, obs = สถานี; MBE > 0 หมายถึง NASA POWER ประเมินสูงกว่าสถานี)\n`)
console.table(
  Object.fromEntries(
    Object.entries(table)
      .filter(([, v]) => v)
      .map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([a, b]) => [a, fmt(b)]))]),
  ),
)

console.log('ET₀ รายเดือน')
console.table(
  Object.fromEntries(
    Object.entries(monthly).map(([m, p]) => {
      const s = stats(p)
      return [m, s ? { n: s.n, สถานี: fmt(s.meanObs), 'NASA POWER': fmt(s.meanSim), MBE: fmt(s.MBE), RMSE: fmt(s.RMSE) } : { n: p.length }]
    }),
  ),
)

if (Object.keys(gapCount).length) {
  console.log('วันที่สถานีขาดข้อมูลและใช้ค่าประมาณตาม FAO-56:', gapCount)
}

if (opt.out) {
  const head = 'date,et0_station,et0_power,diff,tmax_st,tmax_pw,tmin_st,tmin_pw,wind2m_st,wind2m_pw,solar_st,solar_pw,et0_power_method,notes'
  const r2 = (v) => (v == null ? '' : Math.round(v * 100) / 100)
  const body = rows.map((r) =>
    [
      r.date, r2(r.et0Station), r.pw.et0, r2(r.pw.et0 - r.et0Station),
      r.st.tmax, r.pw.tmax, r.st.tmin, r.pw.tmin,
      r.st.wind != null ? r2(r.wind2m) : '', r.pw.wind ?? '',
      r2(r.st.solar ?? (r.st.sunshine != null ? r.solarSt : null)), r.pw.solar ?? '',
      r.pw.et0Method, `"${r.notes}"`,
    ].join(','),
  )
  // ใส่ BOM ให้ Excel อ่านภาษาไทยถูก
  fs.writeFileSync(opt.out, '﻿' + [head, ...body].join('\n'))
  console.log(`บันทึกค่ารายวันไว้ที่ ${opt.out}`)
}
