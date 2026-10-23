/**
 * migration/aim/import-aim.ts — ย้ายข้อมูลบัญชีลูกค้า PAT&AIM เข้า proof (D121)
 *
 * ใช้:
 *   npx tsx migration/aim/import-aim.ts --file="D:/Pat/PAT&AIM.xlsx" --config="D:/Pat/aim-import-config.json"
 *     → dry-run: แปลง + รายงานปัญหา + เทียบยอดกับแอปเดิม · **ไม่แตะ DB**
 *   … --apply --env=.env.local.testing-backup --tenant=<ชื่อย่อลูกค้า>
 *     → ลงจริงเข้า tenant ที่รับลูกค้าไว้แล้วที่หน้า /platform (ดูเงื่อนไขใน apply.ts)
 *
 * 🚨 ลงจริงได้เฉพาะเมื่อรายงานสะอาดทั้งหมด: ไม่มีจุดค้างตัดสิน · ยอดคงเหลือตรงทุกบัญชี
 *    · เงินเดือนทุกบรรทัดคิดได้ตรงแอปเดิม — ไม่ตรงข้อเดียว = ไม่ลง
 * 🚨 ไฟล์ลูกค้า + ค่าตั้งเฉพาะลูกค้าอยู่นอก repo เสมอ · ห้ามคัดลอกเข้า repo (D66)
 */
import { buildAimDataset, legacyBalances, readAimConfig, type Issue } from "./transform";
import { accountBalances, type LedgerTx } from "../../lib/accounting/ledger";
import { taxReport, round2, type Tx } from "../../lib/accounting/calc";
import { buildAimPayroll, payrollTables, LEGS } from "./payroll";
import { applyAim, preflight, INSERT_ORDER, type ImportTable } from "./apply";
import { adminFromEnv } from "../../scripts/lib/provision";

const argOf = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=").replace(/^"|"$/g, "") ?? "";
const FILE = argOf("file");
const CONFIG = argOf("config");
const APPLY = process.argv.includes("--apply");
const DEFAULT_ENTITY = "EID01";
if (!FILE || !CONFIG) {
  console.error('❌ ต้องระบุ --file="<ไฟล์ .xlsx ของแอปเดิม>" --config="<ไฟล์ค่าตั้ง .json>" (ทั้งคู่อยู่นอก repo)');
  process.exit(1);
}

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function groupIssues(title: string, list: Issue[], showAll: boolean) {
  console.log(`\n${title} (${list.length})`);
  const by = new Map<string, Issue[]>();
  for (const i of list) by.set(i.kind, [...(by.get(i.kind) ?? []), i]);
  for (const [k, xs] of by) {
    console.log(`  • ${k}: ${xs.length}`);
    for (const x of showAll ? xs : xs.slice(0, 3)) console.log(`      ${x.txId ? x.txId + " " : ""}${x.text}`);
    if (!showAll && xs.length > 3) console.log(`      … อีก ${xs.length - 3}`);
  }
}

const cfg = readAimConfig(CONFIG);
const ds = buildAimDataset(FILE, cfg);
const t = ds.tables;
type T = Record<string, unknown> & { tx_id: string; transaction_date: string; entity_id: string; type: string; status: string };
const txs = t.transactions as T[];

console.log("── จำนวนแถวที่จะลง ──");
for (const [k, v] of Object.entries(t)) console.log(`  ${k.padEnd(20)} ${v.length}`);
console.log(`  ${"counters".padEnd(20)} ${ds.counters.length}`);

groupIssues("🚨 ต้องตัดสินก่อนลง DB", ds.blockers, true);
groupIssues("⚠️ แปลงแล้ว ควรรู้", ds.warnings, false);

// ── รวม VAT เป็นต้นทุน (กิจการไม่จด VAT) ──────────────────────────────────────
const byEnt = new Map<string, { n: number; vat: number }>();
for (const f of ds.folded) {
  const x = byEnt.get(f.entity) ?? { n: 0, vat: 0 };
  byEnt.set(f.entity, { n: x.n + 1, vat: round2(x.vat + f.vat) });
}
console.log(`\n── รวม VAT เป็นต้นทุน (กิจการไม่จด VAT) ${ds.folded.length} ใบ ──`);
for (const [e, x] of byEnt) console.log(`  ${e}: ${x.n} ใบ · VAT ${fmt(x.vat)} กลายเป็นต้นทุน (ยอดที่จ่ายจริงเท่าเดิม)`);

