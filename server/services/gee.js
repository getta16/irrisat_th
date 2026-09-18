/**
 * เชื่อมต่อ Google Earth Engine เพื่อดึงค่า NDVI รายแปลง
 *
 * ต้องใช้ service account ที่ลงทะเบียนกับ Earth Engine แล้ว (ดูขั้นตอนใน README)
 * ถ้าไม่ได้ตั้งค่าไว้ ระบบจะทำงานในโหมดสาธิต (ข้อมูลจำลอง) แทน
 */
import fs from 'node:fs'
import ee from '@google/earthengine'
import { GEE_KEY_PATH, GEE_KEY_JSON, GEE_PROJECT, ALLOW_DEMO } from '../config.js'

let state = { ready: false, initializing: null, error: null, project: null, account: null }

function loadKey() {
  if (GEE_KEY_JSON) return JSON.parse(GEE_KEY_JSON)
  if (GEE_KEY_PATH) {
    if (!fs.existsSync(GEE_KEY_PATH)) throw new Error(`ไม่พบไฟล์ service account key ที่ ${GEE_KEY_PATH}`)
    return JSON.parse(fs.readFileSync(GEE_KEY_PATH, 'utf8'))
  }
  return null
}

export function initEarthEngine() {
  if (state.ready) return Promise.resolve(state)
  if (state.initializing) return state.initializing

  // ตัวแปร local สำคัญ — callback ข้างในจะเซ็ต state.initializing กลับเป็น null
  const pending = new Promise((resolve) => {
    let key
    try {
      key = loadKey()
    } catch (e) {
      state = { ...state, ready: false, error: e.message, initializing: null }
      return resolve(state)
    }

    if (!key) {
      state = { ...state, ready: false, error: 'ยังไม่ได้ตั้งค่า GEE_SERVICE_ACCOUNT_KEY', initializing: null }
      return resolve(state)
    }

    const project = GEE_PROJECT || key.project_id || null
    state.account = key.client_email || null

    const fail = (err) => {
      state = { ...state, ready: false, error: String(err?.message || err), initializing: null }
      resolve(state)
    }

    ee.data.authenticateViaPrivateKey(
      key,
      () => {
        ee.initialize(
          null,
          null,
          () => {
            state = { ready: true, initializing: null, error: null, project, account: state.account }
            resolve(state)
          },
          fail,
          null,
          project
        )
      },
      fail
    )
  })

  state.initializing = pending
  // เคลียร์ทิ้งเมื่อเสร็จ เพื่อให้ลองเชื่อมต่อใหม่ได้ถ้าครั้งนี้ล้มเหลว
  pending.then(() => {
    if (state.initializing === pending) state.initializing = null
  })
  return pending
}

export function geeStatus() {
  return {
    ready: state.ready,
    project: state.project,
    account: state.account,
    error: state.error,
    demoAllowed: ALLOW_DEMO,
    mode: state.ready ? 'earth-engine' : ALLOW_DEMO ? 'demo' : 'unavailable',
  }
}

function evaluate(eeObject) {
  return new Promise((resolve, reject) => {
    eeObject.evaluate((result, error) => (error ? reject(explainEeError(error)) : resolve(result)))
  })
}

/**
 * Earth Engine แยกสิทธิ์ "คำนวณ" ออกจาก "สร้างชั้นแผนที่"
 *
 * roles/earthengine.viewer ให้แค่ earthengine.computations.create — กราฟ NDVI จึงขึ้นได้ปกติ
 * แต่ tile แผนที่ต้องใช้ earthengine.maps.create ซึ่งมีเฉพาะใน roles/earthengine.writer ขึ้นไป
 * อาการคือ "กราฟมา แต่ชั้นแผนที่พัง" ซึ่งดูเผิน ๆ เหมือนโค้ดวาดแผนที่มีบั๊ก
 */
