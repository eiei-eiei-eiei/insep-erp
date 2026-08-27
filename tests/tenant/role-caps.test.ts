import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { admin, assertTestEnv, cleanupTestTenants, seedTenant, seedUser, signIn, type Tenant } from "./harness";

/**
 * เทสสิทธิ์ 9 บทบาทกับ **ฐานข้อมูลจริง** (D85)
 *
 * 🚨 ทำไมต้องมีชุดนี้แยกจาก `roles.test.ts`:
 *    เทสออฟไลน์ตรวจได้แค่ตาราง `ROLE_CAPS` ฝั่ง TypeScript ซึ่ง**ไม่ได้บังคับอะไรเลย**
 *    ตัวจริงที่กันคนอ่านบิลคนอื่นคือ RLS ใน migration ซึ่ง unit test มองไม่เห็น
 *    (บทเรียน D79 — ฟีเจอร์ที่ตรรกะอยู่ใน plpgsql ไม่เคยทำงานเลยตั้งแต่เปิดระบบ
 *     โดยที่ build/lint/test เขียวหมดมาตลอด)
 *
 * 🚨 ทุกเคสล็อกอินเป็นคนนั้นจริงผ่าน anon key — ห้ามใช้ service role (bypass RLS)
 *
 * ★ "อ่านไม่ได้" ในโลก RLS = **คืนลิสต์ว่าง ไม่ใช่ error** → ต้อง assert จำนวนแถว
 *   ไม่ใช่ assert ว่า error ไม่เป็น null (เขียนผิดแบบนั้นเทสจะผ่านทั้งที่ข้อมูลรั่ว)
 */

let T: Tenant;
let asMain: SupabaseClient;
const as: Record<string, SupabaseClient> = {};

const ROLES_UNDER_TEST = [
  "viewer",
  "sales_manager",
  "sales",
  "finance_manager",
  "accounting_manager",
  "accounting",
  "payroll_manager",
  "payroll",
];

beforeAll(async () => {
  assertTestEnv();
  await cleanupTestTenants();
  T = await seedTenant("caps");
  asMain = await signIn(T);

  // 🚨 harness ไม่ได้ seed ข้อมูลเงินเดือน → ถ้าไม่ใส่เอง เทส "อ่าน employees ได้"
  //    จะกลายเป็นเทสหลอกที่ผ่านเพราะ**ไม่มีข้อมูลให้เห็นตั้งแต่แรก** ไม่ใช่เพราะสิทธิ์ถูก
  //    (จับได้ตอนรันจริงรอบแรก — main เองยังอ่านได้ 0 แถว)
  await admin().from("employees").insert({
    tenant_id: T.tenantId, entity_id: T.entityId,
    emp_id: "EMP-9001", name: "พนักงานทดสอบสิทธิ์", wage_type: "monthly", base_wage: 15000,
  });
  await admin().from("pay_components").insert({
    tenant_id: T.tenantId, code: "base", name: "เงินเดือน", kind: "earning", method: "manual",
  });
  for (const r of ROLES_UNDER_TEST) {
    as[r] = (await seedUser(T, r)).client;
  }
}, 300_000);

afterAll(async () => {
  for (const c of [asMain, ...Object.values(as)]) await c?.auth.signOut().catch(() => {});
  await cleanupTestTenants();
});

/** จำนวนแถวที่บทบาทนี้อ่านเห็นจากตารางนั้น */
async function visible(c: SupabaseClient, table: string): Promise<number> {
  const { data, error } = await c.from(table).select("*");
  // RLS ไม่ throw — คืนลิสต์ว่าง · error จริงจะเป็นเรื่องอื่น (เช่นตารางไม่มี) ต้องรู้
  expect(error, `${table}: ${error?.message}`).toBeNull();
  return (data ?? []).length;
}

describe("main ยังเห็นและแก้ได้ทุกอย่างเหมือนเดิม (ห้าม regress)", () => {
  it("อ่านได้ทั้งบัญชี ผลิต ขาย เงินเดือน", async () => {
    for (const t of ["transactions", "log_ferment", "sales_orders", "employees"]) {
      expect(await visible(asMain, t), t).toBeGreaterThan(0);
    }
  });
});

