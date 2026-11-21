import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  isActiveCert,
  issuedTxIdsOf,
  whtCertFiledPeriods,
  cancelWhtBlock,
  cancelWhtEffects,
  cancelWhtFiledWarn,
  whtIssuedEditNote,
  filedFromServer,
} from "./whtCancel";
import { changedFields } from "../shared/editLog";

/** D180 — ยกเลิกใบ 50ทวิ (migration 0113) */

const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const noTsComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const noSqlComments = (s: string) => s.replace(/--[^\n]*/g, "");
const SQL = read("supabase/migrations/20261121000113_wht_cancel.sql");

function fnBody(sql: string, name: string): string {
  const head = sql.indexOf(`create or replace function ${name}(`);
  expect(head, name).toBeGreaterThan(-1);
  const tag = sql.slice(head).match(/as\s+(\$[a-z]*\$)/i)![1];
  const open = sql.indexOf(tag, head);
  return sql.slice(head, sql.indexOf(tag, open + tag.length) + tag.length);
}

describe("isActiveCert / issuedTxIdsOf — คิวรอออกนับเฉพาะใบปกติ", () => {
  it("ใบปกติ / ไม่มีสถานะ (ข้อมูลเก่า) = ยังมีผล · ยกเลิก = ไม่มีผล", () => {
    expect(isActiveCert({ status: "ปกติ" })).toBe(true);
    expect(isActiveCert({ status: null })).toBe(true);
    expect(isActiveCert({})).toBe(true);
    expect(isActiveCert({ status: "ยกเลิก" })).toBe(false);
  });

  it("★ บิลในใบที่ยกเลิก กลับเข้าคิว · บิลที่มีใบใหม่ยังนับว่าออกแล้ว", () => {
    const s = issuedTxIdsOf([
      { tx_ids: ["TX-1"], status: "ยกเลิก" },
      { tx_ids: ["TX-2", ""], status: "ปกติ" },
      { tx_ids: null, status: "ปกติ" },
    ]);
    expect([...s]).toEqual(["TX-2"]);
    // ยกเลิกแล้วออกใหม่ให้บิลเดิม → ออกแล้ว
    expect(issuedTxIdsOf([{ tx_ids: ["TX-1"], status: "ยกเลิก" }, { tx_ids: ["TX-1"], status: "ปกติ" }]).has("TX-1")).toBe(true);
  });
});

describe("whtCertFiledPeriods — ภงด. ที่ยื่นแล้ว", () => {
  const txs = [
    { tx_id: "A", transaction_date: "2026-09-28", settled_on: "2026-10-05" }, // บิลค้าง เคลียเดือน 10
    { tx_id: "B", transaction_date: "2026-11-02", settled_on: null },
    { tx_id: "Z", transaction_date: "2026-08-01", settled_on: null }, // ไม่อยู่ในใบ
  ];

  it("ยังไม่ยื่น = ว่าง", () => {
    expect(whtCertFiledPeriods(["A"], txs, [])).toEqual([]);
  });

  it("🚨 เดือนของบิล = วันที่เคลีย (settled_on) ไม่ใช่วันที่รายการ — ตรงกับ ภงด. (cashDateOf · D123)", () => {
    expect(whtCertFiledPeriods(["A"], txs, [{ kind: "pnd53", period: "2026-10" }])).toEqual(["ภ.ง.ด.53 งวด 2026-10"]);
    expect(whtCertFiledPeriods(["A"], txs, [{ kind: "pnd53", period: "2026-09" }])).toEqual([]);
  });

  it("นับทั้ง ภงด.3 และ 53 (ภงด. แยกแบบด้วยชื่อคู่ค้า ไม่ใช่ pnd_type บนใบ) · ไม่นับ ภพ.30", () => {
    const f = [
      { kind: "pnd3", period: "2026-11" },
      { kind: "pnd53", period: "2026-11" },
      { kind: "vat", period: "2026-11" },
    ];
    expect(whtCertFiledPeriods(["B"], txs, f)).toEqual(["ภ.ง.ด.3 งวด 2026-11", "ภ.ง.ด.53 งวด 2026-11"]);
  });

  it("แถวที่ถอนแล้วไม่นับ · บิลที่ไม่อยู่ในใบไม่นับ", () => {
    expect(whtCertFiledPeriods(["B"], txs, [{ kind: "pnd3", period: "2026-11", reopened_at: "2026-11-10T00:00:00Z" }])).toEqual([]);
    expect(whtCertFiledPeriods(["B"], txs, [{ kind: "pnd3", period: "2026-08" }])).toEqual([]);
  });

  it("จัดรูปงวดตามหน้าจอได้ · เรียงตามงวด", () => {
    const r = whtCertFiledPeriods(["A", "B"], txs, [{ kind: "pnd3", period: "2026-11" }, { kind: "pnd3", period: "2026-10" }], (p) => `[${p}]`);
    expect(r).toEqual(["ภ.ง.ด.3 งวด [2026-10]", "ภ.ง.ด.3 งวด [2026-11]"]);
  });
});

