/**
 * migration/aim/transform.ts — แปลงไฟล์แอป AIM (GAS บัญชี+เงินเดือน) → record ของ proof (D121)
 *
 * ต่างจาก migration/lib/transform.ts (โรงกลั่น 3 ไฟล์) ตรงที่แอป AIM:
 *   · อ้างบัญชีด้วย **รหัส** (KBANK01) ไม่ใช่ชื่อ ⇒ ต้องแปลงเป็นชื่อใหม่ที่ไม่ซ้ำ (ผู้ใช้ตั้งชื่อเอง)
 *   · มีประเภท `สำรองจ่าย` + สถานะ `รอเคลีย` ⇒ แปลงเป็นสำรองจ่ายของ proof (D119)
 *   · บัญชี `เจ้าหนี้`/`ลูกหนี้` = บิลค้าง ⇒ account_name ว่าง (แบบเดียวกับ proof)
 *
 * 🚨 ไฟล์นี้ **ไม่เขียน DB** — สร้างชุดข้อมูล + รายการปัญหาให้ import-aim.ts ตัดสินใจ
 * 🚨 ข้อมูลลูกค้าจริงห้ามเข้า repo — ไฟล์ .xlsx (--file) และค่าตั้งเฉพาะลูกค้า (--config) อยู่นอก repo
 */
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";
import * as C from "../lib/clean";

type Row = C.Cell[];
type Rec = Record<string, unknown>;

/**
 * ค่าที่เฉพาะลูกค้ารายนี้ — อ่านจากไฟล์ JSON นอก repo (--config) ไม่ฮาร์ดโค้ดในโค้ด
 * 🚨 D66: ห้ามข้อมูลลูกค้าจริงลง repo (repo นี้ขายต่อ)
 */
export type AimConfig = {
  /** รหัสบัญชีเดิม → ชื่อใหม่ (proof อ้างบัญชีด้วยชื่อ และชื่อห้ามซ้ำ) */
  accountNames: Record<string, string>;
  /** คู่แถวเดิมที่ให้แปลงเป็นโอนระหว่างบัญชี (ออกจาก outTx · เข้าที่ inTx) */
  transferPairs?: { outTx: string; inTx: string; transferId: string }[];
  /** บิลมี VAT ในกิจการไม่จด VAT: รวม VAT เป็นต้นทุน (ยอดที่จ่ายจริงเท่าเดิม) */
  nonVatPolicy: "fold-into-cost";
  /**
   * ผูกขาลงบัญชีเงินเดือนกับบิลที่คีย์เองในแอปบัญชี (แอปเดิมไม่ได้ลงขานั้นแต่จ่ายจริงแล้ว)
   * ★ ผูกแล้วขานั้นขึ้น "ลงบัญชีแล้ว" ชี้บิลนั้น → ไม่มีปุ่มให้กดลงซ้ำ · ถอนทีหลัง = ยกเลิกบิลนั้น
   */
  legLinks?: { period: string; leg: string; txId: string }[];
};

export function readAimConfig(path: string): AimConfig {
  const c = JSON.parse(readFileSync(path, "utf8")) as AimConfig;
  if (!c.accountNames || typeof c.accountNames !== "object") throw new Error("config: ไม่มี accountNames");
  if (c.nonVatPolicy !== "fold-into-cost") throw new Error("config: nonVatPolicy ต้องเป็น fold-into-cost");
  return c;
}

/** ค่าบัญชีในแอปเดิมที่หมายถึง "ยังไม่ได้จ่าย/รับ" — proof ใช้ account_name ว่างแทน */
const NO_ACCOUNT = new Set(["เจ้าหนี้", "ลูกหนี้", "สำรองจ่าย"]);

export type Issue = { kind: string; txId?: string; text: string };

export interface AimDataset {
  tables: {
    entities: Rec[];
    bank_accounts: Rec[];
    app_settings: Rec[];
    contacts: Rec[];
    transactions: Rec[];
    transaction_items: Rec[];
    tax_summaries: Rec[];
    wht_certificates: Rec[];
  };
  counters: { key: string; value: number }[];
  /** แถวเดิมที่แปลงไม่ได้แบบปลอดภัย — ต้องให้ผู้ใช้ตัดสิน (ไม่ลง DB จนกว่าจะตัดสิน) */
  blockers: Issue[];
  /** แปลงแล้วแต่ควรรู้ */
  warnings: Issue[];
  /** บิลที่รวม VAT เป็นต้นทุน (กิจการไม่จด VAT) */
  folded: { txId: string; entity: string; vat: number }[];
  /** แถวดิบของ Transactions สำหรับคิดยอดแบบแอปเดิม (reconcile) */
  legacyTx: Row[];
  /** สรุปภาษีล่าสุดต่อ (กิจการ, เดือน) ของแอปเดิม */
  legacyTaxSummary: Rec[];
}

