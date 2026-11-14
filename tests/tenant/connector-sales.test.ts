import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { admin, assertTestEnv, cleanupTestTenants, seedTenant, seedUser, type Tenant } from "./harness";

/**
 * D172 — Claude connector ฝั่งขาย กับ **ฐานข้อมูลจริง** (ไม่ผ่านหน้าเว็บ)
 *
 * ★ เรียก authenticate() + buildServer() ตัวจริงของ /api/mcp ผ่าน MCP client ในหน่วยความจำ
 *   ด้วย token ของผู้ใช้จริง (RLS มีผลเต็ม · ไม่มี service role ในเส้นทางที่เทส)
 * 🚨 เทสขายหน้าร้านจบลูปจริง: ออเดอร์ · บิลรายรับ · สต็อก · ฟอร์ม ภส. (log_product) — และกันการ์ดเดิมขายซ้ำ
 */

let T: Tenant;
const token: Record<string, string> = {};

// tokenClient() ใน session.ts อ่าน env ของแอป — ชี้ไป DB ทดสอบ
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.TENANT_TEST_SUPABASE_URL;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.TENANT_TEST_ANON_KEY;

async function connect(role: string) {
  const { authenticate } = await import("@/lib/connector/session");
  const { buildServer } = await import("@/lib/connector/tools");
  const auth = await authenticate(token[role]);
  if (!auth.ok) return { auth, client: null as unknown as Client };
  const server = buildServer({ db: auth.db, me: auth.me });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(ct);
  return { auth, client };
}

type CallResult = { isError?: boolean; structuredContent?: Record<string, unknown>; content?: { type: string; text?: string }[] };
const textOf = (r: CallResult) => (r.content ?? []).map((c) => c.text ?? "").join(" ");
async function call(c: Client, name: string, args: Record<string, unknown> = {}): Promise<CallResult> {
  return (await c.callTool({ name, arguments: args })) as CallResult;
}

beforeAll(async () => {
  assertTestEnv();
  await cleanupTestTenants();
  T = await seedTenant("csales");
  const db = admin();
  // ค่าตั้งที่ขายหน้าร้านต้องมี (go-live ตั้งที่ ตั้งค่า → กิจการ)
  const set = (kind: string, value: string) => ({ tenant_id: T.tenantId, kind, value });
  const r1 = await db.from("app_settings").insert([
    set("sales_revenue_entity", T.entityId),
    set("sales_revenue_account", "บัญชีทดสอบ"),
    set("pos_walkin_contact", T.contactId),
  ]);
  if (r1.error) throw new Error(r1.error.message);
  for (const role of ["general_staff", "accounting", "sales", "payroll"]) {
    const u = await seedUser(T, role);
    const g = await db.from("connector_users").insert({ user_id: u.userId, note: "zz-test D172" });
    if (g.error) throw new Error(g.error.message);
    const s = await (u.client as SupabaseClient).auth.getSession();
    token[role] = s.data.session!.access_token;
  }
}, 300_000);

afterAll(async () => {
  await cleanupTestTenants();
});

describe("ด่านเข้า + เครื่องมือตามสิทธิ์", () => {
  it("พนักงานทุกฝ่าย: ได้ทั้งบัญชีและขาย", async () => {
    const { auth, client } = await connect("general_staff");
    expect(auth.ok).toBe(true);
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const n of ["preview_bill", "save_bill", "search_orders", "receivables", "pos_preview", "pos_sell"]) expect(names, n).toContain(n);
  });

  it("พนักงานบัญชี: ไม่มีเครื่องมือขาย (เส้นทางเดิมไม่ขยับ)", async () => {
    const { client } = await connect("accounting");
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("preview_bill");
    expect(names).not.toContain("search_orders");
    expect(names).not.toContain("pos_sell");
  });

  it("ฝ่ายขาย: ไม่มีเครื่องมือบัญชี", async () => {
    const { client } = await connect("sales");
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("pos_preview");
    expect(names).not.toContain("preview_bill");
    expect(names).not.toContain("account_statement");
  });

  it("🚨 ฝ่ายเงินเดือน: ต่อไม่ได้ พร้อมเหตุผลไทย (ไม่ใช่ได้เครื่องมือแล้วอ่านได้ลิสต์ว่าง)", async () => {
    const { auth } = await connect("payroll");
    expect(auth.ok).toBe(false);
    if (!auth.ok) {
      expect(auth.status).toBe(403);
      expect(auth.message).toContain("ตั้งค่า → ผู้ใช้");
    }
  });
});

describe("อ่านข้อมูลขาย", () => {
  it("sales_menu เห็นเมนูพร้อมสต็อก", async () => {
    const { client } = await connect("general_staff");
    const r = await call(client, "sales_menu");
    const items = JSON.parse(textOf(r)).items as { name: string; stock_left: number | null; sellable_at_shop: boolean }[];
    expect(items.find((i) => i.name === "เมนูทดสอบ")).toMatchObject({ stock_left: 50, sellable_at_shop: true });
  });

  it("receivables แยกใบเสนอราคาที่ยังไม่คอนเฟิร์มออกจากหนี้", async () => {
    const { client } = await connect("general_staff");
    const j = JSON.parse(textOf(await call(client, "receivables")));
    expect(j.owed).toEqual([]);
    expect(j.quotations_not_confirmed.map((o: { qu_no: string }) => o.qu_no)).toContain(T.quNo);
  });
});

