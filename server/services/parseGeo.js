/**
 * แปลงไฟล์ขอบเขตพื้นที่หลายรูปแบบให้กลายเป็น GeoJSON FeatureCollection (EPSG:4326)
 *
 * รองรับ:
 *   .zip            – Shapefile ที่บีบอัดมาทั้งชุด (shp/dbf/prj/shx) หรือ zip ที่มี kml/geojson ข้างใน
 *   .shp .dbf .prj  – อัปโหลดไฟล์แยกพร้อมกันหลายไฟล์
 *   .kml .kmz       – Google Earth
 *   .gpx            – GPS track/route
 *   .geojson .json  – GeoJSON / FeatureCollection / Feature / Geometry เดี่ยว
 */
import path from 'node:path'
import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'
import { kml as kmlToGeoJSON, gpx as gpxToGeoJSON } from '@tmcw/togeojson'
import proj4 from 'proj4'
import shpDefault, * as shpNs from 'shpjs'

const shpLib = shpDefault && typeof shpDefault === 'object' ? { ...shpNs, ...shpDefault } : { ...shpNs }
const shpZip = typeof shpDefault === 'function' ? shpDefault : shpNs.default

const parseShpFn = shpLib.parseShp || shpNs.parseShp
const parseDbfFn = shpLib.parseDbf || shpNs.parseDbf
const combineFn = shpLib.combine || shpNs.combine

const ext = (name) => path.extname(String(name || '')).toLowerCase()
const baseName = (name) => path.basename(String(name || ''), ext(name)).toLowerCase()

/** ระบบพิกัดที่พบบ่อยในประเทศไทย — ใช้ตอนผู้ใช้ระบุ EPSG มาเอง */
export const COMMON_CRS = {
  4326: '+proj=longlat +datum=WGS84 +no_defs',
  32647: '+proj=utm +zone=47 +datum=WGS84 +units=m +no_defs',
  32648: '+proj=utm +zone=48 +datum=WGS84 +units=m +no_defs',
  24047: '+proj=utm +zone=47 +ellps=evrst30 +towgs84=209,818,290,0,0,0,0 +units=m +no_defs',
  24048: '+proj=utm +zone=48 +ellps=evrst30 +towgs84=209,818,290,0,0,0,0 +units=m +no_defs',
  3857: '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs',
}

class ParseError extends Error {
  constructor(message, hint) {
    super(message)
    this.name = 'ParseError'
    this.hint = hint
  }
}

// ── ตัวช่วยเรื่องพิกัด ────────────────────────────────────────────────

function looksLikeLonLat(coords) {
  const [x, y] = coords
  return Math.abs(x) <= 180 && Math.abs(y) <= 90
}

function firstCoord(geometry) {
  let c = geometry?.coordinates
  while (Array.isArray(c) && Array.isArray(c[0])) c = c[0]
  return Array.isArray(c) ? c : null
}

function mapCoords(coords, fn) {
  if (typeof coords[0] === 'number') return fn(coords)
  return coords.map((c) => mapCoords(c, fn))
}

/** อ่านรหัส EPSG จาก crs member แบบเก่าของ GeoJSON (urn:ogc:def:crs:EPSG::32647) */
function epsgFromCrsMember(obj) {
  const name = obj?.crs?.properties?.name
  if (!name) return null
  const m = String(name).match(/(\d{4,6})\s*$/)
  return m ? Number(m[1]) : null
}

function reprojectFeatureCollection(fc, epsg) {
  const def = COMMON_CRS[epsg]
  if (!def) throw new ParseError(`ไม่รู้จักระบบพิกัด EPSG:${epsg}`, 'รองรับ 4326, 3857, 32647, 32648, 24047, 24048')
  const toWgs84 = proj4(def, COMMON_CRS[4326])
  for (const f of fc.features) {
    if (!f.geometry?.coordinates) continue
    f.geometry.coordinates = mapCoords(f.geometry.coordinates, ([x, y, ...rest]) => {
      const [lon, lat] = toWgs84.forward([x, y])
      return rest.length ? [lon, lat, ...rest] : [lon, lat]
    })
  }
  return fc
}