function sheetRows(wb: XLSX.WorkBook, name: string): Row[] {
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`ไม่พบชีท '${name}'`);
  const arr = XLSX.utils.sheet_to_json<Row>(ws, { header: 1, raw: true, blankrows: false, defval: null });
  return arr.slice(1).filter((r) => r.some((c) => c !== null && c !== undefined && String(c).trim() !== ""));
}

const pad4 = (n: number) => String(n).padStart(4, "0");

export function buildAimDataset(file: string, cfg: AimConfig): AimDataset {
  const ACCOUNT_NAME = cfg.accountNames;
  const pairOut = new Map((cfg.transferPairs ?? []).map((p) => [p.outTx, p]));
  const pairIn = new Map((cfg.transferPairs ?? []).map((p) => [p.inTx, p]));
  const wb = XLSX.read(readFileSync(file), { cellDates: false }); // ★ serial ดิบ (tz-safe — clean.ts)
  const blockers: Issue[] = [];
  const warnings: Issue[] = [];
  const folded: { txId: string; entity: string; vat: number }[] = [];

  // ── กิจการ ────────────────────────────────────────────────────────────────
  const entities = sheetRows(wb, "Entities")
    .filter((r) => C.strReq(r[1]) !== "")
    .map((r) => ({
      entity_id: C.strReq(r[0]),
      name: C.strReq(r[1]),
      type: C.str(r[2]),
      is_vat: C.bool(r[3]),
      tax_id: C.taxId(r[4]),
      branch: C.str(r[5]) ?? "สำนักงานใหญ่",
      address: C.str(r[6]),
    }));
  const entIds = new Set(entities.map((e) => e.entity_id));
  const isVat = new Map(entities.map((e) => [e.entity_id, e.is_vat]));

  // ── บัญชีเงิน ─────────────────────────────────────────────────────────────
  const accountEntities = new Map<string, string[]>();
  const bank_accounts = sheetRows(wb, "Accounts")
    .filter((r) => C.strReq(r[0]) !== "")
    .map((r) => {
      const id = C.strReq(r[0]);
      const name = ACCOUNT_NAME[id];
      if (!name) blockers.push({ kind: "บัญชีใหม่", text: `บัญชี ${id} (${C.strReq(r[1])}) ยังไม่ได้ตั้งชื่อใหม่ใน config` });
      const ents = C.splitComma(r[2]);
      accountEntities.set(id, ents);
      return {
        account_id: id,
        account_name: name ?? id,
        entity_ids: ents,
        kind: C.str(r[3]),
        opening_balance: C.num0(r[4]),
        opening_date: C.isoDate(r[5]),
      };
    });
  const names = bank_accounts.map((a) => a.account_name);
  for (const n of new Set(names)) {
    if (names.filter((x) => x === n).length > 1) blockers.push({ kind: "ชื่อบัญชีซ้ำ", text: `ชื่อบัญชี "${n}" ซ้ำ — proof อ้างบัญชีด้วยชื่อ` });
  }

  // ── ค่าตั้ง (หมวด/อัตรา WHT) — 🚨 ไม่ยก Tax Account (ชื่อเก่าที่ไม่ตรงบัญชีไหน = ภพ.30 เป็น 0 · D93)
  const app_settings: Rec[] = [];
  const settingRows = sheetRows(wb, "Settings");
  for (const [ci, kind] of [[1, "expense_cat"], [2, "income_cat"], [3, "wht_rate"]] as const) {
    const seen = new Set<string>();
    settingRows.forEach((r, i) => {
      const v = C.strReq(r[ci]);
      if (v === "" || seen.has(v)) return;
      seen.add(v);
      app_settings.push({ kind, value: v, sort: i });
    });
  }

  // ── คู่ค้า (ตัดซ้ำชื่อ+สาขา · รหัสซ้ำแจกใหม่เหนือ max — แพตเทิร์นเดียวกับ transform เดิม) ──
  const contactRaw = sheetRows(wb, "Contacts").filter((r) => C.strReq(r[1]) !== "");
  let maxC = 0;
  for (const r of contactRaw) {
    const m = C.strReq(r[0]).match(/^C-(\d+)$/);
    if (m) maxC = Math.max(maxC, Number(m[1]));
  }
  const usedIds = new Set<string>();
  const seenNB = new Set<string>();
  const contacts: Rec[] = [];
  for (const r of contactRaw) {
    const name = C.strReq(r[1]);
    const branch = C.str(r[3]);
    const key = C.normName(name) + "|" + C.normName(branch ?? "");
    if (seenNB.has(key)) { warnings.push({ kind: "คู่ค้าซ้ำ", text: `"${name}" สาขา ${branch ?? "-"} ซ้ำ — ข้ามแถวที่ซ้ำ` }); continue; }
    seenNB.add(key);
    let id = C.strReq(r[0]);
    if (id === "" || usedIds.has(id)) {
      const nid = `C-${pad4(++maxC)}`;
      warnings.push({ kind: "รหัสคู่ค้าซ้ำ", text: `"${id}" (${name}) → ${nid}` });
      id = nid;
    }
    usedIds.add(id);
    contacts.push({
      contact_id: id, name, tax_id: C.taxId(r[2]), branch, address: C.str(r[4]),
      contact_type: C.str(r[5]), phone: null, email: null, credit_term: 0, sale_name: null, is_export: false,
    });
  }

  // ── บิล ────────────────────────────────────────────────────────────────────
  const legacyTx = sheetRows(wb, "Transactions");
  const transactions: Rec[] = [];
  const txIds = new Set<string>();
  for (const r of legacyTx) {
    const tx_id = C.strReq(r[0]);
    if (txIds.has(tx_id)) { blockers.push({ kind: "เลขบิลซ้ำ", txId: tx_id, text: "เลขบิลซ้ำในชีท" }); continue; }
    txIds.add(tx_id);
    const type = C.strReq(r[3]);
    const accRaw = C.strReq(r[4]);
    const entity = C.str(r[20]) ?? "EID01";
    const status = C.strReq(r[18]) || "ปกติ";
    const apar = C.str(r[21]);
    const vat = C.num0(r[11]);
    if (!entIds.has(entity)) blockers.push({ kind: "ไม่พบกิจการ", txId: tx_id, text: `กิจการ ${entity} ไม่มีในชีท Entities` });

    let account_name: string | null = null;
    if (accRaw && !NO_ACCOUNT.has(accRaw)) {
      account_name = ACCOUNT_NAME[accRaw] ?? null;
      if (!account_name) blockers.push({ kind: "ไม่พบบัญชี", txId: tx_id, text: `บัญชี "${accRaw}" ไม่มีในชีท Accounts` });
    }

    const rec: Rec = {
      tx_id,
      created_at: C.isoTimestampTH(r[1]),
      transaction_date: C.isoDate(r[2]),
      type,
      account_name,
      category: C.str(r[5]),
      contact_name: C.str(r[6]),
      description: C.str(r[7]),
      base_amount: C.num0(r[8]),
      discount: C.num0(r[9]),
      amount_after_discount: C.num0(r[10]),
      vat_amount: vat,
      wht_rate: C.num0(r[12]),
      wht_amount: C.num0(r[13]),
      net_amount: C.num0(r[14]),
      tax_invoice_no: C.str(r[15]),
      tax_invoice_date: C.isoDate(r[16]),
      receipt_image_url: C.str(r[17]),
      status,
      transfer_id: C.str(r[19]),
      entity_id: entity,
      ap_ar_status: apar === "AP" || apar === "AR" ? apar : null,
      payment_date: C.isoDate(r[22]),
      po_group_id: C.str(r[23]),
      installment_no: C.num(r[24]),
      installment_total: C.num(r[25]),
      due_date: C.isoDate(r[26]),
      source: "migration",
      advance_for_entity: null,
      advance_status: null,
    };

    if (!["ปกติ", "ยกเลิก"].includes(status)) blockers.push({ kind: "สถานะไม่รู้จัก", txId: tx_id, text: `สถานะ "${status}"` });

    // คู่ที่ผู้ใช้สั่งให้เป็นโอนระหว่างบัญชี — ยอดเงินแต่ละบัญชีเท่าแอปเดิมเป๊ะ (ออก −net · เข้า +net)
    const pair = pairOut.get(tx_id) ?? pairIn.get(tx_id);
    if (pair) {
      if (!account_name) blockers.push({ kind: "คู่โอนไม่มีบัญชี", txId: tx_id, text: "แถวที่ให้แปลงเป็นโอนต้องมีบัญชี" });
      const amt = Math.abs(C.num0(r[14]));
      const out = pairOut.has(tx_id);
      Object.assign(rec, {
        type: "โอนระหว่างบัญชี", category: "โอนระหว่างบัญชี", transfer_id: pair.transferId,
        net_amount: out ? -amt : amt,
        base_amount: 0, discount: 0, amount_after_discount: 0, vat_amount: 0, wht_rate: 0, wht_amount: 0,
        ap_ar_status: null, advance_for_entity: null, advance_status: null,
      });
      warnings.push({ kind: "แปลงเป็นโอนระหว่างบัญชี", txId: tx_id, text: `${type} → โอน (${pair.transferId}) ${out ? "ออก" : "เข้า"} ${amt}` });
      transactions.push(rec);
      continue;
    }

    if (!["รายรับ", "รายจ่าย", "โอนระหว่างบัญชี", "เช็คราคา", "สำรองจ่าย"].includes(type)) {
      blockers.push({ kind: "ประเภทไม่รู้จัก", txId: tx_id, text: `ประเภท "${type}"` });
    }
    if (apar && !["AP", "AR", "รอเคลีย"].includes(apar)) {
      blockers.push({ kind: "สถานะค้างไม่รู้จัก", txId: tx_id, text: `apArStatus "${apar}"` });
    }

    // สำรองจ่าย (D119): บิลอยู่ในกิจการ "คนจ่าย" · advance_for_entity = กิจการที่ซื้อให้
    if (type === "สำรองจ่าย") {
      const target = entity;
      const payers = (accountEntities.get(accRaw) ?? []).filter((e) => e !== target);
      if (!account_name || payers.length === 0) {
        blockers.push({
          kind: "สำรองจ่ายหาคนจ่ายไม่ได้", txId: tx_id,
          text: `จ่ายจาก ${accRaw} ซึ่งเป็นบัญชีของ ${target} เอง (${C.str(r[7]) ?? ""} · ${C.num0(r[14])}) — ` +
            "สำรองจ่ายต้องเป็นเงินของกิจการอื่น ต้องตัดสินว่าจะลงแบบไหน",
        });
      } else {
        rec.entity_id = payers[0];
        rec.advance_for_entity = target;
        rec.advance_status = "รอเบิกคืน";
        if (payers.length > 1) {
          warnings.push({ kind: "สำรองจ่ายเลือกคนจ่าย", txId: tx_id, text: `บัญชี ${account_name} ใช้ร่วม ${payers.length} กิจการ — ใช้ ${payers[0]} เป็นคนจ่าย` });
        }
      }
    }

    // 🚨 trigger 0036 บล็อก VAT ของกิจการไม่จด VAT ทุกทางเข้า (service role ก็ไม่รอด)
    // ⇒ ผู้ใช้ตัดสิน (2026-10-22): รวม VAT เป็นต้นทุน — กิจการพวกนี้ไม่เคยยื่น ภพ.30 ตัวเลขที่ยื่นไม่ขยับ
    //   ยอดก่อนหักส่วนลด/หลังหักส่วนลด += VAT · VAT = 0 · ยอดสุทธิ (เงินที่จ่ายจริง) เท่าเดิม
    //   (แบบเดียวกับ fn_advance_to_personal ของ D119)
    const vatEntity = (rec.advance_for_entity as string | null) ?? (rec.entity_id as string);
    if (vat > 0 && isVat.get(vatEntity) === false) {
      rec.base_amount = C.num0(r[8]) + vat;
      rec.amount_after_discount = C.num0(r[10]) + vat;
      rec.vat_amount = 0;
      folded.push({ txId: tx_id, entity: vatEntity, vat });
    }
    transactions.push(rec);
  }
  for (const p of cfg.transferPairs ?? []) {
    for (const id of [p.outTx, p.inTx]) if (!txIds.has(id)) blockers.push({ kind: "คู่โอนหาบิลไม่เจอ", txId: id, text: `config อ้างบิล ${id} ที่ไม่มีในชีท` });
  }

  // ── รายการในบิล ─────────────────────────────────────────────────────────────
  const transaction_items: Rec[] = [];
  for (const r of sheetRows(wb, "Transaction_Items")) {
    const tx_id = C.strReq(r[1]);
    if (!txIds.has(tx_id)) { warnings.push({ kind: "รายการไม่มีบิล", txId: tx_id, text: `ข้าม ${C.strReq(r[0])} (${C.strReq(r[2])})` }); continue; }
    transaction_items.push({
      item_id: C.strReq(r[0]),
      tx_id,
      item_name: C.strReq(r[2]),
      quantity: C.num(r[3]) ?? 1,
      in_vat: C.num0(r[4]),
      ex_vat: C.num0(r[5]),
      total_price: C.num0(r[6]),
      discount_pct: C.num0(r[7]),
      discount_baht: C.num0(r[8]),
      item_category: C.str(r[9]),
      item_job: C.str(r[10]),
    });
  }

  // ── สรุปภาษี: เอาแถวล่าสุดของแต่ละ (กิจการ, เดือน) — แอปเดิม append ทุกครั้งที่กด ──
  const latest = new Map<string, Rec>();
  for (const r of sheetRows(wb, "Tax_Summaries")) {
    const rec: Rec = {
      report_month: C.reportMonth(r[0]),
      total_sales_amount: C.num(r[1]),
      total_sales_vat: C.num(r[2]),
      total_purchase_amount: C.num(r[3]),
      total_purchase_vat: C.num(r[4]),
      forwarded_vat_in: C.num(r[5]),
      net_payable: C.num(r[6]),
      forwarded_vat_out: C.num(r[7]),
      created_at: C.isoTimestampTH(r[8]),
      entity_id: C.str(r[9]) ?? "EID01",
    };
    const key = `${rec.entity_id}|${rec.report_month}`;
    const prev = latest.get(key);
    if (!prev || String(rec.created_at) > String(prev.created_at)) latest.set(key, rec);
  }
  const tax_summaries = [...latest.values()];

  // ── 50ทวิ ──────────────────────────────────────────────────────────────────
  const wht_certificates = sheetRows(wb, "pnd3-53")
    .filter((r) => C.strReq(r[0]) !== "")
    .map((r) => ({
      doc_no: C.strReq(r[0]),
      issue_date: C.isoDate(r[1]),
      contact_name: C.str(r[2]),
      base_amount: C.num(r[3]),
      wht_amount: C.num(r[4]),
      pnd_type: C.str(r[5]),
      income_seq: C.num(r[6]) ?? 6,
      income_type: C.str(r[7]),
      tx_ids: C.splitComma(r[8]),
      entity_id: C.str(r[9]) ?? "EID01",
    }));
  for (const w of wht_certificates) {
    for (const id of w.tx_ids) if (!txIds.has(id)) warnings.push({ kind: "50ทวิ อ้างบิลที่ไม่มี", text: `${w.doc_no} → ${id}` });
  }

  // ── ตัวนับเลข: กันเลขชนหลังย้าย (TR-yyyymmdd · TRF-yyyymmdd · CONTACT) ──────────
  const ctr = new Map<string, number>();
  const bump = (k: string, n: number) => Number.isFinite(n) && ctr.set(k, Math.max(ctr.get(k) ?? 0, n));
  for (const t of transactions) {
    const m = String(t.tx_id).match(/^(TR-\d{8})-(\d+)$/);
    if (m) bump(m[1], Number(m[2]));
    const f = t.transfer_id ? String(t.transfer_id).match(/^(TRF-\d{8})-(\d+)$/) : null;
    if (f) bump(f[1], Number(f[2]));
  }
  bump("CONTACT", maxC);

  return {
    tables: { entities, bank_accounts, app_settings, contacts, transactions, transaction_items, tax_summaries, wht_certificates },
    counters: [...ctr].map(([key, value]) => ({ key, value })),
    blockers,
    warnings,
    folded,
    legacyTx,
    legacyTaxSummary: tax_summaries,
  };
}

