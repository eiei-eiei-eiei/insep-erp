"use client";
import { IconCheck, IconSquare } from "@/lib/shared/icons";
import { formatDateThai } from "@/lib/shared/format";

/**
 * FLOW sec 6 — "เดือนนี้สร้างรายงานครบยัง"
 * อ่านจาก report_runs ที่ระบบเขียนอยู่แล้วตอนกดสร้างรายงาน (ไม่ได้เพิ่มการบันทึกใหม่)
 * ใช้ร่วม 2 ที่: แท็บเอกสารสรรพากร (บัญชี) และหน้ารายงาน ภส. (/reports)
 */
/**
 * `due` = กำหนดยื่น (ISO) — ใส่เฉพาะรายงานที่มีวันครบกำหนดตามกฎหมายจริง (D88)
 * ไม่ใส่ = แสดงเหมือนเดิมทุกอย่าง (หน้ารายงาน ภส. ไม่มีกำหนดรายเดือนแบบนี้)
 */
export type ChecklistItem = { key: string; label: string; due?: string };

export function ReportChecklist({
  title = "เช็กลิสต์รายงานของเดือนนี้",
  month,
  items,
  runs,
  note,
  today,
}: {
  title?: string;
  month: string;
  items: ChecklistItem[];
  runs: Record<string, string>; // report_key → วันที่สร้างล่าสุด (yyyy-MM-dd)
  note?: string;
  /** วันนี้ (ISO) — ส่งมาจากผู้เรียกเพื่อให้เทียบกำหนดยื่นได้ */
  today?: string;
}) {
  const doneCount = items.filter((i) => runs[i.key]).length;
  const allDone = doneCount === items.length && items.length > 0;

  return (
    <div className="rounded-lg border border-line bg-card p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="font-semibold text-ink">{title}</h3>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${allDone ? "bg-ok-bg text-ok" : "bg-warn-bg text-warn"}`}>
          {doneCount}/{items.length} {allDone ? "ครบแล้ว" : "ยังไม่ครบ"}
        </span>
        <span className="text-xs text-faint">เดือน {month}</span>
      </div>
      <ul className="space-y-1 text-sm">
        {items.map((i) => {
          const at = runs[i.key];
          return (
            <li key={i.key} className="flex flex-wrap items-center gap-2">
              <span className={at ? "text-ok" : "text-faint"}>{at ? <IconCheck size={15} /> : <IconSquare size={15} />}</span>
              <span className={at ? "text-muted" : "text-faint"}>{i.label}</span>
              {at ? (
                <span className="text-xs text-faint">— สร้างล่าสุด {at}</span>
              ) : (
                <span className="text-xs text-warn">— ยังไม่ได้สร้าง</span>
              )}
              {/* กำหนดยื่นตามกฎหมาย — เลยกำหนดแล้วยังไม่สร้าง = แดง (D88) */}
              {i.due && (
                <span className={!at && today && today > i.due ? "text-xs font-medium text-crit" : "text-xs text-faint"}>
                  {!at && today && today > i.due ? "⚠ เลยกำหนดยื่นแล้ว" : "ครบกำหนดยื่น"} {formatDateThai(i.due)}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-faint">
        {note ?? "ติ๊กอัตโนมัติเมื่อกดปุ่มสร้างรายงานในหน้านี้ (ไม่ได้เช็กว่ายื่นแล้วหรือยัง)"}
      </p>
    </div>
  );
}
