"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Field, Msg, NumBox, SaveButton, Select, TextInput, useSaver, Empty } from "@/lib/shared/ui";
import type {
  LegAmountSource,
  PayComponent,
  PayPostLeg,
  PayRates,
  PayVariable,
  VarOp,
  VarRounding,
  VarSource,
} from "@/lib/payroll/types";
import {
  VAR_SOURCE_LABEL,
  VAR_OP_LABEL,
  VAR_ROUNDING_LABEL,
  variableFormulaText,
  variableWarnings,
} from "@/lib/payroll/varText";
import {
  addPayGroupAction,
  deletePayGroupAction,
  savePayInputAction,
  deletePayInputAction,
  reorderPayInputsAction,
  savePayComponentAction,
  deletePayComponentAction,
  savePayVariableAction,
  deletePayVariableAction,
  savePayPostLegAction,
  deletePayPostLegAction,
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
  variable: "ตัวแปรกลาง × ตัวคูณ × หน่วยที่กรอก",
  tier_table: "ตารางขั้นบันได",
  manual: "กรอกยอดเองต่อคนต่องวด",
};


const LEG_SOURCE_LABEL: Record<LegAmountSource, string> = {
  net: "ยอดจ่ายจริง (สุทธิ)",
  gross: "รวมเงินได้",
  sso_employee: "ประกันสังคม — ส่วนลูกจ้าง",
  sso_employer: "ประกันสังคม — ส่วนนายจ้าง",
  sso_total: "ประกันสังคม — ลูกจ้าง + นายจ้าง",
  wht: "ภาษีหัก ณ ที่จ่าย",
  component: "ยอดของรายการเพิ่ม/หักตัวหนึ่ง",
};

/** เช็คบ็อกซ์หลายตัวเลือก — ใช้แทน <select multiple> ที่ต้องกด Ctrl ค้างถึงเลือกได้หลายอัน */
function CheckList({
  options,
  value,
  onChange,
  empty = "— ยังไม่มีให้เลือก —",
}: {
  options: { value: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
  empty?: string;
}) {
  if (options.length === 0) return <p className="text-xs text-faint">{empty}</p>;
  const toggle = (v: string) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg border border-line px-3 py-2">
      {options.map((o) => (
        <label key={o.value} className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} />
          {o.label}
        </label>
      ))}
    </div>
  );
}

/** ดร็อปดาวน์บัญชีเงินจากที่มีอยู่จริง — ไม่ต้องพิมพ์ให้ตรงเอง */
function AccountSelect({
  value,
  onChange,
  accounts,
  allowEmpty,
}: {
  value: string;
  onChange: (v: string) => void;
  accounts: string[];
  allowEmpty?: string;
}) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{allowEmpty ?? "— เลือกบัญชี —"}</option>
      {accounts.map((a) => <option key={a} value={a}>{a}</option>)}
      {/* ค่าที่ตั้งไว้เดิมแต่บัญชีถูกลบ/เปลี่ยนชื่อ — ต้องยังเห็นว่าตั้งอะไรไว้ ไม่ใช่หายเงียบ */}
      {value && !accounts.includes(value) && <option value={value}>{value} (ไม่พบในบัญชีเงิน)</option>}
    </Select>
  );
}

