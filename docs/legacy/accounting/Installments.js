// =========================================================================
// FILE: Installments.gs  [16/16]
// [Phase 3 / #6] แบ่งจ่ายงวด (PO หลายงวด) — ทุกงวด = บิลค้าง AP/AR แยกแถว
//   ผูกกลุ่มด้วย col 23 poGroupId (= txId งวดแรก), col 24 งวดที่, col 25 จำนวนงวด, col 26 dueDate
//   [Option A] col 4 = '' ตอนตั้งค้าง (settle เติมบัญชีจริง) — AP/AR อยู่ที่ col 21
// ⚠️ Transaction_Items = 7 คอลัมน์ · items แนบกับงวดแรก (poGroupId)
// ใช้ helper: readItemsByTxId_, deleteItemsByTxIds_ (TxEdit.gs), buildTxRow_ (TxModel.gs), formatNumber (Reports.gs)
// =========================================================================

/**
 * [Phase 3] สร้างบิลแบ่งจ่ายหลายงวด (ทั้งหมดเป็นหนี้ค้าง)
 * @param {Object} data - { transactionDate, type, category, contactName, description, amountAfterDiscount,
 *                          vatAmount|hasVat, whtRate, entityId, items[], installments:[{percent, dueDate}] }
 * @returns {{ success, message, poGroupId, count }}
 */
function saveTransactionInstallments(data) {
  try {
    const cfg = getConfig_();
    const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
    const txSheet    = ss.getSheetByName('Transactions');
    const itemsSheet = ss.getSheetByName('Transaction_Items');
    const dateObj = new Date();
    const r2 = x => Math.round((Number(x) || 0) * 100) / 100;

    const insts = data.installments || [];
    if (!insts.length) return { success: false, message: 'ไม่มีงวด' };
    const sumPct = insts.reduce((s, i) => s + (parseFloat(i.percent) || 0), 0);
    if (Math.abs(sumPct - 100) > 0.01) return { success: false, message: `ผลรวมเปอร์เซ็นต์ = ${sumPct}% (ต้องเท่ากับ 100%)` };

    const totalBase = parseFloat(data.amountAfterDiscount) || 0;
    const hasVat    = (parseFloat(data.vatAmount) || 0) > 0 || data.hasVat === true;
    const whtRate   = parseFloat(data.whtRate) || 0;
    const apStatus  = (data.type === 'รายรับ') ? 'AR' : 'AP';   // [Option A] จาก type
    const txEntityId = data.entityId || cfg.DEFAULT_ENTITY_ID;

    const N = insts.length;
    const rows = [], txIds = [];
    let accBase = 0;

    for (let i = 0; i < N; i++) {
      const txId = getNextTxId_();
      txIds.push(txId);
      const pct  = (parseFloat(insts[i].percent) || 0) / 100;
      // งวดสุดท้ายซับ remainder กัน rounding สะสม → ผลรวม = totalBase เป๊ะ
      const base = (i < N - 1) ? r2(totalBase * pct) : r2(totalBase - accBase);
      accBase += base;
      const vat  = hasVat ? r2(base * 0.07) : 0;
      const wht  = r2(base * whtRate / 100);
      const net  = r2(base + vat - wht);

      const instData = {
        transactionDate    : data.transactionDate,
        type               : data.type,
        accountType        : '',                       // [Option A] ว่างจน settle
        category           : data.category,
        contactName        : data.contactName,
        description        : (data.description || '') + ` (งวด ${i + 1}/${N})`,
        baseAmount         : base, discount: 0, amountAfterDiscount: base,
        vatAmount          : vat, whtRate: whtRate, whtAmount: wht, netAmount: net,
        taxInvoiceNo       : '', taxInvoiceDate: '',
        entityId           : txEntityId
      };
      const extra = {
        apArStatus      : apStatus,
        poGroupId       : txIds[0],   // txId งวดแรก = รหัสกลุ่ม
        installmentNo   : i + 1,
        installmentTotal: N,
        dueDate         : insts[i].dueDate || ''
      };
      rows.push(buildTxRow_(txId, dateObj, instData, '', extra));
    }

    txSheet.getRange(txSheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);

    // items แนบงวดแรก (เป็นของทั้ง PO — ใช้ค้นประวัติราคาได้)
    if (data.items && data.items.length > 0) {
      const firstId = txIds[0];
      const itemRows = data.items.map((it, idx) => [
        `${firstId}-${(idx + 1).toString().padStart(2, '0')}`, firstId,
        it.itemName, it.quantity, it.inVat, it.exVat, it.totalPrice,
        it.discountPct || 0, it.discountBaht || 0, it.itemCategory || '', it.itemJob || ''
      ]);
      itemsSheet.getRange(itemsSheet.getLastRow() + 1, 1, itemRows.length, itemRows[0].length).setValues(itemRows);
    }

    return { success: true, message: `สร้าง ${N} งวดเรียบร้อย (บันทึกเป็นหนี้ค้างทั้งหมด)`, poGroupId: txIds[0], count: N };
  } catch (e) {
    console.error(`[saveTransactionInstallments] ${e.message}`);
    return { success: false, message: e.message };
  }
}

