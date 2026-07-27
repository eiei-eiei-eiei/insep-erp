/**
 * transform.ts — แปลงแถวจากชีท → record พร้อมลง DB (ใช้ร่วมกันทั้ง import + reconcile)
 * รวมกฎ cleaning/validation/remap ทั้งหมดไว้ที่เดียว (single source of truth)
 *
 * จุดเสี่ยงที่จัดการ (ดู DECISIONS D27 + MIGRATION_PLAN sec 7.2):
 *   · วันที่ tz-safe (clean.isoDate)                · taxId ตัด apostrophe
 *   · entity_id ว่าง → EID01                        · contact_id ซ้ำ → reassign
 *   · remap ลูกค้า order (custId → contacts.id ตามชื่อ) + ดึงโอชาฟูดแพ็คจาก custdata
 *   · transaction_items orphan (tx ไม่มี) → skip     · counters seed จาก max ของ id จริง
 */
import * as C from "./clean";
import { loadWorkbook, rows, type Row } from "./loader";

export interface Dataset {
  tables: Record<string, Record<string, unknown>[]>;
  order: string[]; // ลำดับ insert (รักษา FK)
  counters: { key: string; value: number }[];
  warnings: string[];
  contactRemap: Map<string, string>; // custId เดิม (C001) → contacts.contact_id ใหม่
}

const pad4 = (n: number) => String(n).padStart(4, "0");

