import type { Metadata, Viewport } from "next";
import { Noto_Sans_Thai } from "next/font/google";
import { cookies } from "next/headers";
import { MODE_COOKIE } from "@/lib/shared/mode";
import "./globals.css";

// self-host ฟอนต์ไทยตอน build (ไม่พึ่ง CDN ตอน runtime) — Windows ไม่มี Noto Sans Thai ในเครื่อง
// จึงเคยได้ Leelawadee/Tahoma ปนกัน · ตัวแปร --font-thai ถูกใช้ใน globals.css
const notoThai = Noto_Sans_Thai({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-thai",
});

export const metadata: Metadata = {
  title: "Insep ERP",
  description: "ระบบ ERP ภายในโรงกลั่นสุราคราฟต์ — ผลิต · ขาย · บัญชี · รายงานราชการ",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Insep ERP" },
  icons: { icon: "/icon.svg", apple: "/apple-icon.png" }, // iOS โฮมสกรีนต้องเป็น PNG
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1215" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // อ่านโหมดจาก cookie ฝั่ง server → หน้าแรกที่ render ก็เป็นโหมดที่ถูกแล้ว (ไม่กะพริบขาว)
  const mode = (await cookies()).get(MODE_COOKIE)?.value === "dark" ? "dark" : "light";

  return (
    <html lang="th" data-mode={mode} className={notoThai.variable}>
      <body>{children}</body>
    </html>
  );
}
