"use client";

/**
 * D179 — ช่อง "ยอดที่ใช้คิดหัก ณ ที่จ่าย" ใช้ร่วมฟอร์มบันทึก (EntryTab) กับฟอร์มแก้บิล (BillsTab)
 *
 * เคส: บิลค่าทำของ + ค่าขนส่ง ผู้ขายให้หัก ณ ที่จ่ายเฉพาะค่าทำของ
 * ยอดนี้คือ "จำนวนเงินที่จ่าย" ที่พิมพ์บนใบ 50ทวิ และ ภงด.3/53 (whtBaseOf ใน lib/accounting/calc)
 *
 * ★ ว่าง = ใช้ยอดหลังหักส่วนลดทั้งบิล (พฤติกรรมเดิม) · ประโยคเตือนตัดสินใน lib (whtBaseWarnings)
 * 🪤 component นี้ต้องอยู่ top-level เสมอ (D71/D179) — ประกาศใน component อื่น = เคอร์เซอร์หลุดทุกตัวอักษร
 */
import { Field, NumBox, fmt } from "./ui";

export function WhtBaseField({ value, onChange, afterDiscount, warns, blockedReason }: {
  value: number | "";
  onChange: (v: number | "") => void;
  afterDiscount: number;
  warns: string[];
  /** มีค่า = ใช้ช่องนี้ไม่ได้ (เช่น แบ่งจ่ายหลายงวด) — บอกเหตุผลบนจอ ไม่ซ่อน (D83/D86) */
  blockedReason?: string | null;
}) {
  const custom = value !== "";
  return (
    <div className="mt-2">
      <Field label="ยอดที่ใช้คิดหัก ณ ที่จ่าย">
        <div className="flex items-center gap-2">
          <div className="w-40">
            <NumBox
              value={value}
              readOnly={!!blockedReason}
              placeholder={fmt(afterDiscount)}
              onChange={(v) => onChange(v)}
              className="text-right"
            />
          </div>
          {/* 🪤 ตอนถูกบล็อกก็ต้องยังกดได้ — ค่าที่กรอกค้างไว้ก่อนติ๊กแบ่งงวด ทำให้บันทึกไม่ผ่าน ต้องมีทางล้าง */}
          {custom && (
            <button type="button" onClick={() => onChange("")} className="text-xs text-brand hover:underline">
              ใช้ยอดทั้งบิล
            </button>
          )}
        </div>
      </Field>
      {blockedReason
        ? <p className="mt-1 text-xs text-faint">{blockedReason}</p>
        : (
          <p className="mt-1 text-xs text-faint">
            {custom
              ? <>หักจากยอดนี้แทนยอดทั้งบิล ({fmt(afterDiscount)})</>
              : <>เว้นว่าง = หักจากยอดหลังหักส่วนลดทั้งบิล ({fmt(afterDiscount)})</>}
            {" "}· กรอกเมื่อหักเฉพาะบางส่วน เช่น ค่าทำของ ไม่รวมค่าขนส่ง — ยอดนี้พิมพ์เป็น <b>จำนวนเงินที่จ่าย</b> บนใบ 50ทวิ และ ภงด.3/53
          </p>
        )}
      {!blockedReason && warns.map((w) => (<p key={w} className="mt-1 text-xs text-warn">⚠️ {w}</p>))}
    </div>
  );
}
