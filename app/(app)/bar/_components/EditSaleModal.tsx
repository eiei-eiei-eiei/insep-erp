"use client";

import { useState } from "react";
import { Field, Modal, ModalCancel, TextInput, fmt } from "@/lib/shared/ui";
import { useDateFmt } from "@/lib/shared/dateFormatContext";
import { editMethodOptions, editSaleChanged, editSaleProblem } from "@/lib/bar/billDay";

/**
 * D163 — แก้บิลที่รับเงินแล้ว: **วันขาย** กับ **วิธีรับเงิน** เท่านั้น
 *
 * ★ ไม่ให้แก้รายการ (ผู้ใช้ตกลง) — รับเงินแล้วลูกค้าจ่ายราคานั้นไปแล้ว ส่วนกดรายการผิด
 *   ใช้ปุ่ม "ยกเลิกรายการ" ที่มีอยู่แล้ว
 * 🚨 ด่านจริงอยู่ใน `fn_bar_edit_sale` · ที่นี่บอกล่วงหน้าว่าทำไมบันทึกไม่ได้ (ปุ่มเทาต้องมีเหตุผล · D83)
 */
export function EditSaleModal({
  sale, today, posted, busy, onClose, onSave,
}: {
  sale: {
    sale_no: string;
    status: string;
    tab_name: string | null;
    business_date: string | null;
    method: string | null;
    closed_at: string | null;
    grand_total: number;
  };
  /** วันขายของวันนี้ (คิดด้วยรอบขาย) — เลือกเกินวันนี้ไม่ได้ */
  today: string;
  posted: ReadonlySet<string>;
  busy: boolean;
  onClose: () => void;
  onSave: (v: { businessDate: string; method: string }) => void;
}) {
  const df = useDateFmt();
  const [date, setDate] = useState(sale.business_date ?? today);
  const [method, setMethod] = useState(sale.method ?? "");

  const problem = editSaleProblem({
    status: sale.status,
    oldDate: sale.business_date,
    newDate: date,
    oldMethod: sale.method,
    newMethod: method,
    today,
    posted,
    fmtDate: df.date,
  });
  const changed = editSaleChanged({ oldDate: sale.business_date, newDate: date, oldMethod: sale.method, newMethod: method });

  return (
    <Modal
      title={<>แก้บิล {sale.tab_name || sale.sale_no}</>}
      onClose={onClose}
      busy={busy}
      size="md"
      footer={
        <>
          <ModalCancel onClick={onClose}>กลับ</ModalCancel>
          <button
            type="button"
            disabled={busy || Boolean(problem) || !changed}
            onClick={() => onSave({ businessDate: date, method })}
            className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-on-brand disabled:opacity-50"
          >
            บันทึก
          </button>
        </>
      }
    >
      <div>
        <p className="mb-4 text-sm text-muted">
          {sale.sale_no} · ยอด {fmt(sale.grand_total)} บาท
          {sale.closed_at && <> · กดรับเงินเมื่อ {df.dateTime(sale.closed_at)}</>}
        </p>

        <Field label="วันขาย (ยอดของบิลนี้นับเข้าวันไหน)">
          <TextInput type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {/* ★ ช่องนี้ติดด่านอยู่ = จะไม่ย้าย · ห้ามขึ้นประโยค "จะย้าย" คู่กับเหตุผลที่บอกว่าย้ายไม่ได้ */}
        {sale.business_date && date !== sale.business_date && !problem && (
          <p className="mt-1 text-xs text-muted">
            ยอด {fmt(sale.grand_total)} บาท จะย้ายจากวัน {df.date(sale.business_date)} ไปวัน {df.date(date)}
          </p>
        )}

        <div className="mb-1 mt-4 text-sm text-muted">รับเงินด้วย</div>
        <div className="grid grid-cols-2 gap-2">
          {editMethodOptions(sale.method).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              className={`rounded-lg px-3 py-2 text-sm ${
                method === m ? "bg-brand text-on-brand" : "border border-line bg-card text-ink"
              }`}
            >
              {m}
              {m === sale.method && <span className="block text-xs opacity-80">ค่าเดิม</span>}
            </button>
          ))}
        </div>

        <p className="mt-4 text-xs text-faint">
          แก้รายการในบิลไม่ได้ — ถ้ากดรายการผิด ใช้ปุ่ม ยกเลิกรายการ หรือยกเลิกทั้งบิลแล้วเปิดใหม่ ·
          เวลาบนใบเสร็จยังเป็นเวลาที่กดรับเงินจริง · ระบบเก็บค่าเดิมไว้ในประวัติการแก้ไข (เจ้าของกิจการดูได้ที่ ตั้งค่า)
        </p>
        {problem && <p className="mt-2 text-sm text-warn">{problem}</p>}

        {!problem && !changed && (
          <p className="mt-1 text-xs text-muted">ยังไม่ได้เปลี่ยนวันขายหรือวิธีรับเงิน</p>
        )}
      </div>
    </Modal>
  );
}
