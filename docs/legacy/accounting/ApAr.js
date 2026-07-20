// =========================================================================
// FILE: ApAr.gs  [11/12]
// [Phase 2 / #5] ลูกหนี้-เจ้าหนี้ (AP/AR) — รายงานยอดค้าง + บันทึกการชำระ (settle)
//
// หลักการ (Option A):
//   - บิลตั้งค้าง = แถว Transactions ที่ col 21 (apArStatus) = 'AP' หรือ 'AR'
//     · AP = เจ้าหนี้ (เราติดเงินเขา)  → type 'รายจ่าย'
//     · AR = ลูกหนี้ (เขาติดเงินเรา)  → type 'รายรับ'
//   - col 4 (ชื่อบัญชี) เว้นว่างตอนตั้งค้าง (ยังไม่รู้จ่ายจากบัญชีไหน) → เติมตอน settle
//   - ทุกรายงาน/ยอดเงิน skip แถวที่ col 21 != '' (ดู guard ใน Reports.gs/Accounts.gs)
//   - settle = เคลียร์ col 21 + เซ็ต col 22 paymentDate + col 4 บัญชีที่ใช้จ่าย
//     → แถวกลายเป็น "ปกติ" เข้ารายงาน/ยอดเงินตามวันใบกำกับ (cash-basis แบบ AIM)
// =========================================================================

/**
 * [Phase 2] รายงานยอดค้าง AP/AR ของกิจการที่เลือก
 * @param {string} entityId - กิจการ ('ALL' = ทุกกิจการ)
 * @returns {{ success, payable, receivable, totalAP, totalAR,
 *             payableByContact, receivableByContact }}
 */
function getApArReport(entityId) {
  try {
    const ss   = SpreadsheetApp.openById(getConfig_().SPREADSHEET_ID);
    const data = ss.getSheetByName('Transactions').getDataRange().getValues();   // อ่านครั้งเดียว
    const tz   = Session.getScriptTimeZone();

    const payable = [], receivable = [];
    let totalAP = 0, totalAR = 0;

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row[18] !== 'ปกติ') continue;                              // ข้ามที่ถูกยกเลิก
      const status = String(row[21] || '').trim();                   // col 21 = AP/AR
      if (status !== 'AP' && status !== 'AR') continue;              // เอาเฉพาะที่ยังค้าง
      if (!inEntityScope_(row[TX_ENTITY_COL], entityId)) continue;   // [Multi-Entity]

      const dueVal = row[26];   // col 26 dueDate
      const rec = {
        transactionId: row[0],
        date         : (row[2] instanceof Date) ? Utilities.formatDate(row[2], tz, "dd/MM/yyyy") : row[2],
        dueDate      : (dueVal instanceof Date) ? Utilities.formatDate(dueVal, tz, "dd/MM/yyyy") : (dueVal || ''),
        contactName  : row[6],
        category     : row[5],
        description  : row[7],
        amount       : parseFloat(row[14]) || 0,                     // netAmount = ยอดจ่าย/รับจริง
        installment  : row[24] ? (row[24] + '/' + (row[25] || '')) : ''   // งวดที่/ทั้งหมด (Phase 3)
      };
      if (status === 'AP') { payable.push(rec);    totalAP += rec.amount; }
      else                 { receivable.push(rec); totalAR += rec.amount; }
    }

    return JSON.parse(JSON.stringify({
      success            : true,
      payable, receivable, totalAP, totalAR,
      payableByContact   : groupByContact_(payable),
      receivableByContact: groupByContact_(receivable)
    }));
  } catch (e) {
    console.error(`[getApArReport] ${e.message}`);
    return { success: false, message: e.message };
  }
}

/**
 * [Phase 2] สรุปยอดรวมต่อคู่ค้า (เป็นหนี้ใคร/ลูกหนี้ใคร เท่าไหร่) เรียงมาก→น้อย
 * @param {Array} arr - รายการ AP หรือ AR
 * @returns {Array<{contactName, total}>}
 */
function groupByContact_(arr) {
  const m = {};
  arr.forEach(r => { m[r.contactName] = (m[r.contactName] || 0) + r.amount; });
  return Object.keys(m)
    .map(name => ({ contactName: name, total: m[name] }))
    .sort((a, b) => b.total - a.total);
}

/**
 * [Phase 2] บันทึกการชำระบิลค้าง (settle) — เคลียร์สถานะ AP/AR
 *
 * @param {string} txId
 * @param {Object} payload
 *   payload.accountName    - ชื่อบัญชีที่ใช้จ่าย/รับ (ลง col 4) [Option A]
 *   payload.paymentDate    - "yyyy-MM-dd" วันที่ชำระ (ลง col 22)
 *   payload.taxInvoiceNo   - (optional) อัปเดตเลขใบกำกับ (col 15)
 *   payload.taxInvoiceDate - (optional) วันที่ใบกำกับ (col 16)
 * @returns {{ success, message }}
 */
function settleApAr(txId, payload) {
  payload = payload || {};
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss      = SpreadsheetApp.openById(getConfig_().SPREADSHEET_ID);
    const txSheet = ss.getSheetByName('Transactions');
    // อ่านเฉพาะ col A (txId) — เบากว่าอ่านทั้งชีท
    const ids = txSheet.getRange(1, 1, txSheet.getLastRow(), 1).getValues();

    for (let i = 1; i < ids.length; i++) {
      if (String(ids[i][0]).trim() === String(txId).trim()) {
        const rowNum = i + 1;   // 1-based row number
        const tz = Session.getScriptTimeZone();
        // [Option A] col 4 (range col 5) = ชื่อบัญชีจริงที่ใช้ชำระ
        if (payload.accountName)    txSheet.getRange(rowNum, 5).setValue(payload.accountName);
        if (payload.taxInvoiceNo)   txSheet.getRange(rowNum, 16).setValue(payload.taxInvoiceNo);    // เขียนเฉพาะเมื่อกรอก
        if (payload.taxInvoiceDate) txSheet.getRange(rowNum, 17).setValue(payload.taxInvoiceDate);
        txSheet.getRange(rowNum, 22).setValue('');   // col 21 apArStatus → '' (settled)
        txSheet.getRange(rowNum, 23).setValue(       // col 22 paymentDate
          payload.paymentDate || Utilities.formatDate(new Date(), tz, "yyyy-MM-dd")
        );
        lock.releaseLock();
        return { success: true, message: 'บันทึกการชำระเรียบร้อย' };
      }
    }
    lock.releaseLock();
    return { success: false, message: 'ไม่พบรายการ ' + txId };
  } catch (e) {
    try { lock.releaseLock(); } catch (_) {}
    console.error(`[settleApAr] ${e.message}`);
    return { success: false, message: e.message };
  }
}
