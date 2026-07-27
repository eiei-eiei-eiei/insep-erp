import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Insep ERP",
  description: "ระบบ ERP ภายในโรงกลั่นสุราคราฟต์ — ผลิต · ขาย · บัญชี · รายงานราชการ",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
