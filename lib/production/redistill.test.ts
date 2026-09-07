import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  nextLotNumber,
  nextRoundNo,
  materialDocRef,
  lotSummary,
  roundIssues,
  dilutePlan,
  lotNoteText,
  lotBadge,
  lotsPendingAtMonthEnd,
  type RedistillLot,
  type RedistillRound,
} from "./redistill";

/**
 * D94 — กลั่นหลายรอบ
 *
 * เคสอ้างอิงตลอดไฟล์ (ตัวเลขจากที่คุยกับผู้ใช้):
 *   ยกออกจากถัง 240 ล. @70 → กลั่นซ้ำรอบ 2 ได้ 180 ล. @65 → ปรับดีกรี 40 ได้ 292.50 ล.
 */
const LOT: RedistillLot = {
  lot_no: "S1/69",
  product_name: "ยินทดสอบ",
  draw_date: "2026-09-28",
  draw_vol: 240,
  draw_abv: 70,
};
const R2: RedistillRound = {
  lot_no: "S1/69",
  round_no: 2,
  soak_date: "2026-09-28",
  distill_date: "2026-10-10",
  start_vol: 240,
  start_abv: 70,
  end_vol: 180,
  end_abv: 65,
};
const CLOSE = { diluteDate: "2026-10-12", water: 112.5, finalVol: 292.5, finalAbv: 40 };

describe("เลขล็อต + เลขรอบ", () => {
  it("ล็อตแรกของปี พ.ศ. = S1/69", () => {
    expect(nextLotNumber("2026-09-28", [])).toBe("S1/69");
  });

  it("วิ่งต่อจากเลขสูงสุดของปีนั้น ไม่ใช่จำนวนแถว", () => {
    expect(nextLotNumber("2026-09-28", ["S1/69", "S5/69", "S3/69"])).toBe("S6/69");
  });

  it("ข้ามปีแล้วเริ่มใหม่ที่ 1 (ปีเก่าไม่นับ)", () => {
    expect(nextLotNumber("2027-01-05", ["S9/69"])).toBe("S1/70");
  });

  it("🚨 ไม่ชนกับเลข batch — batch 'n/yy' ไม่ถูกนับเป็นล็อต", () => {
    // ถ้านับปน จะได้ S13/69 ทั้งที่ยังไม่เคยมีล็อตเลย
    expect(nextLotNumber("2026-09-28", ["12/69", "3/69"])).toBe("S1/69");
  });

  it("ไม่มีวันที่ = คืนค่าว่าง (เหมือน nextBatchNumber)", () => {
    expect(nextLotNumber(null, ["S1/69"])).toBe("");
  });

  it("🚨 รอบแรกของการกลั่นซ้ำคือรอบที่ 2 — รอบ 1 คือกลั่นจากน้ำส่า", () => {
    expect(nextRoundNo([])).toBe(2);
    expect(nextRoundNo([R2])).toBe(3);
  });

  it("เลขอ้างอิงวัตถุดิบ = รูปแบบเดียวกับที่ RPC ตรวจ", () => {
    expect(materialDocRef("S1/69", 2)).toBe("S1/69 รอบ 2");
  });
});