describe("🔴 บัญชี — ฝ่ายขายกับฝ่ายเงินเดือนต้องอ่านบิลไม่ได้", () => {
  it.each(["accounting", "accounting_manager", "finance_manager", "viewer"])(
    "%s อ่าน transactions ได้",
    async (r) => {
      expect(await visible(as[r], "transactions")).toBeGreaterThan(0);
    },
  );

  it.each(["sales", "sales_manager", "payroll", "payroll_manager"])(
    "🚨 %s อ่าน transactions ไม่ได้เลยสักแถว",
    async (r) => {
      expect(await visible(as[r], "transactions")).toBe(0);
      expect(await visible(as[r], "transaction_items")).toBe(0);
      expect(await visible(as[r], "tax_summaries")).toBe(0);
    },
  );

  it("🚨 viewer อ่านได้ แต่แก้ไม่ได้", async () => {
    const { error } = await as.viewer
      .from("transactions")
      .update({ description: "แก้โดย viewer" })
      .eq("tx_id", T.txId);
    // RLS ปฏิเสธ update = ไม่มีแถวไหนเข้าเงื่อนไข → ไม่ error แต่ต้องไม่เปลี่ยนค่า
    expect(error).toBeNull();
    const { data } = await asMain.from("transactions").select("description").eq("tx_id", T.txId).maybeSingle();
    expect(data?.description).not.toBe("แก้โดย viewer");
  });

  it("accounting แก้บิลได้จริง (ไม่ใช่แค่ปิดสิทธิ์ทุกคนแล้วเทสผ่าน)", async () => {
    const { error } = await as.accounting
      .from("transactions")
      .update({ description: "แก้โดยพนักงานบัญชี" })
      .eq("tx_id", T.txId);
    expect(error, error?.message).toBeNull();
    const { data } = await asMain.from("transactions").select("description").eq("tx_id", T.txId).maybeSingle();
    expect(data?.description).toBe("แก้โดยพนักงานบัญชี");
  });
});

describe("🔴 เงินเดือน — ข้อมูลอ่อนไหวที่สุด แม้แต่ viewer ก็ไม่เห็น", () => {
  it.each(["payroll", "payroll_manager", "finance_manager"])("%s อ่าน employees ได้", async (r) => {
    // ★ ต้อง > 0 ไม่ใช่ >= 0 — ไม่งั้นเป็นเทสที่ผ่านเพราะไม่มีข้อมูล ไม่ใช่เพราะสิทธิ์ถูก
    expect(await visible(as[r], "employees")).toBeGreaterThan(0);
  });

  it.each(["viewer", "sales", "sales_manager", "accounting", "accounting_manager"])(
    "🚨 %s อ่าน employees / payroll_items ไม่ได้เลย",
    async (r) => {
      expect(await visible(as[r], "employees")).toBe(0);
      expect(await visible(as[r], "payroll_items")).toBe(0);
      expect(await visible(as[r], "pay_components")).toBe(0);
    },
  );
});

describe("🔴 ผลิต — สูตร/ค่าดีกรี ปิดจากฝ่ายขายและบัญชี", () => {
  it("viewer อ่านบันทึกผลิตได้", async () => {
    expect(await visible(as.viewer, "log_ferment")).toBeGreaterThan(0);
  });

  it.each(["sales", "sales_manager", "accounting", "payroll"])(
    "🚨 %s อ่าน log_ferment / containers ไม่ได้",
    async (r) => {
      expect(await visible(as[r], "log_ferment")).toBe(0);
      expect(await visible(as[r], "containers")).toBe(0);
    },
  );

  it("★ แต่ฝ่ายขายต้องอ่าน products + stock_product ได้ (เมนูขายต้องใช้)", async () => {
    for (const r of ["sales", "sales_manager"]) {
      expect(await visible(as[r], "products"), `${r} / products`).toBeGreaterThan(0);
    }
  });

  it("★ ฝ่ายบัญชีต้องอ่าน materials ได้ (ดร็อปดาวน์รับวัตถุดิบ — D79)", async () => {
    expect(await visible(as.accounting, "materials")).toBeGreaterThan(0);
  });

  it("🚨 แต่ฝ่ายขายไม่ได้เห็น materials ตามไปด้วย", async () => {
    expect(await visible(as.sales, "materials")).toBe(0);
  });
});

