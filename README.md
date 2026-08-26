# IrriSAT-TH

ระบบวางแผนการให้น้ำชลประทานรายแปลงจากภาพถ่ายดาวเทียม — สร้างตามแนวทางของ
[irrisat.app](https://www.irrisat.app/) แต่**เพิ่มความสามารถนำเข้าไฟล์ขอบเขตพื้นที่**
(Shapefile / KML / KMZ / GeoJSON / GPX) แทนการวาดแปลงบนแผนที่อย่างเดียว

```
NDVI จากดาวเทียม  ──▶  Kc = 1.37 × NDVI − 0.086  ──┐
                                                    ├──▶  ETc = Kc × ET₀  ──▶  สมดุลน้ำในเขตราก  ──▶  คำแนะนำการให้น้ำ
ET₀ จาก NASA POWER (FAO-56 Penman-Monteith)  ──────┘
```

---

## เริ่มใช้งานใน 3 คำสั่ง

```powershell
cd D:\GIS_GET\vscode\new_irresat
npm run setup      # ติดตั้ง dependency ทั้ง server และ client (ครั้งแรกครั้งเดียว)
npm run dev        # เปิดเซิร์ฟเวอร์ + หน้าเว็บ พร้อมกัน
```

เปิดเบราว์เซอร์ที่ **http://localhost:5173** (Vite จะเปิดให้อัตโนมัติ)

> ระบบใช้งานได้ทันทีโดยยังไม่ต้องตั้งค่าอะไร — ข้อมูลอากาศและ ET₀ เป็นของจริงจาก NASA POWER
> ส่วนค่า NDVI จะเป็นข้อมูล**จำลอง**จนกว่าจะเชื่อมต่อ Google Earth Engine ตามหัวข้อถัดไป

### คำสั่งอื่น ๆ

| คำสั่ง | ทำอะไร |
| --- | --- |
| `npm run dev` | โหมดพัฒนา — แก้โค้ดแล้วรีโหลดอัตโนมัติทั้งสองฝั่ง |
| `npm run build` | build หน้าเว็บเป็นไฟล์ static ไว้ใน `client/dist` |
| `npm start` | รันเซิร์ฟเวอร์อย่างเดียว (เสิร์ฟหน้าเว็บที่ build แล้วที่พอร์ต 5174) |
| `npm run samples` | สร้างไฟล์ตัวอย่างไว้ทดสอบการนำเข้าในโฟลเดอร์ `samples/` |
| `npm run test:smoke` | ทดสอบเส้นทางหลักตั้งแต่นำเข้าไฟล์จนถึงประมวลผล (ต้องเปิดเซิร์ฟเวอร์ไว้ก่อน) |

---

## เชื่อมต่อ Google Earth Engine (เพื่อใช้ NDVI จริง)

เว็บฝั่งเซิร์ฟเวอร์คุยกับ Earth Engine ผ่าน **service account** ไม่ใช่บัญชีส่วนตัว
เพราะไม่มีคนคอยกดยืนยันตัวตนให้ ขั้นตอนทำครั้งเดียว:

### 1. เปิด Earth Engine API ใน Google Cloud

1. ไปที่ [Google Cloud Console](https://console.cloud.google.com/) → สร้างหรือเลือก project
   (ควรใช้ project เดียวกับที่ลงทะเบียน Earth Engine ไว้)
2. เปิดใช้งาน **Google Earth Engine API** ที่
   [APIs & Services → Library](https://console.cloud.google.com/apis/library/earthengine.googleapis.com)

### 2. สร้าง service account และดาวน์โหลดคีย์

1. ไปที่ [IAM & Admin → Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts)
   → **Create Service Account** (ตั้งชื่ออะไรก็ได้ เช่น `irrisat-server`)
2. เข้าไปที่ service account ที่สร้าง → แท็บ **Keys** → **Add Key → Create new key → JSON**
3. เก็บไฟล์ `.json` ที่ดาวน์โหลดมาไว้นอกโฟลเดอร์โปรเจกต์ เช่น `D:\GIS_GET\keys\gee-key.json`

   > ⚠️ ไฟล์นี้คือกุญแจเข้าบัญชี — ห้าม commit ขึ้น git หรือส่งต่อให้ใคร
   > (`.gitignore` กันไว้ให้แล้ว แต่เก็บไว้นอกโปรเจกต์จะปลอดภัยกว่า)

### 3. ลงทะเบียน service account กับ Earth Engine

ไปที่ https://code.earthengine.google.com/register แล้วเลือก **Register a Service Account**
ใส่อีเมลของ service account (หน้าตาแบบ `irrisat-server@ชื่อโปรเจกต์.iam.gserviceaccount.com`)

### 4. ตั้งค่าในโปรเจกต์

คัดลอก `.env.example` เป็น `.env` แล้วแก้:

```ini
GEE_SERVICE_ACCOUNT_KEY=D:/GIS_GET/keys/gee-key.json
GEE_PROJECT=ชื่อ-google-cloud-project
```

รีสตาร์ทเซิร์ฟเวอร์ — ถ้าสำเร็จจะขึ้นข้อความ `Earth Engine → พร้อมใช้งาน`
และป้ายสถานะมุมขวาบนของเว็บจะเปลี่ยนเป็นสีเขียว **"Earth Engine พร้อมใช้งาน"**

---

## การนำเข้าไฟล์ขอบเขตพื้นที่

ลากไฟล์มาวางในกรอบ "นำเข้าขอบเขตพื้นที่" หรือคลิกเพื่อเลือกไฟล์

| รูปแบบ | หมายเหตุ |
| --- | --- |
| `.zip` | Shapefile ที่บีบมาทั้งชุด — **วิธีที่แนะนำที่สุด** เพราะแปลงระบบพิกัดจาก `.prj` ให้อัตโนมัติ |
| `.shp` `.shx` `.dbf` `.prj` `.cpg` | เลือกทุกไฟล์พร้อมกันได้ (กด Ctrl ค้างแล้วคลิก) ระบบจะจับคู่ตามชื่อไฟล์ให้เอง |
| `.kml` / `.kmz` | จาก Google Earth |
| `.geojson` / `.json` | GeoJSON มาตรฐาน |
| `.gpx` | เส้นทาง GPS — เส้นที่ลากบรรจบกันจะถูกแปลงเป็นพื้นที่ |

### เรื่องระบบพิกัด

ไฟล์ Shapefile ที่มี `.prj` มาด้วยจะถูกแปลงเป็น WGS84 ให้อัตโนมัติ
แต่ถ้าไฟล์ไม่ได้บอกระบบพิกัดไว้ (พบบ่อยกับ GeoJSON ที่ export มาจาก QGIS แบบ UTM)
ให้เลือกระบบพิกัดจากช่อง "ระบบพิกัดของไฟล์" ก่อนอัปโหลด:

- **EPSG:32647** — UTM Zone 47N, WGS84 (ไทยฝั่งตะวันตก: กาญจนบุรี ตาก เชียงใหม่ ภูเก็ต)
- **EPSG:32648** — UTM Zone 48N, WGS84 (ไทยฝั่งตะวันออก: กรุงเทพฯ ขอนแก่น อุบลฯ ระยอง)
- **EPSG:24047 / 24048** — Indian 1975 (แผนที่กรมแผนที่ทหารรุ่นเก่า)

### สิ่งที่ระบบจัดการให้อัตโนมัติ

- อ่านชื่อแปลงจากตาราง attribute (`NAME`, `ชื่อแปลง`, `FIELD`, `ID` ฯลฯ) — รวมถึงภาษาไทยที่เข้ารหัส UTF-8
- ปิดวงแหวนที่ไม่ปิด และตัดค่าความสูง (Z) ทิ้ง เพราะ Earth Engine ไม่รับพิกัด 3 มิติ
- เส้นปิด (`LineString`) → แปลงเป็นรูปปิด · จุด (`Point`) → สร้างวงกลมรัศมี 50 ม.
- ข้ามรูปทรงที่เล็กกว่า 100 ตร.ม. และรายงานว่าข้ามไปเพราะอะไร

ทดลองได้ด้วยไฟล์ตัวอย่าง: รัน `npm run samples` แล้วลากไฟล์จากโฟลเดอร์ `samples/` เข้าไป

---

## วิธีคำนวณ

### 1. NDVI จากดาวเทียม

| ชุดข้อมูล | ความละเอียด | รอบถ่ายซ้ำ | การกรองเมฆ |
| --- | --- | --- | --- |
| Sentinel-2 L2A (`COPERNICUS/S2_SR_HARMONIZED`) | 10 ม. | ~5 วัน | s2cloudless + แบนด์ `SCL` |
| Landsat 8/9 C2 L2 | 30 ม. | ~8 วัน | บิตใน `QA_PIXEL` |

ค่าที่ได้คือ NDVI **เฉลี่ยทั้งแปลง** ในแต่ละวันที่มีภาพ ภาพวันเดียวกันที่ถูกตัดเป็นหลาย granule
จะถูก mosaic รวมก่อน เพื่อไม่ให้นับพื้นที่เดียวกันซ้ำ และให้ granule ที่ใสเติมรูโหว่ของ granule ที่ติดเมฆ

**เรื่องการกรองเมฆของ Sentinel-2** — แบนด์ `SCL` อย่างเดียวไม่พอสำหรับสภาพอากาศบ้านเรา
ทดสอบกับแปลงจริงในช่วงมรสุมพบว่า SCL จัด "หมอกแดด/เมฆบาง" เป็นพื้นดินเปล่าหรือพืชพรรณ
ปล่อยให้ NDVI ที่ต่ำผิดปกติหลุดเข้ามา:

| วันที่ | NDVI ที่วัดได้ | SCL | `MSK_CLDPRB` | s2cloudless |
| --- | --- | --- | --- | --- |
| 1 ก.ค. | 0.61 (ผิดปกติ) | ผ่านหมด | 0.3% | **60%** |
| 9 ก.ค. | 0.64 (ผิดปกติ) | ผ่านหมด | 1.9% | **48%** |
| 29 ก.ค. | 0.66 (ผิดปกติ) | ผ่านหมด | 1.4% | **56%** |
| 3 ส.ค. | 0.88 (ปกติ) | ผ่านหมด | 0.0% | **8%** |

ระบบจึงใช้ `COPERNICUS/S2_CLOUD_PROBABILITY` (s2cloudless) ตัดพิกเซลที่มีโอกาสเป็นเมฆเกิน 40%
ควบคู่กับ SCL ที่ยังใช้จับเงาเมฆและหิมะ — ปรับค่าได้ที่ `CLOUD_PROB_MAX` ใน `server/services/gee.js`

ภาพที่มองเห็นแปลงได้น้อยกว่า 40% ของวันที่เห็นชัดที่สุดในช่วงเวลานั้นจะถูกตัดทิ้งไปด้วย

> อยากรู้ว่าทำไมภาพวันไหนถูกตัดทิ้ง รันได้ที่
> `node server/tools/debug-cloudmask.js 2026-07-01`
> จะแสดงประเภทพิกเซลตาม SCL และค่าความน่าจะเป็นเมฆของวันนั้น

### 2. ค่าสัมประสิทธิ์พืช Kc

```
Kc = 1.37 × NDVI − 0.086      (จำกัดไว้ที่ 0 ถึง 1.25)
```

สมการเชิงเส้นชุดเดียวกับที่ IrriSAT ใช้ (Trout et al. 2008; Hornbuckle et al. 2016)
ระหว่างวันที่ไม่มีภาพ ระบบเติมค่า Kc ด้วยการประมาณเชิงเส้นระหว่างภาพสองภาพที่ใกล้ที่สุด

### 3. ET₀ — การคายระเหยอ้างอิง

ดึงข้อมูลอากาศรายวันจาก [NASA POWER](https://power.larc.nasa.gov/) (ฟรี ไม่ต้องมี API key)
แล้วคำนวณด้วยสมการ **FAO-56 Penman-Monteith** เต็มรูปแบบ ได้แก่ รังสีสุทธิ ความชื้นสัมพัทธ์
ความเร็วลมที่ 2 เมตร และความกดอากาศตามระดับความสูง
ถ้าวันไหนข้อมูลลมหรือรังสีขาดหาย จะถอยไปใช้ Hargreaves-Samani แทน

> NASA POWER มีข้อมูลช้ากว่าปัจจุบันราว 3 วัน ระบบจึงตั้งวันสิ้นสุดเริ่มต้นไว้ที่ 3 วันก่อนหน้า

### 4. สมดุลน้ำในเขตราก

```
ETc      = Kc × ET₀
พร่อง(วันนี้) = พร่อง(เมื่อวาน) + ETc − ฝนที่ใช้ได้ − (น้ำที่ให้ × ประสิทธิภาพ)
```

- **TAW** = ปริมาณน้ำที่ดินอุ้มได้ทั้งหมด = (ค่าอุ้มน้ำตามชนิดดิน มม./ม.) × ความลึกราก
- **RAW** = TAW × p — เมื่อน้ำพร่องถึงระดับนี้คือ**ถึงเวลาให้น้ำ** ก่อนที่พืชจะเริ่มเครียด
- **ฝนที่ใช้ได้จริง** — ฝนไม่เกิน 25 มม./วัน ถือว่าซึมลงดินหมด ส่วนที่เกินคิดว่าไหลบ่าไป 40%
- ค่าพร่องถูกตรึงไว้ระหว่าง 0 ถึง TAW น้ำส่วนเกินถือว่าไหลซึมลึกออกไปจากเขตราก

ปรับ **ชนิดพืช · ชนิดดิน · ความลึกราก · ค่า p · ประสิทธิภาพระบบน้ำ** ได้รายแปลงในแถบด้านซ้าย

### ข้อจำกัดที่ควรรู้

- **ยังไม่รวมพยากรณ์ฝนล่วงหน้า** — ตัวเลข "อีกกี่วันต้องให้น้ำ" คิดบนสมมติฐานว่าไม่มีฝนเลย
- **นาข้าวแบบขังน้ำ** ใช้สมดุลน้ำแบบนี้ไม่ตรงนัก เพราะโมเดลนี้คิดแบบดินไร่ ไม่ได้คิดชั้นน้ำขัง
- NDVI ช่วงที่เมฆบังยาวหลายสัปดาห์จะถูกประมาณเป็นเส้นตรง ความแม่นยำจะลดลงตามช่วงที่ขาด
  — ยิ่งช่วงมรสุมที่ถูกกรองทิ้งหลายภาพติดกัน ยิ่งต้องระวัง
- ข้อมูลอากาศจาก NASA POWER เป็นค่าจากกริดประมาณ 0.5° (~50 กม.) ไม่ใช่สถานีตรวจอากาศจริงในแปลง

---

## นำขึ้นเว็บจริงฟรีด้วย Render (แนะนำ)

วิธีนี้ได้ทั้งหน้าเว็บและ API อยู่ที่อยู่เดียวกัน — `https://irrisatth.onrender.com` —
ใช้งานได้ครบทุกฟีเจอร์ ไม่มีค่าใช้จ่าย และไม่ต้องผูกบัตรเครดิต

ทำได้เพราะ `server/index.js` เสิร์ฟไฟล์ใน `client/dist` ให้อยู่แล้ว หน้าเว็บกับ API
จึงอยู่โดเมนเดียวกัน ไม่ต้องตั้ง `VITE_API_BASE` และไม่ต้องยุ่งกับ CORS

### ขั้นตอน

1. push โค้ดขึ้น GitHub ให้เรียบร้อย (ต้องมีไฟล์ `render.yaml` ที่รากโปรเจกต์)

2. สมัคร [render.com](https://render.com) ด้วยปุ่ม **Sign in with GitHub**
   (แพลนฟรีไม่ขอบัตรเครดิต)

3. ที่ dashboard กด **New +** → **Blueprint** → เลือก repo นี้ → **Connect**
   Render จะอ่าน `render.yaml` แล้วตั้งค่าให้เองทั้งหมด

4. Render จะถามค่า 2 ตัวที่เป็นความลับ (ที่เหลือกรอกไว้ใน `render.yaml` แล้ว):

   | ตัวแปร | ใส่อะไร |
   |---|---|
   | `GEE_SERVICE_ACCOUNT_JSON` | เปิดไฟล์คีย์ `.json` ของ service account แล้วคัดลอก**เนื้อในทั้งก้อน** ตั้งแต่ `{` ถึง `}` มาวาง |
   | `GEE_PROJECT` | ชื่อ Google Cloud project ที่เปิด Earth Engine ไว้ (เว้นว่างก็ได้ ระบบจะอ่าน `project_id` จากใน JSON เอง) |

5. กด **Apply** แล้วรอ build ประมาณ 3–5 นาที เสร็จแล้วเปิดเว็บได้ที่
   `https://irrisatth.onrender.com`

ตรวจว่าเชื่อม Earth Engine ติดจริงไหมได้ที่ `https://irrisatth.onrender.com/api/status` —
ถ้าขึ้น `"mode":"earth-engine"` คือใช้ข้อมูลดาวเทียมจริง ถ้าขึ้น `"mode":"demo"` แปลว่าคีย์ยังไม่ถูกต้อง
ให้ดู log ในแท็บ **Logs** ของ Render

หลังจากนี้ทุกครั้งที่ push ขึ้น `main` Render จะ build และ deploy ให้เองอัตโนมัติ

### ข้อจำกัดของแพลนฟรีที่ต้องรู้

- **เว็บหลับเมื่อไม่มีคนเข้า 15 นาที** — คนเข้าคนแรกหลังหลับจะรอ ~50 วินาที
  ก่อนหน้าเว็บจะขึ้น (ครั้งต่อ ๆ ไปเร็วปกติ)

- **ข้อมูลแปลงหายเมื่อรีสตาร์ต** — แพลนฟรีไม่มีดิสก์ถาวร ข้อมูลใน
  `server/data/fields.json` จะหายทุกครั้งที่เว็บหลับแล้วตื่น หรือ deploy ใหม่
  ถ้าต้องเก็บถาวรมีสองทาง:
  - ตั้ง `GCS_BUCKET` ให้ไปเก็บบน Google Cloud Storage (ต้องเปิด billing กับ Google
    แต่ปริมาณเท่านี้อยู่ในโควตาฟรี 5 GB) — ดูหัวข้อ Cloud Run ด้านล่าง
  - เปลี่ยน `server/services/store.js` ไปใช้ฐานข้อมูลฟรีอย่าง Supabase
    (โค้ดแยกส่วนไว้แล้ว แก้เฉพาะไฟล์นี้ไฟล์เดียว)

- **750 ชั่วโมง/เดือน** ต่อบัญชี — พอสำหรับบริการเดียวรันทั้งเดือน

### ถ้าอยากได้โดเมนจริง (เช่น irrisatth.com)

โดเมนจริงต้องเสียค่าจดทะเบียน — ไม่มีเจ้าไหนแจกฟรีแล้ว (ราว 300–500 บาท/ปี)
ถ้าซื้อมาแล้ว ไม่ต้องแก้โค้ดอะไรเลย แค่เข้า Render → service → **Settings → Custom Domains**
→ **Add Custom Domain** แล้วตั้ง DNS ตามที่หน้าจอบอก Render ออกใบรับรอง HTTPS ให้ฟรี

---

## นำขึ้น GitHub Pages

Pages เสิร์ฟได้เฉพาะ**ไฟล์นิ่ง** จึงขึ้นได้แค่หน้าเว็บ (`client/`) เท่านั้น
ส่วน API ใน `server/` ที่คุยกับ Earth Engine ต้องมี Node.js รันอยู่จริง และต้องถือ
service account key ซึ่งเป็นความลับ — เอาขึ้น Pages ไม่ได้ทั้งสองข้อ

ผลคือถ้า deploy แค่ Pages เปล่า ๆ หน้าเว็บจะเปิดขึ้นและเลื่อนแผนที่ได้ แต่จะขึ้นว่า
"ไม่ได้เชื่อมต่อดาวเทียม" และนำเข้าแปลง/คำนวณไม่ได้ เพราะไม่มี API ให้เรียก

### ขั้นตอน

1. ที่ repo บน GitHub → **Settings → Pages → Source** เลือก **GitHub Actions**
2. ไปที่แท็บ **Actions** → เลือก workflow **Deploy to GitHub Pages** → **Run workflow**
   (workflow นี้ปิดการรันอัตโนมัติไว้ เพราะเว็บจริงอยู่บน Render แล้ว — ถ้าปล่อยให้รัน
   ทุกครั้งที่ push จะได้เว็บซ้ำอีกชุดที่ต่อ API ไม่ได้)
3. เว็บจะอยู่ที่ `https://<user>.github.io/<repo>/`

### ให้หน้าเว็บบน Pages ใช้งานได้เต็มรูปแบบ

ต้องมี API รันอยู่ที่อื่นก่อน แล้วตั้ง repository variable `VITE_API_BASE` ให้ชี้ไปที่นั่น
(เช่น `https://irrisatth.onrender.com/api` หรือ Cloud Run — ดูหัวข้อถัดไป)

ถ้าใช้ Render อยู่แล้วก็ไม่จำเป็นต้องทำหัวข้อนี้เลย เพราะได้ทั้งหน้าเว็บและ API ในที่เดียว

---

## โฮสต์ API บน Google Cloud Run

ใช้โปรเจกต์เดียวกับที่เปิด Earth Engine ไว้แล้ว จึงไม่ต้องสร้าง service account ใหม่

### สิ่งที่ต้องมีก่อน

- ผูกบัญชีเรียกเก็บเงิน (billing) กับโปรเจกต์ — Cloud Run มีโควตาฟรีต่อเดือนอยู่แล้ว
  แต่ Google บังคับให้ผูกบัตรก่อนถึงจะเปิดใช้ได้
- ลง gcloud CLI: `winget install Google.CloudSDK` แล้วเปิด PowerShell ใหม่
- `gcloud auth login` แล้ว `gcloud config set project klongkloong`

### 1. เปิด API ที่ต้องใช้

```powershell
gcloud services enable run.googleapis.com cloudbuild.googleapis.com `
  artifactregistry.googleapis.com secretmanager.googleapis.com storage.googleapis.com
```

### 2. สร้าง bucket เก็บข้อมูลแปลง

ดิสก์ของ Cloud Run หายทุกครั้งที่รีสตาร์ต ข้อมูลแปลงจึงต้องไปอยู่บน Cloud Storage
(ชื่อ bucket ต้องไม่ซ้ำกับใครทั้งโลก — เปลี่ยนได้ตามใจ)

```powershell
gcloud storage buckets create gs://klongkloong-irrisat-data --location=asia-southeast1
```

ถ้ามีข้อมูลแปลงเดิมในเครื่องอยู่แล้ว อัปขึ้นไปก่อนได้:

```powershell
gcloud storage cp server/data/fields.json gs://klongkloong-irrisat-data/fields.json
```

### 3. เก็บคีย์ service account ไว้ใน Secret Manager

อย่าใส่คีย์เป็น env var ธรรมดาและอย่า commit ลง git — เก็บเป็น secret แล้วให้ Cloud Run
อ่านตอนรันเท่านั้น

```powershell
gcloud secrets create irrisat-gee-key --data-file="D:GIS_GETscodekeyklongkloong-66f17875c00e.json"
```

### 4. ให้สิทธิ์ service account

รัน Cloud Run ด้วย service account ตัวเดียวกับที่ลงทะเบียน Earth Engine ไว้
(`irrisat-th@klongkloong.iam.gserviceaccount.com`) จะได้เข้าถึง bucket ได้เลยโดยไม่ต้องมีคีย์อีกชุด

```powershell
$SA = "irrisat-th@klongkloong.iam.gserviceaccount.com"

gcloud storage buckets add-iam-policy-binding gs://klongkloong-irrisat-data `
  --member="serviceAccount:$SA" --role="roles/storage.objectAdmin"

gcloud secrets add-iam-policy-binding irrisat-gee-key `
  --member="serviceAccount:$SA" --role="roles/secretmanager.secretAccessor"
```

### 5. Deploy

```powershell
gcloud run deploy irrisat-api `
  --source server `
  --region asia-southeast1 `
  --service-account "irrisat-th@klongkloong.iam.gserviceaccount.com" `
  --set-secrets "GEE_SERVICE_ACCOUNT_JSON=irrisat-gee-key:latest" `
  --set-env-vars "GEE_PROJECT=klongkloong,GCS_BUCKET=klongkloong-irrisat-data,ALLOW_DEMO=false" `
  --memory 1Gi `
  --timeout 300 `
  --max-instances 1 `
  --allow-unauthenticated
```

หมายเหตุแต่ละตัว:

| ตัวเลือก | ทำไมต้องใส่ |
| --- | --- |
| `--source server` | build เฉพาะโฟลเดอร์ server/ ตาม `server/Dockerfile` |
| `--max-instances 1` | ระบบเก็บข้อมูลแปลงไว้ในหน่วยความจำแล้วเขียนกลับ bucket ถ้ามีหลายอินสแตนซ์พร้อมกันจะเขียนทับกันเอง |
| `--memory 1Gi` | shapefile ขนาดใหญ่กับการแปลงพิกัดกินแรมเกิน 512Mi ได้ |
| `--timeout 300` | คำขอ Earth Engine ครั้งแรกของแปลงใหญ่ใช้เวลาหลายสิบวินาที |
| `--allow-unauthenticated` | หน้าเว็บบน Pages เรียกตรงโดยไม่มีระบบล็อกอิน |
| `ALLOW_DEMO=false` | บนของจริงอยากให้ error ชัด ๆ ดีกว่าเงียบ ๆ แล้วส่งข้อมูลจำลองให้ |

เสร็จแล้ว gcloud จะพิมพ์ URL ออกมา เช่น `https://irrisat-api-xxxxxxxx-as.a.run.app`
ลองเช็คว่าเชื่อม Earth Engine ได้จริง:

```powershell
curl.exe https://irrisat-api-xxxxxxxx-as.a.run.app/api/status
```

ควรได้ `"mode":"earth-engine"` ถ้าได้ `"mode":"unavailable"` ให้ดูล็อกด้วย
`gcloud run services logs read irrisat-api --region asia-southeast1`

### 6. ชี้หน้าเว็บมาที่ API

ที่ repo บน GitHub → **Settings → Secrets and variables → Actions → Variables** →
**New repository variable** ชื่อ `VITE_API_BASE` ค่าเป็น URL ข้างบน **ต่อท้ายด้วย `/api`**

```
https://irrisat-api-xxxxxxxx-as.a.run.app/api
```

แล้วไปแท็บ **Actions** → **Deploy to GitHub Pages** → **Run workflow** เพื่อ build ใหม่
(ค่านี้ถูกฝังตอน build ต้อง deploy ใหม่ทุกครั้งที่เปลี่ยน)

### เรื่องที่ควรรู้

- **คำขอแรกช้า** — Cloud Run ปิดคอนเทนเนอร์เมื่อไม่มีคนใช้ คำขอแรกหลังพักจะรอ 10-30 วินาที
  หน้าเว็บถามสถานะซ้ำได้นานถึง 1 นาทีอยู่แล้ว จึงรอจนติดเอง
- **API เปิดให้ทุกคนเรียก** — ใครรู้ URL ก็ยิงได้ รวมถึงลบแปลงในระบบ และใช้โควตา
  Earth Engine ของโปรเจกต์คุณ ถ้าจะจำกัด ให้ตั้ง `--ingress` หรือเพิ่มระบบยืนยันตัวตนภายหลัง
- **ค่าใช้จ่าย** — โควตาฟรีของ Cloud Run ครอบคลุมการใช้งานส่วนตัวสบาย ๆ แต่ควรตั้ง
  งบเตือนไว้ที่ Billing → Budgets & alerts กันเหนียว

---

## โครงสร้างโปรเจกต์

```
new_irresat/
├── package.json           สคริปต์รวมสำหรับรันทั้งระบบ
├── .env                   ค่าตั้งค่าส่วนตัว (สร้างเองจาก .env.example)
│
├── server/                Node.js + Express
│   ├── index.js           จุดเริ่มต้น ประกอบ route ทั้งหมด
│   ├── config.js          อ่านค่าจาก .env
│   ├── routes/
│   │   ├── import.js      POST /api/import      — รับไฟล์ แปลงเป็น GeoJSON
│   │   ├── fields.js      CRUD /api/fields      — จัดการแปลงที่บันทึกไว้
│   │   └── analysis.js    POST /api/analysis    — ประมวลผลและสร้าง tile แผนที่
│   ├── services/
│   │   ├── parseGeo.js    อ่าน shapefile / kml / kmz / geojson / gpx + แปลงระบบพิกัด
│   │   ├── normalize.js   ทำความสะอาดรูปทรง คำนวณพื้นที่เป็นไร่/เฮกตาร์
│   │   ├── gee.js         คุยกับ Google Earth Engine (NDVI + tile แผนที่)
│   │   ├── weather.js     NASA POWER + FAO-56 Penman-Monteith
│   │   ├── irrigation.js  Kc, สมดุลน้ำ, คำแนะนำการให้น้ำ, ข้อมูลจำลอง
│   │   └── store.js       เก็บข้อมูลแปลงลงไฟล์ JSON
│   ├── tools/             สร้างไฟล์ตัวอย่าง + ทดสอบระบบ
│   └── data/fields.json   ข้อมูลแปลงของคุณ (สร้างอัตโนมัติ, ไม่ถูก commit)
│
└── client/                React + Vite
    └── src/
        ├── App.jsx        ประกอบหน้าจอและจัดการ state ทั้งหมด
        ├── api.js         เรียก API ฝั่งเซิร์ฟเวอร์
        └── components/
            ├── MapView.jsx       แผนที่ Leaflet + เครื่องมือวาด (Geoman)
            ├── MapControls.jsx   สลับแผนที่ฐาน / ชั้น NDVI / คำอธิบายสี
            ├── ImportPanel.jsx   นำเข้าไฟล์และเลือกแปลงที่จะบันทึก
            ├── FieldList.jsx     รายการแปลง
            ├── FieldSettings.jsx ตั้งค่าพืช ดิน และบันทึกการให้น้ำ
            └── AnalysisPanel.jsx สรุปผล กราฟ และตารางข้อมูล
```

### API

| Method | Path | ทำอะไร |
| --- | --- | --- |
| `GET` | `/api/status` | สถานะระบบและการเชื่อมต่อ Earth Engine |
| `POST` | `/api/import` | อัปโหลดไฟล์ (multipart) → คืนพื้นที่ที่อ่านได้ (ยังไม่บันทึก) |
| `GET` `POST` | `/api/fields` | อ่าน / เพิ่มแปลง (ส่ง `replace: true` = ลบแปลงเดิมทั้งหมดก่อน) |
| `DELETE` | `/api/fields` | ลบหลายแปลง (`{ ids: [...] }`) หรือลบทั้งหมดด้วย `?all=1` |
| `PATCH` `DELETE` | `/api/fields/:id` | แก้ไข / ลบแปลงเดียว |
| `GET` | `/api/analysis/options` | รายการชนิดพืช ชนิดดิน และชุดข้อมูลดาวเทียม |
| `POST` | `/api/analysis` | ประมวลผลแปลงหนึ่ง → NDVI, Kc, ET₀, ETc, สมดุลน้ำรายวัน |
| `POST` | `/api/analysis/tiles` | URL ของ tile ชั้น NDVI / Kc / ภาพสีจริง |

ผลลัพธ์จาก Earth Engine และ NASA POWER ถูกแคชไว้ในหน่วยความจำ 30 นาที
เพื่อไม่ให้เรียกซ้ำถี่เกินไปและกินโควตา

---

## แหล่งข้อมูล

- **ภาพดาวเทียม** — Copernicus Sentinel-2 (ESA) และ Landsat 8/9 (NASA/USGS) ผ่าน Google Earth Engine
- **ข้อมูลอากาศ** — NASA POWER Project (NASA Langley Research Center)
- **แผนที่ฐาน** — Esri World Imagery และ OpenStreetMap
- **สมการ** — Allen, R.G. et al. (1998) *Crop evapotranspiration*, FAO Irrigation and Drainage Paper 56
