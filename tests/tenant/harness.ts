/**
 * harness.ts — เครื่องมือสร้าง/ล้าง tenant ทดสอบ สำหรับเทสกันข้อมูลรั่วข้ามลูกค้า
 *
 * 🚨 อ่าน env จาก **.env.tenant-test เท่านั้น ไม่แตะ .env.local**
 *    เพราะ .env.local ชี้ DB ที่ใช้งานจริง (ยื่นภาษี) — เทสชุดนี้สร้าง/ลบข้อมูลจริง
 *    ถ้าเผลอชี้ผิดที่ = ยัด tenant ทดสอบลงระบบจริง · แยกไฟล์ = พลาดไม่ได้เลย
 *
 * ตั้งค่าใน .env.tenant-test (ไฟล์นี้ถูก .gitignore แล้ว):
 *   TENANT_TEST_SUPABASE_URL=https://<ref>.supabase.co
 *   TENANT_TEST_SERVICE_ROLE_KEY=...
 *   TENANT_TEST_ANON_KEY=...
 *   TENANT_TEST_CONFIRM=disposable      ← ยืนยันว่า project นี้ทิ้งได้ ไม่ใช่ของจริง
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { generateInitialPassword } from "../../lib/shared/password";

/** รับได้ทั้ง 2 ชื่อ — `.local` เข้าชุดกับ .env.local ที่โปรเจกต์ใช้อยู่ */
export const ENV_FILES = [".env.tenant-test.local", ".env.tenant-test"] as const;
for (const f of ENV_FILES) {
  try {
    process.loadEnvFile?.(f);
    break;
  } catch {
    /* ลองชื่อถัดไป — ไม่เจอสักอันให้ assertTestEnv() ฟ้องเอง */
  }
}

const URL = process.env.TENANT_TEST_SUPABASE_URL ?? "";
const SERVICE = process.env.TENANT_TEST_SERVICE_ROLE_KEY ?? "";
const ANON = process.env.TENANT_TEST_ANON_KEY ?? "";
const CONFIRM = process.env.TENANT_TEST_CONFIRM ?? "";

export function assertTestEnv() {
  const missing = [
    !URL && "TENANT_TEST_SUPABASE_URL",
    !SERVICE && "TENANT_TEST_SERVICE_ROLE_KEY",
    !ANON && "TENANT_TEST_ANON_KEY",
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(
      `ยังไม่ได้ตั้ง ${ENV_FILES[0]} — ขาด: ${missing.join(", ")}\n` +
        "  ดูตัวอย่างค่าที่ต้องใส่ใน .env.example หัวข้อ 'เทสกันข้อมูลรั่ว'",
    );
  }
  if (CONFIRM !== "disposable") {
    throw new Error(
      `ต้องใส่ TENANT_TEST_CONFIRM=disposable ใน ${ENV_FILES[0]}\n` +
        "  = ยืนยันว่า project นี้เป็นของทิ้งได้ ไม่ใช่ DB ที่ใช้งานจริง\n" +
        "  (เทสชุดนี้สร้างและลบข้อมูลจริง — กันชี้ผิด project)",
    );
  }
}

/** marker สำหรับ cleanup — ลบทุกอย่างที่ขึ้นต้นด้วยนี้ทีเดียวได้ */
export const TEST_PREFIX = "zz-test-";

export const admin = (): SupabaseClient =>
  createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

/** client แบบผู้ใช้ทั่วไป (anon key) — RLS มีผลเต็ม */
export const anonClient = (): SupabaseClient =>
  createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