function explainEeError(err) {
  const msg = String(err?.message || err)
  const denied = /Permission '(earthengine\.[a-z]+\.[a-zA-Z]+)' denied/.exec(msg)
  if (!denied) return new Error(msg)

  const sa = state.account || 'SERVICE_ACCOUNT_EMAIL'
  const project = state.project || 'GEE_PROJECT'
  return new Error(
    [
      `service account ยังไม่มีสิทธิ์ ${denied[1]} บนโปรเจกต์ ${project}`,
      'แก้โดยให้สิทธิ์ระดับ writer แล้วรีสตาร์ทเซิร์ฟเวอร์:',
      `  gcloud projects add-iam-policy-binding ${project} \\`,
      `    --member="serviceAccount:${sa}" --role="roles/earthengine.writer"`,
    ].join('\n')
  )
}

function getMapAsync(image, visParams) {
  return new Promise((resolve, reject) => {
    image.getMap(visParams, (map, error) => (error ? reject(explainEeError(error)) : resolve(map)))
  })
}

// ── ชุดข้อมูลดาวเทียมที่รองรับ ────────────────────────────────────────

export const COLLECTIONS = {
  S2: {
    id: 'S2',
    label: 'Sentinel-2 (10 ม. / ~5 วัน)',
    scale: 10,
    revisitDays: 5,
  },
  LANDSAT: {
    id: 'LANDSAT',
    label: 'Landsat 8-9 (30 ม. / ~8 วัน)',
    scale: 30,
    revisitDays: 8,
  },
}

/**
 * เกณฑ์ความน่าจะเป็นเมฆของ s2cloudless ที่ถือว่าใช้ไม่ได้ (%)
 *
 * จำเป็นต้องมีคู่กับ SCL เพราะแบนด์ SCL ของ Sen2Cor มักจัด "หมอกแดด/เมฆบาง"
 * เป็นพื้นดินเปล่าหรือพืชพรรณ ทำให้ NDVI ต่ำผิดปกติหลุดรอดเข้ามา
 * (ทดสอบกับแปลงในไทยช่วงมรสุม: SCL ปล่อยผ่านทุกพิกเซล แต่ s2cloudless อ่านได้ 48-60%)
 */
const CLOUD_PROB_MAX = 40

/** Sentinel-2 L2A — กรองเมฆด้วย s2cloudless + เงาเมฆ/หิมะด้วยแบนด์ SCL */
function sentinel2Ndvi(geom, start, end, maxCloud) {
  const scenes = ee
    .ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(geom)
    .filterDate(start, end)
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', maxCloud))

  const cloudProbability = ee
    .ImageCollection('COPERNICUS/S2_CLOUD_PROBABILITY')
    .filterBounds(geom)
    .filterDate(start, end)

  // จับคู่ภาพกับชั้นความน่าจะเป็นเมฆของ granule เดียวกัน
  const joined = ee.ImageCollection(
    ee.Join.saveFirst('cloudProb').apply({
      primary: scenes,
      secondary: cloudProbability,
      condition: ee.Filter.equals({ leftField: 'system:index', rightField: 'system:index' }),
    })
  )

  return joined.map((img) => {
    const scl = img.select('SCL')
    // 1=พิกเซลเสีย 3=เงาเมฆ 8=เมฆน่าจะใช่ 9=เมฆแน่นอน 10=เมฆบาง 11=หิมะ
    const sclClear = scl
      .neq(1)
      .and(scl.neq(3))
      .and(scl.neq(8))
      .and(scl.neq(9))
      .and(scl.neq(10))
      .and(scl.neq(11))

    // ถ้าหาชั้นความน่าจะเป็นเมฆไม่เจอ ให้ถือว่าไม่มีเมฆ แล้วพึ่ง SCL อย่างเดียว
    const prob = ee
      .Image(ee.Algorithms.If(img.get('cloudProb'), img.get('cloudProb'), ee.Image.constant(0)))
      .rename('probability')

    return img
      .normalizedDifference(['B8', 'B4'])
      .rename('NDVI')
      .updateMask(sclClear.and(prob.lt(CLOUD_PROB_MAX)))
      .copyProperties(img, ['system:time_start'])
  })
}

