/**
 * ข้อมูลอากาศรายวันจาก NASA POWER (ใช้ฟรี ไม่ต้องมี API key)
 * แล้วคำนวณค่าการคายระเหยอ้างอิง ET₀ ด้วยสมการ FAO-56 Penman-Monteith
 *
 * อ้างอิง: Allen et al. (1998), FAO Irrigation and Drainage Paper No. 56
 */

const POWER_URL = 'https://power.larc.nasa.gov/api/temporal/daily/point'
const PARAMS = ['T2M_MAX', 'T2M_MIN', 'T2M', 'RH2M', 'WS2M', 'ALLSKY_SFC_SW_DWN', 'PRECTOTCORR'].join(',')
const FILL = -999

const ymd = (d) => d.replaceAll('-', '')
const isFill = (v) => v === null || v === undefined || v <= FILL + 1

/** ความดันไอน้ำอิ่มตัวที่อุณหภูมิ T (°C) → kPa */
const satVapourPressure = (t) => 0.6108 * Math.exp((17.27 * t) / (t + 237.3))

/** รังสีนอกบรรยากาศ Ra (MJ m⁻² วัน⁻¹) ที่ละติจูด lat และวันที่ลำดับ doy */
function extraterrestrialRadiation(lat, doy) {
  const Gsc = 0.082
  const phi = (Math.PI / 180) * lat
  const dr = 1 + 0.033 * Math.cos((2 * Math.PI * doy) / 365)
  const decl = 0.409 * Math.sin((2 * Math.PI * doy) / 365 - 1.39)
  let x = -Math.tan(phi) * Math.tan(decl)
  x = Math.min(1, Math.max(-1, x)) // กันกรณีขั้วโลกที่ arccos หลุดช่วง
  const ws = Math.acos(x)
  return (
    ((24 * 60) / Math.PI) *
    Gsc *
    dr *
    (ws * Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.sin(ws))
  )
}

function dayOfYear(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`)
  const start = Date.UTC(d.getUTCFullYear(), 0, 0)
  return Math.floor((d.getTime() - start) / 86400000)
}

/**
 * ET₀ ตาม FAO-56 Penman-Monteith (สมการที่ 6)
 * @returns {number} มม./วัน
 */
export function et0Penman({ tmax, tmin, rh, wind, solarMJ, lat, elevation = 0, doy }) {
  const tmean = (tmax + tmin) / 2

  const delta = (4098 * satVapourPressure(tmean)) / Math.pow(tmean + 237.3, 2)
  const P = 101.3 * Math.pow((293 - 0.0065 * elevation) / 293, 5.26)
  const gamma = 0.000665 * P

  const es = (satVapourPressure(tmax) + satVapourPressure(tmin)) / 2
  const ea = Math.max(0, Math.min(es, (rh / 100) * es))

  const u2 = Math.max(0.5, wind) // FAO แนะนำให้ตรึงขั้นต่ำที่ 0.5 m/s

  const Ra = extraterrestrialRadiation(lat, doy)
  const Rso = (0.75 + 2e-5 * elevation) * Ra
  const Rs = Math.min(solarMJ, Rso) // ค่าที่วัดได้ต้องไม่เกินท้องฟ้าโปร่ง
  const Rns = (1 - 0.23) * Rs

  const sigma = 4.903e-9
  const cloudFactor = Rso > 0 ? Math.min(1, Math.max(0.05, Rs / Rso)) : 0.5
  const Rnl =
    sigma *
    ((Math.pow(tmax + 273.16, 4) + Math.pow(tmin + 273.16, 4)) / 2) *
    (0.34 - 0.14 * Math.sqrt(ea)) *
    (1.35 * cloudFactor - 0.35)

  const Rn = Rns - Rnl
  const G = 0 // ระดับรายวัน ความร้อนสะสมในดินถือว่าเป็นศูนย์

  const numerator = 0.408 * delta * (Rn - G) + gamma * (900 / (tmean + 273)) * u2 * (es - ea)
  const denominator = delta + gamma * (1 + 0.34 * u2)

  return Math.max(0, numerator / denominator)
}

/**
 * ดึงข้อมูลอากาศรายวันและ ET₀ ของจุดพิกัดหนึ่ง
 * @returns {Promise<{source: string, elevation: number, days: Array<{date, tmax, tmin, rh, wind, solar, rain, et0}>}>}
 */
export async function getDailyWeather({ lat, lon, start, end }) {
  const url =
    `${POWER_URL}?parameters=${PARAMS}&community=AG` +
    `&latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&start=${ymd(start)}&end=${ymd(end)}&format=JSON`

  const res = await fetch(url, { headers: { accept: 'application/json' } })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`NASA POWER ตอบกลับ ${res.status}: ${body.slice(0, 200)}`)
  }

  const json = await res.json()
  const p = json?.properties?.parameter
  if (!p?.T2M_MAX) throw new Error('NASA POWER ไม่ได้ส่งข้อมูลอุณหภูมิกลับมา')

  const elevation = json?.geometry?.coordinates?.[2] ?? 0

  const days = []
  for (const key of Object.keys(p.T2M_MAX).sort()) {
    const date = `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`

    const tmax = p.T2M_MAX[key]
    const tmin = p.T2M_MIN[key]
    const rh = p.RH2M?.[key]
    const wind = p.WS2M?.[key]
    const solar = p.ALLSKY_SFC_SW_DWN?.[key]
    const rain = p.PRECTOTCORR?.[key]

    if (isFill(tmax) || isFill(tmin)) continue

    const usable = !isFill(rh) && !isFill(wind) && !isFill(solar)
    const et0 = usable
      ? et0Penman({ tmax, tmin, rh, wind, solarMJ: solar, lat, elevation, doy: dayOfYear(date) })
      : hargreavesEt0(tmax, tmin, lat, dayOfYear(date))

    days.push({
      date,
      tmax: round(tmax, 1),
      tmin: round(tmin, 1),
      rh: isFill(rh) ? null : round(rh, 0),
      wind: isFill(wind) ? null : round(wind, 1),
      solar: isFill(solar) ? null : round(solar, 2),
      rain: isFill(rain) ? 0 : round(rain, 1),
      et0: round(et0, 2),
      et0Method: usable ? 'penman-monteith' : 'hargreaves',
    })
  }

  return { source: 'NASA POWER', elevation, days }
}

/** สำรองไว้ใช้เมื่อข้อมูลลม/รังสีขาดหาย — Hargreaves-Samani (FAO-56 สมการที่ 52) */
function hargreavesEt0(tmax, tmin, lat, doy) {
  const tmean = (tmax + tmin) / 2
  const Ra = extraterrestrialRadiation(lat, doy)
  return Math.max(0, 0.0023 * (tmean + 17.8) * Math.sqrt(Math.max(0, tmax - tmin)) * Ra * 0.408)
}

function round(v, n) {
  const f = 10 ** n
  return Math.round(v * f) / f
}
