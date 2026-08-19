"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { saveEntityInfoAction, saveDocEntityAction } from "../actions";
import type { SettingsEntity } from "../settings-data";
import { Card, Field, Msg, SaveButton, Select, TextArea, TextInput, useSaver } from "@/lib/shared/ui";
import { companyFromEntity } from "@/lib/sales/company";
import { companyHeaderPreviewHtml } from "../../sales/_components/print";

/**
 * ข้อมูลกิจการ — ขึ้นหัวเอกสารการค้า (D44) + เลขทะเบียนสรรพสามิตที่ขึ้นหัวฟอร์ม ภส. (D64)
 *
 * เดิมชื่อบริษัท/ที่อยู่/เลขภาษี/เลขบัญชีธนาคาร ถูกฝังไว้ในโค้ด → ลูกค้ารายอื่นพิมพ์
 * ใบกำกับภาษีออกมาเป็นชื่อ + บัญชีธนาคารของโรงแรก (เงินเข้าผิดบัญชี · ใบกำกับผิดนิติบุคคล)
 * ตอนนี้อ่านจากตาราง `entities` — ตารางเดียวกับที่ฟอร์มราชการ (ภพ.30/ภงด./50ทวิ/ภส.) ใช้อยู่แล้ว
 *
 * 🪤 **ตัวเลือกกิจการมี 2 ตัว และต้องแยกกันเสมอ**
 *    - "กิจการที่กำลังแก้" → เขียนลงแถว `entities` ของกิจการนั้น
 *    - "กิจการที่ออกเอกสารการค้า" → เขียน `app_settings.sales_doc_entity`
 *    ของเดิมใช้ตัวเดียวทำสองหน้าที่ · พอมีเหตุให้เข้าไปแก้กิจการที่ 2 (เช่นกรอกเลขสรรพสามิต
 *    ของโรงที่สอง) การกดบันทึกจะย้ายกิจการที่ออกใบกำกับภาษีไปด้วยแบบเงียบ ๆ
 *
 * ★ ตัวอย่างด้านล่างเป็น "หัวกระดาษจริง" (เรียกฟังก์ชันเดียวกับตอนพิมพ์) — เห็นอย่างไรได้อย่างนั้น
 */
