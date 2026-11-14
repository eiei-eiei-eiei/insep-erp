import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * config แยกสำหรับ "เทสกันข้อมูลรั่วข้ามลูกค้า" (npm run test:tenant)
 *
 * แยกจาก vitest.config.ts เพราะเทสชุดนี้ **ต่อ Supabase จริง** — ต้องมีเน็ต ช้ากว่า
 * และต้องตั้ง .env.tenant-test ก่อน · ไม่ควรปนกับ unit test ที่รันออฟไลน์ได้ทุกเมื่อ
 *
 * รันทีละไฟล์/ทีละเทส (ไม่ขนาน) เพราะทุกเทสใช้ tenant ทดสอบชุดเดียวกัน
 */
export default defineConfig({
  // D172 — เทส connector เรียกโค้ดฝั่ง server จริง (lib/connector) ⇒ ต้องมี `@/` และแทน "server-only"
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/tenant/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/tenant/**/*.test.ts"],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
