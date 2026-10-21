/**
 * ช่วงวันที่ของการประมวลผล — ใช้ร่วมกันระหว่างหน้าเว็บ (/api/analysis) และ API ภายนอก (/api/v1)
 */
const iso = (d) => d.toISOString().slice(0, 10)
const shiftDays = (n) => iso(new Date(Date.now() + n * 86400000))

/** NASA POWER มีข้อมูลช้ากว่าปัจจุบันไม่กี่วัน จึงต้องถอยวันสิ้นสุดให้ */
const WEATHER_LAG_DAYS = 3

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * fromYear=2018 คือเริ่มตั้งแต่ 1 ม.ค. 2018 — สะดวกกว่าพิมพ์วันที่เมื่อต้องการย้อนหลังหลายปี
 * (ถ้าส่ง start มาด้วย start ชนะ)
 *
 * @param {{start?: string, end?: string, fromYear?: string|number}} query
 * @param {{maxDays?: number}} [opts] ยาวกว่านี้โยน error (ไม่ระบุ = ไม่จำกัด)
 */
export function resolveRange(query, opts = {}) {
  const end = query.end || shiftDays(-WEATHER_LAG_DAYS)
  const fromYear = query.fromYear === undefined || query.fromYear === '' ? null : Number(query.fromYear)
  if (fromYear !== null && !(Number.isInteger(fromYear) && fromYear >= 1984 && fromYear <= new Date().getUTCFullYear())) {
    throw new RangeError('fromYear ต้องเป็นปี ค.ศ. เช่น 2018')
  }
  const start =
    query.start ||
    (fromYear !== null ? `${fromYear}-01-01` : null) ||
    iso(new Date(Date.parse(`${end}T00:00:00Z`) - 180 * 86400000))
  if (!DATE_RE.test(start) || !DATE_RE.test(end) || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) {
    throw new RangeError('วันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD')
  }
  if (Date.parse(start) > Date.parse(end)) throw new RangeError('วันเริ่มต้นต้องมาก่อนวันสิ้นสุด')
  const days = (Date.parse(end) - Date.parse(start)) / 86400000
  if (opts.maxDays && days > opts.maxDays) {
    throw new RangeError(`ขอได้ไม่เกิน ${opts.maxDays} วันต่อครั้ง (ขอมา ${days} วัน)`)
  }
  return { start, end }
}