// ── 1. ยอดคงเหลือ: แอปเดิม vs proof (หลังแปลง) ─────────────────────────────────
const opening = new Map(t.bank_accounts.map((a) => [a.account_id as string, Number(a.opening_balance) || 0]));
const legacy = legacyBalances(ds.legacyTx, opening);
const proof = accountBalances(
  "2099-12",
  txs as unknown as LedgerTx[],
  t.bank_accounts.map((a) => ({ accountName: a.account_name as string, openingBalance: Number(a.opening_balance) || 0, entityIds: a.entity_ids as string[] })),
  "ALL",
);
console.log("\n── ยอดคงเหลือทุกบัญชี (ทั้งหมดถึงปัจจุบัน) ──");
console.log("  บัญชี                         แอปเดิม          proof        ต่าง");
let balOk = true;
for (const a of t.bank_accounts) {
  const l = legacy.get(a.account_id as string) ?? 0;
  const p = proof.balances.find((b) => b.accountType === a.account_name)?.balance ?? 0;
  const d = round2(p - l);
  if (d !== 0) balOk = false;
  console.log(`  ${(a.account_id + " → " + a.account_name).padEnd(28)} ${fmt(l).padStart(14)} ${fmt(p).padStart(14)} ${d === 0 ? "     ✓" : fmt(d).padStart(11) + " ✗"}`);
}

// ── 2. ภพ.30 ─────────────────────────────────────────────────────────────────
const isVatEnt = new Map(t.entities.map((e) => [e.entity_id as string, e.is_vat as boolean]));
/** แบบแอปเดิม (40_reports.js): ปกติ + VAT > 0 + กิจการ + เดือนของวันที่รายการ — ไม่สนสถานะค้าง/บัญชี */
const legacyVat = (entity: string, month: string, sales: boolean) => {
  let s = 0;
  for (const r of ds.legacyTx) {
    if ((String(r[18] ?? "").trim() || "ปกติ") !== "ปกติ" || String(r[20] ?? "").trim() !== entity) continue;
    if (!(Number(r[11]) > 0)) continue;
    const tx = txs.find((x) => x.tx_id === String(r[0]).trim());
    if (!tx || tx.transaction_date.slice(0, 7) !== month) continue;
    if ((String(r[3]).trim() === "รายรับ") === sales && ["รายรับ", "รายจ่าย"].includes(String(r[3]).trim())) s += Number(r[10]) || 0;
  }
  return Math.round(s * 7) / 100;
};
console.log("\n── ภพ.30: ที่บันทึกไว้ในแอปเดิม (แถวล่าสุด) เทียบกับที่ proof จะคิดได้ ──");
console.log("  กิจการ เดือน     │ ภาษีขาย: บันทึกไว้  proof  สูตรเดิม │ ภาษีซื้อ: บันทึกไว้  proof  สูตรเดิม");
for (const s of [...t.tax_summaries].sort((a, b) => String(a.entity_id + "" + a.report_month).localeCompare(String(b.entity_id + "" + b.report_month)))) {
  const ent = s.entity_id as string;
  const mon = s.report_month as string;
  const r = taxReport(mon, ent, 0, txs as unknown as Tx[], {});
  const mark = (a: number, b: number) => (Math.abs(a - b) < 0.005 ? "✓" : "✗");
  const fs = Number(s.total_sales_vat) || 0, fp = Number(s.total_purchase_vat) || 0;
  const ls = legacyVat(ent, mon, true), lp = legacyVat(ent, mon, false);
  console.log(
    `  ${ent} ${mon} │ ${fmt(fs).padStart(11)} ${fmt(r.totalSalesVat).padStart(10)}${mark(fs, r.totalSalesVat)} ${fmt(ls).padStart(10)}${mark(fs, ls)}` +
      ` │ ${fmt(fp).padStart(11)} ${fmt(r.totalPurchaseVat).padStart(10)}${mark(fp, r.totalPurchaseVat)} ${fmt(lp).padStart(10)}${mark(fp, lp)}`,
  );
}

