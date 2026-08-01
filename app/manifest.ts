import type { MetadataRoute } from "next";

/**
 * PWA manifest — "ติดตั้ง" ลงโฮมสกรีนแท็บเล็ตในโรงกลั่น/มือถือได้เหมือนแอปจริง
 * (ไม่ได้ทำ offline/service worker — แค่ standalone + ไอคอน ก็ได้ประโยชน์แล้ว)
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Insep ERP — ผลิต · ขาย · บัญชี",
    short_name: "Insep ERP",
    description: "ระบบ ERP ภายในโรงกลั่นสุราคราฟต์ — ผลิต · ขาย · บัญชี · รายงานราชการ",
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
    shortcuts: [
      { name: "บันทึกบิล", short_name: "บันทึกบิล", url: "/accounting" },
      { name: "ผลิต", short_name: "ผลิต", url: "/production" },
      { name: "ขาย", short_name: "ขาย", url: "/sales" },
    ],
  };
}