describe("สรุปล็อต", () => {
  it("LPA เข้า/ออก และ % ที่หายไป คิดจากแอลกอฮอล์บริสุทธิ์ ไม่ใช่จากลิตร", () => {
    const s = lotSummary({ ...LOT, dilute_date: "2026-10-12", final_vol: 292.5, final_abv: 40 }, [R2]);
    expect(s.lpaIn).toBeCloseTo(168, 6);      // 240 × 70%
    expect(s.lpaOut).toBeCloseTo(117, 6);     // 292.5 × 40%
    expect(s.lpaLossPct).toBeCloseTo(30.357142, 5);
    expect(s.closed).toBe(true);
  });

  it("ยังไม่ปิดล็อต → เทียบกับรอบสุดท้ายที่จบแล้ว (ปรับดีกรีไม่เปลี่ยน LPA)", () => {
    const s = lotSummary(LOT, [R2]);
    expect(s.closed).toBe(false);
    expect(s.lastVol).toBe(180);
    expect(s.lastAbv).toBe(65);
    expect(s.lpaOut).toBeCloseTo(117, 6);     // 180 × 65% = เท่ากับหลังปรับดีกรีพอดี
  });

  it("กลั่น 3 รอบ — หยิบรอบสุดท้ายที่ **บันทึกผลแล้ว** ไม่ใช่รอบที่เลขมากที่สุด", () => {
    const r3: RedistillRound = { lot_no: "S1/69", round_no: 3, start_vol: 180, start_abv: 65, end_vol: 140, end_abv: 68 };
    const r4: RedistillRound = { lot_no: "S1/69", round_no: 4, start_vol: 140, start_abv: 68 }; // ยังไม่จบ
    const s = lotSummary(LOT, [R2, r3, r4]);
    expect(s.lastRoundNo).toBe(3);
    expect(s.lastVol).toBe(140);
    expect(s.roundsDone).toBe(2);
    expect(s.roundsTotal).toBe(3);
  });

  it("ยังไม่มีรอบเลย ไม่ระเบิด และไม่แกล้งบอกว่ามีของออก", () => {
    const s = lotSummary(LOT, []);
    expect(s.lastVol).toBe(0);
    expect(s.lpaOut).toBe(0);
    expect(s.roundsDone).toBe(0);
  });

  it("🚨 ยังไม่บันทึกผลรอบไหนเลย = % ที่หายต้องเป็น null ห้ามเป็น 100 (เจอตอนเทสในเบราว์เซอร์)", () => {
    // การ์ดสรุปเคยขึ้น "หายระหว่างทาง 100.00%" ทันทีที่เปิดล็อต ทั้งที่ของยังอยู่ในถังครบ
    expect(lotSummary(LOT, []).lpaLossPct).toBeNull();
    expect(lotSummary(LOT, [{ ...R2, end_vol: null, end_abv: null }]).lpaLossPct).toBeNull();
    // พอมีผลรอบแล้วค่อยมีตัวเลข
    expect(lotSummary(LOT, [R2]).lpaLossPct).toBeCloseTo(30.357142, 5);
  });
});

describe("เตือนความไม่ต่อเนื่องของรอบ (เตือน ไม่บล็อก)", () => {
  it("ต่อกันครบถ้วน = ไม่มีคำเตือนเลย", () => {
    expect(roundIssues(LOT, [R2])).toEqual([]);
  });

  it("รอบ 2 เริ่มไม่ตรงกับยอดที่ยกออกจากถัง", () => {
    const bad = roundIssues(LOT, [{ ...R2, start_vol: 200 }]);
    expect(bad.some((m) => m.includes("ยกออกจากถัง 240.00"))).toBe(true);
  });

  it("รอบ 3 เริ่มไม่ตรงกับที่รอบ 2 จบ", () => {
    const r3: RedistillRound = { ...R2, round_no: 3, start_vol: 175, end_vol: 140, end_abv: 68 };
    const bad = roundIssues(LOT, [R2, r3]);
    expect(bad.some((m) => m.includes("รอบที่ 2 จบที่ 180.00"))).toBe(true);
  });

  it("🪤 เศษทศนิยมไม่ทำให้ขึ้นเตือน (240 กับ 239.998 ถือว่าตรงกัน)", () => {
    expect(roundIssues(LOT, [{ ...R2, start_vol: 239.998 }])).toEqual([]);
  });

  it("กลั่นแล้วปริมาณเพิ่ม = กรอกสลับช่อง ต้องเตือน", () => {
    const bad = roundIssues(LOT, [{ ...R2, start_vol: 180, end_vol: 240, end_abv: 70 }]);
    expect(bad.some((m) => m.includes("มากกว่าที่เข้ารอบ"))).toBe(true);
  });

  it("ยังไม่บันทึกผล = เตือน", () => {
    const bad = roundIssues(LOT, [{ ...R2, end_vol: null, end_abv: null }]);
    expect(bad.some((m) => m.includes("ยังไม่ได้บันทึกผล"))).toBe(true);
  });

  it("เลขรอบข้าม (2 → 4) ต้องเตือน", () => {
    const r4: RedistillRound = { ...R2, round_no: 4, start_vol: 180, end_vol: 140 };
    expect(roundIssues(LOT, [R2, r4]).some((m) => m.includes("เลขรอบข้าม"))).toBe(true);
  });

  it("ไม่มีรอบเลย = ไม่เตือนอะไร (ยังไม่ถึงเวลา)", () => {
    expect(roundIssues(LOT, [])).toEqual([]);
  });
});