/**
 * ── 3. บิลที่แอปเดิมนับเข้า ภพ.30 แต่ proof ยังไม่นับ — รายการให้ผู้ใช้ไปแก้รายบิล ──
 * ผู้ใช้ตัดสิน (2026-10-22): **ไม่แก้สูตร proof** (cash basis · กระทบข้อมูลลูกค้ารายอื่น)
 * แก้เป็นเคส ๆ ในแอปแทน · ★ กดรับ/จ่ายชำระแล้วบิลยังอยู่ "เดือนเดิม" (fn_settle_apar ไม่แตะวันที่รายการ)
 *   ⇒ ภพ.30 ของเดือนนั้นจะกลับมาตรงกับที่ยื่นไว้เอง ไม่ไปนับซ้ำในเดือนที่รับเงิน
 */
const filed = new Set(t.tax_summaries.map((s) => `${s.entity_id}|${s.report_month}`));
const diffs = txs.filter((x) =>
  x.status === "ปกติ" && Number(x.vat_amount) > 0 && ["รายรับ", "รายจ่าย"].includes(x.type) &&
  isVatEnt.get(x.entity_id) !== false &&
  // D124 — ไม่ถามบัญชีแล้ว · เหลือแค่บิลค้างที่ยังไม่มีเลขใบกำกับ (D123)
  Boolean(x.ap_ar_status) && !String(x.tax_invoice_no ?? "").trim(),
);
console.log(`\n── บิลที่แอปเดิมนับเข้า ภพ.30 แต่ proof ยังไม่นับ (${diffs.length} ใบ) — ไปแก้รายบิลในแอป ──`);
for (const x of diffs.sort((a, b) => (a.entity_id + a.transaction_date).localeCompare(b.entity_id + b.transaction_date))) {
  const mon = x.transaction_date.slice(0, 7);
  const why = x.ap_ar_status
    ? `บิลค้าง ${x.ap_ar_status} — กดรับ/จ่ายชำระที่แท็บลูกหนี้-เจ้าหนี้ แล้วจะนับเข้า ${mon} เอง`
    : "ไม่มีบัญชี — แท็บค้นบิล → แก้ไข → เลือกบัญชีที่จ่าย/รับ";
  console.log(
    // 🪤 มีแถวสรุปภาษี ≠ ยื่นแล้ว (แอปเดิม append ทุกครั้งที่กดสร้าง เช่น ต.ค. ถูกกดกลางเดือน) — ห้ามเขียนว่ายื่นแล้ว
    `  ${x.entity_id} ${mon}${filed.has(`${x.entity_id}|${mon}`) ? " (แอปเดิมเคยสร้าง ภพ.30 เดือนนี้)" : ""} ${x.tx_id} ${x.type} VAT ${fmt(Number(x.vat_amount))}` +
      ` · ${String(x.contact_name ?? "")} · ${why}`,
  );
}