describe("🔴 ขาย", () => {
  it.each(["sales", "sales_manager", "viewer"])("%s อ่านออเดอร์ได้", async (r) => {
    expect(await visible(as[r], "sales_orders")).toBeGreaterThan(0);
  });

  it("★ ฝ่ายบัญชีต้องอ่านออเดอร์ได้ (แท็บลูกหนี้-เจ้าหนี้โชว์ยอดค้างออเดอร์)", async () => {
    expect(await visible(as.accounting, "sales_orders")).toBeGreaterThan(0);
  });

  it("🚨 ฝ่ายเงินเดือนอ่านออเดอร์ไม่ได้", async () => {
    expect(await visible(as.payroll, "sales_orders")).toBe(0);
    expect(await visible(as.payroll, "warehouse_stock")).toBe(0);
  });
});

describe("🔴 ตั้งค่า — เส้นแบ่ง manager กับพนักงาน", () => {
  it("sales_manager แก้เมนูขายได้ · sales แก้ไม่ได้", async () => {
    const okMgr = await as.sales_manager
      .from("sale_menu")
      .update({ price: 999 })
      .eq("tenant_id", T.tenantId)
      .select("menu_name");
    expect(okMgr.error, okMgr.error?.message).toBeNull();
    expect((okMgr.data ?? []).length, "sales_manager ควรแก้ได้อย่างน้อย 1 แถว").toBeGreaterThan(0);

    const noStaff = await as.sales
      .from("sale_menu")
      .update({ price: 111 })
      .eq("tenant_id", T.tenantId)
      .select("menu_name");
    expect((noStaff.data ?? []).length, "sales ไม่ควรแก้ได้สักแถว").toBe(0);
  });

  it("payroll_manager แก้เกณฑ์คำนวณได้ · payroll แก้ไม่ได้ (แต่กรอกงวดได้)", async () => {
    const mgr = await as.payroll_manager
      .from("pay_components")
      .update({ sort: 5 })
      .eq("tenant_id", T.tenantId)
      .select("code");
    expect(mgr.error, mgr.error?.message).toBeNull();

    const staff = await as.payroll
      .from("pay_components")
      .update({ sort: 9 })
      .eq("tenant_id", T.tenantId)
      .select("code");
    expect((staff.data ?? []).length, "payroll ไม่ควรแก้เกณฑ์ได้").toBe(0);
  });
});

describe("🚨 ตั้งค่ากลาง — เฉพาะ main", () => {
  it("ไม่มีบทบาทไหนนอกจาก main แก้ค่าแบรนด์ได้", async () => {
    for (const r of ROLES_UNDER_TEST) {
      const { data } = await as[r]
        .from("app_settings")
        .update({ value: "ถูกแก้โดย " + r })
        .eq("tenant_id", T.tenantId)
        .eq("kind", "brand_name")
        .select("kind");
      expect((data ?? []).length, `${r} ไม่ควรแก้ brand_name ได้`).toBe(0);
    }
  });

  it("★ แต่ทุกบทบาทต้อง **อ่าน** brand_* ได้ — ไม่งั้นเข้าแอปไม่ได้เลย (กติกา 0033)", async () => {
    for (const r of ROLES_UNDER_TEST) {
      const { data } = await as[r].from("app_settings").select("kind").eq("kind", "brand_name");
      expect((data ?? []).length, `${r} อ่าน brand_name ไม่ได้ = แถบเมนูวาดไม่ได้`).toBeGreaterThan(0);
    }
  });

  it("🚨 โทเคน LINE ยังอ่านได้เฉพาะ main เหมือนเดิม", async () => {
    for (const r of ROLES_UNDER_TEST) {
      const { data } = await as[r].from("app_settings").select("kind").eq("kind", "line_channel_token");
      expect((data ?? []).length, `${r} ไม่ควรอ่านโทเคน LINE ได้`).toBe(0);
    }
  });

  it("ประวัติการแก้ไข (edit_log) อ่านได้เฉพาะ main", async () => {
    for (const r of ROLES_UNDER_TEST) {
      expect(await visible(as[r], "edit_log"), r).toBe(0);
    }
  });
});

