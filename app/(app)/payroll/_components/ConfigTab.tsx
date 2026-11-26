"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Field, IconBtn, NumBox, SaveButton, Select, SuggestInput, TextInput, useSaver, Modal, ModalCancel, useConfirm } from "@/lib/shared/ui";
import { ListEmpty, ListRow, SettingsCard, SettingsList, SettingsShell } from "@/lib/shared/settings";
import { IconEdit, IconPlus, IconTrash } from "@/lib/shared/icons";
import type {
  LegAmountSource,
  PayComponent,
  PayPostLeg,
  PayRates,
  PayTier,
  PitBracket,
  PayVariable,
  VarOp,
  VarStep,
  VarRounding,
  VarSource,
  WageType,
  WorkDayWageType,
} from "@/lib/payroll/types";
import {
  WAGE_LABEL,
  WAGE_TYPES,
  WORK_DAY_SOURCES,
  componentForWage,
  dailyWageWarnings,
  ruleOf,
  wageBaseText,
  wageTypesText,
  workDayRuleText,
} from "@/lib/payroll/workDays";
import {
  VAR_SOURCE_LABEL,
  VAR_OP_LABEL,
  VAR_ROUNDING_LABEL,
  variableFormulaText,
  variableWarnings,
  componentFormulaText,
  componentWarnings,
  sortTiers,
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
  saveWorkDayRuleAction,
  savePayPostLegAction,
  deletePayPostLegAction,
  savePayRatesAction,
  deletePayRatesAction,
  savePayrollSettingAction,
} from "../actions";
import type { EmployeeRow } from "../data";
import type { PayrollConfig } from "./PayrollApp";
import { useDateFmt } from "@/lib/shared/dateFormatContext";
import { bangkokDateISO } from "@/lib/shared/datetime";
import { Button } from "@/lib/shared/page";

/**
 * ถามยืนยันก่อนลบ — ใช้ตัวเดียวกันทุกจุดในหน้านี้ ข้อความจะได้สม่ำเสมอ
 * ★ ของในหน้านี้ลบแล้วกู้ไม่ได้ และบางอย่างมีของอื่นอ้างอยู่ (รายการอ้างตัวแปร ·
 *   ขาอ้างรายการ · งวดที่แช่ค่าไว้อ้างรหัสช่องกรอก) — ต้องถามก่อนเสมอ
 */
function useAskDelete() {
  // 🪤 D134 — เดิมใช้ window.confirm() ซึ่งเบราว์เซอร์บล็อกแล้วคืน false เงียบ ๆ = ปุ่มลบตายทั้งหน้า
  //    เป็น hook แล้ว ⇒ ทุกการ์ดที่เรียกต้องวาง `{confirmNode}` ไม่งั้นกดลบแล้วค้าง
  const { confirmNode, ask } = useConfirm();
  async function askDelete(what: string, then: () => void) {
    if (await ask({ title: `ลบ${what}?`, detail: "ลบแล้วกู้คืนไม่ได้", confirmText: "ลบ", danger: true })) then();
  }
  return { confirmNode, askDelete };
}
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

export function ConfigTab({ config, employees }: { config: PayrollConfig; employees: EmployeeRow[] }) {
  return (
    <SettingsShell
      sections={[
        {
          key: "basic",
          label: "ค่าตั้งพื้นฐาน",
          body: (
            <div className="space-y-4">
              <BasicSettings config={config} />
              <WorkDays config={config} />
            </div>
          ),
        },
        { key: "groups", label: "กลุ่มพนักงาน", count: config.groups.length, body: <Groups config={config} /> },
        { key: "inputs", label: "ช่องกรอกต่อคน", count: config.inputs.length, body: <Inputs config={config} /> },
        {
          key: "formulas",
          label: "สูตรและรายการคำนวณ",
          count: config.variables.length + config.components.length,
          body: <Formulas config={config} employees={employees} />,
        },
        { key: "legs", label: "ขาลงบัญชี", count: config.legs.length, body: <PostLegs config={config} /> },
        { key: "rates", label: "ชุดอัตราตามกฎหมาย", count: config.rates.length, body: <Rates config={config} /> },
      ]}
    />
  );
}

// ── ค่าตั้งพื้นฐาน ───────────────────────────────────────────────────────────
function BasicSettings({ config }: { config: PayrollConfig }) {
  const router = useRouter();
  const { pending, run } = useSaver();
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
    <SettingsCard title="ค่าตั้งพื้นฐาน">
      <div className="grid grid-cols-1 gap-3 py-2 sm:grid-cols-3">
        <Field label="ชั่วโมงทำงานต่อวัน">
          <NumBox value={hours} onChange={(v) => setHours(v === "" ? 0 : v)} />
        </Field>
        <Field label="การปัดเศษ">
          <Select value={rounding} onChange={(e) => setRounding(e.target.value)}>
            <option value="baht">ปัดเป็นจำนวนเต็มบาท</option>
            <option value="satang">เก็บทศนิยม 2 ตำแหน่ง</option>
          </Select>
        </Field>
        <Field
          label="บัญชีเงินหลักที่ใช้จ่ายเงินเดือน"
          help={<>ขาลงบัญชีที่ไม่ระบุบัญชีเงินของตัวเอง จะใช้บัญชีหลักนี้ ·
            รายชื่อบัญชีมาจากบัญชีเงินที่ตั้งไว้ในแอปบัญชี</>}
        >
          <AccountSelect value={pay} onChange={setPay} accounts={config.bankAccounts} />
        </Field>
      </div>
      <div className="mt-1 pb-2"><SaveButton pending={pending} onClick={saveAll}>บันทึกค่าตั้ง</SaveButton></div>
    </SettingsCard>
  );
}

// ── กลุ่มพนักงาน ─────────────────────────────────────────────────────────────
function Groups({ config }: { config: PayrollConfig }) {
  const router = useRouter();
  const { pending, run } = useSaver();
  const { confirmNode, askDelete } = useAskDelete();

  return (
    <>
      {confirmNode}
      <SettingsList
        title="กลุ่มพนักงาน"
        help={<>ใช้คุมว่ารายการไหนให้ใครบ้าง — เช่นตั้ง 2 กลุ่มแล้วให้ค่าล่วงเวลาคนละตัวคูณ
          (สร้างรายการ 2 แถว แถวละกลุ่ม)</>}
        items={config.groups}
        pending={pending}
        placeholder="เช่น รายวัน / หัวหน้างาน แล้วกด Enter"
        emptyHint="— ยังไม่มี —"
        onAdd={(v) => run(() => addPayGroupAction(v), "เพิ่มแล้ว", () => router.refresh())}
        onDelete={(g) => askDelete(`กลุ่ม "${g}"`, () => run(() => deletePayGroupAction(g), "ลบแล้ว", () => router.refresh()))}
      />
    </>
  );
}

