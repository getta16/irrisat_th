/**
 * NDVI รายแปลงที่ผ่านการกรองแล้ว — จุดเดียวที่ทั้งหน้าเว็บและ API ภายนอกดึงค่าจาก Earth Engine
 * ใช้ร่วมกันเพื่อให้สองทางได้ตัวเลขชุดเดียวกัน และแชร์แคชก้อนเดียวกัน
 */
import { getNdviSeries, initEarthEngine } from './gee.js'
import { cached, geomKey } from './cache.js'

/** ภาพที่มองเห็นแปลงน้อยกว่านี้ถือว่าเชื่อถือไม่ได้ (เมฆบังเกือบหมด) */
export const MIN_COVERAGE = 0.4

/**
 * ช่วงยาวกว่านี้แบ่งส่งไป Earth Engine ทีละก้อน — ขอย้อนหลังหลายปีในคำขอเดียว
 * ทำให้ EE หมดเวลา (computation timed out) หรือเกินหน่วยความจำได้ โดยเฉพาะแปลงใหญ่
 */
const CHUNK_DAYS = 366
/** ก้อนที่ส่งพร้อมกัน — มากกว่านี้เสี่ยงโดนจำกัดโควตาของ EE */
const CHUNK_CONCURRENCY = 3
/** ก้อนที่จบก่อนวันนี้เกินเท่านี้ ภาพไม่เปลี่ยนแล้ว เก็บแคชได้นานกว่าปกติ */
const SETTLED_AFTER_DAYS = 30
const SETTLED_TTL_MS = 24 * 60 * 60 * 1000

const DAY_MS = 86400000
const iso = (t) => new Date(t).toISOString().slice(0, 10)

/** แบ่ง [start, end) เป็นก้อนละไม่เกิน CHUNK_DAYS วัน — ขอบเขตตรงกับ filterDate ของ EE (ไม่รวมวันสุดท้าย) */
function splitRange(start, end) {
  const s = Date.parse(`${start}T00:00:00Z`)
  const e = Date.parse(`${end}T00:00:00Z`)
  const chunks = []
  for (let t = s; t < e; t += CHUNK_DAYS * DAY_MS) {
    chunks.push({ start: iso(t), end: iso(Math.min(e, t + CHUNK_DAYS * DAY_MS)) })
  }
  return chunks.length ? chunks : [{ start, end }]
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/**
 * @returns {Promise<Array<{date, ndvi, pixels, coverage}>>} โยน error ถ้า Earth Engine ใช้ไม่ได้
 */
export async function getUsableNdvi({ geometry, start, end, collection = 'S2', maxCloud = 60 }) {
  await initEarthEngine()
  const gk = geomKey(geometry)
  const settledBefore = Date.now() - SETTLED_AFTER_DAYS * DAY_MS

  const parts = await mapLimit(splitRange(start, end), CHUNK_CONCURRENCY, (c) =>
    cached(
      `ndvi|${collection}|${c.start}|${c.end}|${maxCloud}|${gk}`,
      () => getNdviSeries({ geometry, start: c.start, end: c.end, collection, maxCloud }),
      Date.parse(c.end) < settledBefore ? SETTLED_TTL_MS : undefined
    )
  )

  // แต่ละก้อนคิด coverage เทียบกับวันที่เห็นชัดที่สุดของก้อนตัวเอง — รวมแล้วต้องคิดใหม่ทั้งชุด
  // ไม่อย่างนั้นความหมายของ coverage จะเปลี่ยนไปตามว่าขอช่วงยาวหรือสั้น
  const series = parts.flat().map((d) => ({ ...d }))
  const fullView = Math.max(1, ...series.map((d) => d.pixels || 0))
  for (const d of series) d.coverage = Math.min(1, (d.pixels || 0) / fullView)

  // ถ้าทุกภาพโดนเมฆบังหมด ยังคืนชุดเดิมไว้ ดีกว่าไม่มีอะไรเลย (coverage บอกความน่าเชื่อถืออยู่แล้ว)
  const usable = series.filter((d) => d.coverage >= MIN_COVERAGE)
  return usable.length ? usable : series
}