export type Tenant = {
  slug: string;
  tenantId: string;
  entityId: string;
  email: string;
  /** ชื่อผู้ใช้ที่พิมพ์ในหน้า login (ซ้ำกันได้ข้าม tenant — slug เป็นตัวแยก) */
  username: string;
  password: string;
  /**
   * คีย์ "ซ้ำกันทั้งสอง tenant" — พิสูจน์ว่าอยู่ร่วมกันได้หลังผ่าตัด PK (0027)
   * ⚠️ ห้ามใช้ทดสอบการยิงข้าม tenant — เพราะอีกฝั่งก็มีคีย์นี้ของตัวเอง
   *    เรียกไปจะไปโดนของตัวเอง แล้วสำเร็จ (ถูกต้องแล้ว) ทำให้เทสไม่ได้ทดสอบอะไรเลย
   */
  quNo: string;
  txId: string;
  batch: string;
  /** คีย์ "เฉพาะ tenant นี้" — อีกฝั่งไม่มี → ใช้ทดสอบยิงข้ามได้จริง */
  quNoOwn: string;
  txIdOwn: string;
  materialName: string;
  productId: string;
  contactId: string;
};

/** ทุกตารางที่มีคอลัมน์ tenant_id — ใช้วนเช็คว่าอ่านข้ามกันไม่ได้ */
export const TENANT_TABLES = [
  "entities", "bank_accounts", "app_settings", "contacts", "counters", "integration_log",
  "materials", "containers", "products",
  "log_material", "log_ferment", "log_distill", "log_distill_run",
  "log_ferment_monitor", "log_dilute", "log_ferment_draw", "log_product", "stock_product",
  "transactions", "transaction_items", "tax_summaries", "wht_certificates",
  "sale_menu", "sales_orders", "sales_order_items", "warehouse_stock", "stock_moves",
  "pay_inputs", "pay_components", "pay_rates", "pay_variables", "pay_post_legs",
  "employees", "payroll_periods", "payroll_items",
  "report_runs", "edit_log", "profiles",
] as const;

const must = (label: string, error: { message: string } | null) => {
  if (error) throw new Error(`${label}: ${error.message}`);
};

/** ล้าง tenant ทดสอบทั้งหมด (เรียกได้เสมอ — idempotent · ไม่มี env ก็ไม่ระเบิด) */
export async function cleanupTestTenants() {
  if (!URL || !SERVICE) return; // env ไม่ครบ = ยังไม่เคยสร้างอะไร ไม่มีอะไรต้องล้าง
  const db = admin();

  const { data: tenants } = await db.from("tenants").select("id, slug").like("slug", `${TEST_PREFIX}%`);
  if (!tenants?.length) return;

  // 1) ลบ auth user ก่อน (profiles ตามไปด้วย on delete cascade)
  const ids = tenants.map((t) => t.id as string);
  const { data: profs } = await db.from("profiles").select("id").in("tenant_id", ids);
  for (const p of profs ?? []) {
    await db.auth.admin.deleteUser(p.id as string).catch(() => {});
  }

  // 2) ล้างข้อมูลของแต่ละ tenant (fn_mig_truncate ลบเฉพาะ tenant ที่ระบุ — 0029)
  for (const t of tenants) {
    const { error } = await db.rpc("fn_mig_truncate", { p_tenant: t.id });
    if (error) throw new Error(`cleanup fn_mig_truncate(${t.slug}): ${error.message}`);
  }

  // 3) ลบแถว tenants (ต้องหลังสุด เพราะทุกตาราง FK มาที่นี่)
  must("cleanup tenants", (await db.from("tenants").delete().in("id", ids)).error);
}

/**
 * สร้าง tenant ทดสอบ 1 ราย พร้อมผู้ใช้ role main + ข้อมูลตัวอย่างครบทุกโดเมน
 *
 * @param opts.slug ระบุ slug เองได้ (ไม่มี TEST_PREFIX) — ใช้ตอน seed tenant สาธิต
 *   ที่ต้องการให้**ค้างอยู่** ไม่โดน cleanupTestTenants() ลบทิ้งตอนรันเทสรอบถัดไป
 */