export function ConfigTab({ config }: { config: PayrollConfig }) {
  return (
    <div className="space-y-4">
      <BasicSettings config={config} />
      <Groups config={config} />
      <Inputs config={config} />
      <Variables config={config} />
      <Components config={config} />
      <PostLegs config={config} />
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
  const [pay, setPay] = useState(config.payAccount);

  function saveAll() {
    run(async () => {
      for (const [k, v] of [
        ["payroll_hours_per_day", String(hours)],
        ["payroll_rounding", rounding],
        ["payroll_pay_account", pay],
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="ชั่วโมงทำงานต่อวัน">
          <NumBox value={hours} onChange={(v) => setHours(v === "" ? 0 : v)} />
        </Field>
        <Field label="การปัดเศษ">
          <Select value={rounding} onChange={(e) => setRounding(e.target.value)}>
            <option value="baht">ปัดเป็นจำนวนเต็มบาท</option>
            <option value="satang">เก็บทศนิยม 2 ตำแหน่ง</option>
          </Select>
        </Field>
        <Field label="บัญชีเงินหลักที่ใช้จ่ายเงินเดือน">
          <AccountSelect value={pay} onChange={setPay} accounts={config.bankAccounts} />
        </Field>
      </div>
      <p className="mt-2 text-xs text-faint">
        ขาลงบัญชีที่ไม่ระบุบัญชีเงินของตัวเอง จะใช้บัญชีหลักนี้ ·
        รายชื่อบัญชีมาจากบัญชีเงินที่ตั้งไว้ในแอปบัญชี
      </p>
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

  // 🪤 เก็บลำดับเป็น state ในเครื่องด้วย — แท็บถูก mount ค้างไว้ด้วย CSS ตามแพตเทิร์นของทุก
  //    workspace ทำให้ prop จาก `router.refresh()` มาช้ากว่าที่ผู้ใช้คาด · กดแล้วแถวไม่ขยับ
  //    = ผู้ใช้กดซ้ำ (บั๊กตัวเดียวกับรายชื่อพนักงานใน D67) · ยังเรียก refresh ต่อให้ server ตรงกัน
  const [order, setOrder] = useState<string[] | null>(null);
  const rows = order
    ? (order.map((c) => config.inputs.find((i) => i.code === c)).filter(Boolean) as typeof config.inputs)
    : config.inputs;

  /** ย้ายช่องขึ้น/ลง 1 ตำแหน่ง แล้วเขียนลำดับใหม่ทั้งชุด */
  function move(idx: number, dir: -1 | 1) {
    const codes = rows.map((i) => i.code);
    const to = idx + dir;
    if (to < 0 || to >= codes.length) return;
    [codes[idx], codes[to]] = [codes[to], codes[idx]];
    setOrder(codes);
    run(() => reorderPayInputsAction(codes), "ย้ายลำดับแล้ว", () => router.refresh());
  }

  return (
    <Card title="ช่องที่ต้องกรอกต่อคนต่องวด">
      <p className="mb-2 text-xs text-faint">
        คอลัมน์ในตารางงวดจ่ายมาจากที่นี่ — เช่น ชั่วโมง OT · วันลาป่วย · จำนวนครั้งที่มาสาย
        (รหัสเป็นภาษาอังกฤษเพราะใช้เป็นคีย์ของข้อมูล ส่วนชื่อที่แสดงเป็นไทยได้)
        <br />
        ★ ปุ่ม ▲▼ ย้ายลำดับคอลัมน์ได้ — ช่องที่เพิ่มทีหลังไม่จำเป็นต้องอยู่ท้ายสุดตลอดไป
      </p>
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr className="text-left text-faint">
              <th>ลำดับ</th><th>รหัส</th><th>ชื่อที่แสดง</th><th>หน่วย</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i, idx) => (
              <tr key={i.code}>
                {/* ★ ลำดับที่นี่ = ลำดับคอลัมน์ในตารางงวดจ่าย — ย้ายได้โดยไม่ต้องลบแล้วสร้างใหม่
                    (ลบช่องที่มีข้อมูลกรอกไว้แล้ว = ค่าที่คีย์ไปหายทั้งงวด) */}
                <td className="whitespace-nowrap">
                  <button
                    disabled={pending || idx === 0}
                    onClick={() => move(idx, -1)}
                    aria-label={`ย้าย ${i.label} ขึ้น`}
                    className="px-1 text-muted hover:text-ink disabled:opacity-30"
                  >▲</button>
                  <button
                    disabled={pending || idx === rows.length - 1}
                    onClick={() => move(idx, 1)}
                    aria-label={`ย้าย ${i.label} ลง`}
                    className="px-1 text-muted hover:text-ink disabled:opacity-30"
                  >▼</button>
                </td>
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
        {rows.length === 0 && <Empty />}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Field label="รหัส (a-z 0-9 _)"><TextInput value={code} onChange={(e) => setCode(e.target.value)} placeholder="ot_work_h" /></Field>
        <Field label="ชื่อที่แสดง"><TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder="OT วันทำงาน" /></Field>
        <Field label="หน่วย"><TextInput value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="ชั่วโมง" /></Field>
        <div className="flex items-end">
          <SaveButton
            pending={pending}
            onClick={() => run(
              () => savePayInputAction({ code, label, unit, sort: rows.length, active: true }),
              "เพิ่มช่องแล้ว",
              () => { setCode(""); setLabel(""); setUnit(""); setOrder(null); router.refresh(); },
            )}
          >เพิ่มช่อง</SaveButton>
        </div>
      </div>
      <Msg msg={msg} />
    </Card>
  );
}

// ── ตัวแปรกลาง ───────────────────────────────────────────────────────────────
/**
 * จำนวนขั้นสูงสุดของสูตรตัวแปร
 * ★ เดิม (D67) จำกัด 2 ชั้นตอนที่ยังหารได้อย่างเดียว · พอมี +/− เข้ามา 2 ขั้นแคบไป
 *   เคสจริงที่ต้องใช้ 3: ((ฐาน + ค่าตำแหน่ง) ÷ วันมาตรฐาน) ÷ ชม./วัน
 * 🚨 ยังต้องมีเพดานอยู่ — เพดานคือสิ่งที่ทำให้เส้นทางคำนวณ "นับได้จนครบ"
 *   ซึ่งเป็นเหตุผลทั้งหมดที่ยอมให้มีตัวดำเนินการได้ (กติกาเหล็กข้อ 1)
 */
const MAX_VAR_STEPS = 3;
function blankVariable(): PayVariable {
  return { code: "", name: "", source: "base_wage", constValue: 0, steps: [], rounding: "none", sort: 0, active: true };
}

function Variables({ config }: { config: PayrollConfig }) {
  const router = useRouter();
  const { pending, msg, run } = useSaver();
  const [edit, setEdit] = useState<PayVariable | null>(null);
  const set = <K extends keyof PayVariable>(k: K, v: PayVariable[K]) =>
    setEdit((p) => (p ? { ...p, [k]: v } : p));

  const inputOpts = config.inputs.map((i) => ({ value: i.code, label: i.label }));

  /** ช่องเลือก "ค่าที่ใช้" 1 ช่อง (ใช้ทั้งตัวตั้งและตัวหาร) */
  const SlotPicker = ({
    kind, value, inputKey, onKind, onValue, onInput,
  }: {
    kind: VarSource; value?: number; inputKey?: string;
    onKind: (k: VarSource) => void; onValue: (v: number) => void; onInput: (k: string) => void;
  }) => (
    <div className="flex flex-wrap gap-2">
      <Select value={kind} onChange={(e) => onKind(e.target.value as VarSource)}>
        {(Object.keys(VAR_SOURCE_LABEL) as VarSource[]).map((k) => (
          <option key={k} value={k}>{VAR_SOURCE_LABEL[k]}</option>
        ))}
      </Select>
      {kind === "constant" && (
        <NumBox value={value ?? 0} onChange={(v) => onValue(v === "" ? 0 : v)} />
      )}
      {kind === "input" && (
        <Select value={inputKey ?? ""} onChange={(e) => onInput(e.target.value)}>
          <option value="">— เลือกช่อง —</option>
          {inputOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      )}
    </div>
  );

  function setStep(idx: number, patch: Partial<{ op: VarOp; kind: VarSource; value: number; inputKey: string }>) {
    setEdit((p) => {
      if (!p) return p;
      const d = [...(p.steps ?? [])];
      d[idx] = { ...d[idx], ...patch };
      return { ...p, steps: d };
    });
  }

  const inputLabels = Object.fromEntries(config.inputs.map((i) => [i.code, i.label]));

  return (
    <Card title="ตัวแปรกลาง">
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className="text-xs text-faint">
          ค่าที่คำนวณ<b>ชั้นแรก</b> แล้วให้รายการเพิ่ม/หักเอาไปคูณต่อ — เช่น
          <b> อัตราค่าล่วงเวลาต่อชั่วโมง = ฐานเงินเดือน ÷ วันทำงานมาตรฐานของงวด ÷ ชั่วโมงต่อวัน</b>
          <br />
          ★ ค่าที่เปลี่ยนทุกเดือน (วันทำงานมาตรฐาน · วันมาทำงานจริง · ช่องที่กรอกต่องวด) เลือกได้ตรง ๆ
          ตัวแปรจะขยับตามเองโดยไม่ต้องแก้อะไร
        </p>
        <button onClick={() => setEdit(blankVariable())} className="shrink-0 rounded-lg bg-brand px-4 py-2 text-sm text-on-brand">
          + เพิ่มตัวแปร
        </button>
      </div>
      <Msg msg={msg} />

      <div className="overflow-x-auto">
        <table className="tbl">
          <thead><tr className="text-left text-faint"><th>ชื่อ</th><th>สูตร</th><th></th></tr></thead>
          <tbody>
            {config.variables.map((v) => (
              <tr key={v.code}>
                <td>{v.name}{v.active === false && <span className="ml-1 text-xs text-faint">(ปิดอยู่)</span>}</td>
                {/* ★ ใช้ตัวเดียวกับที่หน้าแก้ไขโชว์ — วงเล็บบอกลำดับการคิดจริง ไม่ใช่กฎคณิตศาสตร์ */}
                <td className="text-xs text-muted">{variableFormulaText(v, inputLabels)}</td>
                <td className="whitespace-nowrap">
                  <button onClick={() => setEdit(v)} className="text-muted hover:underline">แก้</button>
                  <button
                    disabled={pending}
                    onClick={() => run(() => deletePayVariableAction(v.code), "ลบแล้ว", () => router.refresh())}
                    className="ml-2 text-crit hover:underline"
                  >ลบ</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {config.variables.length === 0 && <Empty>— ยังไม่มีตัวแปร (ต้องมีก่อนถ้าจะคิดค่าล่วงเวลา) —</Empty>}
      </div>

      {edit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/30 p-4" onClick={() => setEdit(null)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-card p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 font-semibold text-ink">{edit.name || "ตัวแปรใหม่"}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="รหัส (a-z 0-9 _)"><TextInput value={edit.code} onChange={(e) => set("code", e.target.value)} placeholder="hourly_rate" /></Field>
              <Field label="ชื่อที่คนอ่านรู้เรื่อง"><TextInput value={edit.name} onChange={(e) => set("name", e.target.value)} placeholder="อัตราค่าล่วงเวลาต่อชั่วโมง" /></Field>
            </div>

            <div className="mt-3">
              <Field label="ตัวตั้ง">
                <SlotPicker
                  kind={edit.source}
                  value={edit.constValue}
                  inputKey={edit.inputKey}
                  onKind={(k) => set("source", k)}
                  onValue={(v) => set("constValue", v)}
                  onInput={(k) => set("inputKey", k)}
                />
              </Field>
            </div>

            <div className="mt-3 space-y-2">
              <span className="block text-sm text-muted">
                แล้วคิดต่อทีละขั้น (สูงสุด {MAX_VAR_STEPS} ขั้น · เว้นไว้ = ใช้ตัวตั้งตรง ๆ)
              </span>
              {Array.from({ length: MAX_VAR_STEPS }, (_, idx) => idx).map((idx) => {
                const d = (edit.steps ?? [])[idx];
                const prev = (edit.steps ?? [])[idx - 1];
                // ขั้นถัดไปกดเพิ่มได้เฉพาะเมื่อขั้นก่อนหน้ามีแล้ว — กันรูโหว่กลางลิสต์
                if (!d && idx > 0 && !prev) return null;
                return (
                  <div key={idx} className="flex flex-wrap items-center gap-2">
                    {d ? (
                      <>
                        <Select
                          value={d.op ?? "div"}
                          onChange={(e) => setStep(idx, { op: e.target.value as VarOp })}
                          className="w-auto"
                        >
                          {(Object.keys(VAR_OP_LABEL) as VarOp[]).map((o) => (
                            <option key={o} value={o}>{VAR_OP_LABEL[o]}</option>
                          ))}
                        </Select>
                        <SlotPicker
                          kind={d.kind}
                          value={d.value}
                          inputKey={d.inputKey}
                          onKind={(k) => setStep(idx, { kind: k })}
                          onValue={(v) => setStep(idx, { value: v })}
                          onInput={(k) => setStep(idx, { inputKey: k })}
                        />
                        <button
                          onClick={() => set("steps", (edit.steps ?? []).filter((_, i) => i !== idx))}
                          className="text-xs text-crit hover:underline"
                        >เอาออก</button>
                      </>
                    ) : (
                      <button
                        onClick={() => set("steps", [...(edit.steps ?? []), { op: "div", kind: "work_days_std" }])}
                        className="text-xs text-brand hover:underline"
                      >+ เพิ่มขั้น</button>
                    )}
                  </div>
                );
              })}
              <p className="text-xs text-faint">
                🪤 <b>หาร</b>ด้วย 0 (เช่นเดือนที่ยังไม่กรอกชั่วโมง) จะถูก<b>ข้าม</b> ไม่ทำให้ยอดพัง ·
                แต่ <b>คูณ</b>ด้วย 0 ได้ 0 ตามจริง (ไม่ข้าม)
              </p>
            </div>

            <div className="mt-3">
              <Field label="ความละเอียดของค่าที่ได้">
                <Select
                  value={edit.rounding ?? "none"}
                  onChange={(e) => set("rounding", e.target.value as VarRounding)}
                >
                  {(Object.keys(VAR_ROUNDING_LABEL) as VarRounding[]).map((r) => (
                    <option key={r} value={r}>{VAR_ROUNDING_LABEL[r]}</option>
                  ))}
                </Select>
              </Field>
            </div>

            {/* 🚨 บรรทัดนี้คือด่านกันเข้าใจผิดเรื่องลำดับการคิด — ห้ามเอาออก
                ระบบคิดซ้ายไปขวาทีละขั้น แต่คนอ่านด้วยกฎคณิตศาสตร์ (คูณ/หารก่อน) */}
            <div className="mt-3 rounded-lg bg-raised px-3 py-2">
              <div className="text-[10px] font-medium uppercase tracking-widest text-muted">สูตรที่จะถูกใช้จริง</div>
              <div className="mt-1 text-sm font-medium text-ink">{variableFormulaText(edit, inputLabels)}</div>
              {variableWarnings(edit).map((w, i) => (
                <p key={i} className="mt-1 text-xs text-warn">⚠ {w}</p>
              ))}
            </div>

            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={edit.active !== false} onChange={(e) => set("active", e.target.checked)} />
              เปิดใช้งาน
            </label>

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setEdit(null)} className="rounded-lg border border-line px-4 py-2 text-sm">ยกเลิก</button>
              <SaveButton pending={pending} onClick={() => run(() => savePayVariableAction(edit), "บันทึกแล้ว", () => { setEdit(null); router.refresh(); })}>
                บันทึก
              </SaveButton>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

// ── รายการเพิ่ม/หัก ──────────────────────────────────────────────────────────
function blankComponent(): PayComponent {
  return {
    code: "", name: "", kind: "earning", method: "fixed",
    amount: 0, rate: 0, multiplier: 0, tiers: [],
    inputKeys: [], inputAgg: "sum", groupCodes: [],
    taxable: true, ssoBase: false, otBase: false, prorateBase: false,
    sort: 0, active: true,
  };
}

function Components({ config }: { config: PayrollConfig }) {
  const router = useRouter();
  const { pending, msg, run } = useSaver();
  const [edit, setEdit] = useState<PayComponent | null>(null);
  const set = <K extends keyof PayComponent>(k: K, v: PayComponent[K]) =>
    setEdit((p) => (p ? { ...p, [k]: v } : p));

  const usesInputs = edit && !["fixed", "manual", "percent_base"].includes(edit.method);

  return (
    <Card title="รายการเพิ่ม / หัก">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-faint">ทุกอย่างที่ไม่ใช่ค่าจ้างฐาน ประกันสังคม และภาษี อยู่ที่นี่หมด</p>
        <button onClick={() => setEdit(blankComponent())} className="shrink-0 rounded-lg bg-brand px-4 py-2 text-sm text-on-brand">
          + เพิ่มรายการ
        </button>
      </div>
      <Msg msg={msg} />

      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr className="text-left text-faint">
              <th>ชื่อ</th><th>ประเภท</th><th>วิธีคิด</th><th>กลุ่ม</th>
              <th>ภาษี</th><th>ปกส.</th><th>ฐานตัวแปร</th><th>prorate</th><th></th>
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
              {edit.method === "variable" && (
                <>
                  <Field label="ตัวแปรกลางที่ใช้เป็นฐาน">
                    <Select value={edit.variableCode ?? ""} onChange={(e) => set("variableCode", e.target.value)}>
                      <option value="">— เลือกตัวแปร —</option>
                      {config.variables.map((v) => <option key={v.code} value={v.code}>{v.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="ตัวคูณ (เช่น 1.5 / 2 / 3 · ไม่คูณอะไรใส่ 1)">
                    <NumBox value={edit.multiplier ?? 0} blankZero onChange={(v) => set("multiplier", v === "" ? 0 : v)} />
                  </Field>
                </>
              )}
            </div>

            {edit.method === "variable" && (
              <p className="mt-2 rounded-lg bg-raised px-3 py-2 text-xs text-muted">
                ยอด = <b>ค่าตัวแปร × ตัวคูณ × ค่าจากช่องกรอก</b> ·
                ไม่ติ๊กช่องกรอกเลย = คูณ 1 (ใช้กับเบี้ยเหมาที่คิดจากอัตราตรง ๆ)
              </p>
            )}

            {edit.method === "tier_table" && (
              <div className="mt-3">
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

            {usesInputs && (
              <div className="mt-3 space-y-2">
                <span className="block text-sm text-muted">ใช้ค่าจากช่องกรอก (ติ๊กได้หลายช่อง)</span>
                <CheckList
                  options={config.inputs.map((i) => ({ value: i.code, label: i.label }))}
                  value={edit.inputKeys ?? []}
                  onChange={(v) => set("inputKeys", v)}
                  empty="— ยังไม่มีช่องกรอก (สร้างในการ์ดด้านบน) —"
                />
                {(edit.inputKeys ?? []).length > 1 && (
                  <Field label="รวมค่าจากหลายช่องยังไง">
                    <Select value={edit.inputAgg ?? "sum"} onChange={(e) => set("inputAgg", e.target.value as "sum" | "avg")}>
                      <option value="sum">บวกกัน</option>
                      <option value="avg">เฉลี่ย</option>
                    </Select>
                  </Field>
                )}
              </div>
            )}

            <div className="mt-3 space-y-2">
              <span className="block text-sm text-muted">ให้เฉพาะกลุ่ม (ไม่ติ๊กเลย = ทุกคน)</span>
              <CheckList
                options={config.groups.map((g) => ({ value: g, label: g }))}
                value={edit.groupCodes ?? []}
                onChange={(v) => set("groupCodes", v)}
                empty="— ยังไม่มีกลุ่มพนักงาน (รายการนี้จะให้ทุกคน) —"
              />
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
                  รวมเข้าฐานที่ตัวแปรกลางใช้คิด
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

// ── ขาลงบัญชี ────────────────────────────────────────────────────────────────
function blankLeg(): PayPostLeg {
  return {
    code: "", name: "", amountSource: "net", splitByEmployee: false,
    category: "", suggestDay: 0, sort: 0, active: true,
  };
}

function PostLegs({ config }: { config: PayrollConfig }) {
  const router = useRouter();
  const { pending, msg, run } = useSaver();
  const [edit, setEdit] = useState<PayPostLeg | null>(null);
  const set = <K extends keyof PayPostLeg>(k: K, v: PayPostLeg[K]) =>
    setEdit((p) => (p ? { ...p, [k]: v } : p));

  return (
    <Card title="ขาลงบัญชี">
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className="text-xs text-faint">
          กำหนดว่าเงินเดือนไปเป็นรายจ่ายในบัญชีเป็นกี่ก้อน — ตั้งกี่ขาก็ได้ ·
          หมวดรายจ่ายพิมพ์เอง ไม่ต้องมีในรายการหมวดเดิม
          <br />
          🚨 <b>ขาที่ยอดซ้อนกัน = ลงรายจ่ายซ้ำ</b> (เช่นตั้งขาโอทีเพิ่มทั้งที่โอทีอยู่ในยอดสุทธิแล้ว) —
          ตรวจตัวเลขคุมที่แท็บงวดจ่ายก่อนลงบัญชีทุกครั้ง
        </p>
        <button onClick={() => setEdit(blankLeg())} className="shrink-0 rounded-lg bg-brand px-4 py-2 text-sm text-on-brand">
          + เพิ่มขา
        </button>
      </div>
      <Msg msg={msg} />

      <div className="overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr className="text-left text-faint">
              <th>ชื่อขา</th><th>ยอดที่ลง</th><th>แยกรายคน</th><th>หมวดรายจ่าย</th>
              <th>บัญชีเงิน</th><th>วันที่แนะนำ</th><th></th>
            </tr>
          </thead>
          <tbody>
            {config.legs.map((l) => (
              <tr key={l.code}>
                <td>{l.name}{l.active === false && <span className="ml-1 text-xs text-faint">(ปิดอยู่)</span>}</td>
                <td className="text-xs">
                  {LEG_SOURCE_LABEL[l.amountSource]}
                  {l.amountSource === "component" && ` — ${config.components.find((c) => c.code === l.componentCode)?.name ?? l.componentCode}`}
                </td>
                <td>{l.splitByEmployee ? "แยกรายคน" : "ก้อนเดียว"}</td>
                <td>{l.category}</td>
                <td className="text-xs">{l.accountName || "(บัญชีหลัก)"}</td>
                <td className="text-xs">{l.suggestDay ? `สิ้นงวด + ${l.suggestDay} วัน` : "วันจ่ายเงินเดือน"}</td>
                <td className="whitespace-nowrap">
                  <button onClick={() => setEdit(l)} className="text-muted hover:underline">แก้</button>
                  <button
                    disabled={pending}
                    onClick={() => { if (confirm(`ลบขา "${l.name}"?`)) run(() => deletePayPostLegAction(l.code), "ลบแล้ว", () => router.refresh()); }}
                    className="ml-2 text-crit hover:underline"
                  >ลบ</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {config.legs.length === 0 && (
          <Empty>— ยังไม่มีขา (ตั้งอย่างน้อย 1 ขาก่อนถึงจะลงบัญชีได้) —</Empty>
        )}
      </div>

      {edit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/30 p-4" onClick={() => setEdit(null)}>
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-card p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 font-semibold text-ink">{edit.name || "ขาใหม่"}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="รหัส (a-z 0-9 _)"><TextInput value={edit.code} onChange={(e) => set("code", e.target.value)} placeholder="net" /></Field>
              <Field label="ชื่อขา (ขึ้นบนปุ่ม)"><TextInput value={edit.name} onChange={(e) => set("name", e.target.value)} placeholder="จ่ายเงินเดือน" /></Field>
              <Field label="ยอดที่ลงบัญชี">
                <Select value={edit.amountSource} onChange={(e) => set("amountSource", e.target.value as LegAmountSource)}>
                  {(Object.keys(LEG_SOURCE_LABEL) as LegAmountSource[]).map((k) => (
                    <option key={k} value={k}>{LEG_SOURCE_LABEL[k]}</option>
                  ))}
                </Select>
              </Field>
              {edit.amountSource === "component" && (
                <Field label="รายการที่เอายอดมาลง">
                  <Select value={edit.componentCode ?? ""} onChange={(e) => set("componentCode", e.target.value)}>
                    <option value="">— เลือกรายการ —</option>
                    {config.components.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                  </Select>
                </Field>
              )}
              <Field label="หมวดรายจ่าย (พิมพ์เอง)">
                <TextInput value={edit.category} onChange={(e) => set("category", e.target.value)} placeholder="เงินเดือน" />
              </Field>
              <Field label="บัญชีเงิน (ไม่เลือก = ใช้บัญชีหลัก)">
                <AccountSelect
                  value={edit.accountName ?? ""}
                  onChange={(v) => set("accountName", v)}
                  accounts={config.bankAccounts}
                  allowEmpty="— ใช้บัญชีหลัก —"
                />
              </Field>
              <Field label="คู่ค้าบนรายการ (เว้นไว้ = ใช้ชื่อพนักงาน)">
                <TextInput value={edit.contactName ?? ""} onChange={(e) => set("contactName", e.target.value)} placeholder="สำนักงานประกันสังคม" />
              </Field>
              <Field label="วันที่แนะนำ = สิ้นงวด + กี่วัน (0 = วันจ่ายเงินเดือน)">
                <NumBox value={edit.suggestDay ?? 0} blankZero onChange={(v) => set("suggestDay", v === "" ? 0 : v)} />
              </Field>
            </div>

            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={edit.splitByEmployee ?? false} onChange={(e) => set("splitByEmployee", e.target.checked)} />
              แยกเป็น 1 รายการต่อพนักงาน 1 คน (ไม่ติ๊ก = ลงเป็นก้อนเดียว)
            </label>
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={edit.active !== false} onChange={(e) => set("active", e.target.checked)} />
              เปิดใช้งาน
            </label>

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setEdit(null)} className="rounded-lg border border-line px-4 py-2 text-sm">ยกเลิก</button>
              <SaveButton pending={pending} onClick={() => run(() => savePayPostLegAction(edit), "บันทึกแล้ว", () => { setEdit(null); router.refresh(); })}>
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
