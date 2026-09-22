/**
 * NDVI รายแปลงที่ผ่านการกรองแล้ว — จุดเดียวที่ทั้งหน้าเว็บและ API ภายนอกดึงค่าจาก Earth Engine
 * ใช้ร่วมกันเพื่อให้สองทางได้ตัวเลขชุดเดียวกัน และแชร์แคชก้อนเดียวกัน
 */
import { getNdviSeries, initEarthEngine } from './gee.js'
import { cached, geomKey } from './cache.js'

/** ภาพที่มองเห็นแปลงน้อยกว่านี้ถือว่าเชื่อถือไม่ได้ (เมฆบังเกือบหมด) */
export const MIN_COVERAGE = 0.4

/**
 * @returns {Promise<Array<{date, ndvi, pixels, coverage}>>} โยน error ถ้า Earth Engine ใช้ไม่ได้
 */
export async function getUsableNdvi({ geometry, start, end, collection = 'S2', maxCloud = 60 }) {
  await initEarthEngine()
  const series = await cached(`ndvi|${collection}|${start}|${end}|${maxCloud}|${geomKey(geometry)}`, () =>
    getNdviSeries({ geometry, start, end, collection, maxCloud })
  )
  // ถ้าทุกภาพโดนเมฆบังหมด ยังคืนชุดเดิมไว้ ดีกว่าไม่มีอะไรเลย (coverage บอกความน่าเชื่อถืออยู่แล้ว)
  const usable = series.filter((d) => d.coverage >= MIN_COVERAGE)
  return usable.length ? usable : series
}
