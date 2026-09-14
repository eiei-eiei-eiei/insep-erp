"use client";

/**
 * ตัวเลือก "ราคาที่กรอกเป็น รวม VAT / ไม่รวม VAT" (D98 · A21)
 *
 * 🚨 คอมโพเนนต์เดียวใช้ทั้ง EntryTab และ EditBillModal — ก๊อป 2 ชุดเมื่อไร
 *    ฟอร์มบันทึกกับฟอร์มแก้จะคิดเงินคนละแบบ (คำเตือนเดียวกับหัวไฟล์ billItems.ts)
 *
 * 🚨 ทุกข้อความในนี้มาจาก lib/accounting/calc ที่มี golden test คุม
 *    ห้ามแต่งประโยคในคอมโพเนนต์ — บทเรียน D84/D88/D91: ตรรกะถูกแต่ประโยคผิด
 *    อันตรายพอกัน เพราะผู้ใช้อ่านประโยคแล้วทำตาม
 */

import { VAT_MODE_LABEL, vatModeWarn, type VatMode } from "@/lib/accounting/calc";

const MODES: VatMode[] = ["ex", "in"];

export function VatModeCard({ mode, effMode, hasVat, onChange }: {
  /** โหมดที่ผู้ใช้เลือก (ปุ่มไฮไลต์ตามตัวนี้) */
  mode: VatMode;
  /** โหมดที่มีผลจริง — ต่างจาก mode ได้เมื่อบิลยังไม่ติ๊ก VAT */
  effMode: VatMode;
  hasVat: boolean;
  onChange: (m: VatMode) => void;
}) {
  const warn = vatModeWarn(mode, hasVat);
  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-faint">ราคาที่กรอกเป็น</span>
        <div className="inline-flex overflow-hidden rounded-md border border-line">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onChange(m)}
              aria-pressed={m === mode}
              className={`px-3 py-1 text-xs transition ${m === mode ? "bg-brand font-medium text-on-brand" : "bg-raised text-muted hover:text-ink"}`}
            >
              {VAT_MODE_LABEL[m]}
            </button>
          ))}
        </div>
        {/* ★ โชว์เฉพาะตอนที่ "ที่เลือก" กับ "ที่ใช้จริง" ไม่ตรงกัน — ปกติไม่มีอะไรโผล่ */}
        {effMode !== mode && (
          <span className="text-xs text-warn">กำลังคิดแบบ {VAT_MODE_LABEL[effMode]}</span>
        )}
      </div>
      {warn && <p className="mt-1 text-xs text-warn">{warn}</p>}
    </div>
  );
}
