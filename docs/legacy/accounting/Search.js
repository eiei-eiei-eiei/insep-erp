// =========================================================================
// FILE: Search.gs  [14/16]
// [Phase 4 / #8] ค้นหาบิล (searchBills) + ประวัติสินค้า/ราคา (searchItemHistory)
// ⚠️ Transaction_Items = 7 คอลัมน์ (ไม่มี itemCategory/itemJob แบบ AIM)
// =========================================================================

/**
 * [Phase 4] ค้นหาบิล — รวมตาม poGroupId (col 23) ถ้าเป็นกลุ่มงวด, ไม่งั้นต่อ txId
 * ข้าม "โอนระหว่างบัญชี" + "เช็คราคา" + รายการยกเลิก
 * @param {string} keyword - ค้นจาก "รายละเอียดบิล (description)" เท่านั้น (ว่าง = เอาทั้งหมด)
 * @param {string} entityId
 * @param {{type?:string, accountType?:string, category?:string, contact?:string}} [filters]
 *        ฟิลเตอร์แบบ exact-match (ว่าง = ไม่กรอง field นั้น)
 *        - type        : ประเภทรายการ "รายรับ"/"รายจ่าย"
 *        - accountType : ประเภทบัญชี (Transactions col 4)
 *        - category    : หมวดหมู่รายรับ-รายจ่าย (Transactions col 5)
 *        - contact     : คู่ค้า (Transactions col 6)
 * @returns {{ success, results, options }}
 *          results ≤ 500 รายการ ล่าสุดก่อน · options = ค่า distinct สำหรับ dropdown
 */
function searchBills(keyword, entityId, filters) {
  try {
    filters = filters || {};
    const fType    = String(filters.type        || '').trim();
    const fAccount = String(filters.accountType || '').trim();
    const fCat     = String(filters.category    || '').trim();
    const fContact = String(filters.contact     || '').trim();

    const ss = SpreadsheetApp.openById(getConfig_().SPREADSHEET_ID);
    const tz = Session.getScriptTimeZone();
    const data = ss.getSheetByName('Transactions').getDataRange().getValues();
    const kw = String(keyword || '').trim().toLowerCase();

    const bills = {}, order = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row[18] !== 'ปกติ') continue;
      if (row[3] === 'โอนระหว่างบัญชี' || row[3] === 'เช็คราคา') continue;
      if (!inEntityScope_(row[TX_ENTITY_COL], entityId)) continue;

      const txId = row[0];
      const grp  = row[23] ? String(row[23]) : txId;     // รวมตาม poGroupId ถ้ามี
      const dv   = row[2];
      const d    = (dv instanceof Date) ? dv : new Date(dv);
      const base = parseFloat(row[10]) || 0;             // amountAfterDiscount (ก่อน VAT)
      const desc = String(row[7] || '').replace(/\s*\(งวด \d+\/\d+\)\s*$/, '');

      if (!bills[grp]) {
        bills[grp] = {
          firstTxId: txId, date: d, desc: desc, contact: row[6] || '', type: row[3],
          accountType: row[4] || '', category: row[5] || '',   // [Filter] เก็บจากแถวแรกของกลุ่ม
          priceBeforeVat: 0, installments: 0,
          sortKey: (d instanceof Date && !isNaN(d)) ? d.getTime() : 0
        };
        order.push(grp);
      }
      bills[grp].priceBeforeVat += base;
      if (row[23]) bills[grp].installments++;
      if (d instanceof Date && !isNaN(d) && d.getTime() < bills[grp].sortKey) { bills[grp].sortKey = d.getTime(); bills[grp].date = d; }
    }

    const all = order.map(k => bills[k]);

    // [Filter] รวบรวมค่า distinct จากชุดข้อมูลทั้งหมด (ก่อนกรอง) เพื่อ populate dropdown ฝั่ง client
    const accSet = {}, catSet = {}, conSet = {};
    all.forEach(b => {
      if (b.accountType) accSet[b.accountType] = 1;
      if (b.category)    catSet[b.category]    = 1;
      if (b.contact)     conSet[b.contact]     = 1;
    });

    // [Filter] กรอง — keyword เฉพาะ description, ที่เหลือ exact-match
    let out = all;
    if (kw)       out = out.filter(b => (b.desc || '').toLowerCase().indexOf(kw) !== -1);
    if (fType)    out = out.filter(b => b.type === fType);
    if (fAccount) out = out.filter(b => b.accountType === fAccount);
    if (fCat)     out = out.filter(b => b.category === fCat);
    if (fContact) out = out.filter(b => b.contact === fContact);

    // [Phase B/B4] เรียงตาม "ลำดับการบันทึก" ใหม่→เก่า = firstTxId (TR-yyyyMMdd-NNNN) มาก→น้อย
    out.sort((a, b) => (a.firstTxId < b.firstTxId ? 1 : (a.firstTxId > b.firstTxId ? -1 : 0)));

    const r2 = x => Math.round(x * 100) / 100;
    const res = out.slice(0, 500).map(b => ({
      txId: b.firstTxId,
      isInstallment: b.installments > 0,
      date: (b.date instanceof Date && !isNaN(b.date)) ? Utilities.formatDate(b.date, tz, "dd/MM/yyyy") : String(b.date),
      desc: b.desc || '-', contact: b.contact || '', type: b.type,
      accountType: b.accountType || '', category: b.category || '',
      priceBeforeVat: r2(b.priceBeforeVat), installments: b.installments
    }));
    return JSON.parse(JSON.stringify({
      success: true,
      results: res,
      options: {
        accountTypes: Object.keys(accSet).sort(),
        categories:   Object.keys(catSet).sort(),
        contacts:     Object.keys(conSet).sort()
      }
    }));
  } catch (e) {
    console.error(`[searchBills] ${e.message}`);
    return { success: false, message: e.message };
  }
}

