/**
 * reconcile.ts — เทียบข้อมูลหลัง import กับต้นทาง (MIGRATION_PLAN sec 7.3)
 * ออกรายงาน PASS/FAIL:
 *   1. จำนวนแถว: imported(จากชีทหลัง clean) = DB · แสดง raw sheet ด้วย (ผลต่าง = skip ที่ตั้งใจ)
 *   2. transactions: Σ base/vat/net ต่อเดือน×entity×type — เทียบ dataset↔DB + พิมพ์ pivot ให้เทียบมือกับ Sheets
 *   3. stock_product: balance ต่อ product เทียบชีท Stock_Product (แหล่งอิสระ)
 *   4. log_distill: batch ไม่ซ้ำใน DB
 * หมายเหตุ: ยอดบัญชี + PDF ราชการ = เทียบมือ (sec 7.3 ท้ายตาราง) — ไม่อัตโนมัติ
 */
import { buildDataset } from "./lib/transform";
import { serviceClient, requireTenantArg } from "./lib/client";
import { loadWorkbook, rows } from "./lib/loader";
import * as C from "./lib/clean";

let pass = 0;
let fail = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`  ${ok ? "✅" : "❌"} ${label}${detail ? " — " + detail : ""}`);
  ok ? pass++ : fail++;
};
const money = (n: number) => n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eq2 = (a: number, b: number) => Math.abs(a - b) < 0.005;