/**
 * [Phase 3] ดึงรายละเอียดกลุ่มงวด (header + items + ทุกงวด พร้อมสถานะจ่าย)
 * @param {string} poGroupId
 */
function getInstallmentGroup(poGroupId) {
  try {
    const ss = SpreadsheetApp.openById(getConfig_().SPREADSHEET_ID);
    const tz = Session.getScriptTimeZone();
    const data = ss.getSheetByName('Transactions').getDataRange().getValues();
    const grpRows = [];
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][23]).trim() === String(poGroupId).trim() && data[i][18] === 'ปกติ') grpRows.push(data[i]);
    }
    if (!grpRows.length) return { success: false, message: 'ไม่พบกลุ่มงวด ' + poGroupId };

    grpRows.sort((a, b) => (parseInt(a[24]) || 0) - (parseInt(b[24]) || 0));
    const first = grpRows[0];
    const stripDesc = String(first[7] || '').replace(/\s*\(งวด \d+\/\d+\)\s*$/, '');
    const fmt = d => (d instanceof Date) ? Utilities.formatDate(d, tz, "yyyy-MM-dd") : (d ? String(d).substring(0, 10) : '');

    let totalBase = 0;
    const installments = grpRows.map(r => {
      const base = parseFloat(r[10]) || 0; totalBase += base;
      const paid = String(r[21] || '').trim() === '';   // col 21 ว่าง = จ่ายแล้ว
      return { txId: r[0], installmentNo: r[24], base: base, net: parseFloat(r[14]) || 0, paid: paid,
               dueDate: fmt(r[26]), paymentDate: fmt(r[22]), accountType: r[4] };
    });
    const allPaid = installments.every(x => x.paid);
    const anyPaid = installments.some(x => x.paid);

    const header = {
      entityId: first[20], type: first[3], category: first[5], contactName: first[6], description: stripDesc,
      hasVat: grpRows.some(r => (parseFloat(r[11]) || 0) > 0), whtRate: parseFloat(first[12]) || 0,
      transactionDate: fmt(first[2])
    };
    const items = readItemsByTxId_(ss.getSheetByName('Transaction_Items'), poGroupId);

    return JSON.parse(JSON.stringify({
      success: true, poGroupId: poGroupId, header: header, items: items, installments: installments,
      totalBase: Math.round(totalBase * 100) / 100, anyPaid: anyPaid, allPaid: allPaid
    }));
  } catch (e) {
    console.error(`[getInstallmentGroup] ${e.message}`);
    return { success: false, message: e.message };
  }
}

/**
 * [Phase 3] แก้ไขกลุ่มงวด
 *   mode 'A' = ยังไม่จ่ายสักงวด → ลบทั้งกลุ่ม สร้างใหม่ (data.fullData)
 *   mode 'B' = จ่ายบางงวดแล้ว → ลบเฉพาะงวดที่ยังไม่จ่าย แล้วแบ่งยอดคงเหลือใหม่ (data.unpaidInstallments)
 * @param {string} poGroupId
 * @param {Object} data
 */
