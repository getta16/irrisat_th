/** ตรวจว่าการปิดบังเมฆด้วยแบนด์ SCL ของ Sentinel-2 ทำงานจริงหรือไม่ */
import ee from '@google/earthengine'
import { initEarthEngine } from '../services/gee.js'
import { getField, listFields, initStore } from '../services/store.js'

const evaluate = (o) =>
  new Promise((res, rej) => o.evaluate((v, e) => (e ? rej(new Error(e)) : res(v))))

await initStore()
const state = await initEarthEngine()
if (!state.ready) {
  console.error('Earth Engine ไม่พร้อม:', state.error)
  process.exit(1)
}

const field = listFields()[0]
const geom = ee.Geometry(field.geometry)
const date = process.argv[2] || '2026-07-01'

const col = ee
  .ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(geom)
  .filterDate(ee.Date(date), ee.Date(date).advance(1, 'day'))

// S2 มีแบนด์หลายความละเอียด ต้องเลือกแบนด์เดียวก่อนถามระบบพิกัด
const img = col.mosaic().setDefaultProjection(col.first().select('B4').projection())

const scl = img.select('SCL')
const clear = scl.neq(1).and(scl.neq(3)).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10)).and(scl.neq(11))

const ndviRaw = img.normalizedDifference(['B8', 'B4']).rename('NDVI')
const ndviMasked = ndviRaw.updateMask(clear)

const opts = { geometry: geom, scale: 10, maxPixels: 1e9, bestEffort: true }

// ตัวเลือกที่ 2 — แบนด์ MSK_CLDPRB ที่มากับ L2A อยู่แล้ว
const cldprb = img.select('MSK_CLDPRB')

// ตัวเลือกที่ 3 — s2cloudless ซึ่ง Google แนะนำว่าจับเมฆบางได้ดีกว่า SCL มาก
const cloudProb = ee
  .ImageCollection('COPERNICUS/S2_CLOUD_PROBABILITY')
  .filterBounds(geom)
  .filterDate(ee.Date(date), ee.Date(date).advance(1, 'day'))
  .mosaic()
  .setDefaultProjection(col.first().select('B4').projection())
  .select('probability')

const mean = (image, band) => image.reduceRegion({ reducer: ee.Reducer.mean(), ...opts }).get(band)
const count = (image, band) => image.reduceRegion({ reducer: ee.Reducer.count(), ...opts }).get(band)

const out = await evaluate(
  ee.Dictionary({
    granules: col.size(),
    cloudyPct: col.aggregate_array('CLOUDY_PIXEL_PERCENTAGE'),
    // ฮิสโทแกรมของรหัส SCL ในแปลง — บอกว่า GEE จัดพิกเซลเป็นประเภทไหนบ้าง
    sclHistogram: scl.reduceRegion({ reducer: ee.Reducer.frequencyHistogram(), ...opts }).get('SCL'),
    pixelsRaw: count(ndviRaw, 'NDVI'),
    pixelsMasked: count(ndviMasked, 'NDVI'),
    ndviRaw: mean(ndviRaw, 'NDVI'),
    ndviMasked: mean(ndviMasked, 'NDVI'),
    cldprbMean: mean(cldprb, 'MSK_CLDPRB'),
    cldprbMax: cldprb.reduceRegion({ reducer: ee.Reducer.max(), ...opts }).get('MSK_CLDPRB'),
    s2cloudlessMean: mean(cloudProb, 'probability'),
    s2cloudlessMax: cloudProb.reduceRegion({ reducer: ee.Reducer.max(), ...opts }).get('probability'),
    pixelsAfterS2cloudless: count(ndviMasked.updateMask(cloudProb.lt(40)), 'NDVI'),
  })
)

const SCL_LABELS = {
  0: 'ไม่มีข้อมูล', 1: 'พิกเซลเสีย', 2: 'เงามืด/พื้นผิวมืด', 3: 'เงาเมฆ', 4: 'พืชพรรณ',
  5: 'พื้นดินเปล่า', 6: 'น้ำ', 7: 'ไม่ชัดเจน', 8: 'เมฆน่าจะใช่', 9: 'เมฆแน่นอน',
  10: 'เมฆบางระดับสูง', 11: 'หิมะ/น้ำแข็ง',
}

console.log(`วันที่ ${date} · ${out.granules} granule · เมฆทั้งภาพ ${out.cloudyPct.map((v) => v.toFixed(0) + '%').join(', ')}`)
console.log('\nประเภทพิกเซลในแปลง (SCL):')
for (const [code, n] of Object.entries(out.sclHistogram || {}).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(code).padStart(2)} ${(SCL_LABELS[Number(code)] || '?').padEnd(16)} ${n} พิกเซล`)
}
const n = (v, d = 1) => (v === null || v === undefined ? '—' : Number(v).toFixed(d))

console.log('\nก่อนกรองเมฆ      : ' + out.pixelsRaw + ' พิกเซล · NDVI เฉลี่ย ' + n(out.ndviRaw, 3))
console.log('หลังกรองด้วย SCL : ' + out.pixelsMasked + ' พิกเซล · NDVI เฉลี่ย ' + n(out.ndviMasked, 3))
console.log('\nโอกาสเป็นเมฆในแปลง:')
console.log(`  MSK_CLDPRB (L2A) : เฉลี่ย ${n(out.cldprbMean)}%  สูงสุด ${n(out.cldprbMax)}%`)
console.log(`  s2cloudless      : เฉลี่ย ${n(out.s2cloudlessMean)}%  สูงสุด ${n(out.s2cloudlessMax)}%`)
console.log(`  เหลือพิกเซลถ้าตัดที่ s2cloudless < 40% : ${out.pixelsAfterS2cloudless}`)
