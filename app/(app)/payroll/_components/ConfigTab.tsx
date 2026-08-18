"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Field, Msg, NumBox, SaveButton, Select, TextInput, useSaver, Empty } from "@/lib/shared/ui";
import type { PayComponent, PayRates } from "@/lib/payroll/types";
import {
  addPayGroupAction,
  deletePayGroupAction,
  savePayInputAction,
  deletePayInputAction,
  savePayComponentAction,
  deletePayComponentAction,
  savePayRatesAction,
  savePayrollSettingAction,
} from "../actions";
import type { PayrollConfig } from "./PayrollApp";

/**
 * แท็บตั้งค่าการคำนวณ — ที่ที่ลูกค้า "อธิบายเกณฑ์ของโรงตัวเอง" ให้ระบบฟัง
 * ระบบไม่รู้จักเกณฑ์ของใครมาก่อน ทุกอย่างในหน้านี้คือข้อมูล ไม่ใช่โค้ด
 */

const METHOD_LABEL: Record<PayComponent["method"], string> = {
  fixed: "จำนวนเงินคงที่ต่องวด",
  per_unit: "จำนวนเงิน × หน่วยที่กรอก",
  percent_base: "% ของค่าจ้างฐาน",
  hourly_multiplier: "อัตราต่อชั่วโมง × ตัวคูณ × ชั่วโมง",
  tier_table: "ตารางขั้นบันได",
  manual: "กรอกยอดเองต่อคนต่องวด",
};

function blankComponent(): PayComponent {
  return {
    code: "", name: "", kind: "earning", method: "fixed",
    amount: 0, rate: 0, multiplier: 0, tiers: [],
    inputKeys: [], inputAgg: "sum", groupCodes: [],
    taxable: true, ssoBase: false, otBase: false, prorateBase: false,
    sort: 0, active: true,
  };
}

export function ConfigTab({ config }: { config: PayrollConfig }) {
  return (
    <div className="space-y-4">
      <BasicSettings config={config} />
      <Groups config={config} />
      <Inputs config={config} />
      <Components config={config} />
      <Rates config={config} />
    </div>
  );
}