describe("🔴 แผนแถวปรุงที่จะไปโผล่บนฟอร์ม ภส.", () => {
  it("เปิดล็อตอย่างเดียว = แถวเดียว ท่อน 'ยกไปปรุง' ลงวันที่ยกออก", () => {
    const plan = dilutePlan(LOT, []);
    expect(plan).toHaveLength(1);
    expect(plan[0].leg).toBe("ยกไปปรุง");
    expect(plan[0].date).toBe("2026-09-28");
    // 🔴 ยอดที่ลงฟอร์มคือยอดที่ยกออกจากถัง ไม่ใช่ยอดหลังกลั่นซ้ำ
    expect(plan[0].startVol).toBe(240);
    expect(plan[0].finalVol).toBeNull();
  });

  it("ปิดล็อต = 2 แถว คนละวัน · ท่อนสองมีแต่ยอดที่ได้", () => {
    const plan = dilutePlan(LOT, [R2], CLOSE);
    expect(plan.map((p) => [p.leg, p.date])).toEqual([
      ["ยกไปปรุง", "2026-09-28"],
      ["ปรุงเสร็จ", "2026-10-12"],
    ]);
    expect(plan[1].startVol).toBeNull();
    expect(plan[1].finalVol).toBe(292.5);
    expect(plan[1].finalAbv).toBe(40);
    expect(plan[1].water).toBe(112.5);
  });

  it("🚨 ยอดที่หักออกจาก 'คงเหลือสุรากลั่น' = ยอดยกออก ไม่ใช่ยอดหลังกลั่นซ้ำ", () => {
    // ใช้ 180 เมื่อไหร่ คงเหลือสุรากลั่นบนฟอร์มจะพองขึ้น 60 ล. ทุกรอบการผลิต
    const start = dilutePlan(LOT, [R2], CLOSE).map((p) => p.startVol);
    expect(start).toEqual([240, null]);
    expect(start).not.toContain(180);
  });

  it("ไม่เติมน้ำก็ปิดล็อตได้ (บางเจ้ากลั่นจนได้ดีกรีขายเลย)", () => {
    const plan = dilutePlan(LOT, [R2], { diluteDate: "2026-10-12", water: 0, finalVol: 180, finalAbv: 65 });
    expect(plan[1].water).toBe(0);
    expect(plan[1].finalVol).toBe(180);
  });

  it("ยอดรวมสองแถวสมดุลกับที่ฟอร์มต้องเห็น: หักถังหนึ่ง 240 · เติมอีกถัง 292.50", () => {
    const plan = dilutePlan(LOT, [R2], CLOSE);
    const outOfDistill = plan.reduce((s, p) => s + (p.startVol ?? 0), 0);
    const intoDilute = plan.reduce((s, p) => s + (p.finalVol ?? 0), 0);
    expect(outOfDistill).toBe(240);
    expect(intoDilute).toBe(292.5);
  });
});

describe("หมายเหตุที่พิมพ์ลงฟอร์ม", () => {
  it("ยังไม่ปิดล็อต = บอกว่าอยู่ระหว่างดำเนินการ", () => {
    expect(lotNoteText(LOT, [R2]).draw).toBe("ยกไปแช่สมุนไพรและกลั่นซ้ำ S1/69 (อยู่ระหว่างดำเนินการ)");
  });

  it("ปิดแล้ว = ท่อนแรกชี้ไปวันที่ปรับดีกรี · ท่อนสองเล่าครบทั้งสาย", () => {
    const n = lotNoteText(LOT, [R2], CLOSE);
    expect(n.draw).toBe("S1/69 ปรับดีกรีเสร็จ 12/10/69");
    expect(n.final).toBe(
      "S1/69 ได้ 180.00 ล. 65 ดีกรี · ปรับดีกรี 40 ได้ปริมาณ 292.50 ลิตร",
    );
  });

  it("🪤 ไม่มีรอบไหนแช่เลย (วอดก้า) ต้องไม่เขียนคำว่า 'แช่' บนเอกสารราชการ", () => {
    const dry: RedistillRound = { ...R2, soak_date: null };
    // คำกริยาอยู่บนข้อความตอน "ยังไม่ปิดล็อต" — ปิดแล้วเหลือแค่เลขล็อต+วันที่
    expect(lotNoteText(LOT, [dry]).draw).toBe("ยกไปกลั่นซ้ำ S1/69 (อยู่ระหว่างดำเนินการ)");
    expect(lotNoteText(LOT, [dry]).draw).not.toContain("แช่");
    expect(lotNoteText(LOT, [R2]).draw).toContain("แช่สมุนไพร");
  });

  it("กลั่น 3 รอบ — หมายเหตุบอกจำนวนรอบตามจริง", () => {
    const r3: RedistillRound = { ...R2, round_no: 3, start_vol: 180, start_abv: 65, end_vol: 140, end_abv: 68 };
    const n = lotNoteText(LOT, [R2, r3], { ...CLOSE, finalVol: 238, finalAbv: 40 });
    expect(n.final).toContain("S1/69 ได้ 140.00 ล. 68 ดีกรี");
  });
});

