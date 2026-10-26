/**
 * A26 (D132) — ย้ายบิลไปกิจการอื่นจากหน้าแก้ไขบิล
 * + ล็อกว่าเงื่อนไขฝั่ง TS (คำอธิบายบนจอ) ตรงกับด่านตัวจริงใน fn_edit_transaction (0094)
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  MOVABLE_SOURCES, entityMoveBlock, entityMoveError, entityMoveWarnings, entityMoveSavedText, type MoveCheckInput,
} from "./entityMove";

const base: MoveCheckInput = {
  fromEntity: "EID01", toEntity: "EID02", type: "รายจ่าย", advanceForEntity: null,
  vatAmount: 0, toIsVat: true, accountName: "กสิกร", accountLinked: true, isForwardCat: false, toName: "ร้านสาขา 2",
};

describe("A26 — ย้ายได้ไหม (entityMoveBlock)", () => {
  it("บิลที่คีย์เอง (ui) และบิลที่ย้ายมาจากระบบเดิม (migration) ย้ายได้", () => {
    expect(entityMoveBlock({ source: "ui" }, [])).toBeNull();
    expect(entityMoveBlock({ source: "migration" }, [])).toBeNull();
    // ข้อมูลเก่าไม่มี source = ค่าปริยายของคอลัมน์คือ ui
    expect(entityMoveBlock({}, [])).toBeNull();
  });

  it("🚨 บิลที่ระบบอื่นสร้างให้ ย้ายไม่ได้ และบอกว่าไปแก้ที่ไหน", () => {
    expect(entityMoveBlock({ source: "sales" }, [])).toContain("จัดการออเดอร์");
    expect(entityMoveBlock({ source: "payroll" }, [])).toContain("งวดจ่าย");
    expect(entityMoveBlock({ source: "tax" }, [])).toContain("เอกสารสรรพากร");
    expect(entityMoveBlock({ source: "bar" }, [])).toContain("บาร์ → แดชบอร์ด");
    expect(entityMoveBlock({ source: "advance" }, [])).toContain("ถอนการเคลีย");
  });

  it("source ที่ไม่รู้จัก = ย้ายไม่ได้ (ไม่เดา) และขึ้นชื่อ source ให้เห็น", () => {
    expect(entityMoveBlock({ source: "อะไรใหม่" }, [])).toContain("อะไรใหม่");
  });

  it("🚨 ผลของการเคลียสำรองจ่าย ย้ายไม่ได้ แม้ source เป็น ui (บิลสำรองจ่ายใบเดิมที่เคลียแล้ว)", () => {
    expect(entityMoveBlock({ source: "ui", advance_clear_id: "ADV-20261001-0001" }, [])).toContain("ถอนการเคลีย");
    expect(entityMoveBlock({ source: "ui", advance_src_tx: "TR-1" }, [])).toContain("ถอนการเคลีย");
  });

  it("🚨 ออก 50ทวิ ไปแล้ว ย้ายไม่ได้ และบอกเลขที่ใบ", () => {
    const r = entityMoveBlock({ source: "ui" }, ["6901", "6903"]);
    expect(r).toContain("6901, 6903");
    expect(r).toContain("50ทวิ");
  });

  it("บิลกลุ่มงวด/โอน ย้ายไม่ได้ (หน้านี้แก้ไม่ได้ทั้งบิลอยู่แล้ว)", () => {
    expect(entityMoveBlock({ source: "ui", po_group_id: "PO-1" }, [])).not.toBeNull();
    expect(entityMoveBlock({ source: "ui", transfer_id: "TRF-1" }, [])).not.toBeNull();
  });
});

describe("A26 — ด่านที่บันทึกไม่ผ่านแน่ (entityMoveError)", () => {
  it("ไม่ได้ย้าย = ไม่มีอะไรเลย แม้ข้อมูลจะเข้าเงื่อนไขอื่น", () => {
    expect(entityMoveError({ ...base, toEntity: "EID01", vatAmount: 70, toIsVat: false })).toBeNull();
    expect(entityMoveWarnings({ ...base, toEntity: "EID01", accountLinked: false })).toEqual([]);
  });

  it("🚨 บิลสำรองจ่ายย้ายไปเป็นของกิจการที่ซื้อให้ไม่ได้", () => {
    const r = entityMoveError({ ...base, type: "สำรองจ่าย", advanceForEntity: "EID02" });
    expect(r).toContain("สำรองจ่ายให้");
    // ย้ายคนจ่ายไปกิจการอื่นที่ไม่ใช่ปลายทาง = ได้
    expect(entityMoveError({ ...base, type: "สำรองจ่าย", advanceForEntity: "EID03" })).toBeNull();
  });

  it("🚨 มี VAT แล้วย้ายไปกิจการไม่จด VAT = บอกให้เอาติ๊ก VAT ออก (ด่าน 0036)", () => {
    expect(entityMoveError({ ...base, vatAmount: 70, toIsVat: false })).toContain("ไม่ได้จดทะเบียน VAT");
    expect(entityMoveError({ ...base, vatAmount: 0, toIsVat: false })).toBeNull();
    expect(entityMoveError({ ...base, vatAmount: 70, toIsVat: true })).toBeNull();
    // ไม่รู้ = ไม่เดา (DB ตอบเอง)
    expect(entityMoveError({ ...base, vatAmount: 70, toIsVat: undefined })).toBeNull();
  });

  it("บิลสำรองจ่าย: VAT ดูกิจการที่ซื้อให้ ย้ายคนจ่ายไปกิจการไม่จด VAT ไม่โดนด่าน VAT (0086)", () => {
    expect(entityMoveError({ ...base, type: "สำรองจ่าย", advanceForEntity: "EID03", vatAmount: 70, toIsVat: false })).toBeNull();
  });
});

describe("A26 — คำเตือน (entityMoveWarnings)", () => {
  it("ย้ายเมื่อไหร่ บอกเสมอว่ายอดของทั้งสองกิจการเปลี่ยน", () => {
    const w = entityMoveWarnings(base);
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("ร้านสาขา 2");
    expect(w[0]).toContain("ทั้งสองกิจการ");
  });

  it("บัญชีไม่ได้ผูกกับกิจการปลายทาง = เตือน (ไม่ล้างบัญชีให้ — เงินออกจากบัญชีนั้นจริง)", () => {
    expect(entityMoveWarnings({ ...base, accountLinked: false }).some((x) => x.includes("ไม่ได้ผูกกับ"))).toBe(true);
    // ไม่มีบัญชี (บิลค้าง) / ไม่รู้ = ไม่เตือน
    expect(entityMoveWarnings({ ...base, accountName: "", accountLinked: false })).toHaveLength(1);
    expect(entityMoveWarnings({ ...base, accountLinked: undefined })).toHaveLength(1);
  });

  it("หมวดจุดชนวนรับวัตถุดิบ = เตือนว่าสต็อกยังอยู่กิจการเดิม (เฉพาะรายจ่าย)", () => {
    expect(entityMoveWarnings({ ...base, isForwardCat: true }).some((x) => x.includes("วัตถุดิบ"))).toBe(true);
    expect(entityMoveWarnings({ ...base, isForwardCat: true, type: "รายรับ" })).toHaveLength(1);
  });
});

describe("A26 — ข้อความหลังบันทึก", () => {
  it("ย้ายแล้วต้องบอกว่าบิลจะหายจากรายการของกิจการที่เลือกอยู่", () => {
    expect(entityMoveSavedText(true, "ร้านสาขา 2")).toContain("ร้านสาขา 2");
    expect(entityMoveSavedText(false, "x")).toBe("แก้ไขบิลเรียบร้อย");
  });
});

// ── TS ↔ SQL ───────────────────────────────────────────────────────────────────
const DIR = path.resolve(__dirname, "../../supabase/migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const read = (f: string) => readFileSync(path.join(DIR, f), "utf8").replace(/\r\n/g, "\n");
const noComments = (s: string) => s.replace(/--[^\n]*/g, " ");