// ── 4. เงินเดือน: ให้ engine ของ proof คิดทุกบรรทัดใหม่ เทียบกับที่แอปเดิมแช่ไว้ ─────────
const pay = buildAimPayroll(FILE);
const txById = new Map(txs.map((x) => [x.tx_id, x]));
const idsOf = (s: string | null) => (s ?? "").split(/[,\s]+/).filter(Boolean);
// บัญชีจ่ายเงินเดือนหลัก = บัญชีที่บิลเงินเดือนของแอปเดิมใช้บ่อยที่สุด
const netAcc = new Map<string, number>();
for (const l of pay.lines) for (const id of idsOf(l.legacy.postedTxIds)) {
  const a = txById.get(id)?.account_name as string | undefined;
  if (a) netAcc.set(a, (netAcc.get(a) ?? 0) + 1);
}
const payAccount = [...netAcc].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
const pt = payrollTables(pay, new Set(txById.keys()), {
  entityId: DEFAULT_ENTITY, payAccount, links: cfg.legLinks ?? [],
  txDate: new Map(txs.map((x) => [x.tx_id, x.transaction_date])),
});
const payBad = pay.lines.filter((l) => l.diff.length);
console.log(`\n── เงินเดือน: ${pay.employees.length} คน · ${pay.periods.length} งวด · ${pay.lines.length} บรรทัด ──`);
for (const i of pay.issues) console.log(`  🚨 ${i}`);
console.log(`  คิดใหม่ด้วย engine ของ proof เทียบแอปเดิม (ค่าจ้าง/OT/เบี้ยขยัน/รวม/สปส./ภาษี/สุทธิ): ${payBad.length ? `✗ ไม่ตรง ${payBad.length} บรรทัด` : "✓ ตรงทุกบรรทัด"}`);
for (const l of payBad) console.log(`    ${l.periodId} ${l.empId} ${l.diff.join(" ; ")}`);
console.log(`  บัญชีจ่ายเงินเดือนหลัก: ${payAccount || "(หาไม่เจอ)"}`);
console.log("  งวด        สถานะ        สุทธิรวม     บิลเงินเดือน │ สปส.ลูกจ้าง+นายจ้าง        บิล │  ภาษีรวม        บิล");
for (const per of pt.tables.payroll_periods) {
  const ls = pay.lines.filter((l) => l.periodId === per.period_id);
  const st = per.post_state as Record<string, { txIds: string[] }>;
  const sumTx = (code: string) => (st[code]?.txIds ?? []).reduce((s, id) => s + (Number(txById.get(id)?.net_amount) || 0), 0);
  const cell = (code: string, v: number) =>
    !st[code] ? "ยังไม่ลง" : !st[code].txIds.length ? "ไม่มีบิล" : `${fmt(sumTx(code))}${Math.abs(sumTx(code) - v) < 0.005 ? "✓" : "✗"}`;
  const net = ls.reduce((s, l) => s + l.line.net, 0);
  const sso = ls.reduce((s, l) => s + l.line.sso + l.ssoEmployer, 0);
  const wht = ls.reduce((s, l) => s + l.line.wht, 0);
  console.log(
    `  ${per.period_id} ${String(per.status).padEnd(8)} ${fmt(net).padStart(12)} ${cell("net", net).padStart(16)} │` +
      ` ${fmt(sso).padStart(19)} ${cell("sso", sso).padStart(10)} │ ${fmt(wht).padStart(8)} ${cell("wht", wht).padStart(10)}`,
  );
}
for (const n of pt.notes) console.log(`  ⚠️ ${n}`);
/**
 * ขาที่ยังไม่มีบิลผูก → หาบิลที่คีย์เองในแอปบัญชีที่ "ยอดตรงเป๊ะ" ภายใน 60 วันหลังสิ้นงวด
 * ★ แค่ชี้ให้ดู ไม่ผูกให้เอง (ยอดตรงกันโดยบังเอิญได้) — ผูกจริงด้วย legLinks ในไฟล์ค่าตั้ง
 */
console.log("\n  บิลที่คีย์เองในแอปบัญชีซึ่งยอดตรงกับขาที่ยังไม่มีบิล (น่าจะเป็นการจ่ายเดียวกัน):");
let cand = 0;
for (const per of pt.tables.payroll_periods) {
  const st = per.post_state as Record<string, { txIds: string[] }>;
  const ls = pay.lines.filter((l) => l.periodId === per.period_id);
  const want: Record<string, number> = {
    net: ls.reduce((s, l) => s + l.line.net, 0),
    sso: ls.reduce((s, l) => s + l.line.sso + l.ssoEmployer, 0),
    wht: ls.reduce((s, l) => s + l.line.wht, 0),
  };
  const end = new Date(Date.UTC(Number(per.year), Number(per.month), 0));
  const until = new Date(end.getTime() + 60 * 86400_000).toISOString().slice(0, 10);
  const from = new Date(end.getTime() - 31 * 86400_000).toISOString().slice(0, 10);
  for (const l of LEGS) {
    if (st[l.code]?.txIds.length) continue;
    for (const x of txs) {
      if (x.status !== "ปกติ" || x.type !== "รายจ่าย" || String(x.tx_id).startsWith("TRS")) continue;
      if (x.transaction_date < from || x.transaction_date > until) continue;
      if (Math.abs(Number(x.net_amount) - want[l.code]) > 0.005) continue;
      cand++;
      console.log(`    ${per.period_id} ${l.name} ${fmt(want[l.code])} ↔ ${x.tx_id} ${x.transaction_date} ${x.category} · ${x.contact_name ?? ""} · ${x.description ?? ""}`);
    }
  }
}
if (!cand) console.log("    (ไม่พบ)");
console.log(`  ขาลงบัญชีที่ตั้งให้: ${LEGS.map((l) => `${l.name} (หมวด ${l.category})`).join(" · ")}`);

