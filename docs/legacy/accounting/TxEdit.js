// =========================================================================
// FILE: TxEdit.gs  [13/16]
// [Phase 4 / N2] แก้ไข/ลบ บิลย้อนหลัง + helper อ่าน/ลบ items (ใช้ร่วมกับ Installments.gs)
// ⚠️ Transaction_Items = 7 คอลัมน์ [id, txId, itemName, qty, inVat, exVat, totalPrice]
//    (split ไม่เก็บ discountPct/itemCategory/itemJob แบบ AIM — ตัดออกให้ตรง schema เดิม)
// =========================================================================

/**
 * อ่าน items ของ txId หนึ่ง ๆ → array (7 ฟิลด์)
 * @param {Sheet} itSheet - Transaction_Items sheet (ส่ง null ได้ → คืน [])
 * @param {string} txId
 */
function readItemsByTxId_(itSheet, txId) {
  const out = [];
  if (!itSheet) return out;
  const v = itSheet.getDataRange().getValues();
  for (let i = 1; i < v.length; i++) {
    if (String(v[i][1]).trim() === String(txId).trim()) {
      out.push({ itemName: v[i][2], quantity: v[i][3], inVat: v[i][4], exVat: v[i][5], totalPrice: v[i][6],
                 discountPct: v[i][7] || 0, discountBaht: v[i][8] || 0, itemCategory: v[i][9] || '', itemJob: v[i][10] || '' });
    }
  }
  return out;
}

/**
 * ลบ items ของ txId ที่ระบุ (รับได้หลาย txId) — วน reverse กัน index เลื่อน
 * @param {Sheet} itSheet
 * @param {string[]} txIds
 */
function deleteItemsByTxIds_(itSheet, txIds) {
  if (!itSheet) return;
  const set = {};
  txIds.forEach(t => set[String(t).trim()] = 1);
  const v = itSheet.getDataRange().getValues();
  for (let i = v.length - 1; i >= 1; i--) {
    if (set[String(v[i][1]).trim()]) itSheet.deleteRow(i + 1);
  }
}

/**
 * [Phase 4] ดึงข้อมูลบิล 1 ใบ (header + items) สำหรับเปิดในฟอร์มแก้ไข
 * @param {string} txId
 * @returns {{ success, tx, items }}
 */
function getTransactionForEdit(txId) {
  try {
    const ss = SpreadsheetApp.openById(getConfig_().SPREADSHEET_ID);
    const tz = Session.getScriptTimeZone();
    const txData = ss.getSheetByName('Transactions').getDataRange().getValues();
    let row = null;
    for (let i = 1; i < txData.length; i++) {
      if (String(txData[i][0]).trim() === String(txId).trim()) { row = txData[i]; break; }
    }
    if (!row) return { success: false, message: 'ไม่พบรายการ ' + txId };

    const fmtDate = d => (d instanceof Date) ? Utilities.formatDate(d, tz, "yyyy-MM-dd") : (d ? String(d).substring(0, 10) : '');
    const cleanInv = v => (!v || v === '-') ? '' : String(v);
    const tx = {
      txId: row[0], transactionDate: fmtDate(row[2]), type: row[3], accountType: row[4],
      category: row[5], contactName: row[6], description: row[7],
      baseAmount: row[8], discount: row[9], amountAfterDiscount: row[10], vatAmount: row[11],
      whtRate: row[12], whtAmount: row[13], netAmount: row[14],
      taxInvoiceNo: cleanInv(row[15]), taxInvoiceDate: fmtDate(row[16]),
      entityId: row[20], apArStatus: row[21]
    };
    const items = readItemsByTxId_(ss.getSheetByName('Transaction_Items'), txId);
    return JSON.parse(JSON.stringify({ success: true, tx: tx, items: items }));
  } catch (e) {
    console.error(`[getTransactionForEdit] ${e.message}`);
    return { success: false, message: e.message };
  }
}

/**
 * [Phase 4] แก้ไขบิล 1 ใบ — เขียนทับ field หลัก + แทนที่ items
 * [Option A] ไม่แตะ col 21 apArStatus (คงสถานะชำระเดิม — เปลี่ยนผ่าน settle เท่านั้น)
 * @param {string} txId
 * @param {Object} data - เหมือน payload ของ saveTransaction (+ imageObj optional)
 * @returns {{ success, message, txId }}
 */
