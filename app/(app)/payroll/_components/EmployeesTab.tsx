"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Field, Msg, NumBox, SaveButton, Select, TextInput, useSaver, Empty } from "@/lib/shared/ui";
import { saveEmployeeAction } from "../actions";
import type { EmployeeRow } from "../data";
import type { PayrollConfig } from "./PayrollApp";

const WAGE_LABEL: Record<string, string> = {
  monthly: "รายเดือน (เต็มจำนวน)",
  monthly_prorate: "รายเดือน (ลดตามวันมาทำงาน)",
  daily: "รายวัน",
};

const WHT_LABEL: Record<string, string> = {
  none: "ไม่หัก",
  fixed: "หักยอดคงที่",
  auto: "คำนวณอัตโนมัติ",
};

function blank(): Partial<EmployeeRow> {
  return { name: "", wageType: "monthly", baseWage: 0, whtMode: "none", active: true, ssoExempt: false };
}

export function EmployeesTab({ config, initial }: { config: PayrollConfig; initial: EmployeeRow[] }) {
  const router = useRouter();
  const { pending, msg, run } = useSaver();
  const [edit, setEdit] = useState<Partial<EmployeeRow> | null>(null);
  const [q, setQ] = useState("");

  // 🪤 เก็บรายชื่อเป็น state แล้วอัปเดตทันทีหลังบันทึก
  //    เดิมอ่านจาก prop ตรง ๆ + พึ่ง router.refresh() อย่างเดียว → คนที่เพิ่งเพิ่มไม่ขึ้นในลิสต์
  //    (แท็บถูก mount ค้างไว้ด้วย CSS ตามแพตเทิร์นของทุก workspace → prop มาช้ากว่าที่ผู้ใช้คาด)
  //    แพตเทิร์นเดียวกับการ์ดคู่ค้าในแท็บตั้งค่าของบัญชี
  const [rowsAll, setRowsAll] = useState<EmployeeRow[]>(initial);
  useEffect(() => { setRowsAll(initial); }, [initial]);

  const rows = rowsAll.filter((e) => !q || e.name.toLowerCase().includes(q.toLowerCase()));

  function save() {
    if (!edit) return;
    const draft = edit;
    run(() => saveEmployeeAction(draft), "บันทึกพนักงานแล้ว", (data) => {
      const empId = (data as { empId?: string } | undefined)?.empId ?? draft.empId ?? "";
      const saved = { ...draft, empId } as EmployeeRow;
      setRowsAll((prev) =>
        prev.some((e) => e.empId === empId)
          ? prev.map((e) => (e.empId === empId ? { ...e, ...saved } : e))
          : [...prev, saved],
      );
      setEdit(null);
      router.refresh();   // ให้ฝั่ง server ตามมาให้ตรงกัน (แท็บงวดจ่ายใช้ลิสต์เดียวกัน)
    });
  }

  const set = <K extends keyof EmployeeRow>(k: K, v: EmployeeRow[K]) =>
    setEdit((p) => (p ? { ...p, [k]: v } : p));

  return (
    <div className="space-y-4">
      <Card title={`พนักงาน (${rowsAll.length})`}>
        <div className="mb-3 flex items-center gap-2">
          <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นชื่อพนักงาน…" />
          <button
            onClick={() => setEdit(blank())}
            className="whitespace-nowrap rounded-lg bg-brand px-4 py-2 text-sm text-on-brand"
          >
            + เพิ่มพนักงาน
          </button>
        </div>
        <Msg msg={msg} />

        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr className="text-left text-faint">
                <th>รหัส</th><th>ชื่อ-สกุล</th><th>กลุ่ม</th><th>วิธีคิดค่าจ้าง</th>
                <th className="num">ค่าจ้าง</th><th>ภาษี</th><th>สถานะ</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.empId}>
                  <td>{e.empId}</td>
                  <td>{e.name}</td>
                  <td>{e.groupCode ?? "—"}</td>
                  <td>{WAGE_LABEL[e.wageType]}</td>
                  <td className="num">{e.baseWage.toLocaleString()}</td>
                  <td>{WHT_LABEL[e.whtMode]}</td>
                  <td>{e.active ? "ทำงานอยู่" : "พ้นสภาพ"}</td>
                  <td>
                    <button onClick={() => setEdit(e)} className="text-muted hover:underline">แก้</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <Empty />}
        </div>
        <p className="mt-2 text-xs text-faint">
          ★ ลบพนักงานไม่ได้โดยตั้งใจ — มีประวัติเงินเดือนผูกอยู่ · คนที่ออกแล้วให้ตั้งเป็น &ldquo;พ้นสภาพ&rdquo;
          (งวดใหม่จะไม่ดึงมา แต่งวดเก่ายังอยู่ครบ)
        </p>
      </Card>

      {edit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/30 p-4" onClick={() => setEdit(null)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-card p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 font-semibold text-ink">{edit.empId ? `แก้ไข ${edit.empId}` : "เพิ่มพนักงาน"}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="ชื่อ-สกุล">
                <TextInput value={edit.name ?? ""} onChange={(e) => set("name", e.target.value)} />
              </Field>
              <Field label="กลุ่มพนักงาน (ใช้คุมว่าได้รายการไหนบ้าง)">
                <Select value={edit.groupCode ?? ""} onChange={(e) => set("groupCode", e.target.value || null)}>
                  <option value="">— ไม่ระบุ (ได้เฉพาะรายการที่ให้ทุกคน) —</option>
                  {config.groups.map((g) => <option key={g} value={g}>{g}</option>)}
                </Select>
              </Field>
              <Field label="วิธีคิดค่าจ้าง">
                <Select value={edit.wageType ?? "monthly"} onChange={(e) => set("wageType", e.target.value as EmployeeRow["wageType"])}>
                  {Object.entries(WAGE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              <Field label={edit.wageType === "daily" ? "ค่าแรงต่อวัน" : "เงินเดือน"}>
                <NumBox value={edit.baseWage ?? 0} blankZero onChange={(v) => set("baseWage", v === "" ? 0 : v)} />
              </Field>
              <Field label="เลขประจำตัวประชาชน">
                <TextInput value={edit.nationalId ?? ""} onChange={(e) => set("nationalId", e.target.value)} placeholder="13 หลัก" />
              </Field>
              <Field label="เลขประกันสังคม">
                <TextInput value={edit.ssoNo ?? ""} onChange={(e) => set("ssoNo", e.target.value)} />
              </Field>
              <Field label="ธนาคาร">
                <TextInput value={edit.bankName ?? ""} onChange={(e) => set("bankName", e.target.value)} />
              </Field>
              <Field label="เลขที่บัญชี">
                <TextInput value={edit.bankAcct ?? ""} onChange={(e) => set("bankAcct", e.target.value)} />
              </Field>
              <Field label="วันเริ่มงาน">
                <TextInput type="date" value={edit.startDate ?? ""} onChange={(e) => set("startDate", e.target.value)} />
              </Field>
              <Field label="วันพ้นสภาพ">
                <TextInput type="date" value={edit.endDate ?? ""} onChange={(e) => set("endDate", e.target.value)} />
              </Field>
              <Field label="ภาษีหัก ณ ที่จ่าย">
                <Select value={edit.whtMode ?? "none"} onChange={(e) => set("whtMode", e.target.value as EmployeeRow["whtMode"])}>
                  {Object.entries(WHT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              {edit.whtMode === "fixed" && (
                <Field label="ยอดภาษีคงที่ต่องวด">
                  <NumBox value={edit.whtFixed ?? 0} blankZero onChange={(v) => set("whtFixed", v === "" ? 0 : v)} />
                </Field>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={edit.ssoExempt ?? false} onChange={(e) => set("ssoExempt", e.target.checked)} />
                ยกเว้นประกันสังคม
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={edit.active ?? true} onChange={(e) => set("active", e.target.checked)} />
                ยังทำงานอยู่
              </label>
            </div>

            {edit.whtMode === "auto" && (
              <p className="mt-3 rounded-lg bg-raised px-3 py-2 text-xs text-muted">
                คำนวณอัตโนมัติใช้วิธีประมาณการทั้งปีจาก<b>ค่าจ้างประจำ</b> แล้วเฉลี่ยลงแต่ละงวด —
                ยังไม่รวม OT/โบนัสที่ยังไม่เกิด (ปกติของวิธีนี้ · ส่วนต่างไปจบตอนลูกจ้างยื่นภาษีเอง) ·
                ค่าลดหย่อนรายคนกรอกได้ในรอบถัดไป ตอนนี้ใช้ค่าลดหย่อนส่วนตัวจากชุดอัตรา
              </p>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setEdit(null)} className="rounded-lg border border-line px-4 py-2 text-sm">ยกเลิก</button>
              <SaveButton pending={pending} onClick={save}>บันทึก</SaveButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
