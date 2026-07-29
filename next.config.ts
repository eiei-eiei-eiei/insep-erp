// auto-deploy connectivity test — 2026-07-28 (comment only, no behavior change)
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // เปิด typedRoutes ช่วยจับ path พิมพ์ผิดตอน build (สำคัญกับ workflow AI เขียนไฟล์เต็ม)
  // Next.js 15.5: ย้ายจาก experimental.typedRoutes → top-level typedRoutes
  typedRoutes: true,
};

export default nextConfig;