describe("ป้ายสถานะ (ตัดสินใน lib ไม่ใช่ในคอมโพเนนต์)", () => {
  it("ครบทุกสถานะ", () => {
    expect(lotBadge(LOT, []).text).toBe("ยังไม่มีรอบกลั่น");
    expect(lotBadge(LOT, [{ ...R2, end_vol: null }]).text).toBe("กำลังกลั่น");
    expect(lotBadge(LOT, [R2]).text).toBe("รอปรับดีกรี");
    expect(lotBadge({ ...LOT, dilute_date: "2026-10-12", final_vol: 292.5 }, [R2]).text).toBe("ปิดล็อตแล้ว");
  });
});

describe("เตือนก่อนปิดเดือน — ล็อตที่กลั่นซ้ำแล้วแต่ยังไม่ปรับดีกรี", () => {
  const rounds = { "S1/69": [R2] };

  it("กลั่นซ้ำเสร็จเดือน ต.ค. ยังไม่ปรับดีกรี → ปิดเดือน ต.ค. ต้องเตือน", () => {
    const out = lotsPendingAtMonthEnd([LOT], rounds, "2026-10");
    expect(out).toEqual([{ lotNo: "S1/69", productName: "ยินทดสอบ", vol: 180, abv: 65 }]);
  });

  it("🪤 สิ้นเดือน ก.ย. ยังไม่ได้กลั่นซ้ำ = สุรานอนอยู่ในถังแช่ครบ ตรงกับบัญชี → ไม่เตือน", () => {
    expect(lotsPendingAtMonthEnd([LOT], rounds, "2026-09")).toEqual([]);
  });

  it("ปิดล็อตในเดือนนั้นแล้ว → ไม่เตือน", () => {
    const closed = { ...LOT, dilute_date: "2026-10-12", final_vol: 292.5, final_abv: 40 };
    expect(lotsPendingAtMonthEnd([closed], rounds, "2026-10")).toEqual([]);
  });

  it("ปิดล็อตเดือนถัดไป → เดือนนี้ยังต้องเตือน", () => {
    const later = { ...LOT, dilute_date: "2026-11-03", final_vol: 292.5, final_abv: 40 };
    expect(lotsPendingAtMonthEnd([later], rounds, "2026-10")).toHaveLength(1);
  });

  it("ล็อตของเดือนหลัง ไม่โผล่ในเดือนก่อน", () => {
    const nextMonth = { ...LOT, lot_no: "S2/69", draw_date: "2026-11-02" };
    expect(lotsPendingAtMonthEnd([nextMonth], { "S2/69": [] }, "2026-10")).toEqual([]);
  });
});

/**
 * D94 — กติกาที่อยู่ **สองฝั่ง** (TypeScript ตัดสินค่า · SQL บังคับ)
 * หลุดข้างใดข้างหนึ่งไม่มี error ทั้งคู่ → ต้องอ่าน SQL เป็นข้อความมาตรวจ
 * (ชั้นเดียวกับ tenantTables.test.ts D79 · rolesSql.test.ts D85 · exciseHidden.test.ts D90)
 */