/** Landsat 8/9 Collection 2 Level-2 — ปิดบังเมฆด้วยบิตใน QA_PIXEL */
function landsatNdvi(geom, start, end, maxCloud) {
  const prep = (img) => {
    const qa = img.select('QA_PIXEL')
    // bit 1=dilated cloud, 3=cloud, 4=cloud shadow, 5=snow
    const clear = qa
      .bitwiseAnd(1 << 1)
      .eq(0)
      .and(qa.bitwiseAnd(1 << 3).eq(0))
      .and(qa.bitwiseAnd(1 << 4).eq(0))
      .and(qa.bitwiseAnd(1 << 5).eq(0))
    const sr = img.select(['SR_B5', 'SR_B4']).multiply(0.0000275).add(-0.2)
    return sr
      .normalizedDifference(['SR_B5', 'SR_B4'])
      .rename('NDVI')
      .updateMask(clear)
      .copyProperties(img, ['system:time_start'])
  }

  const filterIt = (id) =>
    ee
      .ImageCollection(id)
      .filterBounds(geom)
      .filterDate(start, end)
      .filter(ee.Filter.lt('CLOUD_COVER', maxCloud))

  return filterIt('LANDSAT/LC08/C02/T1_L2').merge(filterIt('LANDSAT/LC09/C02/T1_L2')).map(prep)
}

function buildNdviCollection(geom, start, end, collectionId, maxCloud) {
  return collectionId === 'LANDSAT'
    ? landsatNdvi(geom, start, end, maxCloud)
    : sentinel2Ndvi(geom, start, end, maxCloud)
}

/**
 * ค่า NDVI เฉลี่ยรายภาพในขอบเขตแปลง
 * @returns {Promise<Array<{date: string, ndvi: number, pixels: number, coverage: number}>>}
 */
export async function getNdviSeries({ geometry, start, end, collection = 'S2', maxCloud = 60 }) {
  await initEarthEngine()
  if (!state.ready) throw new Error(state.error || 'Earth Engine ยังไม่พร้อมใช้งาน')

  const cfg = COLLECTIONS[collection] || COLLECTIONS.S2
  const geom = ee.Geometry(geometry)
  const col = buildNdviCollection(geom, start, end, cfg.id, maxCloud)

  // ดาวเทียมตัดภาพเป็น granule ย่อยที่ซ้อนทับกัน แปลงหนึ่งจึงอาจโดนหลายภาพในวันเดียว
  // ต้อง mosaic รวมเป็นภาพเดียวต่อวันก่อน ไม่อย่างนั้นจะนับพิกเซลเดิมซ้ำ
  // และ mosaic ยังช่วยให้ granule ที่ไม่ติดเมฆเติมรูโหว่ของ granule ที่ติดเมฆได้ด้วย
  const dates = col
    .aggregate_array('system:time_start')
    .map((t) => ee.Date(t).format('YYYY-MM-dd'))
    .distinct()

  // mosaic() ไม่มีระบบพิกัดติดมาด้วย ต้องกำหนดกริดของภาพต้นทางกลับเข้าไป
  // ไม่อย่างนั้น reduceRegion จะไปนับบนกริด WGS84 เริ่มต้นซึ่งไม่ตรงกับภาพจริง
  const proj = col.first().projection()

  const daily = ee.ImageCollection(
    dates.map((d) => {
      const day = ee.Date(d)
      return col
        .filterDate(day, day.advance(1, 'day'))
        .mosaic()
        .setDefaultProjection(proj)
        .set('date', d)
    })
  )

  const reducer = ee.Reducer.mean().combine({ reducer2: ee.Reducer.count(), sharedInputs: true })

  const features = daily.map((img) => {
    const stats = img.reduceRegion({
      reducer,
      geometry: geom,
      scale: cfg.scale,
      maxPixels: 1e9,
      bestEffort: true,
    })
    return ee.Feature(null, {
      date: img.get('date'),
      ndvi: stats.get('NDVI_mean'),
      pixels: stats.get('NDVI_count'),
    })
  })

  const raw = await evaluate(
    ee.FeatureCollection(features).filter(ee.Filter.notNull(['ndvi'])).sort('date')
  )

  const byDate = new Map()
  for (const f of raw?.features || []) {
    const { date, ndvi, pixels } = f.properties || {}
    if (typeof ndvi !== 'number' || !Number.isFinite(ndvi)) continue
    const seen = pixels || 0
    const prev = byDate.get(date)
    // หลัง mosaic แล้วควรเหลือวันละภาพ ที่เหลือกันเหนียวไว้ว่าถ้าซ้ำให้เก็บภาพที่เห็นแปลงมากกว่า
    if (!prev || seen > prev.pixels) byDate.set(date, { date, ndvi, pixels: seen })
  }

  const series = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))

  // สัดส่วนพื้นที่ที่มองเห็น เทียบกับวันที่เห็นแปลงได้มากที่สุดในชุดนี้
  // วัดจากข้อมูลจริงแทนการคำนวณจากพื้นที่แปลง เพราะจำนวนพิกเซลขึ้นกับว่า
  // กริดของภาพตกลงบนขอบแปลงอย่างไร ซึ่งต่างกันไปตามแปลงและตามชุดข้อมูล
  const fullView = Math.max(1, ...series.map((d) => d.pixels))
  for (const d of series) d.coverage = Math.min(1, d.pixels / fullView)

  return series
}

