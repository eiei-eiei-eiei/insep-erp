"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveDateFormatsAction } from "../actions";
import {
  DATE_FORMATS,
  DATE_FORMAT_LABEL,
  formatDate,
  formatDateTime,
  formatDayShort,
  formatMonth,
  type DateFormat,
  type DateFormats,
} from "@/lib/shared/dateFormat";
import { Card, Field, SaveButton, Select, useSaver } from "@/lib/shared/ui";

/**
 * รูปแบบวันที่ (D161) — หน้าจอกับเอกสารการค้าเลือกแยกกัน
 *
 * ★ ตัวอย่างเรียก **ตัวจัดรูปตัวเดียวกับที่หน้าจอใช้จริง** (lib/shared/dateFormat) ห้ามเขียนตัวอย่างเอง
 *   (ตัวอย่างที่ไม่ตรงของจริงแย่กว่าไม่มีตัวอย่าง — บทเรียนพรีวิวบิลบาร์ D96)
 * ★ "วันนี้" มาจาก server — SSR กับเบราว์เซอร์ได้ตัวอย่างเดียวกัน
 * ★ บอกตรง ๆ ว่าอะไร **ไม่** เปลี่ยนตามค่านี้ — ไม่งั้นผู้ใช้เปลี่ยนแล้วไปเจอฟอร์มราชการ
 *   ยังเป็นแบบเดิม แล้วสรุปว่าค่าตั้งเสีย
 */
export function DateFormatCard({
  current,
  todayISO,
  nowISO,
}: {
  current: DateFormats;
  todayISO: string;
  nowISO: string;
}) {
  const router = useRouter();
  const { pending, run } = useSaver();
  const [screen, setScreen] = useState<DateFormat>(current.screen);
  const [doc, setDoc] = useState<DateFormat>(current.doc);
  const dirty = screen !== current.screen || doc !== current.doc;

  function save() {
    run(() => saveDateFormatsAction({ screen, doc }), "บันทึกรูปแบบวันที่แล้ว", () => router.refresh());
  }

  const option = (f: DateFormat) => (
    <option key={f} value={f}>
      {formatDate(todayISO, f)} — {DATE_FORMAT_LABEL[f]}
    </option>
  );

  return (
    <Card title="รูปแบบวันที่">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Field label="บนหน้าจอ">
            <Select value={screen} onChange={(e) => setScreen(e.target.value as DateFormat)}>
              {DATE_FORMATS.map(option)}
            </Select>
          </Field>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-raised px-3 py-2 text-xs">
            <dt className="text-faint">วันที่</dt>
            <dd className="text-ink">{formatDate(todayISO, screen)}</dd>
            <dt className="text-faint">วันที่และเวลา</dt>
            <dd className="text-ink">{formatDateTime(nowISO, screen)}</dd>
            <dt className="text-faint">เดือน</dt>
            <dd className="text-ink">{formatMonth(todayISO, screen)}</dd>
            <dt className="text-faint">แบบสั้น (ไม่มีปี)</dt>
            <dd className="text-ink">{formatDayShort(todayISO, screen)}</dd>
          </dl>
        </div>
        <div>
          <Field label="บนเอกสารการค้า">
            <Select value={doc} onChange={(e) => setDoc(e.target.value as DateFormat)}>
              {DATE_FORMATS.map(option)}
            </Select>
          </Field>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-raised px-3 py-2 text-xs">
            <dt className="text-faint">วันที่บนเอกสาร</dt>
            <dd className="text-ink">{formatDate(todayISO, doc)}</dd>
          </dl>
          <p className="mt-2 text-xs text-faint">
            ใบเสนอราคา · ใบแจ้งหนี้ · ใบกำกับภาษี · ใบเสร็จ · ใบลดหนี้ · บิลบาร์ · สลิปเงินเดือน
          </p>
        </div>
      </div>

      <div className="mt-4">
        <SaveButton pending={pending} onClick={save} disabled={!dirty}>
          บันทึกรูปแบบวันที่
        </SaveButton>
        {dirty && (
          <p className="mt-2 text-xs text-warn">ยังไม่ได้บันทึก — กด บันทึกรูปแบบวันที่ ก่อน รูปแบบที่เลือกจึงจะมีผล</p>
        )}
      </div>

      <div className="mt-4 border-t border-line pt-3 text-xs text-faint">
        <p className="mb-1 font-medium text-muted">ที่ไม่เปลี่ยนตามค่านี้</p>
        <ul className="list-disc space-y-0.5 pl-5">
          <li>ฟอร์มราชการ (ภส. · ภพ.30 · ภงด. · 50ทวิ · สปส.) — ใช้รูปแบบตามแบบของกรม</li>
          <li>ไฟล์ส่งออก Excel/CSV และไฟล์สำรองข้อมูล — ใช้ ปี-เดือน-วัน ค.ศ. ให้โปรแกรมอื่นอ่านได้ถูก</li>
          <li>ช่องเลือกวันที่ตอนกรอก — แสดงตามภาษาและการตั้งค่าของเบราว์เซอร์/เครื่อง</li>
          <li>ข้อความเตือนใน LINE</li>
        </ul>
      </div>
    </Card>
  );
}