/** body ของนิยามล่าสุดของ fn_edit_transaction (โค้ดล้วน ไม่มีคอมเมนต์) */
function latestEdit(): string {
  const re = /create\s+(or\s+replace\s+)?function\s+fn_edit_transaction\s*\(/i;
  const f = [...files].reverse().find((x) => re.test(noComments(read(x))));
  expect(f, "ไม่พบนิยาม fn_edit_transaction").toBeTruthy();
  const s = noComments(read(f!));
  const head = s.search(re);
  const tag = s.slice(head).match(/as\s+(\$[a-z]*\$)/i)![1];
  const open = s.indexOf(tag, head);
  return s.slice(head, s.indexOf(tag, open + tag.length) + tag.length);
}

describe("A26 — ด่านใน fn_edit_transaction ต้องตรงกับคำอธิบายบนจอ", () => {
  const body = latestEdit();

  it("รายชื่อ source ที่ย้ายได้ตรงกับ MOVABLE_SOURCES", () => {
    const m = body.match(/not in\s*\(([^)]*)\)/i);
    expect(m, "หา not in (...) ของ source ไม่เจอ").toBeTruthy();
    const list = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(list).toEqual([...MOVABLE_SOURCES]);
  });

  it("มีด่าน: เคลียสำรองจ่าย · 50ทวิ · สำรองจ่ายให้ตัวเอง · กิจการมีอยู่จริง", () => {
    expect(body).toMatch(/v_adv_clear is not null or v_adv_src is not null/);
    expect(body).toMatch(/from wht_certificates[^;]*any\(tx_ids\)/);
    expect(body).toMatch(/v_type = 'สำรองจ่าย' and v_adv_for = v_new_entity/);
    expect(body).toMatch(/from entities where tenant_id = v_tenant and entity_id = v_new_entity/);
  });

  it("🚨 ด่านทั้งหมดอยู่ภายใต้ 'ย้ายกิจการจริง' เท่านั้น — แก้ช่องอื่นของบิลจากระบบอื่นยังทำได้เหมือนเดิม", () => {
    const guard = body.indexOf("if v_new_entity <> v_old_entity then");
    expect(guard).toBeGreaterThan(0);
    for (const needle of ["wht_certificates", "v_adv_clear is not null", "not in ("]) {
      expect(body.indexOf(needle), needle).toBeGreaterThan(guard);
    }
  });

  it("🚨 ด่านต้องมาก่อน update (ไม่งั้นบิลถูกย้ายไปแล้วค่อยตอบ error)", () => {
    expect(body.indexOf("if v_new_entity <> v_old_entity then")).toBeLessThan(body.indexOf("update transactions set"));
  });
});