describe("migration 0061 — ด่านฝั่ง DB ต้องตรงกับที่ lib คิดไว้", () => {
  const ROOT = path.resolve(__dirname, "../..");
  const DIR = path.join(ROOT, "supabase/migrations");
  const sql = readdirSync(DIR)
    .filter((f) => f.endsWith("_redistill.sql"))
    .map((f) => readFileSync(path.join(DIR, f), "utf8"))
    .join("\n");

  it("มีไฟล์ migration ของงานนี้อยู่จริง", () => {
    expect(sql.length).toBeGreaterThan(0);
  });

  it("🚨 รูปแบบเลขอ้างอิงวัตถุดิบใน RPC ตรงกับ materialDocRef() เป๊ะ", () => {
    // RPC ลบ log_material ด้วย doc_ref ก่อนเขียนใหม่ — คนละรูปแบบ = ลบไม่โดน
    // หรือแย่กว่านั้น รับค่าที่หลุดมาแล้วไปลบวัตถุดิบที่เบิกไปหมัก
    expect(sql).toContain("p_lot_no || ' รอบ ' || p_round_no");
    expect(materialDocRef("S1/69", 2)).toBe("S1/69 รอบ 2");
  });

  it("🚨 ท่อน 'ยกไปปรุง' ต้องถูกเขียนตอน **เปิดล็อต** ไม่ใช่ตอนปิด", () => {
    // ไม่งั้นระหว่างแช่เป็นสัปดาห์ ระบบยังคิดว่าสุราก้อนนั้นว่างอยู่ → ปรุงซ้ำได้อีก
    const open = sql.slice(sql.indexOf("function fn_open_redistill_lot"), sql.indexOf("function fn_save_redistill_round"));
    expect(open).toContain("insert into log_dilute");
    expect(open).toContain("'ยกไปปรุง'");
  });

  it("🚨 เปิดล็อตต้องเช็คสุรากลั่นคงเหลือก่อน (กันนับสุราซ้ำ)", () => {
    const open = sql.slice(sql.indexOf("function fn_open_redistill_lot"), sql.indexOf("function fn_save_redistill_round"));
    expect(open).toContain("fn_raw_spirit_remaining");
  });

  it("🚨 ลบล็อตต้องเก็บกวาดครบ 4 ตาราง — ตกที่ไหน ยอดบนฟอร์มค้างตลอดกาล", () => {
    const del = sql.slice(sql.indexOf("function fn_delete_redistill_lot"));
    for (const t of ["log_material", "log_distill_run", "log_dilute", "log_redistill"]) {
      expect(del, `fn_delete_redistill_lot ไม่ได้ลบ ${t}`).toContain(`delete from ${t}`);
    }
  });

  it("🚨 ถอนการปิดล็อตที่ไม่เคยปิด ต้องตอบ error ไทย ไม่ใช่ ok เงียบ ๆ (D93)", () => {
    const reopen = sql.slice(sql.indexOf("function fn_reopen_redistill_lot"), sql.indexOf("function fn_delete_redistill_lot"));
    expect(reopen).toContain("v_n = 0");
    expect(reopen).toContain("ยังไม่ได้ปิด");
  });

  it("🚨 ห้ามแตะ log_distill — กติกาเหล็ก 1 batch = 1 แถว (P3)", () => {
    expect(/(alter|drop)\s+table\s+log_distill\b/.test(sql)).toBe(false);
    expect(/(insert|update|delete)\s+(into\s+|from\s+)?log_distill\b(?!_)/.test(sql)).toBe(false);
  });

  it("ธง is_redistill เป็นคอลัมน์จริง ไม่ใช่การเดาจากรูปแบบชื่อล็อต (D90)", () => {
    expect(sql).toContain("add column if not exists is_redistill");
    expect(sql).not.toContain("like 'S%'");
  });
});

/**
 * D85 บทเรียน: **ทะเบียนแท็บกรองถูก แต่ 3 ใน 4 หน้าจอไม่เรียกตัวกรอง**
 * D79/D90 บทเรียน: กติกาที่อยู่คนละไฟล์กับที่ TypeScript มองทะลุ ต้องอ่านซอร์สมาตรวจ
 */