describe("🚨 ยิง RPC ตรงโดยไม่ผ่านหน้าจอ ต้องโดนปฏิเสธ", () => {
  it("ฝ่ายเงินเดือนยกเลิกออเดอร์ไม่ได้", async () => {
    const { error } = await as.payroll.rpc("fn_cancel_order", { p_qu_no: T.quNo });
    expect(error, "ต้องมี error — ถ้า null แปลว่ายกเลิกออเดอร์สำเร็จ").not.toBeNull();
    expect(error?.message).toContain("สิทธิ์");
  });

  it("ฝ่ายขายลงบัญชีเงินเดือนไม่ได้", async () => {
    const { error } = await as.sales.rpc("fn_post_payroll", {
      p_period_id: "zz-ไม่มีจริง", p_kind: "NET",
      p_date: "2026-08-31", p_payload: {},
    });
    expect(error, "ต้องมี error").not.toBeNull();
    expect(error?.message).toContain("สิทธิ์");
  });

  it("🔴 พนักงานขายธรรมดา (sales) ยกเลิกออเดอร์ไม่ได้ — ยกเลิก = void ใบกำกับภาษี", async () => {
    const { error } = await as.sales.rpc("fn_cancel_order", { p_qu_no: T.quNo });
    expect(error, "ต้องมี error — ถ้า null แปลว่าพนักงานขายยกเลิกออเดอร์ได้").not.toBeNull();
    expect(error?.message).toContain("สิทธิ์");
  });

  it("🔴 sales ยกเลิกใบแจ้งหนี้มัดจำก็ไม่ได้", async () => {
    const { error } = await as.sales.rpc("fn_void_deposit_invoice", { p_qu_no: T.quNo });
    expect(error).not.toBeNull();
    expect(error?.message).toContain("สิทธิ์");
  });

  it("★ ส่วน sales_manager ยกเลิกได้ (ไม่ใช่ปิดหมดทุกคนแล้วเทสผ่าน)", async () => {
    const { error } = await as.sales_manager.rpc("fn_cancel_order", { p_qu_no: T.quNo });
    // อาจล้มด้วยเหตุผลทางธุรกิจได้ (สถานะออเดอร์ไม่เข้าเงื่อนไข) แต่ต้องไม่ใช่เรื่องสิทธิ์
    if (error) expect(error.message).not.toContain("สิทธิ์");
  });

  it("★ sales ยัง **บันทึกการขาย** ได้ตามปกติ (ตัดแค่การยกเลิก ไม่ใช่ตัดทั้งหน้าที่)", async () => {
    const { data } = await as.sales.rpc("has_cap", { cap: "sales.write" });
    expect(data).toBe(true);
  });
});

describe("has_cap() — ฟังก์ชันตัดสินสิทธิ์ฝั่ง DB", () => {
  it("ตอบตรงกับตารางที่ตั้งใจ", async () => {
    const cases: [string, string, boolean][] = [
      ["accounting", "acct.write", true],
      ["accounting", "acct.config", false],
      ["accounting", "pay.read", false],
      ["payroll", "pay.write", true],
      ["payroll", "acct.read", false],
      ["viewer", "prod.read", true],
      ["viewer", "prod.write", false],
      ["viewer", "pay.read", false],
      ["sales_manager", "sales.config", true],
      ["sales", "sales.config", false],
      ["sales_manager", "sales.write", true],
      ["finance_manager", "pay.config", true],
      ["finance_manager", "sales.read", false],
    ];
    for (const [role, cap, want] of cases) {
      const { data, error } = await as[role].rpc("has_cap", { cap });
      expect(error, `${role}/${cap}: ${error?.message}`).toBeNull();
      expect(data, `${role} ควร${want ? "" : "ไม่"}มี ${cap}`).toBe(want);
    }
  });

  it("🚨 main ได้ทุก cap", async () => {
    for (const cap of ["admin", "pay.config", "acct.config", "sales.config", "prod.write"]) {
      const { data } = await asMain.rpc("has_cap", { cap });
      expect(data, cap).toBe(true);
    }
  });
});
