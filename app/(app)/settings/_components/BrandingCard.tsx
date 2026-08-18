"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveBrandingAction } from "../actions";
import { BRAND_COLORS, type BrandColor, type ColorMode } from "@/lib/shared/branding";
import { Card, Field, Msg, SaveButton, Select, TextInput, useSaver } from "@/lib/shared/ui";

/**
 * ตั้งค่าแบรนด์ของกิจการ (D43) — ชื่อ/สี/โลโก้/โหมดเริ่มต้น
 * ค่าเก็บใน app_settings ของกิจการนี้ → อัปเดตแอปกี่รอบก็ไม่หาย
 *
 * ★ สีสถานะ (เขียว/เหลือง/แดง) ไม่มีให้ตั้งโดยตั้งใจ — ต้องแปลเหมือนกันทุกกิจการ
 */
export function BrandingCard({
  current,
}: {
  current: { name: string; color: BrandColor; logoUrl: string | null; defaultMode: ColorMode };
}) {
  const router = useRouter();
  const { pending, msg, run } = useSaver();
  const [name, setName] = useState(current.name);
  const [color, setColor] = useState<BrandColor>(current.color);
  const [logoUrl, setLogoUrl] = useState(current.logoUrl ?? "");
  const [mode, setMode] = useState<ColorMode>(current.defaultMode);

  function save() {
    run(
      () => saveBrandingAction({ name: name.trim(), color, logoUrl: logoUrl.trim(), defaultMode: mode }),
      "บันทึกแบรนด์แล้ว",
      () => router.refresh(),
    );
  }

  return (
    <Card title="แบรนด์ของกิจการ">
      <Msg msg={msg} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="ชื่อที่แสดงบนแถบเมนู">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น โรงกลั่นอินเสพ" />
        </Field>
        <Field label="โหมดเริ่มต้นเมื่อเปิดแอปครั้งแรก">
          <Select value={mode} onChange={(e) => setMode(e.target.value as ColorMode)}>
            <option value="light">สว่าง</option>
            <option value="dark">มืด</option>
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <span className="mb-1 block text-xs font-medium tracking-wide text-muted">สีแบรนด์</span>
          <div className="flex flex-wrap gap-2">
            {BRAND_COLORS.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setColor(c.key)}
                aria-pressed={color === c.key}
                className={`flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition ${
                  color === c.key ? "border-ink font-semibold text-ink" : "border-line text-muted hover:bg-raised"
                }`}
              >
                <span className="h-4 w-4 shrink-0 rounded-full border border-line" style={{ background: c.swatch }} />
                {c.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-faint">
            แต่ละสีมีค่าคู่ สว่าง/มืด ที่ตรวจแล้วว่าอ่านออกทั้งสองโหมด — จึงเลือกจากลิสต์ ไม่ใช่กรอกรหัสสีเอง
          </p>
        </div>
        <div className="sm:col-span-2">
          <Field label="ลิงก์โลโก้ (ไม่ใส่ = ใช้ตัวอักษรแรกของชื่อ)">
            <TextInput value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://… (.svg หรือ .png พื้นโปร่ง)" />
          </Field>
        </div>
      </div>
      <div className="mt-4">
        <SaveButton pending={pending} onClick={save} disabled={!name.trim()}>
          บันทึกแบรนด์
        </SaveButton>
      </div>
      <p className="mt-2 text-xs text-faint">
        สีสถานะ (เขียว = ปกติ · เหลือง = ค้าง · แดง = ผิดพลาด) ตั้งค่าไม่ได้โดยตั้งใจ —
        ต้องแปลเหมือนกันทุกกิจการเวลาสอนงานหรือแก้ปัญหาทางโทรศัพท์
      </p>
    </Card>
  );
}
