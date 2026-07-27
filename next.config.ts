import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // เปิด typedRoutes ช่วยจับ path พิมพ์ผิดตอน build (สำคัญกับ workflow AI เขียนไฟล์เต็ม)
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
