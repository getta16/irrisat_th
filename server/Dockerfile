# อิมเมจสำหรับรัน API บน Google Cloud Run
#
# build จากโฟลเดอร์ server/ เท่านั้น (หน้าเว็บ client/ ไป GitHub Pages แยกต่างหาก)
#   gcloud run deploy irrisat-api --source server ...
FROM node:20-slim

ENV NODE_ENV=production
WORKDIR /app

# ลง dependencies ก่อนคัดลอกซอร์ส เพื่อให้ layer นี้ถูก cache ไว้เมื่อโค้ดเปลี่ยน
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Cloud Run กำหนดพอร์ตมาให้ทาง env PORT (ปกติ 8080) ซึ่ง config.js อ่านอยู่แล้ว
# ที่ประกาศไว้ตรงนี้เป็นแค่ค่าเริ่มต้นตอนรันเองในเครื่อง
EXPOSE 8080

CMD ["node", "index.js"]
