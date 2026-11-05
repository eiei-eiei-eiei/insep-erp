import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // D155 — `@/` เหมือน tsconfig paths · ให้เทสโหลดโมดูลฝั่งแอปได้ (เช่น ตัวประกอบเอกสารขาย print.ts)
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    environment: "node",
    include: [
      "lib/**/*.test.ts",
      "lib/**/*.test.tsx",
      "migration/**/*.test.ts",
      "scripts/**/*.test.ts",
    ],
  },
});