export function CompanyCard({
  entities,
  docEntityId,
}: {
  entities: SettingsEntity[];
  docEntityId: string;
}) {
  const router = useRouter();
  const { pending, msg, run } = useSaver();
  const doc = useSaver();

  const multiEntity = entities.length > 1;
  const initialId = docEntityId || entities[0]?.entity_id || "";
  const [entityId, setEntityId] = useState(initialId);
  const [form, setForm] = useState(() => toForm(entities.find((e) => e.entity_id === initialId)));
  const [docId, setDocId] = useState(docEntityId);

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

  // เลขสรรพสามิตพิมพ์ลงฟอร์มแบบแยกช่อง 13-1-3 (17 ตัวเลข) — ขีดคั่นไม่นับ
  const exciseDigits = form.exciseId.replace(/\D/g, "");
  const exciseWarn = form.exciseId.trim() !== "" && exciseDigits.length !== 17;

  function pickEntity(id: string) {
    setEntityId(id);
    setForm(toForm(entities.find((e) => e.entity_id === id)));
  }
  const set = (k: keyof FormState) => (e: { target: { value: string } }) => setForm((p) => ({ ...p, [k]: e.target.value }));

  function save() {
    run(() => saveEntityInfoAction({ entityId, ...form }), "บันทึกข้อมูลกิจการแล้ว", () => router.refresh());
  }
  function saveDoc() {
    doc.run(() => saveDocEntityAction(docId), "ตั้งกิจการที่ออกเอกสารแล้ว", () => router.refresh());
  }

  return (
    <div className="space-y-4">
      <Card title="ข้อมูลกิจการ">
        <p className="mb-3 text-xs text-faint">
          ค่าชุดนี้ขึ้นหัวใบเสนอราคา / ใบแจ้งหนี้ / ใบกำกับภาษี / ใบเสร็จรับเงิน และหัวฟอร์มราชการ
          (แก้ที่นี่ที่เดียว เอกสารทั้งระบบตรงกัน)
        </p>
        <Msg msg={msg} />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {multiEntity && (
            <div className="sm:col-span-2">
              <Field label="กิจการที่กำลังแก้">
                <Select value={entityId} onChange={(e) => pickEntity(e.target.value)}>
                  <option value="">— เลือกกิจการ —</option>
                  {entities.map((en) => (
                    <option key={en.entity_id} value={en.entity_id}>
                      {en.entity_id} — {en.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}
          <Field label="ชื่อกิจการ (ไทย)">
            <TextInput value={form.name} onChange={set("name")} placeholder="เช่น บริษัท ตัวอย่าง จำกัด" />
          </Field>
          <Field label="สาขา (ขึ้นในวงเล็บหน้าที่อยู่)">
            <TextInput value={form.branch} onChange={set("branch")} placeholder="สำนักงานใหญ่ หรือเลขสาขา เช่น 00002" />
          </Field>
          <Field label="ชื่อกิจการ (อังกฤษ · ไม่ใส่ = ไม่ขึ้นบรรทัดนี้)">
            <TextInput value={form.nameEng} onChange={set("nameEng")} placeholder="EXAMPLE CO.,LTD." />
          </Field>
          <Field label="เลขประจำตัวผู้เสียภาษี">
            <TextInput value={form.taxId} onChange={set("taxId")} placeholder="13 หลัก" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="ที่อยู่ (ไม่ต้องใส่สาขา — ระบบเติมวงเล็บให้เอง)">
              <TextInput value={form.address} onChange={set("address")} placeholder="5/15 ม.8 ต.… อ.… จ.… 60130" />
            </Field>
          </div>
          <Field label="เบอร์โทร (ไม่ใส่ = ไม่ขึ้นท้ายบรรทัดเลขภาษี)">
            <TextInput value={form.phone} onChange={set("phone")} placeholder="0X-XXX-XXXX" />
          </Field>
          <Field label="เลขทะเบียนสรรพสามิต (ขึ้นหัวฟอร์ม ภส.)">
            <TextInput value={form.exciseId} onChange={set("exciseId")} placeholder="เช่น 0605567002178-1-001" />
            <span className={`mt-1 block text-xs ${exciseWarn ? "text-warn" : "text-faint"}`}>
              {exciseWarn
                ? `นับตัวเลขได้ ${exciseDigits.length} ตัว — ฟอร์ม ภส. มีช่อง 17 ตัว (13-1-3) ตรวจอีกครั้งก่อนยื่น`
                : "พิมพ์ขีดคั่นได้ตามใบจริง — ระบบแยกลงช่อง 13-1-3 (17 ตัวเลข) ให้เอง"}
            </span>
          </Field>
          <Field label="เลขที่บัญชีนายจ้าง ประกันสังคม (ขึ้นหัว สปส.1-10)">
            <TextInput
              value={form.ssoEmployerNo}
              onChange={set("ssoEmployerNo")}
              placeholder="10 หลักตามที่ สปส. ออกให้"
            />
            <span className="mt-1 block text-xs text-faint">
              ไม่กรอก = ใช้เลขประจำตัวผู้เสียภาษีแทน (เหมือนที่เคยทำมา) —
              แต่เลขนี้เป็นคนละตัวกัน ถ้ามีใบของ สปส. อยู่ ควรกรอกให้ตรง
            </span>
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
            บันทึกข้อมูลกิจการ
          </SaveButton>
        </div>
      </Card>

      {multiEntity && (
        <Card title="กิจการที่ออกเอกสารการค้า">
          <p className="mb-3 text-xs text-faint">
            ใบเสนอราคา / ใบแจ้งหนี้ / ใบกำกับภาษี / ใบเสร็จ จะออกในนามกิจการนี้ — แยกจากช่อง
            &ldquo;กิจการที่กำลังแก้&rdquo; ด้านบนโดยตั้งใจ (แก้ข้อมูลอีกกิจการแล้วต้องไม่ย้ายผู้ออกเอกสารตาม)
          </p>
          <Msg msg={doc.msg} />
          <div className="flex flex-wrap items-end gap-3">
            <Field label="ผู้ออกเอกสาร">
              <Select value={docId} onChange={(e) => setDocId(e.target.value)}>
                <option value="">— เลือกกิจการ —</option>
                {entities.map((en) => (
                  <option key={en.entity_id} value={en.entity_id}>
                    {en.entity_id} — {en.name}
                  </option>
                ))}
              </Select>
            </Field>
            <SaveButton pending={doc.pending} onClick={saveDoc} disabled={!docId}>
              บันทึกผู้ออกเอกสาร
            </SaveButton>
          </div>
        </Card>
      )}
    </div>
  );
}

type FormState = {
  name: string;
  nameEng: string;
  taxId: string;
  branch: string;
  address: string;
  phone: string;
  bankLine: string;
  exciseId: string;
  ssoEmployerNo: string;
};

function toForm(e: SettingsEntity | undefined): FormState {
  return {
    name: e?.name ?? "",
    nameEng: e?.name_eng ?? "",
    taxId: e?.tax_id ?? "",
    branch: e?.branch ?? "",
    address: e?.address ?? "",
    phone: e?.phone ?? "",
    bankLine: e?.bank_line ?? "",
    exciseId: e?.excise_id ?? "",
    ssoEmployerNo: e?.sso_employer_no ?? "",
  };
}