export function buildDataset(): Dataset {
  const prod = loadWorkbook("production");
  const acc = loadWorkbook("accounting");
  const sales = loadWorkbook("sales");
  const warnings: string[] = [];
  const errors: string[] = [];

  // ── R1 core / master ─────────────────────────────────────────────────────
  // entities (เฉพาะแถวที่มีชื่อจริง — ตัด placeholder id เปล่า)
  const entities = rows(acc, "Entities")
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
  const entityIds = new Set(entities.map((e) => e.entity_id));
  const entOr01 = (v: C.Cell) => {
    const e = C.str(v);
    return e && entityIds.has(e) ? e : "EID01";
  };

  const bank_accounts = rows(acc, "Accounts")
    .filter((r) => C.strReq(r[0]) !== "")
    .map((r) => ({
      account_id: C.strReq(r[0]),
      account_name: C.strReq(r[1]),
      entity_ids: C.splitComma(r[2]),
      kind: C.str(r[3]),
      opening_balance: C.num0(r[4]),
      opening_date: C.isoDate(r[5]),
    }));

  // app_settings จาก Settings col B-E (ข้าม col A Account_List — ไม่มี kind รองรับ, D27)
  const app_settings: Record<string, unknown>[] = [];
  const settingsCols: [number, string][] = [
    [1, "expense_cat"],
    [2, "income_cat"],
    [3, "wht_rate"],
    [4, "tax_account"],
  ];
  const settingsRows = rows(acc, "Settings");
  for (const [ci, kind] of settingsCols) {
    const seen = new Set<string>();
    settingsRows.forEach((r, i) => {
      const value = C.strReq(r[ci]);
      if (value === "" || seen.has(value)) return; // unique (kind,value)
      seen.add(value);
      app_settings.push({ kind, value, sort: i });
    });
  }

  // contacts (Contacts sheet) — จัดการ contact_id ซ้ำ (C-0008/C-0009) + ชื่อซ้ำ
  // pre-scan: หา max ของ C-#### ที่มีจริงก่อน แล้วค่อยแจกเลขใหม่ "เหนือ max"
  // (กัน reassign ไป ชนกับ id ที่โผล่ทีหลังในชีท → ลามทั้งชุด)
  const contactRawRows = rows(acc, "Contacts").filter((r) => C.strReq(r[1]) !== "");
  let maxContactNum = 0;
  for (const r of contactRawRows) {
    const m = C.strReq(r[0]).match(/^C-(\d+)$/);
    if (m) maxContactNum = Math.max(maxContactNum, Number(m[1]));
  }
  const usedIds = new Set<string>();
  const seenNameBranch = new Set<string>(); // dedup ด้วย ชื่อ+สาขา (multi-branch, D30)
  const nameIndex = new Map<string, string>(); // normName → contact_id ตัวแรก (fallback ฝั่งขาย)
  const contacts: Record<string, unknown>[] = [];
  for (const r of contactRawRows) {
    const name = C.strReq(r[1]);
    const nkey = C.normName(name);
    const branch = C.str(r[3]);
    const bkey = nkey + "|" + C.normName(branch ?? "");
    if (seenNameBranch.has(bkey)) {
      warnings.push(`contacts: ชื่อ+สาขาซ้ำ "${name}" (สาขา ${branch ?? "-"}) — ข้ามแถวที่ซ้ำ`);
      continue;
    }
    seenNameBranch.add(bkey);
    let id = C.strReq(r[0]);
    if (id === "" || usedIds.has(id)) {
      const newId = `C-${pad4(++maxContactNum)}`;
      warnings.push(`contacts: contact_id ซ้ำ/ว่าง "${id}" (${name}) → เปลี่ยนเป็น ${newId}`);
      id = newId;
    }
    usedIds.add(id);
    if (!nameIndex.has(nkey)) nameIndex.set(nkey, id); // คงสาขาแรกไว้ให้ฝั่งขาย remap ตามชื่อ
    contacts.push({
      contact_id: id,
      name,
      tax_id: C.taxId(r[2]),
      branch: C.str(r[3]),
      address: C.str(r[4]),
      contact_type: C.str(r[5]),
      // key ให้ตรงกับ contact ที่ดึงจาก custdata (PostgREST bulk insert ต้อง key เหมือนกันทุก object)
      phone: null,
      email: null,
      credit_term: 0,
      sale_name: null,
      is_export: false,
    });
  }

  const materials = rows(prod, "Master_Material")
    .filter((r) => C.strReq(r[0]) !== "")
    .map((r) => ({ material_id: C.strReq(r[0]), name: C.strReq(r[1]), unit: C.str(r[2]) }));
  const materialIds = new Set(materials.map((m) => m.material_id));

  const containers = rows(prod, "Master_Container")
    .filter((r) => C.strReq(r[0]) !== "")
    .map((r) => ({ container_id: C.strReq(r[0]), container_type: C.str(r[1]), capacity_l: C.num(r[2]) }));
  const containerIds = new Set(containers.map((c) => c.container_id));

  const products = rows(prod, "Master_Product")
    .filter((r) => C.strReq(r[0]) !== "")
    .map((r) => ({
      product_id: C.strReq(r[0]),
      name: C.strReq(r[1]),
      degree: C.num(r[2]),
      bottle_size_l: C.num(r[3]),
      // col4 = ชื่อแสดง (ไม่มีคอลัมน์ใน schema — ข้าม)
      liquor_type: C.str(r[5]),
      liquor_kind: C.str(r[6]),
    }));
  const productIds = new Set(products.map((p) => p.product_id));

  const sale_menu = rows(sales, "menu_b2b")
    .filter((r) => C.strReq(r[0]) !== "")
    .map((r) => {
      const pid = C.str(r[3]);
      if (pid && !productIds.has(pid)) {
        warnings.push(`sale_menu "${C.strReq(r[0])}": product_id ${pid} ไม่มีใน products → ตั้ง null`);
      }
      return {
        menu_name: C.strReq(r[0]),
        price: C.num0(r[1]),
        category: C.str(r[2]),
        product_id: pid && productIds.has(pid) ? pid : null,
        multiplier: C.num(r[4]) ?? 1,
      };
    });

  // ── R2 log ผลิต ──────────────────────────────────────────────────────────
  const fkWarn = (tbl: string, field: string, val: string, set: Set<string>) => {
    if (!set.has(val)) errors.push(`${tbl}: ${field} "${val}" ไม่มีใน master`);
  };

  const log_material = rows(prod, "Log_Material").map((r) => {
    const mid = C.strReq(r[3]);
    fkWarn("log_material", "material_id", mid, materialIds);
    return {
      created_at: C.isoTimestampTH(r[0]),
      doc_date: C.isoDate(r[1]),
      trans_type: C.strReq(r[2]),
      material_id: mid,
      amount: C.num0(r[4]),
      doc_ref: C.str(r[5]),
      note: C.str(r[6]),
    };
  });

  const log_ferment = rows(prod, "Log_Ferment").map((r) => {
    const cid = C.str(r[4]);
    if (cid && !containerIds.has(cid)) errors.push(`log_ferment: container_id "${cid}" ไม่มีใน master`);
    return {
      created_at: C.isoTimestampTH(r[0]),
      ferment_date: C.isoDate(r[1]),
      product_name: C.strReq(r[2]),
      batch: C.strReq(r[3]),
      container_id: cid,
      container_qty: C.num(r[5]),
      material_ids: C.str(r[6]), // ★ คง comma text ตามเดิม (fidelity — อย่า normalize)
      material_amounts: C.str(r[7]),
    };
  });

  const distillBatch = new Set<string>();
  const log_distill = rows(prod, "Log_Distill").map((r) => {
    const batch = C.strReq(r[3]);
    if (distillBatch.has(batch)) errors.push(`log_distill: batch "${batch}" ซ้ำ (ละเมิดกฎ 1 batch 1 แถว — P3)`);
    distillBatch.add(batch);
    return {
      created_at: C.isoTimestampTH(r[0]),
      distill_date: C.isoDate(r[1]),
      product_name: C.strReq(r[2]),
      batch,
      vol: C.num0(r[4]),
      abv: C.num0(r[5]),
    };
  });

  // Log_DistillRun ว่าง (ผู้ใช้ยืนยัน ไม่เคยบันทึก reading — D27)
  const log_distill_run = rows(prod, "Log_DistillRun").map((r) => ({
    created_at: C.isoTimestampTH(r[0]),
    run_id: C.strReq(r[1]),
    pot_no: C.num0(r[2]),
    batch: C.strReq(r[3]),
    product_name: C.str(r[4]),
    minute: C.num(r[5]),
    phase: C.str(r[6]),
    abv_obs: C.num(r[7]),
    temp_spirit: C.num(r[8]),
    abv20: C.num(r[9]),
    cum_vol: C.num(r[10]),
    flow_rate: C.num(r[11]),
    vapor_temp: C.num(r[12]),
    pot_temp: C.num(r[13]),
    cool_temp: C.num(r[14]),
    note: C.str(r[15]),
    ferm_charge: C.num(r[16]),
  }));

  const log_ferment_monitor = rows(prod, "Log_FermentMonitor").map((r) => ({
    created_at: C.isoTimestampTH(r[0]),
    measure_date: C.isoDate(r[1]),
    measure_time: C.str(r[2]),
    batch: C.strReq(r[3]),
    product_name: C.str(r[4]),
    ph: C.num(r[5]),
    brix: C.num(r[6]),
    temp: C.num(r[7]),
    note: C.str(r[8]),
  }));

  const log_dilute = rows(prod, "Log_Dilute").map((r) => ({
    created_at: C.isoTimestampTH(r[0]),
    dilute_date: C.isoDate(r[1]),
    product_name: C.strReq(r[2]),
    bottle_size: C.str(r[3]),
    start_vol: C.num(r[4]),
    start_abv: C.num(r[5]),
    water: C.num(r[6]),
    final_vol: C.num(r[7]),
    final_abv: C.num(r[8]),
    note: C.str(r[9]),
  }));

  const log_product = rows(prod, "Log_Product").map((r) => {
    const pid = C.strReq(r[3]);
    fkWarn("log_product", "product_id", pid, productIds);
    return {
      created_at: C.isoTimestampTH(r[0]),
      doc_date: C.isoDate(r[1]),
      trans_type: C.strReq(r[2]),
      product_id: pid,
      amount: C.num0(r[4]),
      note: C.str(r[5]),
    };
  });

  // ── R3 บัญชี ─────────────────────────────────────────────────────────────
  const txIdSet = new Set<string>();
  const transactions = rows(acc, "Transactions").map((r) => {
    const tx_id = C.strReq(r[0]);
    txIdSet.add(tx_id);
    const type = C.strReq(r[3]);
    if (!["รายรับ", "รายจ่าย", "โอนระหว่างบัญชี", "เช็คราคา", "บันทึกภาษี"].includes(type))
      errors.push(`transactions ${tx_id}: type "${type}" ไม่อยู่ใน CHECK`);
    const status = C.strReq(r[18]) || "ปกติ";
    if (!["ปกติ", "ยกเลิก"].includes(status)) errors.push(`transactions ${tx_id}: status "${status}" ไม่อยู่ใน CHECK`);
    const apar = C.str(r[21]);
    if (apar && !["AP", "AR"].includes(apar)) errors.push(`transactions ${tx_id}: ap_ar_status "${apar}" ไม่อยู่ใน CHECK`);
    return {
      tx_id,
      created_at: C.isoTimestampTH(r[1]),
      transaction_date: C.isoDate(r[2]),
      type,
      account_name: C.str(r[4]),
      category: C.str(r[5]),
      contact_name: C.str(r[6]),
      description: C.str(r[7]),
      base_amount: C.num0(r[8]),
      discount: C.num0(r[9]),
      amount_after_discount: C.num0(r[10]),
      vat_amount: C.num0(r[11]),
      wht_rate: C.num0(r[12]),
      wht_amount: C.num0(r[13]),
      net_amount: C.num0(r[14]),
      tax_invoice_no: C.str(r[15]),
      tax_invoice_date: C.isoDate(r[16]),
      receipt_image_url: C.str(r[17]),
      status,
      transfer_id: C.str(r[19]),
      entity_id: entOr01(r[20]),
      ap_ar_status: apar,
      payment_date: C.isoDate(r[22]),
      po_group_id: C.str(r[23]),
      installment_no: C.num(r[24]),
      installment_total: C.num(r[25]),
      due_date: C.isoDate(r[26]),
      source: "migration",
    };
  });

  const transaction_items: Record<string, unknown>[] = [];
  for (const r of rows(acc, "Transaction_Items")) {
    const tx_id = C.strReq(r[1]);
    if (!txIdSet.has(tx_id)) {
      warnings.push(`transaction_items: ข้าม "${C.strReq(r[0])}" — tx_id ${tx_id} ไม่มีใน Transactions (orphan)`);
      continue;
    }
    transaction_items.push({
      item_id: C.strReq(r[0]),
      tx_id,
      item_name: C.strReq(r[2]),
      quantity: C.num(r[3]) ?? 1,
      in_vat: C.num0(r[4]),
      ex_vat: C.num0(r[5]),
      total_price: C.num0(r[6]),
    });
  }

  const wht_certificates = rows(acc, "pnd3-53")
    .filter((r) => C.strReq(r[0]) !== "" && C.strReq(r[2]) !== "")
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
      entity_id: entOr01(r[9]),
    }));

  const tax_summaries = rows(acc, "Tax_Summaries").map((r) => ({
    report_month: C.reportMonth(r[0]),
    total_sales_amount: C.num(r[1]),
    total_sales_vat: C.num(r[2]),
    total_purchase_amount: C.num(r[3]),
    total_purchase_vat: C.num(r[4]),
    forwarded_vat_in: C.num(r[5]),
    net_payable: C.num(r[6]),
    forwarded_vat_out: C.num(r[7]),
    created_at: C.isoTimestampTH(r[8]),
    entity_id: entOr01(r[9]),
  }));

  // ── R4 ขาย ───────────────────────────────────────────────────────────────
  // custdata ใช้เฉพาะดึงลูกค้าที่ order อ้างแต่ไม่มีใน Contacts (D27 — โอชาฟูดแพ็ค)
  const custById = new Map<string, Row>();
  for (const r of rows(sales, "custdata")) {
    if (C.strReq(r[1]) !== "") custById.set(C.strReq(r[0]), r);
  }
  const contactRemap = new Map<string, string>();
  const resolveCustomer = (custId: string, custName: string): string | null => {
    const nkey = C.normName(custName);
    if (nameIndex.has(nkey)) {
      const id = nameIndex.get(nkey)!;
      if (custId) contactRemap.set(custId, id);
      return id;
    }
    // ไม่มีใน contacts → ดึงจาก custdata สร้าง contact ใหม่
    const cd = custById.get(custId);
    if (!cd) {
      warnings.push(`sales_orders: ลูกค้า "${custName}" (${custId}) ไม่มีทั้งใน Contacts และ custdata → customer_id = null`);
      return null;
    }
    const newId = `C-${pad4(++maxContactNum)}`;
    contacts.push({
      contact_id: newId,
      name: C.strReq(cd[1]),
      tax_id: C.taxId(cd[3]),
      branch: C.str(cd[8]),
      address: C.str(cd[2]),
      contact_type: "ลูกค้า",
      phone: C.str(cd[4]),
      email: C.str(cd[5]),
      credit_term: C.num0(cd[6]),
      sale_name: C.str(cd[7]),
      is_export: C.bool(cd[9]),
    });
    nameIndex.set(nkey, newId);
    if (custId) contactRemap.set(custId, newId);
    warnings.push(`sales_orders: ดึงลูกค้า "${C.strReq(cd[1])}" (${custId}) จาก custdata → contacts ${newId}`);
    return newId;
  };

  const orderQuSet = new Set<string>();
  const sales_orders = rows(sales, "btbtransaction")
    .filter((r) => C.strReq(r[4]) !== "")
    .map((r) => {
      const qu_no = C.strReq(r[4]);
      orderQuSet.add(qu_no);
      return {
        qu_no,
        created_at: C.isoTimestampTH(r[0]),
        customer_id: resolveCustomer(C.strReq(r[1]), C.strReq(r[2])),
        customer_name: C.str(r[2]),
        sale_name: C.str(r[3]),
        qu_expire: C.isoDate(r[5]),
        sub_total: C.num0(r[6]),
        discount: C.num0(r[7]),
        sub_discount: C.num0(r[8]),
        vat_amount: C.num0(r[9]),
        grand_total: C.num0(r[10]),
        order_no: C.str(r[11]),
        status: C.strReq(r[12]) || "รอคอนเฟิร์ม",
        deposit: C.num0(r[13]),
        outstanding_balance: C.num0(r[14]),
        due_date: C.isoDate(r[15]),
        payment_method: C.str(r[16]),
        inv_no: C.str(r[17]),
        tax_no1: C.str(r[18]),
        tax_no2: C.str(r[19]),
        remarks: C.str(r[20]),
        doc_date1: C.isoDate(r[21]),
        doc_date2: C.isoDate(r[22]),
        check_detail1: C.str(r[23]),
        check_detail2: C.str(r[24]),
        wht_percent: C.num0(r[25]),
        wht_amount: C.num0(r[26]),
        net_payable: C.num0(r[27]),
        doc_to_print: C.str(r[28]),
        next_status: C.str(r[29]),
        category: C.str(r[30]) ?? "รายได้ค่าสินค้า",
      };
    });

  const sales_order_items: Record<string, unknown>[] = [];
  for (const r of rows(sales, "btbsales")) {
    const qu_no = C.strReq(r[3]); // ★ col3 = quNo (ไม่ใช่ taxinvNo ตาม label — ยืนยันจาก Quotation.gs:166)
    if (qu_no === "") continue;
    if (!orderQuSet.has(qu_no)) {
      warnings.push(`sales_order_items: ข้าม item ของ ${qu_no} — ไม่มี order นี้`);
      continue;
    }
    sales_order_items.push({
      created_at: C.isoTimestampTH(r[0]),
      qu_no,
      item_name: C.strReq(r[4]),
      qty: C.num0(r[5]),
      price: C.num0(r[6]),
    });
  }

  const warehouse_stock = rows(sales, "curstock")
    .filter((r) => C.strReq(r[0]) !== "")
    .map((r) => ({
      item_code: C.strReq(r[0]),
      item_name: C.str(r[1]),
      col2: C.str(r[2]),
      unit: C.str(r[3]),
      qty: C.num0(r[4]),
    }));

  const stock_moves = rows(sales, "stockmove").map((r) => ({
    created_at: C.isoTimestampTH(r[0]),
    item_code: C.str(r[1]),
    item_name: C.str(r[2]),
    qty_before: C.num(r[3]),
    action: C.str(r[4]),
    qty: C.num(r[5]),
    ref_no: C.str(r[6]),
    qty_after: C.num(r[7]),
    user_name: C.str(r[8]),
    remarks: C.str(r[9]),
  }));

  // ── R5 counters (seed จาก max serial ของ id จริง กันเลขชนหลัง cutover) ──────
  const counterMax = new Map<string, number>();
  const bump = (key: string, serial: number) => {
    if (!Number.isFinite(serial)) return;
    counterMax.set(key, Math.max(counterMax.get(key) ?? 0, serial));
  };
  for (const t of transactions) {
    const m1 = String(t.tx_id).match(/^(TR-\d{8})-(\d+)$/);
    if (m1) bump(m1[1], Number(m1[2]));
    const trf = t.transfer_id ? String(t.transfer_id).match(/^(TRF-\d{8})-(\d+)$/) : null;
    if (trf) bump(trf[1], Number(trf[2]));
  }
  for (const o of sales_orders) {
    const qm = String(o.qu_no).match(/^QU(\d{6})-(\d+)$/);
    if (qm) bump(`QU-${qm[1]}`, Number(qm[2]));
    const om = o.order_no ? String(o.order_no).match(/^ORD(\d{6})-(\d+)$/) : null;
    if (om) bump(`ORD-${om[1]}`, Number(om[2]));
  }
  // contact_id (C-####) ใช้ next_serial('CONTACT') ตอนเพิ่มลูกค้า/คู่ค้าในแอป (sales+accounting)
  // ต้อง seed = max ที่มี ไม่งั้น next_serial เริ่มที่ 1 → ชน contact เดิม (duplicate contacts_pkey)
  if (maxContactNum > 0) counterMax.set("CONTACT", maxContactNum);
  const counters = [...counterMax.entries()].map(([key, value]) => ({ key, value }));

  if (errors.length) {
    console.error("\n❌ พบปัญหาข้อมูลที่ต้องหยุดก่อน (ไม่ใช่ warning):");
    errors.forEach((e) => console.error("   - " + e));
    throw new Error(`ข้อมูลไม่ผ่าน validation ${errors.length} จุด — แก้ในชีทต้นทางแล้ว export ใหม่ หรือแจ้งผู้ใช้`);
  }

  return {
    tables: {
      entities,
      bank_accounts,
      app_settings,
      contacts,
      materials,
      containers,
      products,
      sale_menu,
      log_material,
      log_ferment,
      log_distill,
      log_distill_run,
      log_ferment_monitor,
      log_dilute,
      log_product,
      transactions,
      transaction_items,
      wht_certificates,
      tax_summaries,
      sales_orders,
      sales_order_items,
      warehouse_stock,
      stock_moves,
    },
    order: [
      // R1 core/master
      "entities", "bank_accounts", "app_settings", "contacts",
      "materials", "containers", "products", "sale_menu",
      // R2 log ผลิต
      "log_material", "log_ferment", "log_distill", "log_distill_run",
      "log_ferment_monitor", "log_dilute", "log_product",
      // R3 บัญชี
      "transactions", "transaction_items", "wht_certificates", "tax_summaries",
      // R4 ขาย
      "sales_orders", "sales_order_items", "warehouse_stock", "stock_moves",
    ],
    counters,
    warnings,
    contactRemap,
  };
}