/**
 * [Phase A] ดึงรายการ "หมวดหมู่" + "ระบุงาน" ที่เคยกรอก (ไม่ซ้ำ) สำหรับ autocomplete suggestion
 * @returns {{ success, categories:string[], jobs:string[] }}
 * หมายเหตุ: ไม่มี _ ท้ายชื่อ เพราะต้องเรียกจาก client (google.script.run)
 */
function getItemSuggestions() {
  try {
    const ss = SpreadsheetApp.openById(getConfig_().SPREADSHEET_ID);
    const sheet = ss.getSheetByName('Transaction_Items');
    if (!sheet) return { success: true, categories: [], jobs: [] };
    const v = sheet.getDataRange().getValues();
    const catSet = {}, jobSet = {};
    for (let i = 1; i < v.length; i++) {
      const c = String(v[i][9] || '').trim();   // col 9 หมวดหมู่
      const j = String(v[i][10] || '').trim();  // col 10 ระบุงาน
      if (c) catSet[c] = 1;
      if (j) jobSet[j] = 1;
    }
    return JSON.parse(JSON.stringify({ success: true, categories: Object.keys(catSet).sort(), jobs: Object.keys(jobSet).sort() }));
  } catch (e) {
    return { success: false, message: e.message, categories: [], jobs: [] };
  }
}

/**
 * [Phase 4] ประวัติสินค้า/ราคา — ทุก item ในระบบ (ดูราคาย้อนหลังก่อนสั่งซื้อ/ตั้งราคา)
 * @param {string} entityId
 * @param {boolean} includePriceCheck - รวมรายการ "เช็คราคา" ด้วยไหม
 * @returns {{ success, results }}  results ≤ 1000 ล่าสุดก่อน
 */
function searchItemHistory(entityId, includePriceCheck) {
  try {
    const ss = SpreadsheetApp.openById(getConfig_().SPREADSHEET_ID);
    const tz = Session.getScriptTimeZone();

    const txData = ss.getSheetByName('Transactions').getDataRange().getValues();
    const txMap = {};
    for (let i = 1; i < txData.length; i++) {
      const r = txData[i];
      if (!r[0]) continue;
      txMap[r[0]] = { date: r[2], contact: r[6], entityId: String(r[20] || '').trim(), type: r[3], status: r[18] };
    }

    const itemsSheet = ss.getSheetByName('Transaction_Items');
    if (!itemsSheet) return { success: true, results: [] };
    const items = itemsSheet.getDataRange().getValues();

    const out = [];
    for (let i = 1; i < items.length; i++) {
      const it = items[i];
      const tx = txMap[it[1]];
      if (!tx) continue;
      if (tx.status !== 'ปกติ') continue;                       // ข้ามบิลที่ยกเลิก
      if (!inEntityScope_(tx.entityId, entityId)) continue;
      const isPC = tx.type === 'เช็คราคา';
      if (isPC && !includePriceCheck) continue;

      const d = (tx.date instanceof Date) ? tx.date : new Date(tx.date);
      const valid = (d instanceof Date) && !isNaN(d.getTime());
      out.push({
        date        : valid ? Utilities.formatDate(d, tz, "dd/MM/yyyy") : String(tx.date),
        itemName    : String(it[2] || ''),
        quantity    : it[3],
        exVat       : parseFloat(it[5]) || 0,   // ราคา/หน่วย (ก่อน VAT)
        inVat       : parseFloat(it[4]) || 0,   // ราคา/หน่วย (รวม VAT)
        totalPrice  : parseFloat(it[6]) || 0,
        itemCategory: String(it[9] || ''),      // [Phase A] หมวดหมู่
        itemJob     : String(it[10] || ''),     // [Phase A] ระบุงาน
        contact     : tx.contact || '',
        txId        : String(it[1] || ''),
        isPriceCheck: isPC
      });
    }
    // [Phase A] เรียงตาม "ลำดับการบันทึก" ใหม่→เก่า = txId (TR-yyyyMMdd-NNNN) จากมาก→น้อย
    out.sort((a, b) => (a.txId < b.txId ? 1 : (a.txId > b.txId ? -1 : 0)));
    return JSON.parse(JSON.stringify({ success: true, results: out.slice(0, 1000) }));
  } catch (e) {
    console.error(`[searchItemHistory] ${e.message}`);
    return { success: false, message: e.message };
  }
}