describe("🚨 ขายหน้าร้านจบลูป", () => {
  let card: Record<string, unknown>;

  it("pos_preview: การ์ดคิดยอดจากเมนูใน DB · ลูกค้าทั่วไป", async () => {
    const { client } = await connect("general_staff");
    const r = await call(client, "pos_preview", { items: [{ menu: "เมนูทดสอบ", quantity: 2 }] });
    expect(r.isError, textOf(r)).toBeFalsy();
    card = r.structuredContent!;
    expect(card.card).toBe("pos");
    expect(card.errors).toEqual([]);
    expect((card.totals as { grand_total: number }).grand_total).toBe(200);
    expect((card.customer as { id: string }).id).toBe(T.contactId);
  });

  it("tenant_slug ไม่ตรง = ไม่ขาย", async () => {
    const { client } = await connect("general_staff");
    const r = await call(client, "pos_sell", { ...sellArgs(), tenant_slug: "someone-else" });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("ไม่ขาย");
  });

  it("ยอดไม่ตรงกับที่การ์ดโชว์ = ไม่ขาย", async () => {
    const { client } = await connect("general_staff");
    const r = await call(client, "pos_sell", { ...sellArgs(), expected_total: 199 });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("ยอดเปลี่ยน");
  });

  const sellArgs = () => ({
    tenant_slug: card.tenant_slug,
    previewed_at: card.previewed_at,
    expected_total: (card.totals as { grand_total: number }).grand_total,
    customer_id: (card.customer as { id: string }).id,
    items: card.items,
    discount: card.discount,
    method: "เงินสด",
  });

  it("pos_sell: ได้ออเดอร์ปิดการขาย · บิลรายรับ · สต็อกลด · ฟอร์ม ภส. มีแถวจ่าย", async () => {
    const { client } = await connect("general_staff");
    const r = await call(client, "pos_sell", sellArgs());
    expect(r.isError, textOf(r)).toBeFalsy();
    const sc = r.structuredContent as { sold: boolean; qu_no: string; order_no: string; doc_no: string; warning: string };
    expect(sc.sold).toBe(true);
    expect(sc.warning).toBe("");
    expect(sc.doc_no).not.toBe("");

    const db = admin();
    const so = await db.from("sales_orders").select("status, grand_total, remarks, sale_name").eq("tenant_id", T.tenantId).eq("qu_no", sc.qu_no).single();
    expect(so.data).toMatchObject({ grand_total: 200, remarks: "ขายหน้าร้าน", sale_name: "general_staff" });
    expect(String(so.data!.status)).toContain("ปิดการขาย");
    // 🪤 harness seed บิลรายรับ 200 ในบัญชีเดียวกันไว้แล้ว (txIdOwn) — ต้องตัดแถว seed ออก ไม่งั้นนับได้ 2
    const tx = await db.from("transactions").select("tx_id, net_amount, account_name")
      .eq("tenant_id", T.tenantId).eq("type", "รายรับ").not("tx_id", "in", `(${T.txId},${T.txIdOwn})`);
    expect(tx.data?.map((x) => [Number(x.net_amount), x.account_name])).toEqual([[200, "บัญชีทดสอบ"]]);
    const st = await db.from("stock_product").select("balance").eq("tenant_id", T.tenantId).eq("product_id", T.productId).single();
    expect(Number(st.data!.balance)).toBe(48);
    const lp = await db.from("log_product").select("trans_type, amount").eq("tenant_id", T.tenantId).eq("product_id", T.productId).neq("trans_type", "รับ");
    expect(lp.data?.map((x) => Number(x.amount))).toEqual([2]);
  });

  it("🚨 กดการ์ดเดิมซ้ำ = ไม่ขายซ้ำ", async () => {
    const { client } = await connect("general_staff");
    const r = await call(client, "pos_sell", sellArgs());
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("การ์ดนี้ขายไปแล้ว");
    const st = await admin().from("stock_product").select("balance").eq("tenant_id", T.tenantId).eq("product_id", T.productId).single();
    expect(Number(st.data!.balance)).toBe(48);
  });

  it("ขายแล้วค้นเจอใน search_orders / get_order", async () => {
    const { client } = await connect("general_staff");
    const s = JSON.parse(textOf(await call(client, "search_orders", { status: "ปิดการขาย" })));
    expect(s.orders.length).toBe(1);
    const g = JSON.parse(textOf(await call(client, "get_order", { qu_no: s.orders[0].qu_no })));
    expect(g.items).toEqual([{ name: "เมนูทดสอบ", quantity: 2, unit_price: 100, line_total: 200 }]);
    expect(g.payments.length).toBeGreaterThan(0);
  });

  it("🚨 พนักงานบัญชีเรียก pos_sell ไม่ได้ (ไม่มีเครื่องมือนี้)", async () => {
    const { client } = await connect("accounting");
    await expect(client.callTool({ name: "pos_sell", arguments: sellArgs() })).resolves.toMatchObject({ isError: true });
  });
});