export async function seedTenant(
  suffix: string,
  opts: { slug?: string; forcePasswordChange?: boolean } = {},
): Promise<Tenant> {
  const db = admin();
  const slug = opts.slug ?? `${TEST_PREFIX}${suffix}`;
  // 🚨 สุ่มไม่ซ้ำต่อราย — ห้ามใช้รหัสตั้งต้นตัวเดียวกันข้ามลูกค้าเด็ดขาด
  //    ถ้าซ้ำ คนของเจ้าหนึ่งจะล็อกอินเข้าอีกเจ้าได้ผ่าน URL ของเขา (ผู้ใช้จับได้ตอนเทส)
  const password = generateInitialPassword();

  const { data: t, error: tErr } = await db
    .from("tenants")
    .insert({ slug, name: `กิจการทดสอบ ${suffix}` })
    .select("id")
    .single();
  must("สร้าง tenant", tErr);
  const tenantId = t!.id as string;

  // แบรนด์อยู่ใน app_settings ที่เดียว (0030) — หน้า login อ่านผ่าน view tenant_branding
  must("แบรนด์", (await db.from("app_settings").insert([
    { tenant_id: tenantId, kind: "brand_name", value: `แบรนด์ ${suffix}` },
    { tenant_id: tenantId, kind: "brand_color", value: "steel" },
    { tenant_id: tenantId, kind: "default_mode", value: "light" },
  ])).error);

  // ★ ทั้งสอง tenant ใช้ 'EID01' เหมือนกัน — พิสูจน์ว่า composite PK (tenant_id, entity_id) ทำงาน
  const entityId = "EID01";
  must("สร้าง entity", (await db.from("entities").insert({
    tenant_id: tenantId, entity_id: entityId, name: `กิจการทดสอบ ${suffix}`,
    is_vat: true, is_default: true,
  })).error);

  // ผู้ใช้ role main — ★ ชื่อผู้ใช้ต้องไม่ซ้ำ **ทั้งระบบ** (0032) ไม่ใช่แค่ในกิจการ
  // ⚠️ local-part ของอีเมลต้องเท่ากับ username เป๊ะ ไม่งั้นสูตรจริงใน
  //    usernameToEmail(username) จะหาบัญชีนี้ไม่เจอตอนล็อกอินผ่านหน้าจอ
  const username = `owner-${slug}`;
  const email = `${username}@insep.local`;
  const { data: u, error: uErr } = await db.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: {
      username, display_name: `เจ้าของ ${suffix}`, tenant_id: tenantId,
      // เทสอัตโนมัติล็อกอินผ่าน API ไม่ผ่านหน้าจอ → ข้ามหน้าบังคับเปลี่ยนรหัส
      // ส่วน tenant สาธิตตั้ง false เพื่อให้เห็นโฟลว์จริงในเบราว์เซอร์
      skip_password_change: !opts.forcePasswordChange,
    },
  });
  must("สร้างผู้ใช้", uErr);
  must("ตั้ง role main", (await db.from("profiles")
    .update({ role: "main" }).eq("id", u!.user!.id)).error);

  // ── ข้อมูลตัวอย่าง: ใช้คีย์ "เหมือนกันทั้งสอง tenant" เพื่อพิสูจน์ว่าไม่ชนกัน ──
  const base = { tenant_id: tenantId, entity_id: entityId };
  const materialName = "ข้าวเหนียวทดสอบ";
  const productId = "T-PROD-01";
  const contactId = "C-9001";
  const batch = "9/69";
  const quNo = `QU990101-001`;
  const txId = `TR-99010101-0001`;
  // คีย์เฉพาะของ tenant นี้ (อีกฝั่งไม่มี) — ไว้ให้อีกฝั่งลองยิงข้าม
  const quNoOwn = `QU9902${suffix}-001`;
  const txIdOwn = `TR-9902${suffix}-0001`;

  must("material", (await db.from("materials").insert({
    ...base, material_id: "T-MAT-01", name: materialName, unit: "กก.",
  })).error);
  must("container", (await db.from("containers").insert({
    ...base, container_id: "T-CON-01", container_type: "ถังทดสอบ", capacity_l: 200,
  })).error);
  must("product", (await db.from("products").insert({
    ...base, product_id: productId, name: "สุราทดสอบ", degree: 40, bottle_size_l: 0.7,
  })).error);
  must("contact", (await db.from("contacts").insert({
    ...base, contact_id: contactId, name: `ลูกค้าทดสอบ ${suffix}`, roles: ["ลูกค้า"],
  })).error);
  // ★ ต้องมีแถวหมักด้วย ไม่ใช่แค่แถวปิด batch — หน้า "ลงหมัก" เดาเลข batch ถัดไป
  //   จาก log_ferment เท่านั้น (nextBatchNumber ใน lib/production/calc.ts)
  //   ถ้า seed แต่ log_distill หน้าจอจะเสนอ 1/69 เหมือนกันทุก tenant = ดูไม่ออกว่าแยกกันจริง
  must("log_ferment", (await db.from("log_ferment").insert({
    ...base, ferment_date: "2026-01-01", product_name: "สุราทดสอบ", batch,
    container_id: "T-CON-01", container_qty: 1,
    material_ids: "T-MAT-01", material_amounts: "100",
  })).error);
  must("log_distill", (await db.from("log_distill").insert({
    ...base, distill_date: "2026-01-01", product_name: "สุราทดสอบ", batch, vol: 100, abv: 40,
  })).error);
  // D78 สุราแช่: batch เดียวกันข้าม tenant ต้องรินได้ทั้งคู่ (unique เป็น tenant+entity+batch)
  //   ใช้ batchOwn เพื่อไม่ชนกับ batch ที่ log_distill ใช้อยู่ในเส้นทางกลั่นของ tenant เดียวกัน
  must("log_ferment_draw", (await db.from("log_ferment_draw").insert({
    ...base, draw_date: "2026-01-02", product_name: "สุราทดสอบ", batch, vol: 80, abv: 12,
  })).error);
  must("log_product", (await db.from("log_product").insert({
    ...base, doc_date: "2026-01-01", trans_type: "รับ", product_id: productId, amount: 50,
  })).error);
  must("sale_menu", (await db.from("sale_menu").insert({
    ...base, menu_name: "เมนูทดสอบ", price: 100, category: "สุรา", product_id: productId,
  })).error);
  must("sales_order", (await db.from("sales_orders").insert({
    tenant_id: tenantId, entity_id: entityId, qu_no: quNo, order_no: `ORD990101-001`,
    customer_id: contactId, customer_name: `ลูกค้าทดสอบ ${suffix}`,
    status: "รอคอนเฟิร์ม", grand_total: 100, outstanding_balance: 100,
  })).error);
  must("transaction", (await db.from("transactions").insert({
    tenant_id: tenantId, entity_id: entityId, tx_id: txId,
    transaction_date: "2026-01-01", type: "รายรับ", account_name: "บัญชีทดสอบ",
    net_amount: 100, status: "ปกติ", ap_ar_status: "AR",
  })).error);

  // ── ชุดคีย์เฉพาะ tenant นี้ (อีกฝั่งไม่มีเลข/เอกสารพวกนี้) ──
  must("sales_order เฉพาะตัว", (await db.from("sales_orders").insert({
    tenant_id: tenantId, entity_id: entityId, qu_no: quNoOwn, order_no: `ORD9902${suffix}-001`,
    customer_id: contactId, customer_name: `ลูกค้าทดสอบ ${suffix}`,
    status: "รอคอนเฟิร์ม", grand_total: 200, outstanding_balance: 200,
  })).error);
  must("transaction เฉพาะตัว", (await db.from("transactions").insert({
    tenant_id: tenantId, entity_id: entityId, tx_id: txIdOwn,
    transaction_date: "2026-01-01", type: "รายรับ", account_name: "บัญชีทดสอบ",
    net_amount: 200, status: "ปกติ", ap_ar_status: "AR",
  })).error);

  return {
    slug, tenantId, entityId, email, username, password,
    quNo, txId, batch, quNoOwn, txIdOwn,
    materialName, productId, contactId,
  };
}

/** ล็อกอินเป็นผู้ใช้ของ tenant นั้น → client ที่ RLS มีผลเต็ม */
export async function signIn(t: Tenant): Promise<SupabaseClient> {
  const c = anonClient();
  const { error } = await c.auth.signInWithPassword({ email: t.email, password: t.password });
  if (error) throw new Error(`ล็อกอิน ${t.slug}: ${error.message}`);
  return c;
}
