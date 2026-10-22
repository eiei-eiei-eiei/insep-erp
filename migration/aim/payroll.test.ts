/**
 * สถานะลงบัญชีของงวดที่ย้ายจากแอปเงินเดือนเดิม (D121)
 * ★ ข้อมูลสมมติล้วน — ไฟล์ลูกค้าจริงอยู่นอก repo (D66) · ตัวเลขจริงพิสูจน์ด้วย dry-run ของ import-aim
 */
import { describe, expect, it } from "vitest";
import { periodPostState, LEGS, COMPONENTS, VARIABLES, RATES, SETTINGS, type AimLine, type AimPeriod } from "./payroll";
import { calcPayrollLine } from "../../lib/payroll/calc";

const per = (over: Partial<AimPeriod>): AimPeriod => ({
  legacyId: "PR-2569-06", periodId: "PR-2026-06", year: 2026, month: 6, workDaysStd: 30,
  payDate: "2026-06-30", status: "posted", note: null, ...over,
});
const line = (postedTxIds: string | null) => ({ legacy: { postedTxIds } }) as unknown as AimLine;

describe("periodPostState", () => {
  it("งวดร่างของแอปเดิม → ติดครบทุกขาแบบไม่มีบิล (ให้ ภ.ง.ด.1ก นับ) ไม่สร้างรายจ่ายย้อนหลัง", () => {
    const { state } = periodPostState(per({ status: "draft" }), [line(null)], new Set());
    expect(Object.keys(state).sort()).toEqual(LEGS.map((l) => l.code).sort());
    for (const s of Object.values(state)) {
      expect(s.txIds).toEqual([]);
      expect(s.imported).toBeTruthy();
    }
  });

  it("ใส่เฉพาะบิลที่ย้ายมาจริง — บิลที่แอปเดิมอ้างแต่หายไปแล้วไม่ใส่ และติดป้ายไว้", () => {
    const note = JSON.stringify({ postedNet: true, netDate: "2026-06-30", ssoTxId: "TRS-X-9", ssoDate: "2026-07-15" });
    const { state, notes } = periodPostState(per({ note }), [line("TRS-1"), line("TRS-2")], new Set(["TRS-1"]));
    expect(state.net.txIds).toEqual(["TRS-1"]);
    expect(state.net.imported).toBeTruthy();
    expect(state.sso).toEqual({ txIds: [], date: "2026-07-15", imported: expect.any(String) });
    expect(state.wht).toBeUndefined();
    expect(notes.join("\n")).toMatch(/ไม่มีในบัญชี/);
  });

  it("ขาที่แอปเดิมยังไม่ลง ต้องยังไม่ลง + บอกให้ระวังลงซ้ำ (ไม่เดาว่าจ่ายแล้ว)", () => {
    const note = JSON.stringify({ postedNet: true, ssoTxId: "", whtTxId: "" });
    const { state, notes } = periodPostState(per({ status: "partial", note }), [line("TRS-1")], new Set(["TRS-1"]));
    expect(Object.keys(state)).toEqual(["net"]);
    expect(notes.join("\n")).toMatch(/อย่ากดลงบัญชีขานี้ซ้ำ/);
  });

  it("legLinks ผูกขากับบิลที่คีย์เอง — เฉพาะบิลที่มีจริง และไม่ทับขาที่มีบิลอยู่แล้ว", () => {
    const note = JSON.stringify({ postedNet: true, whtTxId: "TRS-W" });
    const have = new Set(["TRS-1", "TRS-W", "TR-SSO"]);
    const { state, notes } = periodPostState(per({ status: "partial", note }), [line("TRS-1")], have, [
      { period: "PR-2026-06", leg: "sso", txId: "TR-SSO" },
      { period: "PR-2026-06", leg: "wht", txId: "TR-OTHER" }, // ไม่มีบิลนี้ → ไม่ผูก
      { period: "PR-2026-06", leg: "net", txId: "TR-SSO" }, // ขามีบิลแล้ว → ไม่ทับ
      { period: "PR-2026-07", leg: "sso", txId: "TR-SSO" }, // คนละงวด
    ], new Map([["TR-SSO", "2026-07-07"]]));
    expect(state.sso).toEqual({ txIds: ["TR-SSO"], date: "2026-07-07", imported: expect.any(String) });
    expect(state.wht.txIds).toEqual(["TRS-W"]);
    expect(state.net.txIds).toEqual(["TRS-1"]);
    expect(notes.join("\n")).toMatch(/ไม่มีในบัญชี — ไม่ผูก/);
    expect(notes.join("\n")).toMatch(/มีบิลอยู่แล้ว/);
  });
});

describe("เกณฑ์ที่แปลงจากแอปเดิม (สูตรอยู่ที่ lib/payroll — ที่นี่ตรวจแค่ว่า config ต่อกันครบ)", () => {
  const run = (group: string, values: Record<string, number>) =>
    calcPayrollLine(
      { empId: "E", name: "ทดสอบ", groupCode: group, wageType: "monthly_prorate", baseWage: 13500, whtMode: "none", taxAllowances: {} },
      { workDays: 30, values: { pos_allow: 0, ...values }, manual: {}, whtOverride: null },
      COMPONENTS, RATES, SETTINGS, { workDaysStd: 30, monthOfYear: 6, yearBE: "2569" }, VARIABLES,
    );

  it("OT วันทำงาน: ช่าง ×1.5 · หัวหน้า ×1.0 (13500 ÷ 30 ÷ 9 = 50/ชม.)", () => {
    expect(run("ช่าง", { ot15_h: 10 }).items.find((i) => i.code === "ot15_tech")?.amount).toBe(750);
    expect(run("หัวหน้า", { ot15_h: 10 }).items.find((i) => i.code === "ot15_lead")?.amount).toBe(500);
  });

  it("เบี้ยขยันเฉพาะช่าง — หัวหน้าไม่ได้แม้กรอกคะแนนมา", () => {
    const tech = run("ช่าง", { sick_d: 0, personal_d: 0, score1: 200, score2: 100 });
    expect(tech.items.filter((i) => i.code.startsWith("attend_")).reduce((s, i) => s + i.amount, 0)).toBe(650);
    const lead = run("หัวหน้า", { score1: 200, score2: 100 });
    expect(lead.items.some((i) => i.code.startsWith("attend_") && i.amount !== 0)).toBe(false);
  });
});