// ── ช่องกรอกต่อคนต่องวด ──────────────────────────────────────────────────────
function Inputs({ config }: { config: PayrollConfig }) {
  const router = useRouter();
  const { pending, run } = useSaver();
  const { confirmNode, askDelete } = useAskDelete();
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
    <SettingsCard
      title="ช่องที่ต้องกรอกต่อคนต่องวด"
      count={rows.length}
      unit="ช่อง"
      help={<>
        คอลัมน์ในตารางงวดจ่ายมาจากที่นี่ — เช่น ชั่วโมง OT · วันลาป่วย · จำนวนครั้งที่มาสาย
        (รหัสเป็นภาษาอังกฤษเพราะใช้เป็นคีย์ของข้อมูล ส่วนชื่อที่แสดงเป็นไทยได้)
        <br />
        ★ ปุ่ม ▲▼ ย้ายลำดับคอลัมน์ได้ — ช่องที่เพิ่มทีหลังไม่จำเป็นต้องอยู่ท้ายสุดตลอดไป
        <br />
        ★ <b>จำค่าจากงวดก่อน</b> เหมาะกับค่าที่เท่าเดิมทุกเดือน เช่นค่าตำแหน่ง — ตอนสร้างงวดใหม่ระบบยกค่าของคนเดิมจากงวดล่าสุดมาให้ แก้ในงวดนั้นได้
      </>}
    >
      {confirmNode}
      {rows.length === 0 && <ListEmpty />}
      {rows.map((i, idx) => (
        <ListRow
          key={i.code}
          title={i.label}
          sub={i.unit ? `หน่วย: ${i.unit}` : undefined}
          meta={
            <label className="flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                disabled={pending}
                checked={i.carryForward}
                aria-label={`จำค่า ${i.label} จากงวดก่อน`}
                onChange={(e) => run(
                  () => savePayInputAction({ ...i, unit: i.unit ?? "", carryForward: e.target.checked }),
                  "บันทึกแล้ว",
                  () => router.refresh(),
                )}
              />
              จำค่าจากงวดก่อน
            </label>
          }
          actions={
            <>
              {/* ★ ลำดับที่นี่ = ลำดับคอลัมน์ในตารางงวดจ่าย — ย้ายได้โดยไม่ต้องลบแล้วสร้างใหม่
                  (ลบช่องที่มีข้อมูลกรอกไว้แล้ว = ค่าที่คีย์ไปหายทั้งงวด) */}
              <IconBtn
                disabled={pending || idx === 0}
                onClick={() => move(idx, -1)}
                aria-label={`ย้าย ${i.label} ขึ้น`}
                title="ย้ายขึ้น"
              >▲</IconBtn>
              <IconBtn
                disabled={pending || idx === rows.length - 1}
                onClick={() => move(idx, 1)}
                aria-label={`ย้าย ${i.label} ลง`}
                title="ย้ายลง"
              >▼</IconBtn>
              <IconBtn
                tone="red"
                disabled={pending}
                onClick={() => askDelete(`ช่อง "${i.label}"`, () => run(() => deletePayInputAction(i.code), "ลบแล้ว", () => { setOrder(null); router.refresh(); }))}
                aria-label={`ลบ ${i.label}`}
                title="ลบช่องนี้"
              ><IconTrash size={16} /></IconBtn>
            </>
          }
        />
      ))}
      <div className="mt-1 grid grid-cols-1 gap-3 border-t border-line-soft py-3 sm:grid-cols-3">
        <Field label="ชื่อที่แสดง"><TextInput value={label} onChange={(e) => setLabel(e.target.value)} placeholder="OT วันทำงาน" /></Field>
        <Field label="หน่วย"><TextInput value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="ชั่วโมง" /></Field>
        <div className="flex items-end">
          <SaveButton
            pending={pending}
            onClick={() => run(
              () => savePayInputAction({ code: "", label, unit, sort: rows.length, active: true }),
              "เพิ่มช่องแล้ว",
              () => { setLabel(""); setUnit(""); setOrder(null); router.refresh(); },
            )}
          >เพิ่มช่อง</SaveButton>
        </div>
      </div>
    </SettingsCard>
  );
}

// ── สูตรและรายการคำนวณ (ตัวแปร + รายการเพิ่ม/หัก รวมกล่องเดียว · D71) ────────
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

function blankComponent(): PayComponent {
  return {
    code: "", name: "", kind: "earning", method: "fixed",
    // 🪤 ตัวคูณเริ่มต้นเคยเป็น 0 → เลือกวิธีคิด "ตัวแปรกลาง" แล้วไม่แตะตัวคูณ
    //    = ยอดเป็น 0 ทุกงวดโดยไม่มีอะไรฟ้อง · เริ่มที่ 1 แล้วให้คนที่อยากคูณเป็นคนแก้
    amount: 0, rate: 0, multiplier: 1, tiers: [],
    inputKeys: [], inputAgg: "sum", groupCodes: [], wageTypes: [],
    taxable: true, ssoBase: false, otBase: false, prorateBase: false,
    sort: 0, active: true,
  };
}

/**
 * ช่องเลือก "ค่าที่ใช้" 1 ช่อง (ตัวตั้งหรือขั้นของตัวแปร)
 *
 * 🚨 **ต้องประกาศไว้นอกคอมโพเนนต์เท่านั้น** — เดิมประกาศเป็น arrow function ข้างใน
 *    `Variables` ทำให้ทุกครั้งที่ setState React เห็นเป็น **component type ตัวใหม่**
 *    → unmount + mount ใหม่ทั้งกิ่ง → **`<input>` ถูกทำลายและโฟกัสหลุดทุกตัวอักษรที่พิมพ์**
 *    อาการที่ผู้ใช้เจอ: พิมพ์ตัวเลขได้ทีละตัวแล้วต้องคลิกกลับเข้าช่องใหม่ ใส่ทศนิยมไม่ได้
 *    (พิสูจน์ในเบราว์เซอร์แล้วว่าโหนด input เปลี่ยนตัวจริงหลังพิมพ์ 1 ครั้ง)
 */
