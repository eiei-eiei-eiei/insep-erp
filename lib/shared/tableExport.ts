"use client";

/**
 * lib/shared/tableExport — ส่งตารางออกไป Excel จากฝั่งเบราว์เซอร์ (D181)
 *
 * · `downloadXlsx` — ไฟล์ .xlsx (ใช้แพ็กเกจ `xlsx` ที่มีอยู่แล้ว · โหลดแบบ dynamic import
 *   ให้หน้าที่ไม่กดปุ่มไม่ต้องแบกไลบรารีนี้)
 * · `copyTsv` — คัดลอกเป็นข้อความคั่นแท็บ วางใน Excel / Google Sheets แล้วแตกช่องเอง
 * ★ ตารางเป็น (string|number)[][] แถวแรก = หัวตาราง · ตัวแปลงข้อมูล→ตาราง อยู่ใน lib ของแต่ละโดเมน (มีเทสคุม)
 */

import { downloadBlob, MIME } from "./download";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param dateCols คอลัมน์ที่เป็นวันที่ ISO → เขียนเป็นวันที่จริงใน Excel (เรียง/กรองตามวันได้)
 * 🪤 ใช้เที่ยงคืนเวลาท้องถิ่น (`new Date(y, m-1, d)`) — `new Date("2026-11-25")` เป็นเวลา UTC
 *    ซึ่ง SheetJS แปลงด้วย timezone เครื่อง ได้วันเพี้ยนไป 1 วันในบางโซน
 */
export async function downloadXlsx(
  table: (string | number)[][],
  fileName: string,
  opts: { sheetName?: string; dateCols?: number[] } = {},
): Promise<void> {
  const XLSX = await import("xlsx");
  const dateCols = new Set(opts.dateCols ?? []);
  const aoa = table.map((row, ri) =>
    row.map((c, ci) => {
      if (ri === 0 || !dateCols.has(ci) || typeof c !== "string" || !ISO_DATE.test(c)) return c;
      const [y, m, d] = c.split("-").map(Number);
      return new Date(y, m - 1, d);
    }),
  );
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true, dateNF: "yyyy-mm-dd" });
  ws["!cols"] = (table[0] ?? []).map((_, ci) => ({
    wch: Math.min(40, Math.max(8, ...table.map((r) => String(r[ci] ?? "").length + 2))),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, (opts.sheetName ?? "Sheet1").slice(0, 31));
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  downloadBlob(out, fileName, MIME.xlsx);
}

/** คัดลอกข้อความลงคลิปบอร์ด · คืน false = เบราว์เซอร์ไม่ยอม (ให้ผู้เรียกขึ้นป้ายแดง) */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* ตกไปใช้ทางสำรอง */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