function updateInstallmentGroup(poGroupId, data) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.openById(getConfig_().SPREADSHEET_ID);
    const txSheet = ss.getSheetByName('Transactions');
    const itSheet = ss.getSheetByName('Transaction_Items');
    const dateObj = new Date();
    const r2 = x => Math.round((Number(x) || 0) * 100) / 100;

    const all = txSheet.getDataRange().getValues();
    const groupIdx = [];
    for (let i = 1; i < all.length; i++) {
      if (String(all[i][23]).trim() === String(poGroupId).trim() && all[i][18] === 'ปกติ') groupIdx.push(i);
    }
    if (!groupIdx.length) { lock.releaseLock(); return { success: false, message: 'ไม่พบกลุ่มงวด' }; }

    // ---------- MODE A: ยังไม่จ่ายสักงวด → สร้างใหม่ทั้งหมด ----------
    if (data.mode === 'A') {
      const anyPaid = groupIdx.some(i => String(all[i][21] || '').trim() === '');
      if (anyPaid) { lock.releaseLock(); return { success: false, message: 'มีงวดที่ชำระแล้ว — ใช้โหมดแก้เฉพาะงวดที่ค้างแทน' }; }
      groupIdx.slice().sort((a, b) => b - a).forEach(i => txSheet.deleteRow(i + 1));
      deleteItemsByTxIds_(itSheet, [poGroupId]);
      lock.releaseLock();
      return saveTransactionInstallments(data.fullData);   // กลุ่มใหม่ (poGroupId ใหม่)
    }

    // ---------- MODE B: จ่ายบางงวด → แบ่งยอดคงเหลือใหม่ ----------
    const paid = [], unpaid = [];
    groupIdx.forEach(i => { (String(all[i][21] || '').trim() === '' ? paid : unpaid).push(i); });
    if (!unpaid.length) { lock.releaseLock(); return { success: false, message: 'ทุกงวดชำระแล้ว แก้ไม่ได้' }; }

    let totalBase = 0; groupIdx.forEach(i => totalBase += parseFloat(all[i][10]) || 0);
    let paidBase = 0; paid.forEach(i => paidBase += parseFloat(all[i][10]) || 0);
    const remaining = r2(totalBase - paidBase);
    if (remaining <= 0) { lock.releaseLock(); return { success: false, message: 'ไม่มียอดคงเหลือให้แบ่ง' }; }

    const insts = data.unpaidInstallments || [];
    const sumPct = insts.reduce((sm, x) => sm + (parseFloat(x.percent) || 0), 0);
    if (!insts.length || sumPct <= 0) { lock.releaseLock(); return { success: false, message: 'กรุณาระบุงวดที่ยังไม่จ่ายให้ถูกต้อง' }; }

    const hRow = all[groupIdx[0]];
    const type = hRow[3];
    const apStatus = (type === 'รายรับ') ? 'AR' : 'AP';
    const hasVat = groupIdx.some(i => (parseFloat(all[i][11]) || 0) > 0);
    const whtRate = parseFloat(hRow[12]) || 0;
    const baseDesc = String(hRow[7] || '').replace(/\s*\(งวด \d+\/\d+\)\s*$/, '');
    const entityId = hRow[20], contactName = hRow[6], category = hRow[5];
    const txnDate = (hRow[2] instanceof Date) ? Utilities.formatDate(hRow[2], Session.getScriptTimeZone(), "yyyy-MM-dd") : String(hRow[2]).substring(0, 10);

    // poGroupId = txId งวดแรก; ถ้า "งวดแรก" ยังไม่จ่าย เราจะลบมัน → ต้องย้าย items ไปงวดใหม่ตัวแรก
    const anchorPaid = paid.some(i => String(all[i][0]).trim() === String(poGroupId).trim());
    let savedItems = null;
    if (!anchorPaid) savedItems = readItemsByTxId_(itSheet, poGroupId);

    unpaid.slice().sort((a, b) => b - a).forEach(i => txSheet.deleteRow(i + 1));
    if (!anchorPaid) deleteItemsByTxIds_(itSheet, [poGroupId]);

    const N = insts.length, paidCount = paid.length;
    const rows = [], newTxIds = [];
    let acc = 0;
    for (let k = 0; k < N; k++) {
      const txId = getNextTxId_(); newTxIds.push(txId);
      const w = (parseFloat(insts[k].percent) || 0) / sumPct;   // normalize → แบ่งยอดคงเหลือ
      const base = (k < N - 1) ? r2(remaining * w) : r2(remaining - acc);
      acc += base;
      const vat = hasVat ? r2(base * 0.07) : 0;
      const wht = r2(base * whtRate / 100);
      const net = r2(base + vat - wht);
      const instData = {
        transactionDate: txnDate, type: type, accountType: '', category: category,
        contactName: contactName, description: baseDesc + ` (งวด ${paidCount + k + 1}/${paidCount + N})`,
        baseAmount: base, discount: 0, amountAfterDiscount: base, vatAmount: vat, whtRate: whtRate, whtAmount: wht, netAmount: net,
        taxInvoiceNo: '', taxInvoiceDate: '', entityId: entityId
      };
      const extra = { apArStatus: apStatus, poGroupId: poGroupId, installmentNo: paidCount + k + 1, installmentTotal: paidCount + N, dueDate: insts[k].dueDate || '' };
      rows.push(buildTxRow_(txId, dateObj, instData, '', extra));
    }
    txSheet.getRange(txSheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);

    // ถ้า anchor (งวดแรก) ถูกลบ → ผูก items กลับใต้ poGroupId เดิม (key คงที่ — getInstallmentGroup หาเจอเสมอ)
    if (!anchorPaid && savedItems && savedItems.length) {
      const firstId = poGroupId;
      const itemRows = savedItems.map((it, i) => [
        `${firstId}-${(i + 1).toString().padStart(2, '0')}`, firstId,
        it.itemName, it.quantity, it.inVat, it.exVat, it.totalPrice,
        it.discountPct || 0, it.discountBaht || 0, it.itemCategory || '', it.itemJob || ''
      ]);
      itSheet.getRange(itSheet.getLastRow() + 1, 1, itemRows.length, itemRows[0].length).setValues(itemRows);
    }

    lock.releaseLock();
    return { success: true, message: `แก้งวดที่ยังไม่จ่ายเรียบร้อย (สร้าง ${N} งวดใหม่ จากยอดคงเหลือ ${formatNumber(remaining)})`, poGroupId: poGroupId };
  } catch (e) {
    try { lock.releaseLock(); } catch (_) {}
    console.error(`[updateInstallmentGroup] ${e.message}`);
    return { success: false, message: e.message };
  }
}