describe("ปุ่ม/ข้อความในป๊อปอัพยกเลิก", () => {
  it("ต้องมีเหตุผล", () => {
    expect(cancelWhtBlock({ reason: "  ", filed: [], ackFiled: false })).toContain("เหตุผล");
    expect(cancelWhtBlock({ reason: "ยอดผิด", filed: [], ackFiled: false })).toBeNull();
  });
  it("🚨 ยื่นแล้วต้องติ๊กรับทราบก่อน (เตือน ไม่บล็อก)", () => {
    expect(cancelWhtBlock({ reason: "ยอดผิด", filed: ["ภ.ง.ด.3 งวด 2026-10"], ackFiled: false })).toContain("รับทราบ");
    expect(cancelWhtBlock({ reason: "ยอดผิด", filed: ["ภ.ง.ด.3 งวด 2026-10"], ackFiled: true })).toBeNull();
  });
  it("บอกว่าเลขไม่ถูกนำกลับมาใช้ · บิลกลับเข้าคิว · แก้ยอดที่บิล", () => {
    const t = cancelWhtEffects({ docNo: "6907", billCount: 1 }).join("\n");
    expect(t).toContain("6907");
    expect(t).toContain("ไม่ใช้เลขนี้ซ้ำ");
    expect(t).toContain("กลับเข้าคิว");
    expect(t).toContain("ยอดที่ใช้คิดหัก ณ ที่จ่าย");
    expect(cancelWhtEffects({ docNo: "6907", billCount: 0 }).join("\n")).toContain("ไม่มีบิลกลับเข้าคิว");
  });
  it("คำเตือนยื่นแล้ว บอกว่าต้องยื่นแบบเพิ่มเติมเอง · ยังไม่ยื่น = null", () => {
    expect(cancelWhtFiledWarn([])).toBeNull();
    expect(cancelWhtFiledWarn(["ภ.ง.ด.53 งวด ต.ค. 69"])).toContain("ยื่นแบบเพิ่มเติม");
  });
  it("หน้าแก้บิลเตือนเมื่อมีใบที่ยังมีผล", () => {
    expect(whtIssuedEditNote([])).toBeNull();
    const n = whtIssuedEditNote(["6901"])!;
    expect(n).toContain("6901");
    expect(n).toContain("ยกเลิกใบ");
  });
});

