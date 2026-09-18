# อิมเมจเดียวจบ: build หน้าเว็บแล้วให้ Express เสิร์ฟทั้งหน้าเว็บและ API
#
#   gcloud run deploy irrisat-thai --source . ...
#
# เดิมแยกเป็นสองที่ (API บน Cloud Run, หน้าเว็บบน GitHub Pages) ซึ่งต้องคอยตั้ง
# VITE_API_BASE, เปิด CORS และเพิ่ม origin ใน OAuth ให้ครบทั้งสองโดเมน
# พอรวมมาโดเมนเดียว หน้าเว็บเรียก /api บนโดเมนตัวเองได้ตรง ๆ จึงไม่ต้องตั้งอะไรเลย

# ── ขั้นที่ 1: build หน้าเว็บ ──────────────────────────────────────────
FROM node:20-slim AS client

WORKDIR /build

COPY client/package.json client/package-lock.json ./
RUN npm ci

COPY client/ ./
# ไม่ตั้ง VITE_BASE และ VITE_API_BASE โดยเจตนา — ปล่อยให้ base เป็น '/'
# และ client/src/api.js จะ fallback ไปที่ '/api' บนโดเมนเดียวกันเอง
RUN npm run build

# ── ขั้นที่ 2: อิมเมจที่เอาไปรันจริง ───────────────────────────────────
FROM node:20-slim

ENV NODE_ENV=production

# ต้องวางโค้ดเซิร์ฟเวอร์ไว้ใต้ /app/server เพื่อให้ path ที่ index.js มองหา
# หน้าเว็บ (__dirname/../client/dist) ตรงกับ /app/client/dist ที่คัดลอกมาข้างล่าง
WORKDIR /app/server

# ลง dependencies ก่อนคัดลอกซอร์ส เพื่อให้ layer นี้ถูก cache ไว้เมื่อโค้ดเปลี่ยน
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

COPY server/ ./
COPY --from=client /build/dist /app/client/dist

# Cloud Run กำหนดพอร์ตมาให้ทาง env PORT (ปกติ 8080) ซึ่ง config.js อ่านอยู่แล้ว
# ที่ประกาศไว้ตรงนี้เป็นแค่ค่าเริ่มต้นตอนรันเองในเครื่อง
EXPOSE 8080

CMD ["node", "index.js"]