async function main() {
  const TENANT = requireTenantArg();
  const db = serviceClient();
  const ds = buildDataset();
  const prod = loadWorkbook("production");

  // ── 1. จำนวนแถว imported vs DB ──────────────────────────────────────────
  console.log("\n【1】 จำนวนแถว (imported = DB)");
  for (const t of ds.order) {
    const expected = ds.tables[t].length;
    const { count, error } = await db.from(t).select("*", { count: "exact", head: true }).eq("tenant_id", TENANT);
    if (error) {
      check(false, t, error.message);
      continue;
    }
    check((count ?? 0) === expected, t, `imported ${expected} · DB ${count}`);
  }
  // stock_product แยก (สร้างจาก recompute ไม่ใช่ import ตรง)
  {
    const { count } = await db.from("stock_product").select("*", { count: "exact", head: true }).eq("tenant_id", TENANT);
    console.log(`  ℹ️  stock_product ใน DB: ${count} แถว (สร้างจาก recompute)`);
  }

  // ── 2. transactions pivot: เดือน × entity × type ────────────────────────
  console.log("\n【2】 transactions Σ base/vat/net ต่อเดือน×entity×type");
  type Agg = { base: number; vat: number; net: number; n: number };
  const key = (m: string, e: string, ty: string) => `${m}|${e}|${ty}`;
  // ปัดรายแถวเป็น 2 ตำแหน่งก่อนรวม — ให้ตรงกับที่ DB เก็บ numeric(14,2)
  // (sheet บางแถวมีทศนิยมเกิน 2 → เทียบดิบจะต่างระดับเศษสตางค์ ทั้งที่ค่าที่เก็บจริงตรงกัน)
  const r2 = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;
  const pivot = (recs: Record<string, unknown>[]) => {
    const map = new Map<string, Agg>();
    for (const r of recs) {
      const m = String(r.transaction_date ?? "").slice(0, 7);
      const k = key(m, String(r.entity_id), String(r.type));
      const a = map.get(k) ?? { base: 0, vat: 0, net: 0, n: 0 };
      a.base += r2(r.base_amount);
      a.vat += r2(r.vat_amount);
      a.net += r2(r.net_amount);
      a.n += 1;
      map.set(k, a);
    }
    return map;
  };
  const fromSheet = pivot(ds.tables.transactions);
  const { data: dbTx, error: txErr } = await db
    .from("transactions")
    .select("transaction_date, entity_id, type, base_amount, vat_amount, net_amount")
    .eq("tenant_id", TENANT);
  if (txErr) {
    check(false, "โหลด transactions จาก DB", txErr.message);
  } else {
    const fromDb = pivot(dbTx as Record<string, unknown>[]);
    let mism = 0;
    const keys = new Set([...fromSheet.keys(), ...fromDb.keys()]);
    for (const k of keys) {
      const s = fromSheet.get(k) ?? { base: 0, vat: 0, net: 0, n: 0 };
      const d = fromDb.get(k) ?? { base: 0, vat: 0, net: 0, n: 0 };
      if (!(eq2(s.base, d.base) && eq2(s.vat, d.vat) && eq2(s.net, d.net) && s.n === d.n)) mism++;
    }
    check(mism === 0, "dataset ↔ DB ตรงกันทุกกลุ่ม", mism ? `${mism} กลุ่มไม่ตรง` : "");

    // พิมพ์ pivot ให้เทียบมือกับ Sheets
    console.log("\n  pivot (เทียบมือกับ pivot ในชีทเดิม):");
    console.log("  " + "เดือน|กิจการ|ประเภท".padEnd(30) + "n".padStart(4) + "  " +
      "Σ base".padStart(15) + "  " + "Σ vat".padStart(13) + "  " + "Σ net".padStart(15));
    for (const k of [...fromSheet.keys()].sort()) {
      const a = fromSheet.get(k)!;
      console.log("  " + k.padEnd(30) + String(a.n).padStart(4) + "  " +
        money(a.base).padStart(15) + "  " + money(a.vat).padStart(13) + "  " + money(a.net).padStart(15));
    }
  }

  // ── 3. stock_product เทียบชีท Stock_Product ──────────────────────────────
  console.log("\n【3】 stock_product เทียบชีท Stock_Product");
  const sheetStock = new Map<string, number>();
  for (const r of rows(prod, "Stock_Product")) {
    const pid = C.strReq(r[0]);
    if (pid) sheetStock.set(pid, C.num0(r[1]));
  }
  const { data: dbStock, error: stErr } = await db.from("stock_product").select("product_id, balance").eq("tenant_id", TENANT);
  if (stErr) {
    check(false, "โหลด stock_product", stErr.message);
  } else {
    const dbMap = new Map((dbStock as { product_id: string; balance: number }[]).map((s) => [s.product_id, Number(s.balance)]));
    const pids = new Set([...sheetStock.keys(), ...dbMap.keys()]);
    let mism = 0;
    for (const pid of pids) {
      const sv = sheetStock.get(pid) ?? 0;
      const dv = dbMap.get(pid) ?? 0;
      if (!eq2(sv, dv)) {
        mism++;
        console.log(`     ⚠️ ${pid}: sheet ${sv} · DB ${dv}`);
      }
    }
    check(mism === 0, "balance ตรงทุก product", mism ? `${mism} product ไม่ตรง (ดูด้านบน — อาจต้องรัน runRecomputeStock ฝั่ง GAS ก่อนเทียบ)` : "");
  }

  // ── 4. log_distill batch ไม่ซ้ำ ─────────────────────────────────────────
  console.log("\n【4】 log_distill batch unique");
  const { data: batches, error: bErr } = await db.from("log_distill").select("batch").eq("tenant_id", TENANT);
  if (bErr) check(false, "โหลด log_distill", bErr.message);
  else {
    const all = (batches as { batch: string }[]).map((b) => b.batch);
    const dup = all.filter((b, i) => all.indexOf(b) !== i);
    check(dup.length === 0, "ไม่มี batch ซ้ำ", dup.length ? `ซ้ำ: ${[...new Set(dup)].join(", ")}` : "");
  }

  console.log(`\n${"─".repeat(50)}`);
  console.log(`สรุป: ✅ ผ่าน ${pass} · ❌ ไม่ผ่าน ${fail}`);
  console.log("เทียบมือเพิ่ม (ไม่อัตโนมัติ): ยอดบัญชีทุกบัญชี + PDF ภพ.30/ภส. เดือนล่าสุด vs ที่ยื่นจริง");
  if (fail) process.exit(1);
}

main().catch((e) => {
  console.error("\n❌ " + (e as Error).message);
  process.exit(1);
});