/**
 * สร้าง URL ของ tile สำหรับซ้อนภาพ NDVI / ภาพสีธรรมชาติ บนแผนที่
 */
export async function getNdviTiles({ geometry, start, end, collection = 'S2', maxCloud = 60, layer = 'ndvi' }) {
  await initEarthEngine()
  if (!state.ready) throw new Error(state.error || 'Earth Engine ยังไม่พร้อมใช้งาน')

  const cfg = COLLECTIONS[collection] || COLLECTIONS.S2
  const geom = ee.Geometry(geometry)

  let image
  let vis

  if (layer === 'truecolor') {
    const bands = cfg.id === 'LANDSAT' ? ['SR_B4', 'SR_B3', 'SR_B2'] : ['B4', 'B3', 'B2']
    const src =
      cfg.id === 'LANDSAT'
        ? ee
            .ImageCollection('LANDSAT/LC08/C02/T1_L2')
            .merge(ee.ImageCollection('LANDSAT/LC09/C02/T1_L2'))
            .filterBounds(geom)
            .filterDate(start, end)
            .map((img) => img.select(bands).multiply(0.0000275).add(-0.2))
        : ee
            .ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
            .filterBounds(geom)
            .filterDate(start, end)
            .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', maxCloud))
            .map((img) => img.select(bands).divide(10000))
    image = src.median()
    vis = { min: 0, max: 0.3, bands }
  } else {
    image = buildNdviCollection(geom, start, end, cfg.id, maxCloud).median()
    vis =
      layer === 'kc'
        ? {
            // Kc = 1.37 × NDVI − 0.086 (สมการของ IrriSAT)
            min: 0,
            max: 1.2,
            palette: ['#f7f4e9', '#dbe7b4', '#a8d18a', '#5fae63', '#26804a', '#0d5236'],
          }
        : {
            min: 0,
            max: 0.9,
            palette: ['#a50026', '#d73027', '#fdae61', '#fee08b', '#d9ef8b', '#a6d96a', '#66bd63', '#1a9850', '#006837'],
          }
    if (layer === 'kc') image = image.multiply(1.37).subtract(0.086)
  }

  const clipped = image.clip(geom.buffer(200))
  const map = await getMapAsync(clipped, vis)

  const urlFormat =
    map.urlFormat ||
    `https://earthengine.googleapis.com/v1/${map.mapid}/tiles/{z}/{x}/{y}`

  return { urlFormat, vis, collection: cfg.id, layer }
}