function SlotPicker({
  kinds, kind, value, inputKey, inputOpts, onKind, onValue, onInput,
}: {
  /** จำกัดตัวเลือก — ไม่ส่ง = ทุกตัว */
  kinds?: VarSource[];
  kind: VarSource;
  value?: number;
  inputKey?: string;
  inputOpts: { value: string; label: string }[];
  onKind: (k: VarSource) => void;
  onValue: (v: number) => void;
  onInput: (k: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Select value={kind} onChange={(e) => onKind(e.target.value as VarSource)}>
        {(kinds ?? (Object.keys(VAR_SOURCE_LABEL) as VarSource[])).map((k) => (
          <option key={k} value={k}>{VAR_SOURCE_LABEL[k]}</option>
        ))}
      </Select>
      {kind === "constant" && (
        <NumBox value={value ?? 0} blankZero onChange={(v) => onValue(v === "" ? 0 : v)} />
      )}
      {kind === "input" && (
        <Select value={inputKey ?? ""} onChange={(e) => onInput(e.target.value)}>
          <option value="">— เลือกช่อง —</option>
          {inputOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      )}
    </div>
  );
}

/**
 * ตารางขั้นบันได — **แถวละขั้น ไม่มีการ parse สตริง**
 *
 * 🚨 ของเดิมเป็นช่องข้อความช่องเดียวที่แปลงกลับไปกลับมาทุกคีย์
 *    (`"1=500, 2=300"` ↔ array) → พิมพ์คอมมาปุ๊บขั้นที่ยังไม่เสร็จโดน filter ทิ้งทันที
 *    ผลจริงที่วัดได้: พิมพ์ `1=500, 2=300` ออกมาเป็น `1=5002300`
 *    → ห้ามกลับไปใช้ช่องข้อความช่องเดียวอีก
 */
function TierEditor({
  tiers, onChange,
}: {
  tiers: PayTier[];
  onChange: (t: PayTier[]) => void;
}) {
  const rows = tiers ?? [];
  const patch = (i: number, p: Partial<PayTier>) =>
    onChange(rows.map((t, idx) => (idx === i ? { ...t, ...p } : t)));

  return (
    <div className="space-y-2">
      {rows.length === 0 && <p className="text-xs text-faint">— ยังไม่มีขั้น กด &ldquo;เพิ่มเงื่อนไข&rdquo; —</p>}
      {rows.map((t, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">ถ้าค่าที่กรอก ≤</span>
          <div className="w-28">
            <NumBox value={t.upTo} blankZero onChange={(v) => patch(i, { upTo: v === "" ? 0 : v })} />
          </div>
          <span className="text-sm text-muted">→ ได้</span>
          <div className="w-32">
            <NumBox value={t.amount} blankZero onChange={(v) => patch(i, { amount: v === "" ? 0 : v })} />
          </div>
          <span className="text-sm text-faint">บาท</span>
          <IconBtn
            tone="red"
            onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
            aria-label={`ลบเงื่อนไขที่ ${i + 1}`}
            title="ลบเงื่อนไขนี้"
          ><IconTrash size={16} /></IconBtn>
        </div>
      ))}
      <button
        onClick={() => onChange([...rows, { upTo: 0, amount: 0 }])}
        className="text-xs text-brand hover:underline"
      >+ เพิ่มเงื่อนไข</button>
      <p className="text-xs text-faint">
        ★ ระบบใช้ขั้น<b>แรก</b>ที่ค่าที่กรอก ≤ ขอบบน · เกินทุกขั้น = 0 ·
        เรียงจากน้อยไปมากให้อัตโนมัติตอนบันทึก
      </p>
    </div>
  );
}

/**
 * สูตรวันทำงาน — ลูกค้าเห็นว่าตารางงวดคิดวันทำงานมาจากอะไร
 * ★ รายเดือนเต็มแสดงด้วยแต่แก้ไม่ได้ เพราะเงินไม่ขึ้นกับวันทำงาน
 */
function WorkDays({ config }: { config: PayrollConfig }) {
  const router = useRouter();
  const { pending, run } = useSaver();
  const [edit, setEdit] = useState<{ wage: WorkDayWageType; v: PayVariable } | null>(null);
  const inputOpts = config.inputs.map((i) => ({ value: i.code, label: i.label }));
  const inputLabels = Object.fromEntries(config.inputs.map((i) => [i.code, i.label]));

  const set = <K extends keyof PayVariable>(k: K, val: PayVariable[K]) =>
    setEdit((p) => (p ? { ...p, v: { ...p.v, [k]: val } } : p));
  function setStep(idx: number, patch: Partial<VarStep>) {
    setEdit((p) => {
      if (!p) return p;
      const d = [...(p.v.steps ?? [])];
      d[idx] = { ...d[idx], ...patch };
      return { ...p, v: { ...p.v, steps: d } };
    });
  }

  function open(wage: WorkDayWageType) {
    const rule = ruleOf(config.workDayRules, wage);
    setEdit({ wage, v: rule ?? { code: "", name: "", source: "work_days_std", steps: [] } });
  }

  return (
    <SettingsCard
      title="ค่าจ้างและวันทำงาน"
      help={<>ค่าตั้งต้นของตารางงวด — วันทำงานในตารางคิดจากสูตรนี้ แล้วแก้รายคนได้ในตาราง ·
        เปลี่ยนสูตรแล้วมีผลกับงวดร่าง ส่วนงวดที่ลงบัญชีแล้วไม่ขยับ</>}
    >
      {WAGE_TYPES.map((w) => (
        <ListRow
          key={w}
          title={WAGE_LABEL[w]}
          sub={
            <>
              <span className="block">ค่าจ้างฐาน: {wageBaseText(w)}</span>
              <span className="block">วันทำงาน: {workDayRuleText(w, config.workDayRules, inputLabels)}</span>
            </>
          }
          actions={
            w !== "monthly" ? (
              <IconBtn onClick={() => open(w)} aria-label={`แก้ไขวันทำงาน ${WAGE_LABEL[w]}`} title="แก้ไข"><IconEdit size={16} /></IconBtn>
            ) : undefined
          }
        />
      ))}

      {edit && (
        <Modal
          title={`วันทำงาน — ${WAGE_LABEL[edit.wage]}`}
          onClose={() => setEdit(null)}
          onSubmit={() => run(() => saveWorkDayRuleAction(edit.wage, edit.v), "บันทึกแล้ว", () => { setEdit(null); router.refresh(); })}
          busy={pending}
          size="lg"
          footer={
            <>
              <ModalCancel onClick={() => setEdit(null)} />
              <SaveButton
                pending={pending}
                onClick={() => run(() => saveWorkDayRuleAction(edit.wage, edit.v), "บันทึกแล้ว", () => { setEdit(null); router.refresh(); })}
              >บันทึก</SaveButton>
            </>
          }
        >
            <VarForm
              v={edit.v} inputOpts={inputOpts} inputLabels={inputLabels}
              set={set} setStep={setStep} kinds={WORK_DAY_SOURCES}
            />
            <p className="mt-2 text-xs text-faint">
              คนรายวันได้เงินตามวันที่มาจริง — ถ้าไม่อยากให้ระบบคิดเป็นวันมาตรฐาน ให้สร้างช่องกรอก เช่น &ldquo;วันมาทำงาน&rdquo; แล้วเลือกช่องนั้นเป็นตัวตั้ง
            </p>
        </Modal>
      )}
    </SettingsCard>
  );
}

type EditTarget =
  | { type: "var"; v: PayVariable; isNew: boolean }
  | { type: "comp"; c: PayComponent; isNew: boolean };

function Formulas({ config, employees }: { config: PayrollConfig; employees: EmployeeRow[] }) {
  const router = useRouter();
  const { pending, run } = useSaver();
  const { confirmNode, askDelete } = useAskDelete();
  const [edit, setEdit] = useState<EditTarget | null>(null);
  // ปุ่มดูตามชนิดค่าจ้าง — ซ่อนแค่บนจอ ข้อมูลยังชุดเดียว
  const [view, setView] = useState<WageType | "all">("all");
  const shownComps = view === "all" ? config.components : config.components.filter((c) => componentForWage(c, view));
  const dailyWarn = dailyWageWarnings(config.components, config.variables, employees.filter((e) => e.active));

  const inputOpts = config.inputs.map((i) => ({ value: i.code, label: i.label }));
  const inputLabels = Object.fromEntries(config.inputs.map((i) => [i.code, i.label]));
  const variableNames = Object.fromEntries(config.variables.map((v) => [v.code, v.name]));

  const setVar = <K extends keyof PayVariable>(k: K, val: PayVariable[K]) =>
    setEdit((p) => (p && p.type === "var" ? { ...p, v: { ...p.v, [k]: val } } : p));
  const setComp = <K extends keyof PayComponent>(k: K, val: PayComponent[K]) =>
    setEdit((p) => (p && p.type === "comp" ? { ...p, c: { ...p.c, [k]: val } } : p));

  function setStep(idx: number, patch: Partial<VarStep>) {
    setEdit((p) => {
      if (!p || p.type !== "var") return p;
      const d = [...(p.v.steps ?? [])];
      d[idx] = { ...d[idx], ...patch };
      return { ...p, v: { ...p.v, steps: d } };
    });
  }

  const usesInputs =
    edit?.type === "comp" && !["fixed", "manual", "percent_base"].includes(edit.c.method);

  function save() {
    if (!edit) return;
    if (edit.type === "var") {
      run(() => savePayVariableAction(edit.v), "บันทึกแล้ว", () => { setEdit(null); router.refresh(); });
    } else {
      // 🚨 เรียงขั้นบันไดก่อนบันทึกเสมอ — tierAmount() คืนขั้นแรกที่เข้าเงื่อนไข
      const c = { ...edit.c, tiers: sortTiers(edit.c.tiers) };
      run(() => savePayComponentAction(c), "บันทึกแล้ว", () => { setEdit(null); router.refresh(); });
    }
  }

  return (
    <SettingsCard
      title="สูตรและรายการคำนวณ"
      count={config.variables.length + config.components.length}
      help={<>ที่นี่มี 2 อย่าง — <b>ตัวแปร</b> คือค่ากลางที่คำนวณไว้ให้เอาไปใช้ต่อ (เช่นอัตราต่อชั่วโมง)
        และ <b>รายการเพิ่ม/หัก</b> คือเงินที่ขึ้นบนสลิปจริง</>}
      action={
        <>
          <button
            onClick={() => setEdit({ type: "var", v: blankVariable(), isNew: true })}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-brand-line px-3 py-2 text-sm font-medium text-brand"
          ><IconPlus size={16} /> ตัวแปร</button>
          <Button
            onClick={() => setEdit({ type: "comp", c: blankComponent(), isNew: true })}
            tone="primary"
          ><IconPlus size={16} /> รายการเพิ่ม/หัก</Button>
        </>
      }
    >
      {confirmNode}
      <p className="py-2 text-xs text-faint">
        🚨 <b>ตัวแปรถูกคิดก่อนรายการเสมอ</b> → รายการอ้างตัวแปรได้ แต่<b>ตัวแปรอ้างรายการไม่ได้</b>
      </p>

      {dailyWarn.length > 0 && (
        <div className="mb-3 rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn">
          {dailyWarn.map((w, i) => <p key={i}>⚠ {w}</p>)}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-faint">ดูรายการของ</span>
        {(["all", ...WAGE_TYPES] as const).map((w) => (
          <button
            key={w}
            onClick={() => setView(w)}
            className={`rounded-full px-3 py-1 text-xs ${view === w ? "bg-brand text-on-brand" : "bg-raised text-muted"}`}
          >
            {w === "all" ? "ทุกแบบ" : WAGE_LABEL[w]}
          </button>
        ))}
      </div>
      {view !== "all" && (
        <p className="mb-3 rounded-lg bg-raised px-3 py-2 text-xs text-muted">
          ค่าจ้างฐาน = {wageBaseText(view)} · วันทำงาน = {workDayRuleText(view, config.workDayRules, inputLabels)}
        </p>
      )}

      {/* ── ตัวแปร (คิดก่อน) ── */}
      <div className="mb-1 mt-2 text-[10px] font-medium uppercase tracking-widest text-muted">
        ตัวแปร — คิดก่อน
      </div>
      {config.variables.length === 0 && <ListEmpty>— ยังไม่มีตัวแปร (ต้องมีก่อนถ้าจะคิดค่าล่วงเวลา) —</ListEmpty>}
      {config.variables.map((v) => (
        <ListRow
          key={v.code}
          dim={v.active === false}
          title={<>{v.name}{v.active === false && <span className="ml-1 text-xs text-faint">(ปิดอยู่)</span>}</>}
          sub={variableFormulaText(v, inputLabels)}
          actions={
            <>
              <IconBtn onClick={() => setEdit({ type: "var", v, isNew: false })} aria-label={`แก้ไข ${v.name}`} title="แก้ไข"><IconEdit size={16} /></IconBtn>
              <IconBtn
                tone="red"
                disabled={pending}
                onClick={() => askDelete(`ตัวแปร "${v.name}"`, () => run(() => deletePayVariableAction(v.code), "ลบแล้ว", () => router.refresh()))}
                aria-label={`ลบ ${v.name}`}
                title="ลบตัวแปรนี้"
              ><IconTrash size={16} /></IconBtn>
            </>
          }
        />
      ))}

      {/* ── รายการเพิ่ม/หัก (คิดทีหลัง) ── */}
      <div className="mb-1 mt-5 text-[10px] font-medium uppercase tracking-widest text-muted">
        รายการเพิ่ม / หัก — คิดทีหลัง
      </div>
      {shownComps.length === 0 && <ListEmpty>— ยังไม่มีรายการ —</ListEmpty>}
      {shownComps.map((c) => {
        // เข้าฐานไหนบ้าง — ข้อมูลเดิม 4 คอลัมน์ ✓/— ย้ายมารวมบรรทัดเดียว (ภาษีกับ ปกส. ไม่เท่ากัน จึงต้องเห็นครบ)
        const bases = [
          c.taxable ? "ภาษี" : null,
          c.ssoBase ? "ปกส." : null,
          c.otBase ? "ฐานตัวแปร" : null,
          c.prorateBase ? "prorate" : null,
        ].filter(Boolean).join(", ");
        return (
          <ListRow
            key={c.code}
            dim={c.active === false}
            title={
              <>
                {c.name}
                <span className="ml-1.5 text-xs text-muted">({c.kind === "earning" ? "เพิ่ม" : "หัก"})</span>
                {c.active === false && <span className="ml-1 text-xs text-faint">(ปิดอยู่)</span>}
              </>
            }
            sub={
              <>
                <span className="block">{componentFormulaText(c, { inputLabels, variableNames })}</span>
                <span className="block">
                  กลุ่ม: {(c.groupCodes ?? []).join(", ") || "ทุกกลุ่ม"} · ใช้กับ: {wageTypesText(c)} · เข้าฐาน: {bases || "—"}
                </span>
              </>
            }
            actions={
              <>
                <IconBtn onClick={() => setEdit({ type: "comp", c, isNew: false })} aria-label={`แก้ไข ${c.name}`} title="แก้ไข"><IconEdit size={16} /></IconBtn>
                <IconBtn
                  tone="red"
                  disabled={pending}
                  onClick={() => askDelete(`รายการ "${c.name}"`, () => run(() => deletePayComponentAction(c.code), "ลบแล้ว", () => router.refresh()))}
                  aria-label={`ลบ ${c.name}`}
                  title="ลบรายการนี้"
                ><IconTrash size={16} /></IconBtn>
              </>
            }
          />
        );
      })}

      {edit && (
        <Modal
          title={edit.type === "var" ? (edit.v.name || "ตัวแปรใหม่") : (edit.c.name || "รายการใหม่")}
          onClose={() => setEdit(null)}
          onSubmit={save}
          busy={pending}
          size="lg"
          footer={
            <>
              <ModalCancel onClick={() => setEdit(null)} />
              <SaveButton pending={pending} onClick={save}>บันทึก</SaveButton>
            </>
          }
        >
            {/* สลับชนิดได้เฉพาะตอนสร้างใหม่ — ของที่บันทึกแล้วอยู่คนละตาราง ย้ายข้ามไม่ได้ */}
            {edit.isNew && (
              <div className="mb-3 flex flex-wrap gap-4 rounded-lg border border-line px-3 py-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio" checked={edit.type === "var"}
                    onChange={() => setEdit({ type: "var", v: blankVariable(), isNew: true })}
                  />
                  ตัวแปร (ค่ากลางที่เอาไปใช้ต่อ)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio" checked={edit.type === "comp"}
                    onChange={() => setEdit({ type: "comp", c: blankComponent(), isNew: true })}
                  />
                  รายการเพิ่ม/หัก (ขึ้นบนสลิป)
                </label>
              </div>
            )}

            {edit.type === "var" ? (
              <VarForm
                v={edit.v} inputOpts={inputOpts} inputLabels={inputLabels}
                set={setVar} setStep={setStep}
              />
            ) : (
              <CompForm
                c={edit.c} config={config} usesInputs={!!usesInputs}
                inputLabels={inputLabels} variableNames={variableNames} set={setComp}
              />
            )}

        </Modal>
      )}
    </SettingsCard>
  );
}

/** ฟอร์มของ "ตัวแปร" */
function VarForm({
  v, inputOpts, inputLabels, set, setStep, kinds,
}: {
  v: PayVariable;
  /** ส่งมา = ฟอร์มสูตรวันทำงาน: จำกัดตัวเลือก และซ่อนชื่อ/การปัด/เปิดปิด */
  kinds?: VarSource[];
  inputOpts: { value: string; label: string }[];
  inputLabels: Record<string, string>;
  set: <K extends keyof PayVariable>(k: K, val: PayVariable[K]) => void;
  setStep: (idx: number, patch: Partial<VarStep>) => void;
}) {
  const steps = v.steps ?? [];
  return (
    <>
      {!kinds && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* ★ ไม่มีช่องรหัสแล้ว — ระบบตั้งให้เอง (ผู้ใช้จำรหัสที่ตัวเองตั้งไม่ได้อยู่ดี)
              🚨 ของที่บันทึกแล้วห้ามเปลี่ยนรหัส เพราะงวดที่แช่ค่าไว้อ้างรหัสนี้ */}
          <Field label="ชื่อที่คนอ่านรู้เรื่อง"><TextInput value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="อัตราค่าล่วงเวลาต่อชั่วโมง" /></Field>
        </div>
      )}

      <div className="mt-3">
        <Field label="ตัวตั้ง">
          <SlotPicker
            kinds={kinds}
            kind={v.source} value={v.constValue} inputKey={v.inputKey} inputOpts={inputOpts}
            onKind={(k) => set("source", k)}
            onValue={(x) => set("constValue", x)}
            onInput={(k) => set("inputKey", k)}
          />
        </Field>
      </div>

      <div className="mt-3 space-y-2">
        <span className="block text-sm text-muted">
          แล้วคิดต่อทีละขั้น (สูงสุด {MAX_VAR_STEPS} ขั้น · เว้นไว้ = ใช้ตัวตั้งตรง ๆ)
        </span>
        {Array.from({ length: MAX_VAR_STEPS }, (_, i) => i).map((idx) => {
          const d = steps[idx];
          if (!d && idx > 0 && !steps[idx - 1]) return null;
          return (
            <div key={idx} className="flex flex-wrap items-center gap-2">
              {d ? (
                <>
                  <Select value={d.op ?? "div"} onChange={(e) => setStep(idx, { op: e.target.value as VarOp })}>
                    {(Object.keys(VAR_OP_LABEL) as VarOp[]).map((o) => (
                      <option key={o} value={o}>{VAR_OP_LABEL[o]}</option>
                    ))}
                  </Select>
                  <SlotPicker
                    kinds={kinds}
                    kind={d.kind} value={d.value} inputKey={d.inputKey} inputOpts={inputOpts}
                    onKind={(k) => setStep(idx, { kind: k })}
                    onValue={(x) => setStep(idx, { value: x })}
                    onInput={(k) => setStep(idx, { inputKey: k })}
                  />
                  <IconBtn
                    tone="red"
                    onClick={() => set("steps", steps.filter((_, i) => i !== idx))}
                    aria-label={`เอาขั้นที่ ${idx + 1} ออก`}
                    title="เอาขั้นนี้ออก"
                  ><IconTrash size={16} /></IconBtn>
                </>
              ) : (
                <button
                  onClick={() => set("steps", [...steps, kinds ? { op: "sub", kind: "input" } : { op: "div", kind: "work_days_std" }])}
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

      {!kinds && (
        <div className="mt-3">
          <Field label="ความละเอียดของค่าที่ได้">
            <Select value={v.rounding ?? "none"} onChange={(e) => set("rounding", e.target.value as VarRounding)}>
              {(Object.keys(VAR_ROUNDING_LABEL) as VarRounding[]).map((r) => (
                <option key={r} value={r}>{VAR_ROUNDING_LABEL[r]}</option>
              ))}
            </Select>
          </Field>
        </div>
      )}

      <FormulaBox text={variableFormulaText(v, inputLabels)} warnings={variableWarnings(v)} />

      {!kinds && (
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.active !== false} onChange={(e) => set("active", e.target.checked)} />
          เปิดใช้งาน
        </label>
      )}
    </>
  );
}

/** ฟอร์มของ "รายการเพิ่ม/หัก" */
function CompForm({
  c, config, usesInputs, inputLabels, variableNames, set,
}: {
  c: PayComponent;
  config: PayrollConfig;
  usesInputs: boolean;
  inputLabels: Record<string, string>;
  variableNames: Record<string, string>;
  set: <K extends keyof PayComponent>(k: K, val: PayComponent[K]) => void;
}) {
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="ชื่อที่แสดงบนสลิป"><TextInput value={c.name} onChange={(e) => set("name", e.target.value)} placeholder="ค่าล่วงเวลา 1.5" /></Field>
        <Field label="ประเภท">
          <Select value={c.kind} onChange={(e) => set("kind", e.target.value as PayComponent["kind"])}>
            <option value="earning">เพิ่ม (บวกเข้าเงินได้)</option>
            <option value="deduction">หัก (ลบออกจากยอดจ่าย)</option>
          </Select>
        </Field>
        <Field label="วิธีคิด">
          <Select value={c.method} onChange={(e) => set("method", e.target.value as PayComponent["method"])}>
            {(Object.keys(METHOD_LABEL) as PayComponent["method"][]).map((m) => (
              <option key={m} value={m}>{METHOD_LABEL[m]}</option>
            ))}
          </Select>
        </Field>

        {(c.method === "fixed" || c.method === "per_unit") && (
          <Field label={c.method === "fixed" ? "จำนวนเงินต่องวด" : "จำนวนเงินต่อหน่วย"}>
            <NumBox value={c.amount ?? 0} blankZero onChange={(v) => set("amount", v === "" ? 0 : v)} />
          </Field>
        )}
        {c.method === "percent_base" && (
          <Field label="เปอร์เซ็นต์ของค่าจ้างฐาน">
            <NumBox value={c.rate ?? 0} blankZero onChange={(v) => set("rate", v === "" ? 0 : v)} />
          </Field>
        )}
        {c.method === "variable" && (
          <>
            <Field label="ตัวแปรที่ใช้เป็นฐาน">
              <Select value={c.variableCode ?? ""} onChange={(e) => set("variableCode", e.target.value)}>
                <option value="">— เลือกตัวแปร —</option>
                {config.variables.map((v) => <option key={v.code} value={v.code}>{v.name}</option>)}
              </Select>
            </Field>
            <Field label="ตัวคูณ (ใช้ค่าตัวแปรตรง ๆ ให้ใส่ 1)">
              <NumBox value={c.multiplier ?? 0} blankZero onChange={(v) => set("multiplier", v === "" ? 0 : v)} />
            </Field>
          </>
        )}
      </div>

      {c.method === "tier_table" && (
        <div className="mt-3">
          <Field label="ขั้นบันได — ตั้งกี่เงื่อนไขก็ได้">
            <TierEditor tiers={c.tiers ?? []} onChange={(t) => set("tiers", t)} />
          </Field>
        </div>
      )}

      {usesInputs && (
        <div className="mt-3 space-y-2">
          <span className="block text-sm text-muted">ใช้ค่าจากช่องกรอก (ติ๊กได้หลายช่อง)</span>
          <CheckList
            options={config.inputs.map((i) => ({ value: i.code, label: i.label }))}
            value={c.inputKeys ?? []}
            onChange={(v) => set("inputKeys", v)}
            empty="— ยังไม่มีช่องกรอก (สร้างในการ์ดด้านบน) —"
          />
          {(c.inputKeys ?? []).length > 1 && (
            <Field label="รวมค่าจากหลายช่องยังไง">
              <Select value={c.inputAgg ?? "sum"} onChange={(e) => set("inputAgg", e.target.value as "sum" | "avg")}>
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
          value={c.groupCodes ?? []}
          onChange={(v) => set("groupCodes", v)}
          empty="— ยังไม่มีกลุ่มพนักงาน (รายการนี้จะให้ทุกคน) —"
        />
        <span className="block text-sm text-muted">ใช้กับวิธีคิดค่าจ้าง (ไม่ติ๊กเลย = ทุกแบบ)</span>
        <CheckList
          options={WAGE_TYPES.map((w) => ({ value: w, label: WAGE_LABEL[w] }))}
          value={c.wageTypes ?? []}
          onChange={(v) => set("wageTypes", v as WageType[])}
        />
      </div>

      <FormulaBox
        text={componentFormulaText(c, { inputLabels, variableNames })}
        warnings={componentWarnings(c)}
      />

      <div className="mt-3 rounded-lg bg-raised p-3">
        <p className="mb-2 text-xs text-muted">
          <b>รายการนี้เข้าฐานไหนบ้าง</b> — 🚨 ฐานภาษีกับฐานประกันสังคม<b>ไม่เท่ากัน</b>:
          ค่าล่วงเวลาและโบนัสเข้าฐานภาษี แต่ไม่ใช่ &ldquo;ค่าจ้าง&rdquo; ตาม พ.ร.บ.ประกันสังคม
          ติดผิด = ตัวเลขที่ยื่นผิดตั้งแต่เดือนแรกโดยไม่มีอะไรฟ้อง
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={c.taxable ?? false} onChange={(e) => set("taxable", e.target.checked)} />
            เข้าฐานภาษีเงินได้
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={c.ssoBase ?? false} onChange={(e) => set("ssoBase", e.target.checked)} />
            เข้าฐานประกันสังคม
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={c.otBase ?? false} onChange={(e) => set("otBase", e.target.checked)} />
            รวมเข้าฐานที่ตัวแปรใช้คิด
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={c.prorateBase ?? false} onChange={(e) => set("prorateBase", e.target.checked)} />
            รวมกับค่าจ้างฐานแล้วลดตามวันมาทำงาน
          </label>
        </div>
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={c.active !== false} onChange={(e) => set("active", e.target.checked)} />
        เปิดใช้งาน
      </label>
    </>
  );
}

/** กล่อง "สูตรที่จะถูกใช้จริง" — ด่านกันตั้งเกณฑ์ผิดโดยไม่รู้ตัว (ห้ามเอาออก) */
function FormulaBox({ text, warnings }: { text: string; warnings: string[] }) {
  return (
    <div className="mt-3 rounded-lg bg-raised px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-widest text-muted">สูตรที่จะถูกใช้จริง</div>
      <div className="mt-1 text-sm font-medium text-ink">{text}</div>
      {warnings.map((w, i) => (
        <p key={i} className="mt-1 text-xs text-warn">⚠ {w}</p>
      ))}
    </div>
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
  const { pending, run } = useSaver();
  const { confirmNode, askDelete } = useAskDelete();
  const [edit, setEdit] = useState<PayPostLeg | null>(null);
  const set = <K extends keyof PayPostLeg>(k: K, v: PayPostLeg[K]) =>
    setEdit((p) => (p ? { ...p, [k]: v } : p));

  return (
    <SettingsCard
      title="ขาลงบัญชี"
      count={config.legs.length}
      unit="ขา"
      help={<>กำหนดว่าเงินเดือนไปเป็นรายจ่ายในบัญชีเป็นกี่ก้อน — ตั้งกี่ขาก็ได้ ·
        หมวดรายจ่ายพิมพ์เอง ไม่ต้องมีในรายการหมวดเดิม</>}
      action={
        <Button
          onClick={() => setEdit(blankLeg())}
          tone="primary"
        ><IconPlus size={16} /> เพิ่มขา</Button>
      }
    >
      {confirmNode}
      <p className="py-2 text-xs text-faint">
        🚨 <b>ขาที่ยอดซ้อนกัน = ลงรายจ่ายซ้ำ</b> (เช่นตั้งขาโอทีเพิ่มทั้งที่โอทีอยู่ในยอดสุทธิแล้ว) —
        ตรวจตัวเลขคุมที่แท็บงวดจ่ายก่อนลงบัญชีทุกครั้ง
      </p>

      {config.legs.length === 0 && (
        <ListEmpty>— ยังไม่มีขา (ตั้งอย่างน้อย 1 ขาก่อนถึงจะลงบัญชีได้) —</ListEmpty>
      )}
      {config.legs.map((l) => (
        <ListRow
          key={l.code}
          dim={l.active === false}
          title={<>{l.name}{l.active === false && <span className="ml-1 text-xs text-faint">(ปิดอยู่)</span>}</>}
          sub={
            <>
              <span className="block">
                ยอดที่ลง: {LEG_SOURCE_LABEL[l.amountSource]}
                {l.amountSource === "component" && ` — ${config.components.find((c) => c.code === l.componentCode)?.name ?? l.componentCode}`}
                {" · "}{l.splitByEmployee ? "แยกรายคน" : "ก้อนเดียว"}
              </span>
              <span className="block">
                หมวด: {l.category || "—"} · บัญชี: {l.accountName || "(บัญชีหลัก)"} · วันที่แนะนำ: {l.suggestDay ? `สิ้นงวด + ${l.suggestDay} วัน` : "วันจ่ายเงินเดือน"}
              </span>
            </>
          }
          actions={
            <>
              <IconBtn onClick={() => setEdit(l)} aria-label={`แก้ไข ${l.name}`} title="แก้ไข"><IconEdit size={16} /></IconBtn>
              <IconBtn
                tone="red"
                disabled={pending}
                onClick={() => askDelete(`ขา "${l.name}"`, () => run(() => deletePayPostLegAction(l.code), "ลบแล้ว", () => router.refresh()))}
                aria-label={`ลบ ${l.name}`}
                title="ลบขานี้"
              ><IconTrash size={16} /></IconBtn>
            </>
          }
        />
      ))}

      {edit && (
        <Modal
          title={edit.name || "ขาใหม่"}
          onClose={() => setEdit(null)}
          onSubmit={() => run(() => savePayPostLegAction(edit), "บันทึกแล้ว", () => { setEdit(null); router.refresh(); })}
          busy={pending}
          size="lg"
          footer={
            <>
              <ModalCancel onClick={() => setEdit(null)} />
              <SaveButton pending={pending} onClick={() => run(() => savePayPostLegAction(edit), "บันทึกแล้ว", () => { setEdit(null); router.refresh(); })}>
                บันทึก
              </SaveButton>
            </>
          }
        >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              <Field label="หมวดรายจ่าย (พิมพ์เองได้ · มีตัวเลือกที่เคยใช้ให้)">
                <SuggestInput
                  listId="leg-cat-list"
                  value={edit.category}
                  onChange={(v) => set("category", v)}
                  options={config.expenseCategories}
                  placeholder="เงินเดือน"
                />
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
                <SuggestInput
                  listId="leg-contact-list"
                  value={edit.contactName ?? ""}
                  onChange={(v) => set("contactName", v)}
                  options={config.contactNames}
                  placeholder="สำนักงานประกันสังคม"
                />
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

        </Modal>
      )}
    </SettingsCard>
  );
}

// ── ชุดอัตราตามกฎหมาย ───────────────────────────────────────────────────────
function Rates({ config }: { config: PayrollConfig }) {
  const df = useDateFmt();
  const router = useRouter();
  const { pending, run } = useSaver();
  const { confirmNode, askDelete } = useAskDelete();
  // 🪤 เดิมเปิดมาพร้อมข้อมูล **ชุดล่าสุด รวมวันที่เริ่มมีผล** → กด "บันทึกชุดอัตรา"
  //    จะ upsert ทับชุดนั้นทั้งที่ผู้ใช้คิดว่ากำลังเพิ่มชุดใหม่ (คีย์ของตารางคือ effective_from)
  //    → เริ่มที่ชุดเปล่าเสมอ · จะแก้ของเดิมต้องกดปุ่ม "แก้" ในตารางให้ชัดเจน
  const [form, setForm] = useState<PayRates>(blankRates);
  const set = <K extends keyof PayRates>(k: K, v: PayRates[K]) => setForm((p) => ({ ...p, [k]: v }));

  // ★ วันที่ของชุดที่กำลังแก้อยู่ — null = กำลังเพิ่มชุดใหม่
  //   (คีย์ของตารางคือ effective_from → แก้วันที่ = สร้างชุดใหม่ ไม่ใช่แก้ชุดเดิม)
  const [editing, setEditing] = useState<string | null>(null);
  const today = bangkokDateISO(); // D161: เดิม toISOString = วันที่ UTC (ตี 0-7 ได้เมื่อวาน)

  function startEdit(r: PayRates) {
    setForm(r);
    setEditing(r.effectiveFrom);
  }

  function startNew() {
    setForm(blankRates());
    setEditing(null);
  }

  return (
    <SettingsCard title="ชุดอัตราตามกฎหมาย (มีวันเริ่มมีผล)" count={config.rates.length} unit="ชุด">
      {confirmNode}
      <p className="mb-3 text-xs text-faint">
        🚨 อัตราพวกนี้ถูกแก้ด้วยกฎกระทรวงเป็นระยะ — เก็บเป็นชุดที่มีวันเริ่มมีผล
        เพื่อให้เปิดดูงวดเก่าแล้วได้อัตราของตอนนั้น ไม่ใช่ของวันนี้ ·
        <b> ค่าที่ใส่ต้องตรวจกับประกาศจริงก่อนใช้ยื่น</b> ระบบไม่ได้อัปเดตให้อัตโนมัติ
      </p>

      {config.rates.length > 0 && (
        <div className="mb-3 overflow-x-auto">
          <table className="tbl">
            <thead><tr className="text-left text-faint"><th>เริ่มมีผล</th><th className="num">อัตรา ปกส.</th><th className="num">เพดานฐาน</th><th className="num">ลดหย่อนส่วนตัว</th><th className="num">ขั้นภาษี</th><th></th></tr></thead>
            <tbody>
              {config.rates.map((r) => (
                <tr key={r.effectiveFrom} className={editing === r.effectiveFrom ? "bg-brand-soft" : undefined}>
                  <td>{df.date(r.effectiveFrom)}</td>
                  <td className="num">{r.ssoRate}%</td>
                  <td className="num">{r.ssoWageMax.toLocaleString()}</td>
                  <td className="num">{r.personalAllowance.toLocaleString()}</td>
                  <td className="num">{(r.pitBrackets ?? []).length} ขั้น</td>
                  <td className="whitespace-nowrap">
                    <div className="flex items-center gap-1">
                      <IconBtn onClick={() => startEdit(r)} aria-label={`แก้ไขชุดอัตราที่เริ่มมีผล ${df.date(r.effectiveFrom)}`} title="แก้ไข"><IconEdit size={16} /></IconBtn>
                      <IconBtn
                        tone="red"
                        disabled={pending}
                        onClick={() => askDelete(
                          `ชุดอัตราที่เริ่มมีผล ${df.date(r.effectiveFrom)}`,
                          () => run(() => deletePayRatesAction(r.effectiveFrom), "ลบแล้ว", () => { startNew(); router.refresh(); }),
                        )}
                        aria-label={`ลบชุดอัตราที่เริ่มมีผล ${df.date(r.effectiveFrom)}`}
                        title="ลบชุดอัตรานี้"
                      ><IconTrash size={16} /></IconBtn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-ink">
          {editing ? `กำลังแก้ชุดที่เริ่มมีผล ${editing}` : "เพิ่มชุดอัตราใหม่"}
        </span>
        {editing && (
          <button onClick={startNew} className="text-xs text-brand hover:underline">
            + เพิ่มชุดใหม่แทน
          </button>
        )}
      </div>

      {editing && editing <= today && (
        <div className="mb-3 rounded-lg bg-warn-bg px-3 py-2 text-xs text-warn">
          ⚠ ชุดนี้มีผลไปแล้ว — งวดที่<b>บันทึกไว้แล้วจะไม่ขยับ</b> (แช่อัตราที่ใช้ตอนนั้นไว้ใน
          <code> rates_snapshot </code>) แต่ถ้ากด <b>คำนวณ &amp; บันทึก</b> งวดเก่าใหม่อีกครั้ง
          จะได้อัตราที่แก้นี้แทน · แก้เพื่อ<b>ซ่อมค่าที่กรอกผิด</b>ได้ ·
          ถ้าเป็น<b>อัตราใหม่ตามกฎกระทรวง</b> ให้กด &ldquo;เพิ่มชุดใหม่แทน&rdquo; แล้วใส่วันที่เริ่มมีผลจริง
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
        <Field label="ขั้นบันไดภาษีเงินได้บุคคลธรรมดา">
          <BracketEditor brackets={form.pitBrackets ?? []} onChange={(b) => set("pitBrackets", b)} />
        </Field>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <SaveButton
          pending={pending}
          onClick={() => run(
            () => savePayRatesAction(form),
            editing ? "แก้ชุดอัตราแล้ว" : "เพิ่มชุดอัตราแล้ว",
            () => { setEditing(form.effectiveFrom); router.refresh(); },
          )}
        >
          {editing ? "บันทึกการแก้ไข" : "เพิ่มชุดอัตรา"}
        </SaveButton>
        {editing && (
          <button onClick={startNew} className="rounded-lg border border-line px-4 py-2 text-sm text-muted">
            เลิกแก้
          </button>
        )}
      </div>
    </SettingsCard>
  );
}

/** ชุดอัตราเปล่าสำหรับ "เพิ่มชุดใหม่" — ค่าตั้งต้นเป็นของที่ใช้กันทั่วไป แต่ **ต้องตรวจกับประกาศจริง** */
function blankRates(): PayRates {
  return {
    effectiveFrom: "",
    ssoRate: 5, ssoWageMin: 1650, ssoWageMax: 15000,
    pitBrackets: [
      { upTo: 150000, rate: 0 }, { upTo: 300000, rate: 0.05 }, { upTo: 500000, rate: 0.1 },
      { upTo: 750000, rate: 0.15 }, { upTo: 1000000, rate: 0.2 }, { upTo: 2000000, rate: 0.25 },
      { upTo: 5000000, rate: 0.3 }, { upTo: 1e15, rate: 0.35 },
    ],
    personalAllowance: 60000, expenseRate: 50, expenseCap: 100000,
  };
}

/**
 * ขั้นบันไดภาษี — **แถวละขั้น ไม่มีการ parse สตริง**
 *
 * 🚨 ของเดิมเป็นช่องข้อความช่องเดียวที่แปลง `"150000=0, 300000=0.05"` ↔ array ทุกคีย์
 *    บั๊กเดียวกับขั้นบันไดเบี้ยขยันเป๊ะ (พิมพ์คอมมาแล้วขั้นที่ยังไม่เสร็จโดน filter ทิ้ง)
 *    — ที่ผ่านมาไม่มีใครเจอเพราะยังไม่มีปุ่มแก้ให้กด
 * ★ โชว์ `= X%` ข้างช่องอัตรา เพราะค่าที่เก็บเป็นทศนิยม (0.05) ซึ่งอ่านผิดเป็น 0.05% ได้ง่าย
 *   — เป็นการ **แสดงผลอย่างเดียว ไม่แปลงค่าที่เก็บ** (แปลงเมื่อไหร่คือความเสี่ยงกับเลขภาษี)
 */
function BracketEditor({
  brackets,
  onChange,
}: {
  brackets: PitBracket[];
  onChange: (b: PitBracket[]) => void;
}) {
  const rows = brackets ?? [];
  const patch = (i: number, p: Partial<PitBracket>) =>
    onChange(rows.map((b, idx) => (idx === i ? { ...b, ...p } : b)));

  return (
    <div className="space-y-2">
      {rows.length === 0 && <p className="text-xs text-faint">— ยังไม่มีขั้น กด &ldquo;เพิ่มขั้น&rdquo; —</p>}
      {rows.map((b, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">เงินได้สุทธิถึง</span>
          <div className="w-40"><NumBox value={b.upTo} onChange={(v) => patch(i, { upTo: v === "" ? 0 : v })} /></div>
          <span className="text-sm text-muted">อัตรา</span>
          <div className="w-24"><NumBox value={b.rate} onChange={(v) => patch(i, { rate: v === "" ? 0 : v })} /></div>
          <span className="w-14 text-sm text-faint">= {Math.round(Number(b.rate) * 10000) / 100}%</span>
          <IconBtn
            tone="red"
            onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
            aria-label={`ลบขั้นที่ ${i + 1}`}
            title="ลบขั้นนี้"
          ><IconTrash size={16} /></IconBtn>
        </div>
      ))}
      <button
        onClick={() => onChange([...rows, { upTo: 0, rate: 0 }])}
        className="text-xs text-brand hover:underline"
      >+ เพิ่มขั้น</button>
      <p className="text-xs text-faint">
        ★ อัตราใส่เป็น<b>ทศนิยม</b> (0.05 = 5%) · ขั้นบนสุดใส่ตัวเลขใหญ่ ๆ เพื่อครอบส่วนที่เหลือ
        (ค่าตั้งต้นใช้ 1e15) · เรียงจากน้อยไปมาก
      </p>
    </div>
  );
}
