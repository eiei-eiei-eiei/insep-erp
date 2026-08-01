"use client";

import "./globals.css";

/**
 * error ระดับ root layout (กรณีที่ error.tsx ของ (app) ครอบไม่ถึง)
 * ต้องมี <html>/<body> เองตาม Next.js — ข้อความไทยเหมือนกัน
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="th">
      <body>
        <div style={{ maxWidth: 520, margin: "80px auto", textAlign: "center", padding: 16 }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>ระบบขัดข้องชั่วคราว</h1>
          <p style={{ fontSize: 14, color: "#475569", marginBottom: 20 }}>
            ข้อมูลที่บันทึกไปแล้วไม่หาย — กดลองใหม่ ถ้ายังไม่หายให้ปิดแท็บแล้วเปิดใหม่
          </p>
          <button
            onClick={reset}
            style={{ minHeight: 44, padding: "0 20px", borderRadius: 8, background: "#1e293b", color: "#fff", fontWeight: 600 }}
          >
            ลองใหม่
          </button>
          {error.digest && <p style={{ marginTop: 24, fontSize: 12, color: "#94a3b8" }}>รหัสอ้างอิง: {error.digest}</p>}
        </div>
      </body>
    </html>
  );
}