describe("แก้จากเทสเบราว์เซอร์ 133 (2026-11-22)", () => {
  it("ข้อความยื่นแล้วจาก server → รายการ + งวดตามหน้าจอ (ไม่ใช่ 2026-11 ดิบ)", () => {
    expect(filedFromServer(null)).toEqual([]);
    expect(filedFromServer("ภ.ง.ด.3 งวด 2026-11, ภ.ง.ด.53 งวด 2026-10", (p) => `<${p}>`))
      .toEqual(["ภ.ง.ด.3 งวด <2026-11>", "ภ.ง.ด.53 งวด <2026-10>"]);
  });

  it("🪤 ป๊อปอัพ: server ตอบ need_ack = กล่องเหลือง ไม่ใช่กล่องแดงพูดซ้ำ (อ่านซอร์ส)", () => {
    const dlg = noTsComments(read("app/(app)/accounting/_components/CancelWhtDialog.tsx"));
    const i = dlg.indexOf("if (r.needAck && r.filed)");
    expect(i).toBeGreaterThan(0);
    const branch = dlg.slice(i, dlg.indexOf("setError(", i));
    expect(branch).toMatch(/return;/);
  });

  it("🪤 ติ๊กยื่น/จ่ายที่การ์ดชำระภาษี → การ์ด 50ทวิ โหลดใหม่ (อ่านซอร์ส)", () => {
    const pay = noTsComments(read("app/(app)/accounting/_components/TaxPayCard.tsx"));
    expect(pay).toMatch(/const changed = \(\) => \{ load\(\); onFilingChanged\?\.\(\); \};/);
    // ทุกจุดที่เปลี่ยนสถานะยื่น/จ่าย เรียก changed ไม่ใช่ load เฉย ๆ
    expect(pay).not.toMatch(/(Action\([^)]*\),\s*"[^"]*",\s*load\))|(,\s*load,\s*\))/);
    expect((pay.match(/changed\)/g) ?? []).length + (pay.match(/changed,/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(noTsComments(read("app/(app)/accounting/_components/TaxDocsTab.tsx"))).toMatch(/onFilingChanged=\{reload\}/);
  });

  it("ประวัติการแก้ไขของใบ 50ทวิ: ไม่โชว์ uuid/เวลาดิบ · ยอดบนใบใช้ป้ายของใบ", () => {
    const f = changedFields({
      tableName: "wht_certificates",
      action: "update",
      before: { status: "ปกติ", cancelled_by: null, cancelled_at: null, cancel_reason: null, base_amount: 10500 },
      after: { status: "ยกเลิก", cancelled_by: "2f37-uuid", cancelled_at: "2026-11-21T17:48:52Z", cancel_reason: "ยอดผิด", base_amount: 10000 },
    });
    expect(f.map((x) => x.key)).toEqual(["status", "cancel_reason", "base_amount"]);
    expect(f.find((x) => x.key === "base_amount")!.label).toBe("จำนวนเงินที่จ่าย (บนใบ)");
    // ตารางอื่นยังใช้ป้ายเดิม
    const t = changedFields({ tableName: "transactions", action: "update", before: { base_amount: 1 }, after: { base_amount: 2 } });
    expect(t[0].label).toBe("ยอดก่อน VAT");
  });
});

describe("migration 0113 — ด่านใน SQL ตรงกับคำอธิบายบนจอ (อ่านซอร์ส)", () => {
  const code = noSqlComments(SQL);
  const cancel = fnBody(code, "fn_cancel_wht");

  it("คอลัมน์สถานะ + CHECK 2 ค่า (ภาษาไทยตามเดิม)", () => {
    expect(code).toMatch(/add column if not exists status text not null default 'ปกติ'/);
    expect(code).toMatch(/check \(status in \('ปกติ', 'ยกเลิก'\)\)/);
  });

  it("🚨 ยกเลิก = update สถานะ ไม่ลบแถว (ลบ = เลขกลับมาใช้ซ้ำ · D100)", () => {
    expect(cancel).toMatch(/update wht_certificates set\s+status\s+= 'ยกเลิก'/);
    expect(cancel).not.toMatch(/delete from wht_certificates/);
  });

  it("ด่าน: tenant · cap acct.write · กิจการ · เหตุผล · ใบพนักงาน · ยกเลิกซ้ำ", () => {
    expect(cancel).toMatch(/my_tenant\(\)/);
    expect(cancel).toMatch(/has_cap\('acct\.write'\)/);
    expect(cancel).toMatch(/my_entities\(\)/);
    expect(cancel).toMatch(/v_reason = ''/);
    expect(cancel).toMatch(/c\.emp_id is not null/);
    expect(cancel).toMatch(/c\.status = 'ยกเลิก'/);
  });

  it("🚨 กติกา 'ยื่นแล้ว' ตรงกับ whtCertFiledPeriods: settled_on → transaction_date · pnd3+pnd53 · ไม่นับที่ถอน", () => {
    expect(cancel).toMatch(/coalesce\(t\.settled_on, t\.transaction_date\)/);
    expect(cancel).toMatch(/f\.kind in \('pnd3', 'pnd53'\)/);
    expect(cancel).toMatch(/f\.reopened_at is null/);
    expect(cancel).toMatch(/not coalesce\(p_ack_filed, false\)/);
  });

  it("ไม่ใช่ security definer (RLS wht_w คุมชั้นล่าง) · ปิด anon", () => {
    expect(cancel).not.toMatch(/security definer/);
    expect(code).toMatch(/revoke execute on function fn_cancel_wht\(text, text, text, boolean\) from public, anon;/);
  });

  it("fn_update_wht ปฏิเสธใบที่ยกเลิก ก่อน update", () => {
    const upd = fnBody(code, "fn_update_wht");
    const guard = upd.indexOf("status = 'ยกเลิก'");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(upd.indexOf("update wht_certificates set"));
  });

  it("fn_edit_transaction ด่านย้ายกิจการนับเฉพาะใบปกติ", () => {
    expect(fnBody(code, "fn_edit_transaction")).toMatch(/from wht_certificates[^;]*any\(tx_ids\)\s*and status = 'ปกติ'/);
  });

  it("audit trigger ของ wht_certificates", () => {
    expect(code).toMatch(/create trigger audit_wht_certificates after insert or update or delete on wht_certificates/);
  });
});

describe("ผู้อ่าน wht_certificates ฝั่งบัญชีรู้จักสถานะ (อ่านซอร์ส)", () => {
  const data = noTsComments(read("app/(app)/accounting/data.ts"));

  it("คิวรอออก (getDashboard) ใช้ issuedTxIdsOf + อ่าน status", () => {
    expect(data).toMatch(/from\("wht_certificates"\)\.select\("tx_ids, status"\)/);
    expect(data).toMatch(/issuedTxIdsOf\(/);
  });

  it("หน้าแก้บิล (ด่านย้ายกิจการ) นับเฉพาะใบปกติ", () => {
    expect(data).toMatch(/contains\("tx_ids", \[txId\]\)\.eq\("status", "ปกติ"\)/);
  });

  it("🚨 เลขที่มีแล้ว (existingDocNos) ยังรวมใบที่ยกเลิก — ห้ามกรอง status", () => {
    const m = data.match(/const existingDocNos = ([^;]+);/);
    expect(m).toBeTruthy();
    expect(m![1]).not.toMatch(/cancelled|status/);
  });

  it("ป๊อปอัพยกเลิกไม่มี onSubmit / window.confirm", () => {
    const dlg = noTsComments(read("app/(app)/accounting/_components/CancelWhtDialog.tsx"));
    expect(dlg).toMatch(/<Modal\b/);
    expect(dlg).not.toMatch(/onSubmit=/);
    expect(dlg).not.toMatch(/window\.confirm/);
  });
});
