"use client";

import { fmt, NumBox, TextInput } from "./ui";
import { planAmounts, planError, type PlanRowInput } from "@/lib/sales/installments";

/**
 * ตัวแก้แผนงวด (D146) — ใช้ทั้งในใบเสนอราคา (เฟส 3b) และป๊อปอัพปรับงวดของออเดอร์ (เฟส 3c)
 *
 * แก้ได้เฉพาะงวดที่ยังไม่ล็อก · % คิดจากยอดสุทธิหลังหัก ณ ที่จ่าย · **งวดสุดท้ายรับเศษ** (planAmounts)
 * ★ ยอดเป็นบาทบนจอคิดด้วยฟังก์ชันเดียวกับที่ server ส่งเข้า RPC — เห็นอย่างไร บันทึกอย่างนั้น
 * ★ ข้อความผิดมาจาก `planError()` ตัวเดียวกับที่ server ตรวจก่อนบันทึก
 */
export function InstallmentEditor({
  rows,
  onChange,
  net,
  remain,
  startSeq = 1,
  sent = false,
}: {
  rows: PlanRowInput[];
  onChange: (rows: PlanRowInput[]) => void;
  /** ยอดสุทธิทั้งสัญญา (ฐานของ %) */
  net: number;
  /** ยอดที่งวดชุดนี้ต้องรวมให้ได้ (ใบเสนอราคา = ยอดสุทธิ · ปรับงวด = ยอดค้าง − งวดล็อกที่ยังไม่รับ) */
  remain: number;
  /** เลขงวดแรกของชุดนี้ (ปรับงวดหลังรับงวดแรก = 2) */
  startSeq?: number;
  /** ส่งคลังไปแล้ว — ไม่มีจุดส่งของให้เลือก */
  sent?: boolean;
}) {
  const amounts = net > 0 ? planAmounts(net, rows.map((r) => r.percent || 0), remain) : rows.map(() => 0);
  const sum = Math.round(rows.reduce((s, r) => s + (r.percent || 0), 0) * 100) / 100;
  const need = net > 0 ? Math.round((remain / net) * 10000) / 100 : 0;
  const err = net > 0 ? planError(rows, net, remain, sent) : null;

  const set = (i: number, patch: Partial<PlanRowInput>) =>
    onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : patch.shipPoint ? { ...r, shipPoint: false } : r)));
  const remove = (i: number) => onChange(rows.filter((_, k) => k !== i));
  /** รวมงวดนี้กับงวดถัดไป — คงชื่องวดแรก · % บวกกัน · จุดส่งของติดไปด้วย */
  const mergeNext = (i: number) =>
    onChange([
      ...rows.slice(0, i),
      {
        ...rows[i],
        percent: Math.round(((rows[i].percent || 0) + (rows[i + 1].percent || 0)) * 100) / 100,
        shipPoint: rows[i].shipPoint || rows[i + 1].shipPoint,
      },
      ...rows.slice(i + 2),
    ]);
  const add = () =>
    onChange([...rows, { label: `งวดที่ ${startSeq + rows.length}`, percent: Math.max(0, Math.round((need - sum) * 100) / 100), shipPoint: false }]);

  return (
    <div className="space-y-2 text-xs">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-faint">
              <th className="w-8 text-left font-normal">งวด</th>
              <th className="text-left font-normal">ชื่องวด</th>
              <th className="w-16 text-right font-normal">%</th>
              <th className="w-24 text-right font-normal">ยอด (บาท)</th>
              {!sent && <th className="w-12 text-center font-normal" title="ส่งคลังเมื่อรับเงินงวดนี้">ส่งของ</th>}
              <th className="w-16" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-line">
                <td className="py-1 text-muted">{startSeq + i}</td>
                <td className="py-1 pr-1"><TextInput value={r.label} onChange={(e) => set(i, { label: e.target.value })} className="h-8 text-xs" /></td>
                <td className="py-1"><NumBox value={r.percent} blankZero onChange={(v) => set(i, { percent: v === "" ? 0 : v })} className="h-8 w-16 text-right text-xs" /></td>
                <td className={`py-1 text-right ${i === rows.length - 1 ? "text-muted" : ""}`} title={i === rows.length - 1 ? "งวดสุดท้ายรับยอดที่เหลือ (ไม่มีเศษสตางค์ตกหล่น)" : undefined}>
                  {fmt(amounts[i] ?? 0)}
                </td>
                {!sent && (
                  <td className="py-1 text-center">
                    <input
                      type="radio"
                      name={`ship-${startSeq}`}
                      checked={r.shipPoint}
                      onChange={() => set(i, { shipPoint: true })}
                      aria-label={`ส่งของเมื่อรับงวดที่ ${startSeq + i}`}
                    />
                  </td>
                )}
                <td className="py-1 text-right whitespace-nowrap">
                  {i < rows.length - 1 && (
                    <button type="button" onClick={() => mergeNext(i)} title="รวมกับงวดถัดไป" className="mr-1 rounded border border-line px-1.5 py-0.5 text-faint hover:text-ink">รวม</button>
                  )}
                  {rows.length > 1 && (
                    <button type="button" onClick={() => remove(i)} aria-label={`ลบงวดที่ ${startSeq + i}`} className="rounded border border-line px-1.5 py-0.5 text-faint hover:text-crit">✕</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={add} className="rounded border border-line px-2 py-1 text-muted hover:bg-raised hover:text-ink">+ เพิ่มงวด</button>
        {/* ส่วนที่ขาด/เกินบอกในบรรทัดเหลืองด้านล่าง (planError) — ไม่พูดซ้ำตรงนี้ */}
        <span className={Math.abs(sum - need) > 0.01 ? "font-semibold text-warn" : "text-faint"}>รวม {sum}%</span>
      </div>
      {!sent && !rows.some((r) => r.shipPoint) && (
        <p className="text-faint">ไม่ได้เลือกงวดส่งของ — ระบบส่งคลังเมื่อรับเงินครบทุกงวด หรือกด ส่งคลังตอนนี้ ที่หน้าจัดการออเดอร์</p>
      )}
      {err && <p className="text-warn">{err}</p>}
    </div>
  );
}