describe("การต่อสายฝั่งหน้าจอ (อ่านซอร์สจริงมาตรวจ)", () => {
  const ROOT = path.resolve(__dirname, "../..");
  const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

  it("แท็บ 'กลั่นซ้ำ' อยู่ในทะเบียนกลาง และผูกกับเส้นทางสุรากลั่น", () => {
    const tabs = read("lib/shared/tabs.ts");
    expect(tabs).toContain('slug: "redistill"');
    const line = tabs.split("\n").find((l) => l.includes('slug: "redistill"')) ?? "";
    expect(line).toContain('process: "สุรากลั่น"');
  });

  it("🚨 ProductionApp ต้อง render RedistillTab จริง — ทะเบียนแท็บอย่างเดียวไม่พอ (D85)", () => {
    const app = read("app/(app)/production/_components/ProductionApp.tsx");
    expect(app).toContain("RedistillTab");
    expect(app).toContain('visited.has("กลั่นซ้ำ")');
  });

  it("🔴 ผู้อ่าน log_distill_run ทุกจุดใน data.ts ต้องกรอง is_redistill", () => {
    // ไม่กรอง = ล็อตกลั่นซ้ำโผล่ปนกับ batch หมักในหน้าประวัติ/กระดาน batch
    // 🪤 เช็คเป็น "คำสั่ง" ไม่ใช่ "บรรทัด" — chain ของ supabase ขึ้นบรรทัดใหม่ได้
    const data = read("app/(app)/production/data.ts");
    const stmts = data.split(";").filter((x) => x.includes('from("log_distill_run")'));
    expect(stmts.length).toBeGreaterThan(0);
    for (const st of stmts) {
      expect(st, `คำสั่งนี้ไม่กรองธง: ${st.replace(/\s+/g, " ").trim().slice(0, 90)}`).toContain("is_redistill");
    }
  });

  it("🚨 ค่าระหว่างกลั่นซ้ำต้องถูกเขียนพร้อมธง is_redistill ทั้ง 2 action", () => {
    const actions = read("app/(app)/production/actions.ts");
    const start = actions.slice(
      actions.indexOf("export async function startDistillRunAction"),
      actions.indexOf("export async function saveDistillReadingAction"),
    );
    const save = actions.slice(
      actions.indexOf("export async function saveDistillReadingAction"),
      actions.indexOf("export async function closeBatchAction"),
    );
    expect(start).toContain("is_redistill: input.isRedistill");
    expect(save).toContain("is_redistill: input.isRedistill");
  });

  it("🔴 บันทึก/ลบรอบ ต้องอัปเดตหมายเหตุแถว 'ยกไปปรุง' ด้วย (0062)", () => {
    // อาการเดิม: เปิดล็อตตอนยังไม่มีรอบ → หมายเหตุไม่มีคำว่า "แช่" · บันทึกรอบที่แช่แล้ว
    // หมายเหตุไม่เปลี่ยน ⇒ ฟอร์มสุราบอกว่าไม่ได้แช่ แต่ฟอร์มวัตถุดิบวันเดียวกันตัดสมุนไพร
    const actions = read("app/(app)/production/actions.ts");
    for (const fn of ["saveRedistillRoundAction", "deleteRedistillRoundAction"]) {
      const i = actions.indexOf("export async function " + fn);
      expect(i, fn + " หายไป").toBeGreaterThan(-1);
      const body = actions.slice(i, actions.indexOf("export async function", i + 30));
      expect(body, fn + " ไม่ได้ส่งหมายเหตุที่คิดใหม่").toContain("p_draw_note");
      expect(body, fn + " ต้องคิดข้อความจาก lotNoteText ไม่ใช่พิมพ์เอง").toContain("lotNoteText(");
    }
    const sql = readdirSync(path.join(ROOT, "supabase/migrations"))
      .filter((f) => f.includes("redistill"))
      .map((f) => readFileSync(path.join(ROOT, "supabase/migrations", f), "utf8"))
      .join(String.fromCharCode(10));
    // 🪤 พารามิเตอร์เพิ่ม = ต้อง drop ก่อน ไม่งั้นได้ overload ตัวที่ 2 (D69)
    expect(sql).toContain("drop function if exists fn_save_redistill_round");
    expect(sql).toContain("drop function if exists fn_delete_redistill_round");
  });

  it("🚨 แถวปรุงที่มาจากล็อต ต้องแก้/ลบจากแท็บปรุงไม่ได้ (ค่าเดียวมีสองนิยาม — D81/D88)", () => {
    const dilute = read("app/(app)/production/_components/DiluteTab.tsx");
    expect(dilute).toContain("disabled={pending || !!r.redistill_lot}");
    // ต้องปิดทั้งปุ่มแก้และปุ่มลบ ไม่ใช่ปิดข้างเดียว
    expect(dilute.split("disabled={pending || !!r.redistill_lot}").length - 1).toBe(2);
  });

  it("ข้อความหมายเหตุที่ลงฟอร์มถูกสร้างจาก lotNoteText ฝั่ง lib เท่านั้น", () => {
    const actions = read("app/(app)/production/actions.ts");
    expect(actions).toContain("lotNoteText(");
    // 🚨 ห้ามให้คอมโพเนนต์แต่งประโยคที่จะไปพิมพ์ลงเอกสารราชการเอง (D84/D88)
    const tab = read("app/(app)/production/_components/RedistillTab.tsx");
    expect(tab).not.toContain("lotNoteText");
  });
});