/**
 * ยอดคงเหลือแบบแอป AIM เดิม (50_apar_statement.js) — ไว้เทียบกับ proof หลังแปลง
 * รายรับ/รับคืนสำรองจ่าย = + · รายจ่าย/สำรองจ่าย = − · โอน = ตามเครื่องหมาย
 * ข้ามแถวยกเลิก · ข้ามบิลค้าง ยกเว้นสำรองจ่าย (เงินออกจริง)
 */
export function legacyBalances(legacyTx: Row[], opening: Map<string, number>): Map<string, number> {
  const bal = new Map(opening);
  for (const r of legacyTx) {
    if ((C.strReq(r[18]) || "ปกติ") !== "ปกติ") continue;
    const type = C.strReq(r[3]);
    if (C.str(r[21]) && type !== "สำรองจ่าย" && type !== "รับคืนสำรองจ่าย") continue;
    const acc = C.strReq(r[4]);
    if (!bal.has(acc)) continue;
    const net = C.num0(r[14]);
    if (type === "รายรับ" || type === "รับคืนสำรองจ่าย") bal.set(acc, bal.get(acc)! + net);
    else if (type === "รายจ่าย" || type === "สำรองจ่าย") bal.set(acc, bal.get(acc)! - net);
    else if (type === "โอนระหว่างบัญชี") bal.set(acc, bal.get(acc)! + net);
  }
  return bal;
}