// ── ค่าตั้งพื้นฐาน ───────────────────────────────────────────────────────────
function BasicSettings({ config }: { config: PayrollConfig }) {
  const router = useRouter();
  const { pending, msg, run } = useSaver();
  const [hours, setHours] = useState(config.settings.hoursPerDay);
  const [rounding, setRounding] = useState<string>(config.settings.rounding);
  const [pay, setPay] = useState(config.accounts.pay);
  const [sso, setSso] = useState(config.accounts.sso);
  const [wht, setWht] = useState(config.accounts.wht);

  function saveAll() {
    run(async () => {
      for (const [k, v] of [
        ["payroll_hours_per_day", String(hours)],
        ["payroll_rounding", rounding],
        ["payroll_pay_account", pay],
        ["payroll_sso_account", sso],
        ["payroll_wht_account", wht],
      ] as [string, string][]) {
        const r = await savePayrollSettingAction(k, v);
        if (!r.ok) return r;
      }
      return { ok: true };
    }, "บันทึกค่าตั้งแล้ว", () => router.refresh());
  }

  return (
    <Card title="ค่าตั้งพื้นฐาน">
      <Msg msg={msg} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="ชั่วโมงทำงานต่อวัน (ใช้หาอัตราต่อชั่วโมงของ OT)">
          <NumBox value={hours} onChange={(v) => setHours(v === "" ? 0 : v)} />
        </Field>
        <Field label="การปัดเศษ">
          <Select value={rounding} onChange={(e) => setRounding(e.target.value)}>
            <option value="baht">ปัดเป็นจำนวนเต็มบาท</option>
            <option value="satang">เก็บทศนิยม 2 ตำแหน่ง</option>
          </Select>
        </Field>
        <Field label="บัญชีเงินที่ใช้จ่ายเงินเดือน">
          <TextInput value={pay} onChange={(e) => setPay(e.target.value)} placeholder="ชื่อบัญชีให้ตรงกับในแอปบัญชี" />
        </Field>
        <Field label="บัญชีที่ใช้นำส่งประกันสังคม (ว่าง = ใช้บัญชีจ่ายเงินเดือน)">
          <TextInput value={sso} onChange={(e) => setSso(e.target.value)} />
        </Field>
        <Field label="บัญชีที่ใช้นำส่งภาษี (ว่าง = ใช้บัญชีจ่ายเงินเดือน)">
          <TextInput value={wht} onChange={(e) => setWht(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3"><SaveButton pending={pending} onClick={saveAll}>บันทึกค่าตั้ง</SaveButton></div>
    </Card>
  );
}

// ── กลุ่มพนักงาน ─────────────────────────────────────────────────────────────
function Groups({ config }: { config: PayrollConfig }) {
  const router = useRouter();
  const { pending, msg, run } = useSaver();
  const [val, setVal] = useState("");

  return (
    <Card title="กลุ่มพนักงาน">
      <p className="mb-2 text-xs text-faint">
        ใช้คุมว่ารายการไหนให้ใครบ้าง — เช่นตั้ง 2 กลุ่มแล้วให้ค่าล่วงเวลาคนละตัวคูณ
        (สร้างรายการ 2 แถว แถวละกลุ่ม)
      </p>
      <div className="mb-2 flex flex-wrap gap-2">
        {config.groups.length === 0 && <span className="text-sm text-faint">— ยังไม่มี —</span>}
        {config.groups.map((g) => (
          <span key={g} className="inline-flex items-center gap-1 rounded-full bg-raised px-3 py-1 text-sm text-muted">
            {g}
            <button
              disabled={pending}
              onClick={() => run(() => deletePayGroupAction(g), "ลบแล้ว", () => router.refresh())}
              className="text-faint hover:text-crit"
            >✕</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <TextInput value={val} onChange={(e) => setVal(e.target.value)} placeholder="เช่น รายวัน / หัวหน้างาน" />
        <SaveButton pending={pending} onClick={() => run(() => addPayGroupAction(val), "เพิ่มแล้ว", () => { setVal(""); router.refresh(); })}>
          เพิ่ม
        </SaveButton>
      </div>
      <Msg msg={msg} />
    </Card>
  );
}

// ── ช่องกรอกต่อคนต่องวด ──────────────────────────────────────────────────────
function Inputs({ config }: { config: PayrollConfig }) {
  const router = useRouter();
  const { pending, msg, run } = useSaver();
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [unit, setUnit] = useState("");

  return (
    <Card title="ช่องที่ต้องกรอกต่อคนต่องวด">
      <p className="mb-2 text-xs text-faint">
        คอลัมน์ในตารางงวดจ่ายมาจากที่นี่ — เช่น ชั่วโมง OT · วันลาป่วย · จำนวนครั้งที่มาสาย
        (รหัสเป็นภาษาอังกฤษเพราะใช้เป็นคีย์ของข้อมูล ส่วนชื่อที่แสดงเป็นไทยได้)
      </p>
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead><tr className="text-left text-faint"><th>รหัส</th><th>ชื่อที่แสดง</th><th>หน่วย</th><th></th></tr></thead>
          <tbody>
            {config.inputs.map((i) => (
              <tr key={i.code}>
                <td className="font-mono text-xs">{i.code}</td>
                <td>{i.label}</td>
                <td>{i.unit ?? "—"}</td>
                <td>
                  <button
                    disabled={pending}
                    onClick={() => run(() => deletePayInputAction(i.code), "ลบแล้ว", () => router.refresh())}
                    className="text-crit hover:underline"
                  >ลบ</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {config.inputs.length === 0 && <Empty />}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Field label="รหัส (a-z 0-9 _)"><TextInput value={code} onChange={(e) => setCode(e.target.value)} placeholder="ot_work_h" /></Field>
        <Field label="ชื่อที่แสดง"><TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder="OT วันทำงาน" /></Field>
        <Field label="หน่วย"><TextInput value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="ชั่วโมง" /></Field>
        <div className="flex items-end">
          <SaveButton
            pending={pending}
            onClick={() => run(
              () => savePayInputAction({ code, label, unit, sort: config.inputs.length, active: true }),
              "เพิ่มช่องแล้ว",
              () => { setCode(""); setLabel(""); setUnit(""); router.refresh(); },
            )}
          >เพิ่มช่อง</SaveButton>
        </div>
      </div>
      <Msg msg={msg} />
    </Card>
  );
}

// ── รายการเพิ่ม/หัก ──────────────────────────────────────────────────────────
function Components({ config }: { config: PayrollConfig }) {
  const router = useRouter();
  const { pending, msg, run } = useSaver();
  const [edit, setEdit] = useState<PayComponent | null>(null);
  const set = <K extends keyof PayComponent>(k: K, v: PayComponent[K]) =>
    setEdit((p) => (p ? { ...p, [k]: v } : p));

  return (
    <Card title="รายการเพิ่ม / หัก">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-faint">
          ทุกอย่างที่ไม่ใช่ค่าจ้างฐาน ประกันสังคม และภาษี อยู่ที่นี่หมด
        </p>
        <button onClick={() => setEdit(blankComponent())} className="rounded-lg bg-brand px-4 py-2 text-sm text-on-brand">
          + เพิ่มรายการ
        </button>
      </div>
      <Msg msg={msg} />

      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr className="text-left text-faint">
              <th>ชื่อ</th><th>ประเภท</th><th>วิธีคิด</th><th>กลุ่ม</th>
              <th>ภาษี</th><th>ปกส.</th><th>ฐาน OT</th><th>prorate</th><th></th>
            </tr>
          </thead>
          <tbody>
            {config.components.map((c) => (
              <tr key={c.code}>
                <td>{c.name}{c.active === false && <span className="ml-1 text-xs text-faint">(ปิดอยู่)</span>}</td>
                <td>{c.kind === "earning" ? "เพิ่ม" : "หัก"}</td>
                <td className="text-xs">{METHOD_LABEL[c.method]}</td>
                <td className="text-xs">{(c.groupCodes ?? []).join(", ") || "ทุกกลุ่ม"}</td>
                <td>{c.taxable ? "✓" : "—"}</td>
                <td>{c.ssoBase ? "✓" : "—"}</td>
                <td>{c.otBase ? "✓" : "—"}</td>
                <td>{c.prorateBase ? "✓" : "—"}</td>
                <td className="whitespace-nowrap">
                  <button onClick={() => setEdit(c)} className="text-muted hover:underline">แก้</button>
                  <button
                    disabled={pending}
                    onClick={() => { if (confirm(`ลบรายการ "${c.name}"?`)) run(() => deletePayComponentAction(c.code), "ลบแล้ว", () => router.refresh()); }}
                    className="ml-2 text-crit hover:underline"
                  >ลบ</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {config.components.length === 0 && <Empty />}
      </div>

      {edit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/30 p-4" onClick={() => setEdit(null)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-card p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 font-semibold text-ink">{edit.name || "รายการใหม่"}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="รหัส (a-z 0-9 _)"><TextInput value={edit.code} onChange={(e) => set("code", e.target.value)} /></Field>
              <Field label="ชื่อที่ขึ้นบนสลิป"><TextInput value={edit.name} onChange={(e) => set("name", e.target.value)} /></Field>
              <Field label="ประเภท">
                <Select value={edit.kind} onChange={(e) => set("kind", e.target.value as PayComponent["kind"])}>
                  <option value="earning">รายการเพิ่ม</option>
                  <option value="deduction">รายการหัก</option>
                </Select>
              </Field>
              <Field label="วิธีคิด">
                <Select value={edit.method} onChange={(e) => set("method", e.target.value as PayComponent["method"])}>
                  {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>

              {(edit.method === "fixed" || edit.method === "per_unit") && (
                <Field label={edit.method === "fixed" ? "จำนวนเงินต่องวด" : "จำนวนเงินต่อหน่วย"}>
                  <NumBox value={edit.amount ?? 0} blankZero onChange={(v) => set("amount", v === "" ? 0 : v)} />
                </Field>
              )}
              {edit.method === "percent_base" && (
                <Field label="เปอร์เซ็นต์ของค่าจ้างฐาน">
                  <NumBox value={edit.rate ?? 0} blankZero onChange={(v) => set("rate", v === "" ? 0 : v)} />
                </Field>
              )}
              {edit.method === "hourly_multiplier" && (
                <Field label="ตัวคูณ (เช่น 1.5 / 2 / 3)">
                  <NumBox value={edit.multiplier ?? 0} blankZero onChange={(v) => set("multiplier", v === "" ? 0 : v)} />
                </Field>
              )}

              {edit.method !== "fixed" && edit.method !== "manual" && edit.method !== "percent_base" && (
                <>
                  <Field label="ใช้ค่าจากช่องกรอก (เลือกได้หลายช่อง)">
                    <select
                      multiple
                      value={edit.inputKeys ?? []}
                      onChange={(e) => set("inputKeys", Array.from(e.target.selectedOptions).map((o) => o.value))}
                      className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm"
                    >
                      {config.inputs.map((i) => <option key={i.code} value={i.code}>{i.label}</option>)}
                    </select>
                  </Field>
                  <Field label="รวมค่าจากหลายช่องยังไง">
                    <Select value={edit.inputAgg ?? "sum"} onChange={(e) => set("inputAgg", e.target.value as "sum" | "avg")}>
                      <option value="sum">บวกกัน</option>
                      <option value="avg">เฉลี่ย</option>
                    </Select>
                  </Field>
                </>
              )}

              {edit.method === "tier_table" && (
                <div className="sm:col-span-2">
                  <Field label="ขั้นบันได — ค่าที่กรอก ≤ ขอบบน จะได้เงินตามขั้นนั้น (เกินทุกขั้น = 0)">
                    <TextInput
                      value={(edit.tiers ?? []).map((t) => `${t.upTo}=${t.amount}`).join(", ")}
                      onChange={(e) =>
                        set("tiers", e.target.value.split(",").map((s) => {
                          const [a, b] = s.split("=");
                          return { upTo: Number(a?.trim()) || 0, amount: Number(b?.trim()) || 0 };
                        }).filter((t) => t.upTo > 0))
                      }
                      placeholder="1=500, 1.5=400, 2=300, 2.5=100"
                    />
                  </Field>
                </div>
              )}

              <Field label="ให้เฉพาะกลุ่ม (ไม่เลือก = ทุกคน)">
                <select
                  multiple
                  value={edit.groupCodes ?? []}
                  onChange={(e) => set("groupCodes", Array.from(e.target.selectedOptions).map((o) => o.value))}
                  className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm"
                >
                  {config.groups.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </Field>
              <Field label="หมวดรายจ่ายตอนลงบัญชี">
                <TextInput value={edit.expenseCat ?? ""} onChange={(e) => set("expenseCat", e.target.value)} />
              </Field>
            </div>

            <div className="mt-4 rounded-lg bg-raised p-3">
              <p className="mb-2 text-xs text-muted">
                <b>รายการนี้เข้าฐานไหนบ้าง</b> — 🚨 ฐานภาษีกับฐานประกันสังคม<b>ไม่เท่ากัน</b>:
                ค่าล่วงเวลาและโบนัสเข้าฐานภาษี แต่ไม่ใช่ &ldquo;ค่าจ้าง&rdquo; ตาม พ.ร.บ.ประกันสังคม
                ติดผิด = ตัวเลขที่ยื่นผิดตั้งแต่เดือนแรกโดยไม่มีอะไรฟ้อง
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={edit.taxable ?? false} onChange={(e) => set("taxable", e.target.checked)} />
                  เข้าฐานภาษีเงินได้
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={edit.ssoBase ?? false} onChange={(e) => set("ssoBase", e.target.checked)} />
                  เข้าฐานประกันสังคม
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={edit.otBase ?? false} onChange={(e) => set("otBase", e.target.checked)} />
                  เข้าฐานคิดอัตราต่อชั่วโมง (OT)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={edit.prorateBase ?? false} onChange={(e) => set("prorateBase", e.target.checked)} />
                  รวมกับค่าจ้างฐานแล้วลดตามวันมาทำงาน
                </label>
              </div>
            </div>

            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={edit.active !== false} onChange={(e) => set("active", e.target.checked)} />
              เปิดใช้งาน
            </label>

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setEdit(null)} className="rounded-lg border border-line px-4 py-2 text-sm">ยกเลิก</button>
              <SaveButton pending={pending} onClick={() => run(() => savePayComponentAction(edit), "บันทึกแล้ว", () => { setEdit(null); router.refresh(); })}>
                บันทึก
              </SaveButton>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

// ── ชุดอัตราตามกฎหมาย ───────────────────────────────────────────────────────
function Rates({ config }: { config: PayrollConfig }) {
  const router = useRouter();
  const { pending, msg, run } = useSaver();
  const [form, setForm] = useState<PayRates>(() =>
    config.rates[0] ?? {
      effectiveFrom: "",
      ssoRate: 5, ssoWageMin: 1650, ssoWageMax: 15000,
      pitBrackets: [
        { upTo: 150000, rate: 0 }, { upTo: 300000, rate: 0.05 }, { upTo: 500000, rate: 0.1 },
        { upTo: 750000, rate: 0.15 }, { upTo: 1000000, rate: 0.2 }, { upTo: 2000000, rate: 0.25 },
        { upTo: 5000000, rate: 0.3 }, { upTo: 1e15, rate: 0.35 },
      ],
      personalAllowance: 60000, expenseRate: 50, expenseCap: 100000,
    },
  );
  const set = <K extends keyof PayRates>(k: K, v: PayRates[K]) => setForm((p) => ({ ...p, [k]: v }));

  return (
    <Card title="ชุดอัตราตามกฎหมาย (มีวันเริ่มมีผล)">
      <p className="mb-3 text-xs text-faint">
        🚨 อัตราพวกนี้ถูกแก้ด้วยกฎกระทรวงเป็นระยะ — เก็บเป็นชุดที่มีวันเริ่มมีผล
        เพื่อให้เปิดดูงวดเก่าแล้วได้อัตราของตอนนั้น ไม่ใช่ของวันนี้ ·
        <b> ค่าที่ใส่ต้องตรวจกับประกาศจริงก่อนใช้ยื่น</b> ระบบไม่ได้อัปเดตให้อัตโนมัติ
      </p>
      <Msg msg={msg} />

      {config.rates.length > 0 && (
        <div className="mb-3 overflow-x-auto">
          <table className="tbl">
            <thead><tr className="text-left text-faint"><th>เริ่มมีผล</th><th className="num">อัตรา ปกส.</th><th className="num">เพดานฐาน</th><th className="num">ลดหย่อนส่วนตัว</th></tr></thead>
            <tbody>
              {config.rates.map((r) => (
                <tr key={r.effectiveFrom}>
                  <td>{r.effectiveFrom}</td>
                  <td className="num">{r.ssoRate}%</td>
                  <td className="num">{r.ssoWageMax.toLocaleString()}</td>
                  <td className="num">{r.personalAllowance.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="วันที่เริ่มมีผล">
          <TextInput type="date" value={form.effectiveFrom} onChange={(e) => set("effectiveFrom", e.target.value)} />
        </Field>
        <Field label="อัตราเงินสมทบ (%)">
          <NumBox value={form.ssoRate} onChange={(v) => set("ssoRate", v === "" ? 0 : v)} />
        </Field>
        <Field label="ฐานค่าจ้างขั้นต่ำ">
          <NumBox value={form.ssoWageMin} onChange={(v) => set("ssoWageMin", v === "" ? 0 : v)} />
        </Field>
        <Field label="เพดานฐานค่าจ้าง">
          <NumBox value={form.ssoWageMax} onChange={(v) => set("ssoWageMax", v === "" ? 0 : v)} />
        </Field>
        <Field label="ค่าลดหย่อนส่วนตัว">
          <NumBox value={form.personalAllowance} onChange={(v) => set("personalAllowance", v === "" ? 0 : v)} />
        </Field>
        <Field label="หักค่าใช้จ่าย (%) / เพดาน">
          <div className="flex gap-2">
            <NumBox value={form.expenseRate} onChange={(v) => set("expenseRate", v === "" ? 0 : v)} />
            <NumBox value={form.expenseCap} onChange={(v) => set("expenseCap", v === "" ? 0 : v)} />
          </div>
        </Field>
      </div>

      <div className="mt-3">
        <Field label="ขั้นบันไดภาษี — รูปแบบ ขอบบน=อัตรา (อัตราเป็นทศนิยม เช่น 0.05 = 5%)">
          <TextInput
            value={form.pitBrackets.map((b) => `${b.upTo}=${b.rate}`).join(", ")}
            onChange={(e) =>
              set("pitBrackets", e.target.value.split(",").map((s) => {
                const [a, b] = s.split("=");
                return { upTo: Number(a?.trim()) || 0, rate: Number(b?.trim()) || 0 };
              }).filter((b) => b.upTo > 0))
            }
          />
        </Field>
      </div>

      <div className="mt-3">
        <SaveButton pending={pending} onClick={() => run(() => savePayRatesAction(form), "บันทึกชุดอัตราแล้ว", () => router.refresh())}>
          บันทึกชุดอัตรา
        </SaveButton>
      </div>
    </Card>
  );
}
