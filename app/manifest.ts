import type { MetadataRoute } from "next";

/**
 * PWA manifest — "ติดตั้ง" ลงโฮมสกรีนแท็บเล็ต/มือถือได้เหมือนแอปจริง
 * (ไม่ได้ทำ offline/service worker — แค่ standalone + ไอคอน ก็ได้ประโยชน์แล้ว)
 *
 * ★ D133 — ข้อความเป็นกลาง ไม่พูดถึงโรงกลั่น (ลูกค้าที่ไม่ได้ทำโรงเหล้าก็ติดตั้งไฟล์นี้)
 *   และ **ไม่มี shortcuts** — ไฟล์นี้เป็นค่าคงที่ต่อ deployment รู้ไม่ได้ว่าลูกค้าซื้อโมดูลไหน
 *   (เดิมมีปุ่มลัด "ผลิต" ให้ลูกค้าทุกเจ้า กดแล้วเด้งกลับหน้าแรก)
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PROOF — ระบบหลังบ้าน",
    short_name: "PROOF",
    description: "ระบบหลังบ้านสำหรับธุรกิจ — บัญชี · ขาย · เงินเดือน และอื่น ๆ",
    start_url: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#f8fafc",
    theme_color: "#1e293b",
    lang: "th",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