function updateTransaction(txId, data) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const cfg = getConfig_();
    const ss = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
    const txSheet = ss.getSheetByName('Transactions');
    const ids = txSheet.getRange(1, 1, txSheet.getLastRow(), 1).getValues();
    let rowNum = -1;
    for (let i = 1; i < ids.length; i++) {
      if (String(ids[i][0]).trim() === String(txId).trim()) { rowNum = i + 1; break; }
    }
    if (rowNum < 0) { lock.releaseLock(); return { success: false, message: 'ไม่พบรายการ ' + txId }; }

    const cur = txSheet.getRange(rowNum, 1, 1, 27).getValues()[0];

    // รูปสลิป: ถ้าอัปใหม่ → แทนที่, ไม่งั้นคงเดิม (col 17)
    let receiptUrl = cur[17];
    if (data.imageObj && data.imageObj.base64) {
      const folderId = cfg.RECEIPT_FOLDER_ID;
      if (folderId) {
        const folder = DriveApp.getFolderById(folderId);
        const blob = Utilities.newBlob(
          Utilities.base64Decode(data.imageObj.base64.split(',')[1]),
          data.imageObj.base64.split(':')[1].split(';')[0],
          txId + '_' + data.imageObj.filename
        );
        receiptUrl = folder.createFile(blob).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW).getUrl();
      }
    }

    // เขียนทับ col index 2..16 (column 3..17) = transactionDate..taxInvoiceDate
    txSheet.getRange(rowNum, 3, 1, 15).setValues([[
      data.transactionDate, data.type, data.accountType, data.category, data.contactName, data.description,
      data.baseAmount, data.discount, data.amountAfterDiscount, data.vatAmount, data.whtRate, data.whtAmount, data.netAmount,
      data.taxInvoiceNo, data.taxInvoiceDate
    ]]);
    txSheet.getRange(rowNum, 18).setValue(receiptUrl);                 // col 17 receiptImageUrl
    txSheet.getRange(rowNum, 21).setValue(data.entityId || cur[20]);   // col 20 entityId
    // (col 21 apArStatus คงเดิม — ไม่เขียนทับ)

    // แทนที่ items ทั้งหมดของ txId นี้
    const itSheet = ss.getSheetByName('Transaction_Items');
    if (itSheet) {
      const itVals = itSheet.getDataRange().getValues();
      for (let i = itVals.length - 1; i >= 1; i--) {
        if (String(itVals[i][1]).trim() === String(txId).trim()) itSheet.deleteRow(i + 1);
      }
      if (data.items && data.items.length > 0) {
        const itemRows = data.items.map((item, i) => [
          `${txId}-${(i + 1).toString().padStart(2, '0')}`, txId,
          item.itemName, item.quantity, item.inVat, item.exVat, item.totalPrice,
          item.discountPct || 0, item.discountBaht || 0, item.itemCategory || '', item.itemJob || ''
        ]);
        itSheet.getRange(itSheet.getLastRow() + 1, 1, itemRows.length, itemRows[0].length).setValues(itemRows);
      }
    }

    lock.releaseLock();
    return { success: true, message: 'แก้ไขบิลเรียบร้อย', txId: txId };
  } catch (e) {
    try { lock.releaseLock(); } catch (_) {}
    console.error(`[updateTransaction] ${e.message}`);
    return { success: false, message: e.message };
  }
}

/**
 * [Phase 4] ลบบิล (soft delete) — set col 18 status = 'ยกเลิก' (ทุกรายงานข้าม row[18]!=='ปกติ')
 * รองรับลบทั้งกลุ่มงวด (ถ้าส่ง poGroupId)
 * @param {string} txId
 * @returns {{ success, message }}
 */
function voidTransaction(txId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.openById(getConfig_().SPREADSHEET_ID);
    const txSheet = ss.getSheetByName('Transactions');
    const data = txSheet.getDataRange().getValues();
    let n = 0;
    for (let i = 1; i < data.length; i++) {
      // ลบ row ที่ txId ตรง หรืออยู่กลุ่มงวดเดียวกัน (col 23 poGroupId = txId)
      if (String(data[i][0]).trim() === String(txId).trim() ||
          String(data[i][23] || '').trim() === String(txId).trim()) {
        txSheet.getRange(i + 1, 19).setValue('ยกเลิก');   // col 18 status (1-based = 19)
        n++;
      }
    }
    lock.releaseLock();
    if (n === 0) return { success: false, message: 'ไม่พบรายการ ' + txId };
    return { success: true, message: `ยกเลิกบิลเรียบร้อย (${n} รายการ)` };
  } catch (e) {
    try { lock.releaseLock(); } catch (_) {}
    return { success: false, message: e.message };
  }
}