/**
 * ตรวจว่าพิกัดอยู่นอกช่วง lon/lat หรือไม่ ถ้าใช่ให้แปลงด้วย EPSG ที่ระบุ
 * (Shapefile ไม่ต้องผ่านทางนี้ เพราะ shpjs อ่าน .prj แล้วแปลงให้เอง)
 */
function ensureWgs84(fc, hintEpsg) {
  const sample = fc.features.map((f) => firstCoord(f.geometry)).find(Boolean)
  if (!sample) return fc
  if (looksLikeLonLat(sample)) return fc

  if (hintEpsg) return reprojectFeatureCollection(fc, Number(hintEpsg))

  throw new ParseError(
    'พิกัดในไฟล์ไม่ใช่ละติจูด/ลองจิจูด (WGS84) และไฟล์ไม่ได้ระบุระบบพิกัดมาด้วย',
    'ระบุระบบพิกัดตอนอัปโหลด เช่น UTM Zone 47N (EPSG:32647) หรือ 48N (EPSG:32648) ' +
      'หรือแปลงไฟล์เป็น WGS84 ก่อนด้วย QGIS'
  )
}

// ── ตัวแปลงแต่ละฟอร์แมต ──────────────────────────────────────────────

function asFeatureCollection(input) {
  if (!input) throw new ParseError('อ่านข้อมูลจากไฟล์ไม่ได้')
  const list = Array.isArray(input) ? input : [input]
  const features = []
  for (const item of list) {
    if (!item) continue
    if (item.type === 'FeatureCollection') features.push(...(item.features || []))
    else if (item.type === 'Feature') features.push(item)
    else if (item.type && item.coordinates) features.push({ type: 'Feature', properties: {}, geometry: item })
    else if (item.type === 'GeometryCollection') {
      for (const g of item.geometries || []) features.push({ type: 'Feature', properties: {}, geometry: g })
    }
  }
  return { type: 'FeatureCollection', features }
}

function parseXmlDoc(buffer) {
  const text = buffer.toString('utf8').replace(/^﻿/, '')
  const errors = []
  const doc = new DOMParser({
    onError: (level, msg) => {
      if (level === 'error' || level === 'fatalError') errors.push(msg)
    },
  }).parseFromString(text, 'text/xml')
  if (!doc || errors.length) throw new ParseError('ไฟล์ XML/KML เสียหาย อ่านไม่ได้', errors[0])
  return doc
}

async function parseShapefileParts(files) {
  // จับกลุ่มไฟล์ที่ชื่อฐานเดียวกัน เช่น field.shp + field.dbf + field.prj
  const groups = new Map()
  for (const f of files) {
    const key = baseName(f.originalname)
    if (!groups.has(key)) groups.set(key, {})
    groups.get(key)[ext(f.originalname).slice(1)] = f.buffer
  }

  const out = []
  for (const [name, parts] of groups) {
    if (!parts.shp) continue
    const prj = parts.prj ? parts.prj.toString('utf8') : undefined
    const geometries = await parseShpFn(parts.shp, prj)
    let features
    if (parts.dbf) {
      const props = await parseDbfFn(parts.dbf, parts.cpg ? parts.cpg.toString('utf8').trim() : undefined)
      features = combineFn([geometries, props])
    } else {
      features = asFeatureCollection(geometries)
    }
    const fc = asFeatureCollection(features)
    fc.features.forEach((f) => {
      f.properties = { _source: `${name}.shp`, ...(f.properties || {}) }
    })
    out.push(fc)
  }

  if (!out.length) {
    throw new ParseError(
      'ไม่พบไฟล์ .shp ในสิ่งที่อัปโหลด',
      'Shapefile ต้องมีอย่างน้อยไฟล์ .shp, .shx, .dbf และควรมี .prj — เลือกให้ครบทุกไฟล์ หรือบีบเป็น .zip ก่อน'
    )
  }
  return { type: 'FeatureCollection', features: out.flatMap((fc) => fc.features) }
}

