"use client";

import { useState } from "react";
import { correctAbvTo20C } from "@/lib/abv";
import { Card, Field, NumInput, RowBtn } from "./ui";

/**
 * เครื่องคิดเลขดีกรี@20°C แบบลอย ๆ — ไม่ผูก batch/ล็อต ไม่บันทึกอะไรลง DB
 * ★ ใช้ correctAbvTo20C ตัวเดียวกับแท็บกลั่น/กลั่นซ้ำ (ห้ามเขียนสูตรชุดที่สอง)
 * นอกช่วงตาราง (อุณหภูมิ 0–40°C) ฟังก์ชันคืน null → บอกผู้ใช้ตรง ๆ ไม่เดาค่า
 */
export function AbvCalcCard({ onUse }: { onUse?: (abv20: string) => void }) {
  const [abvObs, setAbvObs] = useState("");
  const [temp, setTemp] = useState("");
  const filled = abvObs !== "" && temp !== "";
  const abv20 = filled ? correctAbvTo20C(abvObs, temp) : null;

  return (
    <Card title="เครื่องคิดเลขดีกรี@20°C (ปรับตามอุณหภูมิ)">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="ดีกรีที่อ่าน (%)">
          <NumInput value={abvObs} onChange={(e) => setAbvObs(e.target.value)} />
        </Field>
        <Field label="อุณหภูมิสุรา (°C)">
          <NumInput value={temp} onChange={(e) => setTemp(e.target.value)} />
        </Field>
        <Field label="ดีกรี@20°C (คำนวณ)">
          <div className="rounded-lg border border-line bg-raised px-3 py-2 text-muted">
            {!filled ? "—" : abv20 === null ? "นอกช่วงตาราง" : <b className="text-ink">{abv20.toFixed(2)}</b>}
          </div>
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {onUse && (
          <RowBtn onClick={() => abv20 !== null && onUse(abv20.toFixed(2))} disabled={abv20 === null}
            title={abv20 === null ? "กรอกดีกรีที่อ่านและอุณหภูมิก่อน" : "เติมค่านี้ลงช่อง ดีกรีตั้งต้น C1 ด้านล่าง"}>
            ใช้เป็นดีกรีตั้งต้น C1
          </RowBtn>
        )}
        <p className="text-xs text-faint">
          ใช้ตารางเดียวกับแท็บกลั่น · อุณหภูมิ 0–40°C · ดีกรี 0–100% · คำนวณอย่างเดียว ไม่บันทึกลงระบบ
        </p>
      </div>
    </Card>
  );
}
