"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { saveCompanyDocAction } from "../actions";
import type { Entity } from "./types";
import { Card, Field, Msg, SaveButton, Select, TextArea, TextInput, useSaver } from "./ui";
import { companyFromEntity } from "@/lib/sales/company";
import { companyHeaderPreviewHtml } from "../../sales/_components/print";

/**
 * ข้อมูลผู้ขายบนเอกสารการค้า (D44)
 *
 * เดิมชื่อบริษัท/ที่อยู่/เลขภาษี/เลขบัญชีธนาคาร ถูกฝังไว้ในโค้ด → ลูกค้ารายอื่นพิมพ์
 * ใบกำกับภาษีออกมาเป็นชื่อ + บัญชีธนาคารของโรงแรก (เงินเข้าผิดบัญชี · ใบกำกับผิดนิติบุคคล)
 * ตอนนี้อ่านจากตาราง `entities` — ตารางเดียวกับที่ฟอร์มราชการ (ภพ.30/ภงด./50ทวิ/ภส.) ใช้อยู่แล้ว
 *
 * ★ ตัวอย่างด้านล่างเป็น "หัวกระดาษจริง" (เรียกฟังก์ชันเดียวกับตอนพิมพ์) — เห็นอย่างไรได้อย่างนั้น
 */
export function CompanyDocCard({ entities, docEntityId }: { entities: Entity[]; docEntityId: string }) {
  const router = useRouter();
  const { pending, msg, run } = useSaver();

  const initialId = docEntityId || (entities.length === 1 ? entities[0].entity_id : "");
  const [entityId, setEntityId] = useState(initialId);
  const [form, setForm] = useState(() => toForm(entities.find((e) => e.entity_id === initialId)));

  const preview = useMemo(
    () =>
      companyHeaderPreviewHtml(
        companyFromEntity({
          name: form.name,
          name_eng: form.nameEng,
          tax_id: form.taxId,
          branch: form.branch,
          address: form.address,
          phone: form.phone,
          bank_line: form.bankLine,
        }),
      ),
    [form],
  );

  function pickEntity(id: string) {
    setEntityId(id);
    setForm(toForm(entities.find((e) => e.entity_id === id)));
  }
  const set = (k: keyof FormState) => (e: { target: { value: string } }) => setForm((p) => ({ ...p, [k]: e.target.value }));

  function save() {
    run(() => saveCompanyDocAction({ entityId, ...form }), "บันทึกข้อมูลบนเอกสารแล้ว", () => router.refresh());
  }

  return (
    <Card title="ข้อมูลบนเอกสารการค้า">
      <p className="mb-3 text-xs text-faint">
        ค่าชุดนี้ขึ้นหัวใบเสนอราคา / ใบแจ้งหนี้ / ใบกำกับภาษี / ใบเสร็จรับเงิน — เป็นข้อมูลเดียวกับที่ฟอร์มราชการใช้
        (แก้ที่นี่ที่เดียว หัวเอกสารทั้งระบบตรงกัน)
      </p>
      <Msg msg={msg} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="กิจการที่ใช้ออกเอกสาร">
          <Select value={entityId} onChange={(e) => pickEntity(e.target.value)}>
            <option value="">— เลือกกิจการ —</option>
            {entities.map((en) => (
              <option key={en.entity_id} value={en.entity_id}>
                {en.entity_id} — {en.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="สาขา (ขึ้นในวงเล็บหน้าที่อยู่)">
          <TextInput value={form.branch} onChange={set("branch")} placeholder="สำนักงานใหญ่ หรือเลขสาขา เช่น 00002" />
        </Field>
        <Field label="ชื่อกิจการ (ไทย)">
          <TextInput value={form.name} onChange={set("name")} placeholder="เช่น บริษัท ตัวอย่าง จำกัด" />
        </Field>
        <Field label="ชื่อกิจการ (อังกฤษ · ไม่ใส่ = ไม่ขึ้นบรรทัดนี้)">
          <TextInput value={form.nameEng} onChange={set("nameEng")} placeholder="EXAMPLE CO.,LTD." />
        </Field>
        <div className="sm:col-span-2">
          <Field label="ที่อยู่ (ไม่ต้องใส่สาขา — ระบบเติมวงเล็บให้เอง)">
            <TextInput value={form.address} onChange={set("address")} placeholder="5/15 ม.8 ต.… อ.… จ.… 60130" />
          </Field>
        </div>
        <Field label="เลขประจำตัวผู้เสียภาษี">
          <TextInput value={form.taxId} onChange={set("taxId")} placeholder="13 หลัก" />
        </Field>
        <Field label="เบอร์โทร (ไม่ใส่ = ไม่ขึ้นท้ายบรรทัดเลขภาษี)">
          <TextInput value={form.phone} onChange={set("phone")} placeholder="0X-XXX-XXXX" />
        </Field>
        <div className="sm:col-span-2">
          <Field label="ช่องทางการโอนเงิน (ขึ้นบรรทัดใหม่ได้ · ไม่ใส่ = ไม่ขึ้นกล่องนี้บนเอกสาร)">
            <TextArea
              value={form.bankLine}
              onChange={set("bankLine")}
              rows={2}
              placeholder={"ธนาคาร… เลขที่บัญชี …\nชื่อบัญชี …"}
            />
          </Field>
        </div>
      </div>

      <div className="mt-4">
        <span className="mb-1 block text-xs font-medium tracking-wide text-muted">ตัวอย่างหัวกระดาษจริง</span>
        {/* พื้นขาวตายตัวโดยตั้งใจ (ไม่ใช้ token ธีม) — นี่คือกระดาษ ไม่ใช่หน้าจอแอป */}
        <div className="overflow-x-auto rounded border border-line" style={{ background: "#fff" }}>
          <div className="min-w-[560px]" dangerouslySetInnerHTML={{ __html: preview }} />
        </div>
        <p className="mt-1 text-xs text-faint">
          กล่องนี้พื้นขาวเสมอ (เอกสารพิมพ์ลงกระดาษ ไม่ตามธีมแอป) · ถ้าเห็นสาขาซ้ำสองที่ ให้ลบคำว่าสาขา/สำนักงานใหญ่ออกจากช่องที่อยู่
        </p>
      </div>

      <div className="mt-4">
        <SaveButton pending={pending} onClick={save} disabled={!entityId || !form.name.trim()}>
          บันทึกข้อมูลบนเอกสาร
        </SaveButton>
      </div>
    </Card>
  );
}

type FormState = { name: string; nameEng: string; taxId: string; branch: string; address: string; phone: string; bankLine: string };

function toForm(e: Entity | undefined): FormState {
  return {
    name: e?.name ?? "",
    nameEng: e?.name_eng ?? "",
    taxId: e?.tax_id ?? "",
    branch: e?.branch ?? "",
    address: e?.address ?? "",
    phone: e?.phone ?? "",
    bankLine: e?.bank_line ?? "",
  };
}