async function parseZip(buffer, hintEpsg) {
  const zip = await JSZip.loadAsync(buffer)
  const entries = Object.values(zip.files).filter((e) => !e.dir)

  const hasShp = entries.some((e) => ext(e.name) === '.shp')
  if (hasShp) {
    // ปล่อยให้ shpjs จัดการ zip ทั้งก้อน (อ่าน .prj และแปลงพิกัดให้อัตโนมัติ)
    const result = await shpZip(buffer)
    const fc = asFeatureCollection(result)
    if (!fc.features.length) throw new ParseError('Shapefile ใน zip ไม่มีข้อมูลรูปทรง')
    return fc
  }

  // zip/kmz ที่มี kml หรือ geojson ข้างใน
  const inner = entries.filter((e) => ['.kml', '.geojson', '.json', '.gpx'].includes(ext(e.name)))
  if (!inner.length) {
    throw new ParseError(
      'ไม่พบไฟล์ข้อมูลพื้นที่ในไฟล์บีบอัด',
      'ไฟล์ zip ควรมี .shp/.dbf/.prj หรือ .kml/.geojson อยู่ข้างใน'
    )
  }

  const collected = []
  for (const entry of inner) {
    const content = Buffer.from(await entry.async('arraybuffer'))
    collected.push(await parseSingle(entry.name, content, hintEpsg))
  }
  return { type: 'FeatureCollection', features: collected.flatMap((fc) => fc.features) }
}

async function parseSingle(filename, buffer, hintEpsg) {
  switch (ext(filename)) {
    case '.zip':
    case '.kmz':
      return parseZip(buffer, hintEpsg)

    case '.kml':
      return ensureWgs84(asFeatureCollection(kmlToGeoJSON(parseXmlDoc(buffer))), hintEpsg)

    case '.gpx':
      return ensureWgs84(asFeatureCollection(gpxToGeoJSON(parseXmlDoc(buffer))), hintEpsg)

    case '.geojson':
    case '.json': {
      let raw
      try {
        raw = JSON.parse(buffer.toString('utf8').replace(/^﻿/, ''))
      } catch {
        throw new ParseError('ไฟล์ JSON ผิดรูปแบบ อ่านไม่ได้')
      }
      const fc = asFeatureCollection(raw)
      return ensureWgs84(fc, hintEpsg || epsgFromCrsMember(raw))
    }

    default:
      throw new ParseError(
        `ยังไม่รองรับไฟล์นามสกุล ${ext(filename) || '(ไม่มีนามสกุล)'}`,
        'รองรับ .zip .shp .kml .kmz .geojson .json .gpx'
      )
  }
}

/**
 * จุดเข้าใช้งานหลัก — รับไฟล์จาก multer (อาจหลายไฟล์) แล้วคืน FeatureCollection เดียว
 * @param {Array<{originalname: string, buffer: Buffer}>} files
 * @param {number|string} [hintEpsg] รหัส EPSG ที่ผู้ใช้ระบุ เผื่อไฟล์ไม่ได้บอกระบบพิกัดมา
 */
export async function parseUploadedFiles(files, hintEpsg) {
  if (!files?.length) throw new ParseError('ไม่ได้แนบไฟล์มา')

  const shapefileParts = files.filter((f) => ['.shp', '.dbf', '.prj', '.shx', '.cpg'].includes(ext(f.originalname)))
  const others = files.filter((f) => !shapefileParts.includes(f))

  const collections = []
  if (shapefileParts.length) collections.push(await parseShapefileParts(shapefileParts))
  for (const f of others) collections.push(await parseSingle(f.originalname, f.buffer, hintEpsg))

  const features = collections.flatMap((fc) => fc.features).filter((f) => f?.geometry)
  if (!features.length) throw new ParseError('อ่านไฟล์ได้ แต่ไม่พบรูปทรงเชิงพื้นที่ข้างใน')

  return { type: 'FeatureCollection', features }
}

export { ParseError }
