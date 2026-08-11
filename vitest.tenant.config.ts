import { defineConfig } from "vitest/config";

/**
 * config แยกสำหรับ "เทสกันข้อมูลรั่วข้ามลูกค้า" (npm run test:tenant)
 *
 * แยกจาก vitest.config.ts เพราะเทสชุดนี้ **ต่อ Supabase จริง** — ต้องมีเน็ต ช้ากว่า
 * และต้องตั้ง .env.tenant-test ก่อน · ไม่ควรปนกับ unit test ที่รันออฟไลน์ได้ทุกเมื่อ
 *
 * รันทีละไฟล์/ทีละเทส (ไม่ขนาน) เพราะทุกเทสใช้ tenant ทดสอบชุดเดียวกัน
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/tenant/**/*.test.ts"],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