const clean = balOk && ds.blockers.length === 0 && payBad.length === 0 && pay.issues.length === 0;
console.log(
  (APPLY ? "\n── ตรวจก่อนลงจริง ──" : "\n✅ dry-run จบ — ยังไม่ได้แตะฐานข้อมูล") +
    (balOk ? "\n   ✓ ยอดคงเหลือทุกบัญชีตรงแอปเดิม" : "\n   ✗ ยอดคงเหลือมีบัญชีที่ไม่ตรง (ดูด้านบน)") +
    (ds.blockers.length ? `\n   🚨 มี ${ds.blockers.length} จุดที่ต้องตัดสินก่อน (ดูหัวข้อ 🚨 ด้านบน)` : "\n   ✓ ไม่มีจุดที่ต้องตัดสินค้าง") +
    (payBad.length || pay.issues.length ? "\n   ✗ เงินเดือนมีบรรทัดที่คิดไม่ตรงแอปเดิม (ดูด้านบน)" : "\n   ✓ เงินเดือนคิดตรงแอปเดิมทุกบรรทัด"),
);

if (APPLY) {
  runApply().catch((e) => {
    console.error(`\n❌ ${(e as Error).message}`);
    process.exit(1);
  });
}

async function runApply() {
  const envFile = argOf("env");
  const slug = argOf("tenant");
  if (!envFile || !slug) {
    console.error("\n❌ --apply ต้องระบุ --env=<ไฟล์ env ของ DB ปลายทาง> --tenant=<ชื่อย่อลูกค้า>");
    process.exit(1);
  }
  if (!clean) {
    console.error("\n❌ ไม่ลง — รายงานยังไม่สะอาด (ดู ✗/🚨 ด้านบน)");
    process.exit(1);
  }
  const { db, ref } = adminFromEnv(envFile);
  console.log(`\n── ลงจริง → DB ${ref} · ลูกค้า "${slug}" ──`);
  const { tenant, problems } = await preflight(db, slug, t.entities.length, DEFAULT_ENTITY);
  if (!tenant || problems.length) {
    for (const p of problems) console.error(`  ❌ ${p}`);
    process.exit(1);
  }
  console.log(`  ลูกค้า: ${tenant.name} (${tenant.id})`);
  const src = { ...t, ...pt.tables, app_settings: [...t.app_settings, ...pt.tables.app_settings] } as Record<string, Record<string, unknown>[]>;
  const tables = Object.fromEntries(INSERT_ORDER.map((tb) => [tb, src[tb] ?? []])) as Record<ImportTable, Record<string, unknown>[]>;
  const got = await applyAim(
    db,
    { tenantId: tenant.id, defaultEntity: DEFAULT_ENTITY, tables, counters: [...ds.counters, ...pt.counters] },
    console.log,
  );
  console.log("\n── อ่านกลับจาก DB ──");
  let ok = true;
  for (const tb of INSERT_ORDER) {
    // app_settings/entities มีของ provisioning ปนอยู่ → นับได้ "อย่างน้อย" เท่าที่ลง
    const want = tables[tb].length;
    const pass = tb === "app_settings" || tb === "entities" ? got[tb] >= want : got[tb] === want;
    if (!pass) ok = false;
    console.log(`  ${tb.padEnd(18)} ลง ${String(want).padStart(5)} · อ่านได้ ${String(got[tb]).padStart(5)} ${pass ? "✓" : "✗"}`);
  }
  console.log(ok ? "\n✅ ลงครบ — ต่อด้วยเปิดแอปตรวจตาม docs/TESTING.md ส่วนที่ 79" : "\n⚠️ จำนวนที่อ่านกลับไม่ตรง — ห้ามใช้งานจนกว่าจะหาสาเหตุ");
}
