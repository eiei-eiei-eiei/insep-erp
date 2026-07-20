// =========================================================================
// FILE: PriceCheck.gs  [15/16]
// [Phase 5 / N3] เช็คราคา — บันทึกใบเช็คราคาเป็น tx type='เช็คราคา' (ยอด 0)
//   ใช้เก็บประวัติราคาสินค้า/วัตถุดิบ โดยไม่กระทบบัญชี/ภาษี
//   - col 4 (accountType) = '' , category = 'เช็คราคา' → ไม่เข้า taxAccountSet → หลุดทุกรายงาน
//   - ดึงดูได้ผ่าน searchItemHistory(includePriceCheck=true)
// ⚠️ Transaction_Items = 7 คอลัมน์
// =========================================================================

/**
 * [Phase 5] บันทึกใบเช็คราคา
 * @param {Object} data - { date?, contactName?, note?, entityId, items:[{itemName,quantity,inVat,exVat,totalPrice}] }
 * @returns {{ success, message, txId }}
 */
function savePriceCheck(data) {
  try {
    const cfg = getConfig_();
    const ss  = SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
    const txSheet    = ss.getSheetByName('Transactions');
    const itemsSheet = ss.getSheetByName('Transaction_Items');
    if (!data.items || !data.items.length) return { success: false, message: 'กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ' };

    const dateObj = new Date();
    const txId    = getNextTxId_();
    const txEntityId = data.entityId || cfg.DEFAULT_ENTITY_ID;

    // buildTxRow_: type/category='เช็คราคา', accountType ว่าง, ยอดทั้งหมด 0, apArStatus '' (default)
    const row = buildTxRow_(txId, dateObj, {
      transactionDate    : data.date || Utilities.formatDate(dateObj, Session.getScriptTimeZone(), "yyyy-MM-dd"),
      type               : 'เช็คราคา',
      accountType        : '',
      category           : 'เช็คราคา',
      contactName        : data.contactName || '',
      description        : data.note || '',
      baseAmount         : 0, discount: 0, amountAfterDiscount: 0, vatAmount: 0,
      whtRate            : 0, whtAmount: 0, netAmount: 0,
      taxInvoiceNo       : '', taxInvoiceDate: '',
      entityId           : txEntityId
    }, '');
    txSheet.appendRow(row);

    const itemRows = data.items.map((it, i) => [
      `${txId}-${(i + 1).toString().padStart(2, '0')}`, txId,
      it.itemName, it.quantity, it.inVat, it.exVat, it.totalPrice,
      it.discountPct || 0, it.discountBaht || 0, it.itemCategory || '', ''   // [Phase A] เช็คราคามีหมวดหมู่ ไม่มีระบุงาน
    ]);
    itemsSheet.getRange(itemsSheet.getLastRow() + 1, 1, itemRows.length, itemRows[0].length).setValues(itemRows);

    return { success: true, message: 'บันทึกการเช็คราคาเรียบร้อย', txId: txId };
  } catch (e) {
    console.error(`[savePriceCheck] ${e.message}`);
    return { success: false, message: e.message };
  }
}
